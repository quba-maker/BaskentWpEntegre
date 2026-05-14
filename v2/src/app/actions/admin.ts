"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";

// ==========================================
// QUBA AI — Super Admin Actions
// Sadece "owner" rolündeki kullanıcılar erişebilir
// ==========================================

export async function getAllTenants() {
  const session = await getSession();
  if (session?.role !== "owner" && session?.role !== "platform_admin") return { success: false, error: "Yetki yok" };

  try {
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

    return { success: true, tenants };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function createTenant(data: {
  name: string;
  slug: string;
  industry?: string;
  plan?: string;
}) {
  const session = await getSession();
  if (session?.role !== "owner" && session?.role !== "platform_admin") return { success: false, error: "Yetki yok" };

  try {
    // Slug validation
    const slug = data.slug.toLowerCase().trim();
    const RESERVED_SLUGS = ['admin', 'api', 'login', 'setup', 'privacy', 'terms', 'app', 'dashboard', 'settings', 'webhook', 'sse', 'health', 'status', 'billing', 'support', 'docs', 'help'];
    
    if (!/^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/.test(slug) || slug.length < 2) {
      return { success: false, error: "Slug sadece küçük harf, rakam ve tire içerebilir (2-30 karakter)." };
    }
    if (RESERVED_SLUGS.includes(slug)) {
      return { success: false, error: `"${slug}" sistem tarafından ayrılmış bir isimdir.` };
    }

    const existing = await sql`SELECT id FROM tenants WHERE slug = ${slug}`;
    if (existing.length > 0) return { success: false, error: "Bu slug zaten kullanılıyor." };
    data.slug = slug;

    // 1. Tenant oluştur
    const created = await sql`
      INSERT INTO tenants (name, slug, industry, plan, status)
      VALUES (${data.name}, ${data.slug}, ${data.industry || 'general'}, ${data.plan || 'starter'}, 'active')
      RETURNING id
    `;
    const tenantId = created[0]?.id;
    if (!tenantId) return { success: false, error: "Tenant oluşturulamadı." };

    // 2. Generic varsayılan ayarları seed et
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

    // 3. Audit log
    logAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: "tenant_created",
      entityType: "tenant",
      entityId: tenantId,
      details: { name: data.name, slug: data.slug, plan: data.plan },
    });

    return { success: true, tenantId };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function toggleTenantStatus(tenantId: string) {
  const session = await getSession();
  if (session?.role !== "owner" && session?.role !== "platform_admin") return { success: false, error: "Yetki yok" };

  try {
    const tenant = await sql`SELECT status FROM tenants WHERE id = ${tenantId}`;
    const newStatus = tenant[0]?.status === "active" ? "suspended" : "active";

    await sql`UPDATE tenants SET status = ${newStatus}, updated_at = NOW() WHERE id = ${tenantId}`;

    return { success: true, newStatus };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ==========================================
// ONBOARDING WIZARD ACTIONS
// Adım adım yeni firma kurulumu
// ==========================================

/**
 * Adım 2: Meta/WhatsApp kimlik bilgilerini güncelle
 */
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
  const session = await getSession();
  if (session?.role !== "owner" && session?.role !== "platform_admin") return { success: false, error: "Yetki yok" };

  try {
    await sql`
      UPDATE tenants SET
        meta_page_token = COALESCE(${config.meta_page_token || null}, meta_page_token),
        whatsapp_phone_id = COALESCE(${config.whatsapp_phone_id || null}, whatsapp_phone_id),
        whatsapp_business_id = COALESCE(${config.whatsapp_business_id || null}, whatsapp_business_id),
        meta_page_id = COALESCE(${config.meta_page_id || null}, meta_page_id),
        instagram_id = COALESCE(${config.instagram_id || null}, instagram_id),
        ai_model = COALESCE(${config.ai_model || null}, ai_model),
        daily_ai_limit = COALESCE(${config.daily_ai_limit || null}, daily_ai_limit),
        timezone = COALESCE(${config.timezone || null}, timezone),
        primary_color = COALESCE(${config.primary_color || null}, primary_color),
        updated_at = NOW()
      WHERE id = ${tenantId}
    `;

    logAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: "tenant_config_updated",
      entityType: "tenant",
      entityId: tenantId,
      details: { updatedFields: Object.keys(config).filter(k => (config as any)[k]) },
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Adım 3: Tenant'a admin kullanıcı oluştur
 */
export async function createTenantUser(tenantId: string, user: {
  email: string;
  password: string;
  name: string;
  role?: string;
}) {
  const session = await getSession();
  if (session?.role !== "owner" && session?.role !== "platform_admin") return { success: false, error: "Yetki yok" };

  try {
    // Email kontrolü — hedef tenant içinde benzersiz
    const existing = await sql`SELECT id FROM users WHERE email = ${user.email} AND tenant_id = ${tenantId}`;
    if (existing.length > 0) return { success: false, error: "Bu e-posta bu firmada zaten kayıtlı." };

    // Bcrypt hash — dynamic import
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash(user.password, 12);

    await sql`
      INSERT INTO users (tenant_id, email, password_hash, name, role)
      VALUES (${tenantId}, ${user.email}, ${hash}, ${user.name}, ${user.role || 'admin'})
    `;

    logAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: "tenant_user_created",
      entityType: "user",
      details: { email: user.email, role: user.role || 'admin', forTenant: tenantId },
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Adım 4: Tenant kurulumunu doğrula
 */
export async function verifyTenantSetup(tenantId: string) {
  const session = await getSession();
  if (session?.role !== "owner" && session?.role !== "platform_admin") return { success: false, error: "Yetki yok" };

  try {
    const tenant = await sql`SELECT * FROM tenants WHERE id = ${tenantId}`;
    if (tenant.length === 0) return { success: false, error: "Tenant bulunamadı." };
    const t = tenant[0];

    const users = await sql`SELECT COUNT(*) as c FROM users WHERE tenant_id = ${tenantId}`;
    const settings = await sql`SELECT COUNT(*) as c FROM settings WHERE tenant_id = ${tenantId}`;

    const checks = [
      { name: "Firma bilgileri", ok: !!t.name && !!t.slug, detail: t.name },
      { name: "WhatsApp token", ok: !!t.meta_page_token, detail: t.meta_page_token ? "✓ Tanımlı" : "✗ Eksik" },
      { name: "WhatsApp Phone ID", ok: !!t.whatsapp_phone_id, detail: t.whatsapp_phone_id || "✗ Eksik" },
      { name: "Admin kullanıcı", ok: Number(users[0]?.c) > 0, detail: `${users[0]?.c} kullanıcı` },
      { name: "Prompt ayarları", ok: Number(settings[0]?.c) > 0, detail: `${settings[0]?.c} ayar` },
      { name: "AI model", ok: !!t.ai_model, detail: t.ai_model || "varsayılan" },
    ];

    const allPassed = checks.every(c => c.ok);

    return {
      success: true,
      ready: allPassed,
      checks,
      summary: allPassed 
        ? `✅ ${t.name} kurulumu tamamlandı ve hazır!` 
        : `⚠️ ${checks.filter(c => !c.ok).length} eksik adım var.`,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
