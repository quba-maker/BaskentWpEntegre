import { neon } from "@neondatabase/serverless";
import { logger } from "@/lib/core/logger";

// ==========================================
// QUBA AI OS — Multi-Tenant Runtime Resolver
// ==========================================
// Webhook payload'ından tenant'ı çözer.
// Tüm downstream servisler bu config'i tüketir.
// Global env singleton'larını tamamen ortadan kaldırır.
// ==========================================

export interface TenantRuntimeConfig {
  // Identity
  tenantId: string;
  tenantSlug: string;
  name: string;

  // New Channel Architecture
  channelId: string;
  groupId: string;
  provider: string; // 'whatsapp' | 'messenger' | 'instagram'

  // Meta App Credentials (tenant-isolated, for validating webhook signature)
  metaAppId: string | null;
  metaAppSecret: string | null;

  // Channel Specific
  identifier: string; // The phone number id or page id
  accessToken: string | null; // Extracted from channel_integrations.credentials_encrypted if JSON

  // Legacy mappings for backwards compatibility during migration
  whatsappPhoneNumberId: string | null;
  whatsappBusinessAccountId: string | null;
  metaPageId: string | null;
  instagramId: string | null;

  // Plan & Status
  plan: string;
  status: string;

  // Raw DB row
  raw: Record<string, any>;
}

export interface TenantIdentifier {
  type: 'whatsapp' | 'messenger' | 'instagram';
  id: string;
  source: string;
  wabaId?: string; // Optional: WhatsApp Business Account ID fallback
}

export class TenantResolverService {
  private log = logger.withContext({ module: 'TenantResolver' });

  /**
   * Webhook payload'ından tenant tanımlayıcıları çıkarır.
   */
  extractIdentifiers(body: any): TenantIdentifier | null {
    if (!body?.object || !body?.entry?.[0]) return null;

    // 1. WHATSAPP
    if (body.object === 'whatsapp_business_account') {
      const phoneId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      const wabaId = body.entry?.[0]?.id;
      if (phoneId) {
        return { type: 'whatsapp', id: phoneId, source: 'metadata.phone_number_id', wabaId };
      }
    }

    // 2. MESSENGER / PAGE
    if (body.object === 'page') {
      const pageId = body.entry?.[0]?.id;
      if (pageId) {
        return { type: 'messenger', id: pageId, source: 'entry.id (page)' };
      }
    }

    // 3. INSTAGRAM
    if (body.object === 'instagram') {
      const igId = body.entry?.[0]?.id;
      if (igId) {
        return { type: 'instagram', id: igId, source: 'entry.id (instagram)' };
      }
    }

    return null;
  }

