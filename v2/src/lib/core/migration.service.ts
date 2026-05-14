import { TenantDB } from "./tenant-db";
import { logger } from "./logger";
import { sql } from "@/lib/db";

// ==========================================
// QUBA AI — Tenant Auto-Migration Engine
// STRICT WRITE-PATH ONLY (Linear/Stripe Standard)
// ==========================================

const log = logger.withContext({ module: 'AutoMigrationEngine' });

// The Single Source of Truth for Legacy -> V2 Schema changes
export const LEGACY_TO_V2_KEY_MAP: Record<string, string> = {
  bot_whatsapp_active: "channel_whatsapp_enabled",
  bot_instagram_active: "channel_instagram_enabled",
  bot_foreign_active: "channel_foreign_enabled",
  // Add future migrations here
};

export interface MigrationAuditRecord {
  tenant_id: string;
  original_key: string;
  new_key: string;
  value: any;
}

export class MigrationService {
  /**
   * Evaluates a tenant's settings and performs an atomic upgrade
   * ONLY triggered via Setup, Admin Panel, or Background Cron.
   */
  static async runTenantMigration(tenantId: string, db: TenantDB) {
    const startTime = Date.now();
    log.info(`Starting schema migration check for tenant`, { tenantId });

    try {
      // Phase A: Detect (Read current schema state)
      // Check if we already migrated recently to avoid heavy queries
      const tenantCheck = await db.executeSafe(sql`
        SELECT schema_version FROM tenants WHERE id = ${tenantId}
      `);
      
      const currentVersion = tenantCheck[0]?.schema_version || 'v1';
      if (currentVersion === 'v2') {
        log.debug(`Tenant already at v2 schema. Skipping migration.`, { tenantId });
        return { migrated: false, reason: 'already_v2' };
      }

      // Fetch all settings for detection
      const settings = await db.executeSafe(sql`
        SELECT key, value FROM settings WHERE tenant_id = ${tenantId}
      `);

      // Phase B: Queue Write (Normalize Payload)
      const migrationQueue: MigrationAuditRecord[] = [];
      const keysToDelete: string[] = [];
      const upsertQueries = [];

      for (const row of settings) {
        const legacyKey = row.key;
        const newKey = LEGACY_TO_V2_KEY_MAP[legacyKey];

        // If this is a known legacy key
        if (newKey) {
          migrationQueue.push({
            tenant_id: tenantId,
            original_key: legacyKey,
            new_key: newKey,
            value: row.value
          });
          keysToDelete.push(legacyKey);

          // Prepare UPSERT for the new V2 Key
          upsertQueries.push(sql`
            INSERT INTO settings (tenant_id, key, value, updated_at)
            VALUES (${tenantId}, ${newKey}, ${row.value}, NOW())
            ON CONFLICT (tenant_id, key) 
            DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
          `);
        }
      }

      if (migrationQueue.length === 0) {
        // No keys to migrate, but mark as v2 to prevent future checks
        await db.executeSafe(sql`UPDATE tenants SET schema_version = 'v2' WHERE id = ${tenantId}`);
        return { migrated: false, reason: 'no_legacy_keys_found' };
      }

      // Phase C: Atomic Transaction (UPSERT + DELETE + LOG + MARK_V2)
      // We do this in one gigantic transaction to ensure data integrity
      const transactionQueries = [
        ...upsertQueries,
        sql`DELETE FROM settings WHERE tenant_id = ${tenantId} AND key = ANY(${keysToDelete})`,
        sql`UPDATE tenants SET schema_version = 'v2' WHERE id = ${tenantId}`
      ];

      // Insert Audit Logs (If table exists, otherwise skip or ensure it exists)
      // For now, we serialize the audit to a JSON blob or log it.
      // A dedicated migration_audit_logs table is best.
      const auditLogJson = JSON.stringify(migrationQueue);
      transactionQueries.push(sql`
        INSERT INTO migration_audit_logs (tenant_id, from_version, to_version, changes, created_at)
        VALUES (${tenantId}, 'v1', 'v2', ${auditLogJson}::jsonb, NOW())
      `);

      await db.executeTransaction(transactionQueries);

      log.info(`Tenant successfully migrated to v2 schema`, { 
        tenantId, 
        migratedKeys: keysToDelete.length,
        durationMs: Date.now() - startTime 
      });

      return { migrated: true, count: keysToDelete.length, queue: migrationQueue };

    } catch (error: any) {
      log.error(`Migration Engine failed for tenant`, error, { tenantId });
      throw error;
    }
  }
}
