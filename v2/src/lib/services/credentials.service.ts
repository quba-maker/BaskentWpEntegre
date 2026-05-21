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
}

export class CredentialsService {
  /**
   * Resolves credentials for a given tenant and channel provider with V2 -> V1 legacy fallback.
   */
  static async resolveCredentials(
    tenantId: string,
    provider: "whatsapp" | "messenger" | "instagram"
  ): Promise<ResolvedCredentials> {
    try {
      const db = withTenantDB(tenantId);
      
      // 1. Try V2 Routing: Look up via channel groups -> channels -> channel integrations
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
            accessToken = row.credentials_encrypted; // Plain string fallback if not serialized as JSON
          }
        }

        if (accessToken) {
          return {
            accessToken,
            whatsappPhoneNumberId: provider === "whatsapp" ? row.identifier : null,
            whatsappBusinessAccountId: null,
            metaPageId: provider === "messenger" ? row.identifier : null,
            instagramId: provider === "instagram" ? row.identifier : null,
            source: "v2_channels"
          };
        }
      }

      // 2. Fallback to Legacy Tenants V1 Columns
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
        log.warn("Using V1 fallback credentials for tenant outbound send", { tenantId, provider });
        
        return {
          accessToken: t.meta_page_token || null,
          whatsappPhoneNumberId: t.whatsapp_phone_id || null,
          whatsappBusinessAccountId: t.whatsapp_business_id || null,
          metaPageId: t.meta_page_id || null,
          instagramId: t.instagram_id || null,
          source: "v1_legacy"
        };
      }
    } catch (err) {
      log.error("Failed to resolve outbound credentials", err instanceof Error ? err : new Error(String(err)));
    }

    // 3. Environment Fallback
    log.warn("Falling back to environment credentials", { tenantId, provider });
    return {
      accessToken: process.env.META_ACCESS_TOKEN || null,
      whatsappPhoneNumberId: process.env.PHONE_NUMBER_ID || null,
      whatsappBusinessAccountId: null,
      metaPageId: process.env.PAGE_ACCESS_TOKEN || null,
      instagramId: process.env.IG_TOKEN_1 || null,
      source: "env_fallback"
    };
  }
}

