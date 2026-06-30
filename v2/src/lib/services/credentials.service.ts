import { withTenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";
import { decryptPayload, EncryptedPayload } from "@/lib/core/encryption";
import { getProviderAliases, canonicalProvider, isThreeSixtyProvider } from "@/lib/core/provider-aliases";

const log = logger.withContext({ module: "CredentialsService" });

export interface ResolvedCredentials {
  accessToken: string | null;
  whatsappPhoneNumberId: string | null;
  whatsappBusinessAccountId: string | null;
  metaPageId: string | null;
  instagramId: string | null;
  source: "v2_channels" | "v1_legacy" | "none" | "env_fallback";
  channelId?: string | null;
  provider?: string | null;
}

/**
 * Returns true if V1 legacy credential fallback is allowed.
 * Default: false (V2 channel_integrations is the only source).
 * Set USE_V1_CREDENTIAL_FALLBACK=true to enable legacy tenants.meta_page_token fallback.
 */
function isV1FallbackEnabled(): boolean {
  return process.env.USE_V1_CREDENTIAL_FALLBACK === 'true';
}

export class CredentialsService {
  /**
   * Resolves credentials for a given tenant and channel provider.
   * 
   * Resolution chain:
   *   1. V2: channel_integrations.credentials_encrypted (tenant-isolated) — ALWAYS PRIMARY
   *   2. V1: tenants.meta_page_token (ONLY if USE_V1_CREDENTIAL_FALLBACK=true)
   *   3. ENV Fallback: THREE_SIXTY_DIALOG_API_KEY_FALLBACK (for 360dialog first deploy/rollback)
   *   4. HARD FAIL: returns nulls (caller must handle)
   * 
   * ENV fallback has been permanently removed for Meta but supported as fallback for 360dialog.
   */
  static async resolveCredentials(
    tenantId: string,
    provider: "whatsapp" | "messenger" | "instagram"
  ): Promise<ResolvedCredentials> {
    try {
      const db = withTenantDB(tenantId);
      
      // ── LAYER 1: V2 Channel Integrations (Tenant-Isolated) ──
      // Uses provider aliases: 'instagram' matches both 'instagram' and 'meta_instagram'
      const providerAliases = getProviderAliases(provider);
      const v2Results = await db.executeSafe({
        text: `
          SELECT ci.credentials_encrypted,
                 ci.provider as integration_provider,
                 ci.health_status,
                 ci.last_sync_at,
                 c.identifier,
                 c.id as channel_id,
                 c.provider,
                 c.name
          FROM channels c
          JOIN channel_groups cg ON c.group_id = cg.id
          LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
          WHERE cg.tenant_id = $1 
            AND c.provider = ANY($2::text[])
            AND c.status = 'active'
          ORDER BY
            CASE
              WHEN c.provider IN ('360dialog', '360dialog_whatsapp') THEN 0
              WHEN ci.provider IN ('360dialog', '360dialog_whatsapp') THEN 0
              WHEN LOWER(COALESCE(c.name, '')) LIKE '%360dialog%' THEN 0
              WHEN ci.health_status = 'healthy' THEN 1
              WHEN ci.credentials_encrypted IS NOT NULL THEN 2
              ELSE 3
            END,
            ci.last_sync_at DESC NULLS LAST,
            c.created_at DESC NULLS LAST
          LIMIT 1
        `,
        values: [tenantId, providerAliases]
      }) as any[];

      if (v2Results && v2Results.length > 0) {
        const row = v2Results[0];
        let accessToken = null;
        
        if (row.credentials_encrypted) {
          try {
            const parsed = JSON.parse(row.credentials_encrypted);
            
            // ── Encrypted envelope: { version, provider, encrypted_payload } ──
            if (parsed.encrypted_payload && parsed.version) {
              try {
                const decrypted = decryptPayload(parsed as EncryptedPayload);
                // Decrypted keys use snake_case: access_token, page_token, phone_number_id
                accessToken = decrypted.access_token || decrypted.accessToken || decrypted.page_token || null;
                // Override phoneNumberId if present in decrypted payload
                if (decrypted.phone_number_id) {
                  row.__decryptedPhoneNumberId = decrypted.phone_number_id;
                }
                log.info("[CREDENTIAL_DECRYPTED] Successfully decrypted V2 credentials", {
                  tenantId, provider, hasToken: !!accessToken
                });
              } catch (decryptErr) {
                log.error("[CREDENTIAL_DECRYPT_FAILED] Could not decrypt encrypted_payload", decryptErr instanceof Error ? decryptErr : new Error(String(decryptErr)), {
                  tenantId, provider, version: parsed.version
                });
              }
            }
            // ── Plain JSON: { accessToken: "..." } ──
            else if (parsed.accessToken) {
              accessToken = parsed.accessToken;
            }
          } catch {
            // ── Raw string token (not JSON) ──
            accessToken = row.credentials_encrypted;
          }
        }

        if (row.credentials_encrypted && !accessToken) {
          log.error("[CREDENTIAL_UNREADABLE] V2 channel credentials exist but could not be decrypted/read. Refusing fallback to avoid using a stale outbound key.", undefined, {
            tenantId,
            provider,
            channelId: row.channel_id,
            channelProvider: row.provider,
            integrationProvider: row.integration_provider
          });
          return {
            accessToken: null,
            whatsappPhoneNumberId: null,
            whatsappBusinessAccountId: null,
            metaPageId: null,
            instagramId: null,
            source: "none",
            channelId: row.channel_id,
            provider: row.provider
          };
        }

        if (accessToken) {
          log.info("[CREDENTIAL_RESOLVED] V2 channel credentials found", {
            tenantId, provider, channelId: row.channel_id, source: "v2_channels"
          });
          
          const inferredThreeSixty =
            isThreeSixtyProvider(row.provider) ||
            isThreeSixtyProvider(row.integration_provider) ||
            String(row.name || '').toLowerCase().includes('360dialog');
          const isCoexistence = provider === "whatsapp" && process.env.ENABLE_360DIALOG_COEXISTENCE === "true";
          // A tenant-updated channel key must always win. The environment fallback exists only
          // for first deploy/rollback when no V2 key is stored; otherwise a stale fallback can
          // make the UI look updated while outbound 360dialog sends use the wrong key.
          const finalToken = accessToken;

          return {
            accessToken: finalToken,
            whatsappPhoneNumberId: provider === "whatsapp" ? (row.__decryptedPhoneNumberId || row.identifier) : null,
            whatsappBusinessAccountId: null,
            metaPageId: provider === "messenger" ? row.identifier : null,
            instagramId: provider === "instagram" ? row.identifier : null,
            source: "v2_channels",
            channelId: row.channel_id,
            provider: (isCoexistence || inferredThreeSixty) ? "360dialog" : row.provider
          };
        }
      }

      // ── LAYER 2: V1 Legacy Tenant Columns (Feature-Flag Gated) ──
      if (isV1FallbackEnabled()) {
        const legacyResults = await db.executeSafe({
          text: `
            SELECT meta_page_token, whatsapp_phone_id, whatsapp_business_id, meta_page_id, instagram_id
            FROM tenants
            WHERE id = $1
            LIMIT 1
          `,
          values: [tenantId]
        }) as any[];

        if (legacyResults && legacyResults.length > 0) {
          const t = legacyResults[0];
          if (t.meta_page_token) {
            log.warn("[CREDENTIAL_RESOLVED] Using V1 legacy credentials — should migrate to V2", {
              tenantId, provider, source: "v1_legacy"
            });
            return {
              accessToken: t.meta_page_token || null,
              whatsappPhoneNumberId: t.whatsapp_phone_id || null,
              whatsappBusinessAccountId: t.whatsapp_business_id || null,
              metaPageId: t.meta_page_id || null,
              instagramId: t.instagram_id || null,
              source: "v1_legacy",
              provider: provider
            };
          }
        }
      } else {
        log.info("[V1_CREDENTIAL_FALLBACK_DISABLED] V1 tenants fallback skipped", {
          tenantId, provider
        });
      }

      // ── LAYER 3: 360dialog Coexistence Fallback API Key from environment variables ──
      const fallbackApiKey = process.env.THREE_SIXTY_DIALOG_API_KEY_FALLBACK;
      if (provider === "whatsapp" && fallbackApiKey) {
        log.info("[CREDENTIAL_RESOLVED] Using fallback 360dialog API Key from environment variables", {
          tenantId, provider, source: "env_fallback"
        });
        return {
          accessToken: fallbackApiKey,
          whatsappPhoneNumberId: null, // REMOVED: hardcoded phone — resolved via channel provider-awareness
          whatsappBusinessAccountId: null,
          metaPageId: null,
          instagramId: null,
          source: "env_fallback",
          provider: "360dialog"
        };
      }
    } catch (err) {
      log.error("[CREDENTIAL_MISSING] DB credential resolution failed", err instanceof Error ? err : new Error(String(err)), {
        tenantId, provider
      });
    }

    // ── HARD FAIL: No credentials found ──
    log.error("[CREDENTIAL_MISSING] No credentials found — V2 empty, V1 fallback disabled", undefined, {
      tenantId, provider, v1FallbackEnabled: isV1FallbackEnabled()
    });
    return {
      accessToken: null,
      whatsappPhoneNumberId: null,
      whatsappBusinessAccountId: null,
      metaPageId: null,
      instagramId: null,
      source: "none"
    };
  }
}
