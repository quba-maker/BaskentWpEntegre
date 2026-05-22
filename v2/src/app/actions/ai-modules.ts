"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { AI_MODULES, getDefaultModules, type TenantModuleConfig } from "@/lib/ai/modules";
import { logAudit } from "@/lib/audit";

// ==========================================
// QUBA AI — AI Module Management Actions (V2-Native)
// V2: ai_module_settings table (row-per-module)
// Rollback: USE_V2_AI_MODULES=false → settings table
// ==========================================

function isV2AIModulesEnabled(): boolean {
  return process.env.USE_V2_AI_MODULES !== 'false'; // default: true
}

// ── LAZY SEED ───────────────────────────────────────────
// İlk okumada V2 tablosunda 0 satır varsa default modülleri yazar
async function lazySeedModules(ctx: { db: any; tenantId: string }): Promise<TenantModuleConfig[]> {
  const defaults = getDefaultModules();

  for (const mod of defaults) {
    // Check if already exists (no unique constraint, conditional insert)
    const existing = await ctx.db.executeSafe({
      text: `SELECT id FROM ai_module_settings WHERE tenant_id = $1 AND module_name = $2 LIMIT 1`,
      values: [ctx.tenantId, mod.moduleId]
    });

    if (existing.length === 0) {
      await ctx.db.executeSafe({
        text: `INSERT INTO ai_module_settings (tenant_id, module_name, is_active, config)
               VALUES ($1, $2, $3, $4)`,
        values: [ctx.tenantId, mod.moduleId, mod.enabled, JSON.stringify(mod.config)]
      });
    }
  }

  return defaults;
}

// ── GET MODULES ─────────────────────────────────────────
export async function getAIModules(): Promise<{
  success: boolean;
  data?: { modules: TenantModuleConfig[]; catalog: typeof AI_MODULES };
  error?: string;
}> {
  return withActionGuard({ actionName: 'getAIModules' }, async (ctx) => {
    if (isV2AIModulesEnabled()) {
      // V2: Read from ai_module_settings
      const rows = await ctx.db.executeSafe({
        text: `SELECT module_name, is_active, config FROM ai_module_settings WHERE tenant_id = $1`,
        values: [ctx.tenantId]
      });

      let modules: TenantModuleConfig[];

      if (rows.length === 0) {
        // Lazy seed: write defaults to V2 table
        modules = await lazySeedModules(ctx);
      } else {
        // Map DB rows to TenantModuleConfig shape
        modules = rows.map((r: any) => ({
          moduleId: r.module_name,
          enabled: r.is_active,
          config: typeof r.config === 'string' ? JSON.parse(r.config) : (r.config || {})
        }));

        // Ensure any new catalog modules are included (added after seed)
        const allModuleIds = Object.keys(AI_MODULES);
        const existingIds = new Set(modules.map(m => m.moduleId));
        const defaults = getDefaultModules();

        for (const def of defaults) {
          if (!existingIds.has(def.moduleId)) {
            // New module added to catalog — seed it
            await ctx.db.executeSafe({
              text: `INSERT INTO ai_module_settings (tenant_id, module_name, is_active, config)
                     VALUES ($1, $2, $3, $4)`,
              values: [ctx.tenantId, def.moduleId, def.enabled, JSON.stringify(def.config)]
            });
            modules.push(def);
          }
        }
      }

      return { modules, catalog: AI_MODULES };
    }

    // V1 FALLBACK: Read from settings table
    const config = await ctx.db.executeSafe({
      text: `SELECT value FROM settings WHERE key = 'ai_modules_config' AND tenant_id = $1`,
      values: [ctx.tenantId]
    });

    let modules: TenantModuleConfig[];
    if (config.length > 0) {
      modules = JSON.parse(config[0].value);
    } else {
      modules = getDefaultModules();
    }

    return { modules, catalog: AI_MODULES };
  });
}

// ── TOGGLE MODULE ───────────────────────────────────────
export async function toggleAIModule(moduleId: string, enabled: boolean) {
  return withActionGuard({ actionName: 'toggleAIModule', roles: ['owner', 'admin'] }, async (ctx) => {
    if (isV2AIModulesEnabled()) {
      // V2: Direct row update
      const existing = await ctx.db.executeSafe({
        text: `SELECT id FROM ai_module_settings WHERE tenant_id = $1 AND module_name = $2 LIMIT 1`,
        values: [ctx.tenantId, moduleId]
      });

      if (existing.length === 0) {
        // Module not seeded yet — seed all, then update
        await lazySeedModules(ctx);
      }

      await ctx.db.executeSafe({
        text: `UPDATE ai_module_settings SET is_active = $1, updated_at = NOW()
               WHERE tenant_id = $2 AND module_name = $3`,
        values: [enabled, ctx.tenantId, moduleId]
      });

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
    }

    // V1 FALLBACK
    const configRes = await ctx.db.executeSafe({
      text: `SELECT value FROM settings WHERE key = 'ai_modules_config' AND tenant_id = $1`,
      values: [ctx.tenantId]
    });

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
    await ctx.db.executeSafe({
      text: `INSERT INTO settings (key, value, tenant_id, updated_at) 
      VALUES ('ai_modules_config', $1, $2, NOW())
      ON CONFLICT (tenant_id, key) 
      DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      values: [value, ctx.tenantId]
    });

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

// ── UPDATE MODULE CONFIG ────────────────────────────────
export async function updateAIModuleConfig(moduleId: string, config: Record<string, any>) {
  return withActionGuard({ actionName: 'updateAIModuleConfig', roles: ['owner', 'admin'] }, async (ctx) => {
    if (isV2AIModulesEnabled()) {
      // V2: Direct row update with JSONB merge
      const existing = await ctx.db.executeSafe({
        text: `SELECT id, config FROM ai_module_settings WHERE tenant_id = $1 AND module_name = $2 LIMIT 1`,
        values: [ctx.tenantId, moduleId]
      });

      if (existing.length === 0) {
        await lazySeedModules(ctx);
        // Re-fetch after seed
        const seeded = await ctx.db.executeSafe({
          text: `SELECT id, config FROM ai_module_settings WHERE tenant_id = $1 AND module_name = $2 LIMIT 1`,
          values: [ctx.tenantId, moduleId]
        });
        if (seeded.length === 0) throw new Error("Modül bulunamadı");
      }

      // Merge existing config with new config
      const currentConfig = existing.length > 0
        ? (typeof existing[0].config === 'string' ? JSON.parse(existing[0].config) : (existing[0].config || {}))
        : {};
      const mergedConfig = { ...currentConfig, ...config };

      await ctx.db.executeSafe({
        text: `UPDATE ai_module_settings SET config = $1, updated_at = NOW()
               WHERE tenant_id = $2 AND module_name = $3`,
        values: [JSON.stringify(mergedConfig), ctx.tenantId, moduleId]
      });

      return true;
    }

    // V1 FALLBACK
    const configRes = await ctx.db.executeSafe({
      text: `SELECT value FROM settings WHERE key = 'ai_modules_config' AND tenant_id = $1`,
      values: [ctx.tenantId]
    });

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
    await ctx.db.executeSafe({
      text: `INSERT INTO settings (key, value, tenant_id, updated_at) 
      VALUES ('ai_modules_config', $1, $2, NOW())
      ON CONFLICT (tenant_id, key) 
      DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      values: [value, ctx.tenantId]
    });

    return true;
  });
}
