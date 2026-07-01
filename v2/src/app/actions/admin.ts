"use server";

import { sql } from "@/lib/db";
import { withActionGuard } from "@/lib/core/action-guard";
import { logAudit } from "@/lib/audit";
import { normalizeTenantSetupRole } from "@/lib/auth/roles";

// ==========================================
// QUBA AI — Super Admin Actions
// Sadece Quba platform_admin erişebilir
// Cross-tenant sorgular raw SQL kullanır (kasıtlı)
// ==========================================

export async function getAllTenants() {
  return withActionGuard({ actionName: 'getAllTenants', roles: ['platform_admin'], requireTenant: false }, async (ctx) => {
    const tenants = await sql`
      SELECT t.*,
        COALESCE(cv.cnt, 0) as conversation_count,
        COALESCE(mv.cnt, 0) as message_count,
        COALESCE(uv.cnt, 0) as user_count
      FROM tenants t
      LEFT JOIN (SELECT tenant_id, COUNT(*) as cnt FROM conversations GROUP BY tenant_id) cv ON cv.tenant_id = t.id
      LEFT JOIN (SELECT tenant_id, COUNT(*) as cnt FROM messages GROUP BY tenant_id) mv ON mv.tenant_id = t.id
      LEFT JOIN (SELECT tenant_id, COUNT(*) as cnt FROM users GROUP BY tenant_id) uv ON uv.tenant_id = t.id
      ORDER BY t.created_at DESC
    `;
    return tenants;
  });
}

export async function createTenant(data: {
  name: string;
  slug: string;
  industry?: string;
  plan?: string;
}) {
  return withActionGuard({ actionName: 'createTenant', roles: ['platform_admin'], requireTenant: false }, async (ctx) => {
    const slug = data.slug.toLowerCase().trim();
    const RESERVED_SLUGS = ['admin', 'api', 'login', 'setup', 'privacy', 'terms', 'app', 'dashboard', 'settings', 'webhook', 'sse', 'health', 'status', 'billing', 'support', 'docs', 'help'];

    if (!/^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/.test(slug) || slug.length < 2) {
      throw new Error("Slug sadece küçük harf, rakam ve tire içerebilir (2-30 karakter).");
    }
    if (RESERVED_SLUGS.includes(slug)) {
      throw new Error(`"${slug}" sistem tarafından ayrılmış bir isimdir.`);
    }

    const existing = await sql`SELECT id FROM tenants WHERE slug = ${slug}`;
    if (existing.length > 0) throw new Error("Bu slug zaten kullanılıyor.");

    const created = await sql`
      INSERT INTO tenants (name, slug, industry, plan, status)
      VALUES (${data.name}, ${slug}, ${data.industry || 'general'}, ${data.plan || 'starter'}, 'active')
      RETURNING id
    `;
    const tenantId = created[0]?.id;
    if (!tenantId) throw new Error("Tenant oluşturulamadı.");

    const genericPrompt = `Sen ${data.name} firmasının dijital asistanısın.\nGörevin müşterilerle profesyonel, sıcak ve yardımcı bir şekilde iletişim kurmak.\nHer zaman nazik ol, soruları yanıtla ve müşteriyi randevuya/satışa yönlendir.\nBilmediğin konularda "Bu konuda ekibimiz size yardımcı olacaktır" de.`;

    const defaultSettings = [
      ['system_prompt_whatsapp', genericPrompt],
      ['system_prompt_tr', genericPrompt],
      ['ai_model', 'gemini-2.5-flash'],
      ['bot_aggression_level', 'medium'],
      ['bot_max_messages', '8'],
      ['bot_auto_greeting', 'true'],
      ['channel_whatsapp_enabled', 'true'],
      ['channel_instagram_enabled', 'false'],
      ['channel_messenger_enabled', 'false'],
    ];

    for (const [key, value] of defaultSettings) {
      await sql`INSERT INTO settings (key, value, tenant_id) VALUES (${key}, ${value}, ${tenantId}) ON CONFLICT DO NOTHING`;
    }

    logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userEmail: ctx.email,
      action: "tenant_created",
      entityType: "tenant",
      entityId: tenantId,
      details: { name: data.name, slug, plan: data.plan },
    });

    return tenantId;
  });
}

export async function toggleTenantStatus(tenantId: string) {
  return withActionGuard({ actionName: 'toggleTenantStatus', roles: ['platform_admin'], requireTenant: false }, async (ctx) => {
    const tenant = await sql`SELECT status FROM tenants WHERE id = ${tenantId}`;
    const newStatus = tenant[0]?.status === "active" ? "suspended" : "active";
    await sql`UPDATE tenants SET status = ${newStatus}, updated_at = NOW() WHERE id = ${tenantId}`;
    return newStatus;
  });
}

// ==========================================
// ONBOARDING WIZARD ACTIONS
// ==========================================

