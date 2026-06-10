import type { TenantDB } from '@/lib/core/tenant-db';

/**
 * Dynamically resolves tenant display name from database.
 * Falls back to null if resolution fails.
 */
export async function resolveTenantDisplayName(db: TenantDB, tenantId: string): Promise<string | null> {
  try {
    const rows = await db.executeSafe({
      text: `SELECT name FROM tenants WHERE id = $1::uuid LIMIT 1`,
      values: [tenantId]
    }) as any[];
    if (rows.length > 0 && rows[0].name) {
      return rows[0].name;
    }
  } catch (_) {}
  return null;
}

/**
 * Dynamically resolves location name (e.g. city) from settings table.
 * Falls back to null if not defined.
 */
export async function resolveTenantLocationName(db: TenantDB, tenantId: string): Promise<string | null> {
  try {
    const rows = await db.executeSafe({
      text: `SELECT value FROM settings WHERE tenant_id = $1::uuid AND key = 'location_name' LIMIT 1`,
      values: [tenantId]
    }) as any[];
    if (rows.length > 0 && rows[0].value) {
      return String(rows[0].value).trim();
    }
  } catch (_) {}
  return null;
}

/**
 * Checks if tenant is in healthcare industry.
 */
export async function resolveIsHealthcare(db: TenantDB, tenantId: string): Promise<boolean> {
  // 1. Check from tenant settings
  try {
    const settingsRows = await db.executeSafe({
      text: `SELECT value FROM settings WHERE tenant_id = $1::uuid AND key = 'industry' LIMIT 1`,
      values: [tenantId]
    }) as any[];
    if (settingsRows.length > 0 && settingsRows[0].value) {
      const ind = String(settingsRows[0].value).toLowerCase().trim();
      if (ind === 'healthcare' || ind === 'health') return true;
    }
  } catch (_) {}

  // 2. Check from tenants table
  try {
    const rows = await db.executeSafe({
      text: `SELECT industry FROM tenants WHERE id = $1::uuid LIMIT 1`,
      values: [tenantId]
    }) as any[];
    if (rows.length > 0 && rows[0].industry) {
      const ind = rows[0].industry.toLowerCase().trim();
      return ind === 'healthcare' || ind === 'health';
    }
  } catch (_) {}

  return false;
}
