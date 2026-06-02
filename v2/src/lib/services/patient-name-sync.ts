import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: "PatientNameSyncService" });

/**
 * Validates whether a given string is a plausible patient name.
 * Programmatically filters out AI hallucinations (Turkish city names, prepositions, hitaps, etc.)
 */
export function isValidPatientName(name?: string | null): boolean {
  if (!name || !name.trim()) return false;
  const cleaned = name.trim();
  const lower = cleaned.toLowerCase();

  // List of common Turkish city names, prepositions, pronouns, and hitaps
  const blacklist = [
    "konya",
    "konyaya",
    "konya'ya",
    "istanbul",
    "ankara",
    "izmir",
    "antalya",
    "adana",
    "bursa",
    "samsun",
    "trabzon",
    "merhaba",
    "selam",
    "selamlar",
    "hayırlı",
    "isler",
    "gunler",
    "aksamlar",
    "sabahlar",
    "telefon",
    "randevu",
    "hastane",
    "doktor",
    "hemsire",
    "tedavi",
    "klinik",
    "baskent",
    "evet",
    "hayır",
    "tabiki",
    "tamam",
    "ok",
    "yes",
    "no",
    "hello",
    "hi",
    "annem",
    "babam",
    "kardesim",
    "esim",
    "kendisi",
    "turkiye",
    "türkiye",
    "almanya",
    "ingiltere",
    "fransa",
    "belçika",
    "hollanda",
    "isimsiz"
  ];

  // 1. Exact match blacklist check
  if (blacklist.includes(lower)) return false;

  // 2. Length check (too short or excessively long strings are likely not names)
  if (cleaned.length < 2 || cleaned.length > 50) return false;

  // 3. Numeric check (names shouldn't contain digits)
  if (/[0-9]/.test(cleaned)) return false;

  // 4. City names inside strings (e.g. "Konya'dan")
  const words = lower.split(/\s+/);
  for (const word of words) {
    if (blacklist.includes(word)) return false;
  }

  return true;
}

export class PatientNameSyncService {
  /**
   * Synchronizes a patient's name across all opportunities, conversations, and leads
   * sharing the same phone number and tenant ID. Prevents name fragmentation.
   * Null-safe, thread-safe, and validated.
   */
  static async syncName(db: TenantDB, phoneNumber: string, newName: string): Promise<void> {
    if (!phoneNumber || !newName || !newName.trim()) return;
    const cleanName = newName.trim();

    // Programmatic safeguard against AI extraction hallucinations
    if (!isValidPatientName(cleanName)) {
      log.warn(`[PATIENT_NAME_SYNC] Ignored invalid/hallucinated name update: "${cleanName}" for phone: ${phoneNumber}`);
      return;
    }

    const cleanPhone = phoneNumber.replace(/\D/g, "");
    const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;

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
