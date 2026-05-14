"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { AI_MODULES, getDefaultModules, type ModuleId, type TenantModuleConfig } from "@/lib/ai/modules";
import { logAudit } from "@/lib/audit";

// ==========================================
// QUBA AI — AI Module Management Actions
// Tenant bazlı AI modül yönetimi
// ==========================================

/**
 * Tenant'ın AI modül yapılandırmasını getir
 */
export async function getAIModules(): Promise<{
  success: boolean;
  modules?: TenantModuleConfig[];
  catalog?: typeof AI_MODULES;
  error?: string;
}> {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Oturum yok" };

    // DB'den tenant config al
    const config = await sql`
      SELECT value FROM settings 
      WHERE key = 'ai_modules_config' AND tenant_id = ${session.tenantId}
    `;

    let modules: TenantModuleConfig[];
    if (config.length > 0) {
      modules = JSON.parse(config[0].value);
    } else {
      // İlk kez — varsayılan modülleri oluştur
      modules = getDefaultModules();
    }

    return { success: true, modules, catalog: AI_MODULES };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Modülü aç/kapat
 */
export async function toggleAIModule(moduleId: string, enabled: boolean) {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Oturum yok" };
    if (session.role !== "owner" && session.role !== "admin" && session.role !== "platform_admin") {
      return { success: false, error: "Yetki yok" };
    }

    // Mevcut config al
    const configRes = await sql`
      SELECT value FROM settings 
      WHERE key = 'ai_modules_config' AND tenant_id = ${session.tenantId}
    `;

    let modules: TenantModuleConfig[];
    if (configRes.length > 0) {
      modules = JSON.parse(configRes[0].value);
    } else {
      modules = getDefaultModules();
    }

    // Modülü bul ve güncelle
    const idx = modules.findIndex((m) => m.moduleId === moduleId);
    if (idx === -1) return { success: false, error: "Modül bulunamadı" };
    modules[idx].enabled = enabled;

    // Kaydet
    const value = JSON.stringify(modules);
    await sql`
      INSERT INTO settings (key, value, tenant_id, updated_at) 
      VALUES ('ai_modules_config', ${value}, ${session.tenantId}, NOW())
      ON CONFLICT (tenant_id, key) 
      DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `;

    logAudit({
      tenantId: session.tenantId,
      userId: session.userId,
      userEmail: session.email,
      action: "ai_module_toggled",
      entityType: "ai_module",
      entityId: moduleId,
      details: { enabled },
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Modül yapılandırmasını güncelle
 */
export async function updateAIModuleConfig(moduleId: string, config: Record<string, any>) {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Oturum yok" };
    if (session.role !== "owner" && session.role !== "admin" && session.role !== "platform_admin") {
      return { success: false, error: "Yetki yok" };
    }

    const configRes = await sql`
      SELECT value FROM settings 
      WHERE key = 'ai_modules_config' AND tenant_id = ${session.tenantId}
    `;

    let modules: TenantModuleConfig[];
    if (configRes.length > 0) {
      modules = JSON.parse(configRes[0].value);
    } else {
      modules = getDefaultModules();
    }

    const idx = modules.findIndex((m) => m.moduleId === moduleId);
    if (idx === -1) return { success: false, error: "Modül bulunamadı" };
    modules[idx].config = { ...modules[idx].config, ...config };

    const value = JSON.stringify(modules);
    await sql`
      INSERT INTO settings (key, value, tenant_id, updated_at) 
      VALUES ('ai_modules_config', ${value}, ${session.tenantId}, NOW())
      ON CONFLICT (tenant_id, key) 
      DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    `;

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
