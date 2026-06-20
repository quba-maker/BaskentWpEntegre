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

      // 2. Fetch Form Outbound Autopilot Settings
      const formRows = await ctx.db.executeSafe({
        text: `SELECT config FROM ai_module_settings WHERE tenant_id = $1 AND module_name = 'form_autopilot_for_open_meta_window' LIMIT 1`,
        values: [ctx.tenantId]
      }) as any[];

      const defaultFormConfig = {
        enabled: false,
        dry_run: true,
        rollout_percentage: 0,
        department_mode: 'selected',
        allowed_departments: [] as string[],
        channels: {
          whatsapp: {
            auto_greeting_enabled: false,
            dry_run: true
          }
        }
      };

      let formAutopilotConfig = { ...defaultFormConfig };
      if (formRows.length > 0 && formRows[0].config) {
        const parsedConfig = typeof formRows[0].config === 'string'
          ? JSON.parse(formRows[0].config)
          : formRows[0].config;
        formAutopilotConfig = {
          ...defaultFormConfig,
          ...parsedConfig
        };
      }

      // 3. Fetch Inbound Autopilot Settings
      const inboundRows = await ctx.db.executeSafe({
        text: `SELECT config FROM ai_module_settings WHERE tenant_id = $1 AND module_name = 'inbound_autopilot_settings' LIMIT 1`,
        values: [ctx.tenantId]
      }) as any[];

      const defaultInboundConfig = {
        enabled: false,
        dry_run: true,
        rollout_percentage: 0,
        department_mode: 'selected',
        allowed_departments: [] as string[]
      };

      let inboundAutopilotConfig = { ...defaultInboundConfig };
      if (inboundRows.length > 0 && inboundRows[0].config) {
        const parsedConfig = typeof inboundRows[0].config === 'string'
          ? JSON.parse(inboundRows[0].config)
          : inboundRows[0].config;
        inboundAutopilotConfig = {
          ...defaultInboundConfig,
          ...parsedConfig
        };
      }

      // Legacy compatibility: map channelsConfig to form config's whatsapp channel
      const channelsConfig = {
        whatsapp: {
          auto_greeting_enabled: formAutopilotConfig.enabled,
          dry_run: formAutopilotConfig.dry_run
        }
      };

      return {
        success: true,
        envLocks,
        channelsConfig, // Legacy support
        formAutopilotConfig,
        inboundAutopilotConfig,
        userRole: ctx.role,
        tenantId: ctx.tenantId
      };
    }
  ).then(res => {
    if (!res.success || !res.data) return { success: false, error: res.error || "Ayarlar alınamadı." };
    return { 
      success: true, 
      envLocks: res.data.envLocks, 
      channelsConfig: res.data.channelsConfig,
      formAutopilotConfig: res.data.formAutopilotConfig,
      inboundAutopilotConfig: res.data.inboundAutopilotConfig,
      userRole: res.data.userRole,
      tenantId: res.data.tenantId
    };
  });
}

