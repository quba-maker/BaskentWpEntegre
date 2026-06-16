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

export async function getAutoGreetingSettingsAction() {
  return withActionGuard(
    { actionName: 'getAutoGreetingSettingsAction' },
    async (ctx) => {
      // 1. Resolve tenant slug for allowlist check
      const tenantRows = await ctx.db.executeSafe({
        text: `SELECT slug FROM tenants WHERE id = $1 LIMIT 1`,
        values: [ctx.tenantId]
      }) as any[];

      const tenantSlug = tenantRows[0]?.slug || '';

      const allowedTenantsList = (process.env.FORM_AUTOPILOT_ALLOWED_TENANTS || '')
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
      const isTenantAllowed = allowedTenantsList.includes(tenantSlug.toLowerCase());

      const envLocks = {
        phaseLockBlocked: process.env.FORM_AUTOPILOT_PHASE_LOCK_OUTBOUND_BLOCKED !== 'false',
        globalDisabled: process.env.FORM_AUTOPILOT_GLOBAL_DISABLED === 'true',
        isTenantAllowed,
        dryRun: process.env.FORM_AUTOPILOT_DRY_RUN !== 'false',
        allowedTenants: process.env.FORM_AUTOPILOT_ALLOWED_TENANTS || ''
      };

      // 2. Fetch DB Settings
      const rows = await ctx.db.executeSafe({
        text: `SELECT config_json FROM ai_module_settings WHERE tenant_id = $1 AND module_name = 'form_autopilot_for_open_meta_window' LIMIT 1`,
        values: [ctx.tenantId]
      }) as any[];

      let channelsConfig = {
        whatsapp: {
          auto_greeting_enabled: false,
          dry_run: true
        }
      };

      if (rows.length > 0 && rows[0].config_json && typeof rows[0].config_json === 'object') {
        const config = rows[0].config_json;
        if (config.channels && typeof config.channels === 'object') {
          channelsConfig = {
            ...channelsConfig,
            ...config.channels
          };
        }
      }

      return {
        success: true,
        envLocks,
        channelsConfig
      };
    }
  ).then(res => {
    if (!res.success || !res.data) return { success: false, error: res.error || "Ayarlar alınamadı." };
    return { success: true, envLocks: res.data.envLocks, channelsConfig: res.data.channelsConfig };
  });
}

export async function saveAutoGreetingChannelSettingsAction(channelId: string, settingsPatch: any) {
  return withActionGuard(
    { 
      actionName: 'saveAutoGreetingChannelSettingsAction',
      roles: ['owner', 'admin']
    },
    async (ctx) => {
      // 1. Fetch current row
      const rows = await ctx.db.executeSafe({
        text: `SELECT id, config_json FROM ai_module_settings WHERE tenant_id = $1 AND module_name = 'form_autopilot_for_open_meta_window' LIMIT 1`,
        values: [ctx.tenantId]
      }) as any[];

      let currentConfig: any = {
        dry_run: true,
        channels: {}
      };
      let rowId: string | null = null;

      if (rows.length > 0) {
        rowId = rows[0].id;
        if (rows[0].config_json && typeof rows[0].config_json === 'object') {
          currentConfig = {
            ...currentConfig,
            ...rows[0].config_json
          };
        }
      }

      // Ensure channels object exists
      if (!currentConfig.channels || typeof currentConfig.channels !== 'object') {
        currentConfig.channels = {};
      }

      // Patch only the specified channel, leave others untouched
      currentConfig.channels[channelId] = {
        ...(currentConfig.channels[channelId] || {}),
        ...settingsPatch
      };

      // Also mirror root dry_run if patching whatsapp
      if (channelId === 'whatsapp' && settingsPatch.dry_run !== undefined) {
        currentConfig.dry_run = settingsPatch.dry_run;
      }

      if (rowId) {
        await ctx.db.executeSafe({
          text: `UPDATE ai_module_settings SET config_json = $1, updated_at = NOW() WHERE id = $2`,
          values: [JSON.stringify(currentConfig), rowId]
        });
      } else {
        await ctx.db.executeSafe({
          text: `INSERT INTO ai_module_settings (tenant_id, module_name, is_active, config_json) VALUES ($1, 'form_autopilot_for_open_meta_window', true, $2)`,
          values: [ctx.tenantId, JSON.stringify(currentConfig)]
        });
      }

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}
