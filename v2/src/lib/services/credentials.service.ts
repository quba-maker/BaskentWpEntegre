import { withTenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: "CredentialsService" });

export interface ResolvedCredentials {
  accessToken: string | null;
  whatsappPhoneNumberId: string | null;
  whatsappBusinessAccountId: string | null;
  metaPageId: string | null;
  instagramId: string | null;
  source: "v2_channels" | "v1_legacy" | "env_fallback";
  channelId?: string | null;
}

/**
 * Returns true if ENV credential fallback is allowed.
 * Default: false (strict tenant isolation mode).
 * Set ALLOW_ENV_CREDENTIAL_FALLBACK=true to enable legacy behavior during emergency recovery.
 */
function isEnvFallbackAllowed(): boolean {
  return process.env.ALLOW_ENV_CREDENTIAL_FALLBACK === 'true';
}

export class CredentialsService {
  /**
   * Resolves credentials for a given tenant and channel provider.
   * 
   * Resolution chain (strict priority):
   *   1. V2: channel_integrations.credentials_encrypted (tenant-isolated)
   *   2. V1: tenants.meta_page_token (legacy, tenant-scoped)
   *   3. ENV: process.env (ONLY if ALLOW_ENV_CREDENTIAL_FALLBACK=true)
   * 
   * If no credentials found and ENV fallback is disabled, returns nulls.
   * Caller MUST check for null and throw hard error.
   */
  static async resolveCredentials(
    tenantId: string,
    provider: "whatsapp" | "messenger" | "instagram"
  ): Promise<ResolvedCredentials> {
    try {
      const db = withTenantDB(tenantId);
      
      // ── LAYER 1: V2 Channel Integrations (Tenant-Isolated) ──
      const v2Results = await db.executeSafe({
        text: `
          SELECT ci.credentials_encrypted, c.identifier, c.id as channel_id
          FROM channels c
          JOIN channel_groups cg ON c.group_id = cg.id
          LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
          WHERE cg.tenant_id = $1 
            AND c.provider = $2
          LIMIT 1
        `,
        values: [tenantId, provider]
      }) as any[];

      if (v2Results && v2Results.length > 0) {
        const row = v2Results[0];
        let accessToken = null;
        
        if (row.credentials_encrypted) {
          try {
            const creds = JSON.parse(row.credentials_encrypted);
            accessToken = creds.accessToken || null;
          } catch {
            accessToken = row.credentials_encrypted;
          }
        }

        if (accessToken) {
          log.info("[CREDENTIAL_RESOLVED] V2 channel credentials found", {
            tenantId, provider, channelId: row.channel_id, source: "v2_channels"
          });
          return {
            accessToken,
            whatsappPhoneNumberId: provider === "whatsapp" ? row.identifier : null,
            whatsappBusinessAccountId: null,
            metaPageId: provider === "messenger" ? row.identifier : null,
            instagramId: provider === "instagram" ? row.identifier : null,
            source: "v2_channels",
            channelId: row.channel_id
          };
        }
      }

      // ── LAYER 2: V1 Legacy Tenant Columns ──
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
            source: "v1_legacy"
          };
        }
      }
    } catch (err) {
      log.error("[CREDENTIAL_MISSING] DB credential resolution failed", err instanceof Error ? err : new Error(String(err)), {
        tenantId, provider
      });
    }

    // ── LAYER 3: ENV Fallback (Feature-Flag Gated) ──
    if (isEnvFallbackAllowed()) {
      log.warn("[CREDENTIAL_SOURCE] ENV fallback ACTIVATED — emergency recovery mode", {
        tenantId, provider, source: "env_fallback", flag: "ALLOW_ENV_CREDENTIAL_FALLBACK=true"
      });
      return {
        accessToken: process.env.META_ACCESS_TOKEN || null,
        whatsappPhoneNumberId: process.env.PHONE_NUMBER_ID || null,
        whatsappBusinessAccountId: null,
        metaPageId: process.env.PAGE_ACCESS_TOKEN || null,
        instagramId: process.env.IG_TOKEN_1 || null,
        source: "env_fallback"
      };
    }

    // ── HARD FAIL: No credentials and ENV fallback disabled ──
    log.error("[CREDENTIAL_MISSING] No credentials found and ENV fallback is DISABLED", undefined, {
      tenantId, provider, envFallbackAllowed: false
    });
    return {
      accessToken: null,
      whatsappPhoneNumberId: null,
      whatsappBusinessAccountId: null,
      metaPageId: null,
      instagramId: null,
      source: "env_fallback"
    };
  }
}