export async function saveFormAutopilotSettingsAction(tenantId: string, settingsPatch: any) {
  return withActionGuard(
    { 
      actionName: 'saveFormAutopilotSettingsAction',
      roles: ['owner', 'admin']
    },
    async (ctx) => {
      // tenant scope check
      if (tenantId !== ctx.tenantId) {
        throw new Error("Geçersiz firma yetkisi (Cross-tenant violation)");
      }

      // Fetch current row
      const rows = await ctx.db.executeSafe({
        text: `SELECT id, config FROM ai_module_settings WHERE tenant_id = $1 AND module_name = 'form_autopilot_for_open_meta_window' LIMIT 1`,
        values: [ctx.tenantId]
      }) as any[];

      let currentConfig: any = {
        enabled: false,
        dry_run: true,
        rollout_percentage: 0,
        department_mode: 'selected',
        allowed_departments: []
      };
      let rowId: string | null = null;

      if (rows.length > 0) {
        rowId = rows[0].id;
        if (rows[0].config) {
          const parsedConfig = typeof rows[0].config === 'string'
            ? JSON.parse(rows[0].config)
            : rows[0].config;
          currentConfig = {
            ...currentConfig,
            ...parsedConfig
          };
        }
      }

      const originalConfig = { ...currentConfig };

      // Apply patches (only valid config keys, no PII allowed)
      const allowedKeys = ['enabled', 'dry_run', 'rollout_percentage', 'department_mode', 'allowed_departments'];
      for (const key of allowedKeys) {
        if (settingsPatch[key] !== undefined) {
          currentConfig[key] = settingsPatch[key];
        }
      }

      // Synchronize channels object for legacy compatibility if enabled or dry_run changed
      if (!currentConfig.channels || typeof currentConfig.channels !== 'object') {
        currentConfig.channels = {};
      }
      currentConfig.channels.whatsapp = {
        auto_greeting_enabled: currentConfig.enabled,
        dry_run: currentConfig.dry_run
      };

      if (rowId) {
        await ctx.db.executeSafe({
          text: `UPDATE ai_module_settings SET config = $1, updated_at = NOW() WHERE id = $2`,
          values: [JSON.stringify(currentConfig), rowId]
        });
      } else {
        await ctx.db.executeSafe({
          text: `INSERT INTO ai_module_settings (tenant_id, module_name, is_active, config) VALUES ($1, 'form_autopilot_for_open_meta_window', true, $2)`,
          values: [ctx.tenantId, JSON.stringify(currentConfig)]
        });
      }

      // Log config change in a PII-free format
      const diff: any = {};
      for (const key of allowedKeys) {
        if (JSON.stringify(originalConfig[key]) !== JSON.stringify(currentConfig[key])) {
          diff[key] = { from: originalConfig[key], to: currentConfig[key] };
        }
      }

      await ctx.db.executeSafe({
        text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary) VALUES ($1, $2, $3, $4::jsonb)`,
        values: [
          ctx.tenantId,
          'UPDATE_FORM_AUTOPILOT_SETTINGS',
          `Form autopilot settings updated by user ${ctx.userId}`,
          JSON.stringify({
            userId: ctx.userId,
            module: 'form_autopilot_for_open_meta_window',
            diff
          })
        ]
      }).catch(err => console.error("Failed to write form settings change audit log", err));

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function saveInboundAutopilotSettingsAction(tenantId: string, settingsPatch: any) {
  return withActionGuard(
    { 
      actionName: 'saveInboundAutopilotSettingsAction',
      roles: ['owner', 'admin']
    },
    async (ctx) => {
      // tenant scope check
      if (tenantId !== ctx.tenantId) {
        throw new Error("Geçersiz firma yetkisi (Cross-tenant violation)");
      }

      // Fetch current row
      const rows = await ctx.db.executeSafe({
        text: `SELECT id, config FROM ai_module_settings WHERE tenant_id = $1 AND module_name = 'inbound_autopilot_settings' LIMIT 1`,
        values: [ctx.tenantId]
      }) as any[];

      let currentConfig: any = {
        enabled: false,
        dry_run: true,
        rollout_percentage: 0,
        department_mode: 'selected',
        allowed_departments: []
      };
      let rowId: string | null = null;

      if (rows.length > 0) {
        rowId = rows[0].id;
        if (rows[0].config) {
          const parsedConfig = typeof rows[0].config === 'string'
            ? JSON.parse(rows[0].config)
            : rows[0].config;
          currentConfig = {
            ...currentConfig,
            ...parsedConfig
          };
        }
      }

      const originalConfig = { ...currentConfig };

      // Apply patches (only valid config keys, no PII allowed)
      const allowedKeys = ['enabled', 'dry_run', 'rollout_percentage', 'department_mode', 'allowed_departments'];
      for (const key of allowedKeys) {
        if (settingsPatch[key] !== undefined) {
          currentConfig[key] = settingsPatch[key];
        }
      }

      if (rowId) {
        await ctx.db.executeSafe({
          text: `UPDATE ai_module_settings SET config = $1, updated_at = NOW() WHERE id = $2`,
          values: [JSON.stringify(currentConfig), rowId]
        });
      } else {
        await ctx.db.executeSafe({
          text: `INSERT INTO ai_module_settings (tenant_id, module_name, is_active, config) VALUES ($1, 'inbound_autopilot_settings', true, $2)`,
          values: [ctx.tenantId, JSON.stringify(currentConfig)]
        });
      }

      // Log config change in a PII-free format
      const diff: any = {};
      for (const key of allowedKeys) {
        if (JSON.stringify(originalConfig[key]) !== JSON.stringify(currentConfig[key])) {
          diff[key] = { from: originalConfig[key], to: currentConfig[key] };
        }
      }

      await ctx.db.executeSafe({
        text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary) VALUES ($1, $2, $3, $4::jsonb)`,
        values: [
          ctx.tenantId,
          'UPDATE_INBOUND_AUTOPILOT_SETTINGS',
          `Inbound autopilot settings updated by user ${ctx.userId}`,
          JSON.stringify({
            userId: ctx.userId,
            module: 'inbound_autopilot_settings',
            diff
          })
        ]
      }).catch(err => console.error("Failed to write inbound settings change audit log", err));

      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

// Legacy wrapper to keep other features happy (delegates to saveFormAutopilotSettingsAction)
export async function saveAutoGreetingChannelSettingsAction(channelId: string, settingsPatch: any) {
  return withActionGuard(
    { 
      actionName: 'saveAutoGreetingChannelSettingsAction',
      roles: ['owner', 'admin']
    },
    async (ctx) => {
      // Map legacy format to the new structure
      const newPatch = {
        enabled: settingsPatch.auto_greeting_enabled,
        dry_run: settingsPatch.dry_run
      };
      const res = await saveFormAutopilotSettingsAction(ctx.tenantId, newPatch);
      if (!res.success) {
        throw new Error(res.error || "Form otopilot ayarları kaydedilemedi");
      }
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

