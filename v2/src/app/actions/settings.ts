"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

// ==========================================
// QUBA AI — Settings Actions
// ==========================================

export async function getTenantSettings() {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Oturum yok" };

    const tenants = await sql`
      SELECT id, name, slug, industry, logo_url, primary_color,
             meta_page_id, instagram_id, whatsapp_phone_id, whatsapp_business_id,
             ai_model, max_bot_messages, timezone, plan, monthly_message_limit, status,
             created_at
      FROM tenants WHERE id = ${session.tenantId}
    `;

    if (tenants.length === 0) return { success: false, error: "Tenant bulunamadı" };

    return { success: true, tenant: tenants[0], user: { name: session.name, email: session.email, role: session.role } };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateTenantSettings(updates: Record<string, any>) {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Oturum yok" };
    if (session.role !== "owner" && session.role !== "admin") return { success: false, error: "Yetki yok" };

    const { name, industry, primaryColor, aiModel, maxBotMessages, timezone } = updates;

    await sql`
      UPDATE tenants SET
        name = COALESCE(${name || null}, name),
        industry = COALESCE(${industry || null}, industry),
        primary_color = COALESCE(${primaryColor || null}, primary_color),
        ai_model = COALESCE(${aiModel || null}, ai_model),
        max_bot_messages = COALESCE(${maxBotMessages ? parseInt(maxBotMessages) : null}, max_bot_messages),
        timezone = COALESCE(${timezone || null}, timezone),
        updated_at = NOW()
      WHERE id = ${session.tenantId}
    `;

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getUsageStats() {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, stats: null };

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const usage = await sql`
      SELECT * FROM usage_log WHERE tenant_id = ${session.tenantId} AND month = ${month}
    `;

    const tenant = await sql`
      SELECT monthly_message_limit, plan FROM tenants WHERE id = ${session.tenantId}
    `;

    return {
      success: true,
      stats: {
        currentMonth: month,
        totalMessages: usage[0]?.total_messages || 0,
        totalAiMessages: usage[0]?.total_ai_messages || 0,
        estimatedCost: parseFloat(usage[0]?.estimated_cost_usd || "0"),
        limit: tenant[0]?.monthly_message_limit || 500,
        plan: tenant[0]?.plan || "starter"
      }
    };
  } catch (error: any) {
    return { success: false, stats: null };
  }
}
