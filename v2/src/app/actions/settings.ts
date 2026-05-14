"use server";

import { sql } from "@/lib/db";
import { withActionGuard } from "@/lib/core/action-guard";

// ==========================================
// QUBA AI — Settings Actions (Zero-Trust Migrated)
// ==========================================

export async function getTenantSettings() {
  return withActionGuard(
    { actionName: 'getTenantSettings' },
    async (ctx) => {
      // 1. Unsafe execute ile güvenli query gönderilir
      const tenants = await ctx.db.executeSafe(sql`
        SELECT id, name, slug, industry, logo_url, primary_color,
               meta_page_id, instagram_id, whatsapp_phone_id, whatsapp_business_id,
               ai_model, max_bot_messages, timezone, plan, monthly_message_limit, status,
               created_at
        FROM tenants WHERE id = ${ctx.tenantId}
      `);

      if (tenants.length === 0) throw new Error("Tenant bulunamadı");

      const tenant = { ...tenants[0] };
      
      // Token maskeleme — sadece platform_admin/owner/admin
      if (ctx.role !== 'owner' && ctx.role !== 'admin' && ctx.role !== 'platform_admin') {
        if (tenant.meta_page_token) {
          tenant.meta_page_token = '••••••••' + tenant.meta_page_token.slice(-8);
        }
      }

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
      const { name, industry, primaryColor, aiModel, maxBotMessages, timezone } = updates;

      await ctx.db.executeSafe(sql`
        UPDATE tenants SET
          name = COALESCE(${name || null}, name),
          industry = COALESCE(${industry || null}, industry),
          primary_color = COALESCE(${primaryColor || null}, primary_color),
          ai_model = COALESCE(${aiModel || null}, ai_model),
          max_bot_messages = COALESCE(${maxBotMessages ? parseInt(maxBotMessages) : null}, max_bot_messages),
          timezone = COALESCE(${timezone || null}, timezone),
          updated_at = NOW()
        WHERE id = ${ctx.tenantId}
      `);

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

      // Burada 'tenant_id' kelimesi geçiyor, executeSafe onaylar
      const usage = await ctx.db.executeSafe(sql`
        SELECT * FROM usage_log WHERE tenant_id = ${ctx.tenantId} AND month = ${month}
      `);

      // tenants tablosu
      const tenant = await ctx.db.executeSafe(sql`
        SELECT monthly_message_limit, plan FROM tenants WHERE id = ${ctx.tenantId}
      `);

      return {
        currentMonth: month,
        totalMessages: usage[0]?.total_messages || 0,
        totalAiMessages: usage[0]?.total_ai_messages || 0,
        estimatedCost: parseFloat(usage[0]?.estimated_cost_usd || "0"),
        limit: tenant[0]?.monthly_message_limit || 500,
        plan: tenant[0]?.plan || "starter"
      };
    }
  ).then(res => {
    if (!res.success) return { success: false, stats: null };
    return { success: true, stats: res.data };
  });
}
