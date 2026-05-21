"use server";

// sql import removed — all queries use parameterized {text, values} format for proper RLS enforcement
import { withActionGuard } from "@/lib/core/action-guard";

// ==========================================
// QUBA AI — Settings Actions (Zero-Trust Migrated)
// ==========================================

export async function getTenantSettings() {
  return withActionGuard(
    { actionName: 'getTenantSettings' },
    async (ctx) => {
      // 1. Unsafe execute ile güvenli query gönderilir
      const tenants = await ctx.db.executeSafe({
        text: `SELECT id, name, slug, industry, logo_url, primary_color,
               ai_model, timezone, plan, monthly_message_limit, status,
               created_at
               FROM tenants WHERE id = $1`,
        values: [ctx.tenantId]
      });

      if (tenants.length === 0) throw new Error("Tenant bulunamadı");

      const tenant = { ...tenants[0] };
      
      // Token maskeleme vb işlemler yeni mimaride channel_integrations'a taşındığı için gerek kalmadı.

      return { 
        tenant, 
        user: { name: ctx.email, email: ctx.email, role: ctx.role } // Not: session.name olmadığı için geçici olarak emaile bağlandı veya eklenebilir.
      };
    }
  ).then(res => {
    // Legacy API uyumluluğu için response mapping (UI kırılmasın diye)
    if (!res.success) return { success: false, error: res.error };
    return { success: true, tenant: res.data?.tenant, user: res.data?.user };
  });
}

export async function updateTenantSettings(updates: Record<string, any>) {
  return withActionGuard(
    { 
      actionName: 'updateTenantSettings',
      roles: ['owner', 'admin'] // Sadece yetkili roller değiştirebilir
    },
    async (ctx) => {
      const { name, industry, primaryColor, timezone } = updates;
      // NOTE: aiModel & maxBotMessages are now managed exclusively via Bot page (saveBotSetting action)

      await ctx.db.executeSafe({
        text: `UPDATE tenants SET
                 name = COALESCE($1, name),
                 industry = COALESCE($2, industry),
                 primary_color = COALESCE($3, primary_color),
                 timezone = COALESCE($4, timezone),
                 updated_at = NOW()
               WHERE id = $5`,
        values: [name || null, industry || null, primaryColor || null, timezone || null, ctx.tenantId]
      });

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function getUsageStats() {
  return withActionGuard(
    { actionName: 'getUsageStats' },
    async (ctx) => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      // Get metrics from ai_runtime_metrics instead of missing usage_log table
      const metrics = await ctx.db.executeSafe({
        text: `SELECT 
                 COUNT(*) as total_ai_messages,
                 SUM(estimated_cost_usd) as estimated_cost_usd,
                 SUM(total_tokens) as total_tokens
               FROM ai_runtime_metrics 
               WHERE tenant_id = $1 AND created_at >= $2`,
        values: [ctx.tenantId, monthStart]
      });

      // tenants tablosu
      const tenant = await ctx.db.executeSafe({
        text: `SELECT monthly_message_limit, plan FROM tenants WHERE id = $1`,
        values: [ctx.tenantId]
      });

      return {
        currentMonth: month,
        totalMessages: parseInt(metrics[0]?.total_ai_messages || "0"), // Base metrics on AI actions for now
        totalAiMessages: parseInt(metrics[0]?.total_ai_messages || "0"),
        estimatedCost: parseFloat(metrics[0]?.estimated_cost_usd || "0"),
        limit: tenant[0]?.monthly_message_limit || 500,
        plan: tenant[0]?.plan || "starter"
      };
    }
  ).then(res => {
    if (!res.success) return { success: false, stats: null };
    return { success: true, stats: res.data };
  });
}