  /**
   * Webhook payload'ından tenant'ı çözer.
   * DB lookup → TenantRuntimeConfig döner.
   */
  async resolve(body: any): Promise<TenantRuntimeConfig | null> {
    const startTime = Date.now();
    const identifier = this.extractIdentifiers(body);

    if (!identifier) {
      this.log.warn('Cannot extract tenant identifier from webhook payload', {
        bodyObject: body?.object,
        hasEntry: !!body?.entry?.[0]
      });
      return null;
    }

    try {
      const sql = neon(process.env.DATABASE_URL!);

      // NEW V2 ROUTING: Look up via channels -> channel_groups -> tenants
      let results = await sql`
        SELECT 
          c.id as channel_id,
          c.provider,
          c.identifier,
          cg.id as group_id,
          t.id as tenant_id,
          t.slug as tenant_slug,
          t.name as tenant_name,
          t.meta_app_id,
          t.meta_app_secret,
          t.plan,
          t.status,
          t.whatsapp_phone_id,
          t.whatsapp_business_id,
          t.meta_page_id,
          t.instagram_id,
          ci.credentials_encrypted
        FROM channels c
        JOIN channel_groups cg ON c.group_id = cg.id
        JOIN tenants t ON cg.tenant_id = t.id
        LEFT JOIN channel_integrations ci ON ci.channel_id = c.id
        WHERE c.identifier = ${identifier.id} 
          AND t.status = 'active'
        LIMIT 1
      `;

      // FALLBACK TO LEGACY V1 ROUTING (Migration phase)
      // If the channel doesn't exist yet, we check if the tenant exists via legacy columns
      if (results.length === 0) {
        let legacyResults: any[] = [];
        if (identifier.type === 'whatsapp') {
          legacyResults = await sql`SELECT * FROM tenants WHERE whatsapp_phone_id = ${identifier.id} AND status = 'active' LIMIT 1`;
          if (legacyResults.length === 0 && identifier.wabaId) {
            legacyResults = await sql`SELECT * FROM tenants WHERE whatsapp_business_id = ${identifier.wabaId} AND status = 'active' LIMIT 1`;
          }
        } else if (identifier.type === 'messenger') {
          legacyResults = await sql`SELECT * FROM tenants WHERE meta_page_id = ${identifier.id} AND status = 'active' LIMIT 1`;
        } else if (identifier.type === 'instagram') {
          legacyResults = await sql`SELECT * FROM tenants WHERE instagram_id = ${identifier.id} AND status = 'active' LIMIT 1`;
        }

        if (legacyResults.length > 0) {
          const t = legacyResults[0];
          this.log.warn('Used legacy V1 routing. Tenant has no channel defined!', {
            tenantId: t.id,
            tenantSlug: t.slug,
            identifierId: identifier.id
          });
          
          return {
            tenantId: t.id,
            tenantSlug: t.slug,
            name: t.name,
            channelId: 'legacy_unmapped',
            groupId: 'legacy_unmapped',
            provider: identifier.type,
            metaAppId: t.meta_app_id || null,
            metaAppSecret: t.meta_app_secret || null,
            identifier: identifier.id,
            accessToken: t.meta_page_token || null,
            whatsappPhoneNumberId: t.whatsapp_phone_id || null,
            whatsappBusinessAccountId: t.whatsapp_business_id || null,
            metaPageId: t.meta_page_id || null,
            instagramId: t.instagram_id || null,
            plan: t.plan || 'starter',
            status: t.status,
            raw: t
          };
        }
      }

      const durationMs = Date.now() - startTime;

      if (results.length === 0) {
        this.log.warn('No matching active tenant/channel found', {
          identifierType: identifier.type,
          identifierId: identifier.id,
          identifierSource: identifier.source,
          durationMs
        });
        return null;
      }

      const row = results[0];
      
      // Attempt to extract access token from JSON credentials
      let accessToken = null;
      try {
        if (row.credentials_encrypted) {
          const creds = JSON.parse(row.credentials_encrypted);
          accessToken = creds.accessToken || null;
        }
      } catch (e) {
        // Assume plain string or legacy format
        accessToken = row.credentials_encrypted;
      }

      // If no token in integration, fallback to legacy tenant token
      if (!accessToken && identifier.type === 'whatsapp') accessToken = row.whatsapp_business_id ? row.meta_page_token : null; // Typically same token

      const runtime: TenantRuntimeConfig = {
        tenantId: row.tenant_id,
        tenantSlug: row.tenant_slug,
        name: row.tenant_name,
        channelId: row.channel_id,
        groupId: row.group_id,
        provider: row.provider,
        metaAppId: row.meta_app_id || null,
        metaAppSecret: row.meta_app_secret || null,
        identifier: row.identifier,
        accessToken: accessToken,
        whatsappPhoneNumberId: row.whatsapp_phone_id || null,
        whatsappBusinessAccountId: row.whatsapp_business_id || null,
        metaPageId: row.meta_page_id || null,
        instagramId: row.instagram_id || null,
        plan: row.plan || 'starter',
        status: row.status,
        raw: row
      };

      this.log.info('Tenant resolved (V2)', {
        tenantSlug: runtime.tenantSlug,
        channelId: runtime.channelId,
        provider: runtime.provider,
        durationMs
      });

      return runtime;

    } catch (error: any) {
      this.log.error('Tenant resolution failed', error, {
        identifierType: identifier.type,
        identifierId: identifier.id
      });
      return null;
    }
  }
}

