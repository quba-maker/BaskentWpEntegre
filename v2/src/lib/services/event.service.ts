import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";

export class EventService {
  private db: TenantDB;
  private log = logger.withContext({ module: 'EventService' });

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Yeni randevu talebi oluşturur (Idempotent).
   * Zaten pending/scheduled randevu varsa yenisini açmaz.
   * NOTE: events table must exist via setup migrations.
   */
  async requestAppointment(phoneNumber: string, details: string): Promise<void> {
    try {
      const activeEvent = await this.db.executeSafe(sql`
        SELECT id FROM events 
        WHERE phone_number = ${phoneNumber} 
          AND tenant_id = ${this.db.tenantId}
          AND event_type = 'appointment_request' 
          AND status IN ('pending', 'scheduled', 'confirmed')
      `);

      if (activeEvent.length === 0) {
        await this.db.executeSafe(sql`
          INSERT INTO events (tenant_id, phone_number, event_type, details, status) 
          VALUES (${this.db.tenantId}, ${phoneNumber}, 'appointment_request', ${details.substring(0, 500)}, 'pending')
        `);
      }
    } catch (e: any) {
      this.log.error("EventService Error", e instanceof Error ? e : new Error(String(e)));
    }
  }
}
