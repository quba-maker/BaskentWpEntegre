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
        (SELECT COUNT(*) FROM conversations WHERE tenant_id = t.id) as conversation_count,
        (SELECT COUNT(*) FROM messages WHERE tenant_id = t.id) as message_count,
        (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as user_count
      FROM tenants t
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
    const existing = await sql`SELECT id FROM tenants WHERE slug = ${data.slug}`;
    if (existing.length > 0) return { success: false, error: "Bu slug zaten kullanılıyor." };

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
