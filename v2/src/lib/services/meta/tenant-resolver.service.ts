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

  // Meta App Credentials (tenant-isolated)
  metaAppId: string | null;
  metaAppSecret: string | null;

  // WhatsApp Runtime
  whatsappPhoneNumberId: string | null;
  whatsappBusinessAccountId: string | null;
  accessToken: string | null;

  // Facebook / Instagram
  metaPageId: string | null;
  instagramId: string | null;

  // Plan & Status
  plan: string;
  status: string;

  // Raw DB row (legacy compat)
  raw: Record<string, any>;
}

export interface TenantIdentifier {
  type: 'whatsapp_phone_id' | 'whatsapp_business_id' | 'meta_page_id' | 'instagram_id';
  id: string;
  source: string;
}

export class TenantResolverService {
  private log = logger.withContext({ module: 'TenantResolver' });

  /**
   * Webhook payload'ından tenant tanımlayıcıları çıkarır.
   * Fallback zinciri: phone_number_id → waba_id → page_id → instagram_id
   */
  extractIdentifiers(body: any): TenantIdentifier | null {
    if (!body?.object || !body?.entry?.[0]) return null;

    // 1. WHATSAPP — phone_number_id (en güvenilir tanımlayıcı)
    if (body.object === 'whatsapp_business_account') {
      const phoneId = body.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      if (phoneId) {
        return { type: 'whatsapp_phone_id', id: phoneId, source: 'metadata.phone_number_id' };
      }

      // Fallback: WABA ID (entry-level)
      const wabaId = body.entry?.[0]?.id;
      if (wabaId) {
        return { type: 'whatsapp_business_id', id: wabaId, source: 'entry.id (waba)' };
      }
    }

    // 2. MESSENGER / PAGE — page_id
    if (body.object === 'page') {
      const pageId = body.entry?.[0]?.id;
      if (pageId) {
        return { type: 'meta_page_id', id: pageId, source: 'entry.id (page)' };
      }
    }

    // 3. INSTAGRAM — instagram_id
    if (body.object === 'instagram') {
      const igId = body.entry?.[0]?.id;
      if (igId) {
        return { type: 'instagram_id', id: igId, source: 'entry.id (instagram)' };
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

      // Dynamic column-based lookup
      const columnMap: Record<string, string> = {
        'whatsapp_phone_id': 'whatsapp_phone_id',
        'whatsapp_business_id': 'whatsapp_business_id',
        'meta_page_id': 'meta_page_id',
        'instagram_id': 'instagram_id',
      };

      const column = columnMap[identifier.type];
      if (!column) {
        this.log.warn('Unknown identifier type', { type: identifier.type });
        return null;
      }

      // Parameterized query (SQL injection safe)
      // neon tagged template literals auto-parameterize
      let tenants: any[];
      switch (identifier.type) {
        case 'whatsapp_phone_id':
          tenants = await sql`SELECT * FROM tenants WHERE whatsapp_phone_id = ${identifier.id} AND status = 'active' LIMIT 1`;
          break;
        case 'whatsapp_business_id':
          tenants = await sql`SELECT * FROM tenants WHERE whatsapp_business_id = ${identifier.id} AND status = 'active' LIMIT 1`;
          break;
        case 'meta_page_id':
          tenants = await sql`SELECT * FROM tenants WHERE meta_page_id = ${identifier.id} AND status = 'active' LIMIT 1`;
          break;
        case 'instagram_id':
          tenants = await sql`SELECT * FROM tenants WHERE instagram_id = ${identifier.id} AND status = 'active' LIMIT 1`;
          break;
        default:
          tenants = [];
      }

      const durationMs = Date.now() - startTime;

      if (tenants.length === 0) {
        this.log.warn('No matching active tenant found', {
          identifierType: identifier.type,
          identifierId: identifier.id,
          identifierSource: identifier.source,
          durationMs
        });
        return null;
      }

      const t = tenants[0];
      const runtime: TenantRuntimeConfig = {
        tenantId: t.id,
        tenantSlug: t.slug,
        name: t.name,
        metaAppId: t.meta_app_id || null,
        metaAppSecret: t.meta_app_secret || null,
        whatsappPhoneNumberId: t.whatsapp_phone_id || null,
        whatsappBusinessAccountId: t.whatsapp_business_id || null,
        accessToken: t.meta_page_token || null,
        metaPageId: t.meta_page_id || null,
        instagramId: t.instagram_id || null,
        plan: t.plan || 'starter',
        status: t.status,
        raw: t
      };

      this.log.info('Tenant resolved', {
        tenantSlug: runtime.tenantSlug,
        identifierType: identifier.type,
        identifierSource: identifier.source,
        hasOwnSecret: !!runtime.metaAppSecret,
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