export async function updateTenantConfig(tenantId: string, config: {
  meta_page_token?: string;
  whatsapp_phone_id?: string;
  whatsapp_business_id?: string;
  meta_page_id?: string;
  instagram_id?: string;
  ai_model?: string;
  daily_ai_limit?: number;
  timezone?: string;
  primary_color?: string;
}) {
  return withActionGuard({ actionName: 'updateTenantConfig', roles: ['platform_admin'], requireTenant: false }, async (ctx) => {
    await sql`
      UPDATE tenants SET
        ai_model = COALESCE(${config.ai_model || null}, ai_model),
        timezone = COALESCE(${config.timezone || null}, timezone),
        primary_color = COALESCE(${config.primary_color || null}, primary_color),
        updated_at = NOW()
      WHERE id = ${tenantId}
    `;

    // Meta credentials should go to tenant_integrations (V2 pattern)
    // Legacy fields meta_page_token, whatsapp_phone_id remain for backward compat
    if (config.meta_page_token || config.whatsapp_phone_id) {
      await sql`
        INSERT INTO tenant_integrations (tenant_id, provider, config, status)
        VALUES (${tenantId}, 'whatsapp', ${JSON.stringify({
          accessToken: config.meta_page_token,
          phoneNumberId: config.whatsapp_phone_id,
          businessId: config.whatsapp_business_id,
          pageId: config.meta_page_id,
          instagramId: config.instagram_id,
        })}::jsonb, 'active')
        ON CONFLICT (tenant_id, provider) DO UPDATE SET
          config = EXCLUDED.config, updated_at = NOW()
      `;
    }

    logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userEmail: ctx.email,
      action: "tenant_config_updated",
      entityType: "tenant",
      entityId: tenantId,
      details: { updatedFields: Object.keys(config).filter(k => (config as any)[k]) },
    });

    return true;
  });
}

export async function createTenantUser(tenantId: string, user: {
  email: string;
  password: string;
  name: string;
  role?: string;
}) {
  return withActionGuard({ actionName: 'createTenantUser', roles: ['platform_admin'], requireTenant: false }, async (ctx) => {
    const existing = await sql`SELECT id FROM users WHERE email = ${user.email} AND tenant_id = ${tenantId}`;
    if (existing.length > 0) throw new Error("Bu e-posta bu firmada zaten kayıtlı.");
    const tenantRole = normalizeTenantSetupRole(user.role || 'admin');

    const bcryptModule = await import("bcryptjs");
    const bcrypt = (bcryptModule as any).default || bcryptModule;
    const hash = await bcrypt.hash(user.password, 12);

    await sql`
      INSERT INTO users (tenant_id, email, password_hash, name, role)
      VALUES (${tenantId}, ${user.email}, ${hash}, ${user.name}, ${tenantRole})
    `;

    logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userEmail: ctx.email,
      action: "tenant_user_created",
      entityType: "user",
      details: { email: user.email, role: tenantRole, forTenant: tenantId },
    });

    return true;
  });
}

export async function verifyTenantSetup(tenantId: string) {
  return withActionGuard({ actionName: 'verifyTenantSetup', roles: ['platform_admin'], requireTenant: false }, async (ctx) => {
    const tenant = await sql`SELECT * FROM tenants WHERE id = ${tenantId}`;
    if (tenant.length === 0) throw new Error("Tenant bulunamadı.");
    const t = tenant[0];

    const users = await sql`SELECT COUNT(*) as c FROM users WHERE tenant_id = ${tenantId}`;
    const settings = await sql`SELECT COUNT(*) as c FROM settings WHERE tenant_id = ${tenantId}`;

    // Check tenant_integrations for credentials
    const integrations = await sql`SELECT provider FROM tenant_integrations WHERE tenant_id = ${tenantId} AND status = 'active'`;
    const hasWhatsApp = integrations.some((i: any) => i.provider === 'whatsapp');

    const checks = [
      { name: "Firma bilgileri", ok: !!t.name && !!t.slug, detail: t.name },
      { name: "WhatsApp entegrasyonu", ok: hasWhatsApp, detail: hasWhatsApp ? "✓ Tanımlı" : "✗ Eksik" },
      { name: "Admin kullanıcı", ok: Number(users[0]?.c) > 0, detail: `${users[0]?.c} kullanıcı` },
      { name: "Prompt ayarları", ok: Number(settings[0]?.c) > 0, detail: `${settings[0]?.c} ayar` },
      { name: "AI model", ok: !!t.ai_model, detail: t.ai_model || "varsayılan" },
    ];

    const allPassed = checks.every(c => c.ok);
    return {
      ready: allPassed,
      checks,
      summary: allPassed
        ? `✅ ${t.name} kurulumu tamamlandı ve hazır!`
        : `⚠️ ${checks.filter(c => !c.ok).length} eksik adım var.`,
    };
  });
}
