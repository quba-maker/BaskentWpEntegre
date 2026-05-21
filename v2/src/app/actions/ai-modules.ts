"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { AI_MODULES, getDefaultModules, type TenantModuleConfig } from "@/lib/ai/modules";
import { logAudit } from "@/lib/audit";

// ==========================================
// QUBA AI — AI Module Management Actions
// Tenant bazlı AI modül yönetimi
// ==========================================

export async function getAIModules(): Promise<{
  success: boolean;
  data?: { modules: TenantModuleConfig[]; catalog: typeof AI_MODULES };
  error?: string;
}> {
  return withActionGuard({ actionName: 'getAIModules' }, async (ctx) => {
    const config = await ctx.db.executeSafe(
      `SELECT value FROM settings WHERE key = 'ai_modules_config' AND tenant_id = $1`,
      [ctx.tenantId]
    );

    let modules: TenantModuleConfig[];
    if (config.length > 0) {
      modules = JSON.parse(config[0].value);
    } else {
      modules = getDefaultModules();
    }

    return { modules, catalog: AI_MODULES };
  });
}

export async function toggleAIModule(moduleId: string, enabled: boolean) {
  return withActionGuard({ actionName: 'toggleAIModule', roles: ['owner', 'admin'] }, async (ctx) => {
    const configRes = await ctx.db.executeSafe(
      `SELECT value FROM settings WHERE key = 'ai_modules_config' AND tenant_id = $1`,
      [ctx.tenantId]
    );

    let modules: TenantModuleConfig[];
    if (configRes.length > 0) {
      modules = JSON.parse(configRes[0].value);
    } else {
      modules = getDefaultModules();
    }

    const idx = modules.findIndex((m) => m.moduleId === moduleId);
    if (idx === -1) throw new Error("Modül bulunamadı");
    modules[idx].enabled = enabled;

    const value = JSON.stringify(modules);
    await ctx.db.executeSafe(
      `INSERT INTO settings (key, value, tenant_id, updated_at) 
      VALUES ('ai_modules_config', $1, $2, NOW())
      ON CONFLICT (tenant_id, key) 
      DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [value, ctx.tenantId]
    );

    logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      userEmail: ctx.email,
      action: "ai_module_toggled",
      entityType: "ai_module",
      entityId: moduleId,
      details: { enabled },
    });

    return true;
  });
}

export async function updateAIModuleConfig(moduleId: string, config: Record<string, any>) {
  return withActionGuard({ actionName: 'updateAIModuleConfig', roles: ['owner', 'admin'] }, async (ctx) => {
    const configRes = await ctx.db.executeSafe(
      `SELECT value FROM settings WHERE key = 'ai_modules_config' AND tenant_id = $1`,
      [ctx.tenantId]
    );

    let modules: TenantModuleConfig[];
    if (configRes.length > 0) {
      modules = JSON.parse(configRes[0].value);
    } else {
      modules = getDefaultModules();
    }

    const idx = modules.findIndex((m) => m.moduleId === moduleId);
    if (idx === -1) throw new Error("Modül bulunamadı");
    modules[idx].config = { ...modules[idx].config, ...config };

    const value = JSON.stringify(modules);
    await ctx.db.executeSafe(
      `INSERT INTO settings (key, value, tenant_id, updated_at) 
      VALUES ('ai_modules_config', $1, $2, NOW())
      ON CONFLICT (tenant_id, key) 
      DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [value, ctx.tenantId]
    );

    return true;
  });
}
