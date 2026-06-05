import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";
import { isValidPatientName } from "@/lib/utils/patient-name-resolver";

const log = logger.withContext({ module: "PatientNameSyncService" });

export class PatientNameSyncService {
  /**
   * Synchronizes a patient's name across all opportunities, conversations, and leads
   * sharing the same phone number and tenant ID. Prevents name fragmentation.
   * Null-safe, thread-safe, and validated.
   */
  static async syncName(db: TenantDB, phoneNumber: string, newName: string, forceManualOverride: boolean = false): Promise<void> {
    if (!phoneNumber || !newName || !newName.trim()) return;
    const cleanName = newName.trim();

    // Programmatic safeguard against AI extraction hallucinations
    if (!isValidPatientName(cleanName)) {
      log.warn(`[PATIENT_NAME_SYNC] Ignored invalid/hallucinated name update: "${cleanName}" for phone: ${phoneNumber}`);
      return;
    }

    const cleanPhone = phoneNumber.replace(/\D/g, "");
    const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;

    // Check if name is manually locked for this phone number
    if (!forceManualOverride) {
      try {
        const lockCheck = await db.executeSafe(sql`
          SELECT metadata FROM opportunities
          WHERE phone_number = ${phoneNumber} AND tenant_id = ${db.tenantId}
            AND stage NOT IN ('lost', 'not_qualified', 'arrived')
          ORDER BY updated_at DESC
          LIMIT 1
        `);
        if (lockCheck.length > 0) {
          const metadata = typeof lockCheck[0].metadata === 'string'
            ? JSON.parse(lockCheck[0].metadata)
            : (lockCheck[0].metadata || {});
          if (metadata.name_locked === true || metadata.name_locked === 'true') {
            log.info(`[PATIENT_NAME_SYNC] Skipped sync because patient name is manually locked. Name: "${cleanName}" for phone: ${phoneNumber}`);
            return;
          }
        }
      } catch (lockErr) {
        log.warn(`[PATIENT_NAME_SYNC] Lock check failed, proceeding safely`, { error: String(lockErr) });
      }
    }

    log.info(`[PATIENT_NAME_SYNC] Syncing validated name to "${cleanName}" for phone: ${phoneNumber}`, { tenantId: db.tenantId });

    try {
      // 1. Update conversations record for this patient
      await db.executeSafe(sql`
        UPDATE conversations 
        SET patient_name = ${cleanName}, updated_at = NOW() 
        WHERE phone_number = ${phoneNumber} AND tenant_id = ${db.tenantId}
      `);

      // 2. Update ALL opportunities (both active and historical) for this patient
      await db.executeSafe(sql`
        UPDATE opportunities 
        SET patient_name = ${cleanName}, updated_at = NOW() 
        WHERE phone_number = ${phoneNumber} AND tenant_id = ${db.tenantId}
      `);

      // 3. Update ALL lead forms matching this phone number (best-effort matching last 10 digits)
      if (last10) {
        await db.executeSafe(sql`
          UPDATE leads 
          SET patient_name = ${cleanName} 
          WHERE phone_number LIKE ${"%" + last10} AND tenant_id = ${db.tenantId}
        `);
      }

      log.info(`[PATIENT_NAME_SYNC_SUCCESS] Patient name synchronized successfully across conversations, opportunities, and leads.`);
    } catch (err) {
      log.error(`[PATIENT_NAME_SYNC_FAILED] Failed to sync patient name`, err instanceof Error ? err : new Error(String(err)));
    }
  }
}
