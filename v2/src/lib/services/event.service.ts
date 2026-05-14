import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";

export class EventService {
  private db: TenantDB;

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Yeni randevu talebi oluşturur (Idempotent).
   * Zaten pending/scheduled randevu varsa yenisini açmaz.
   */
  async requestAppointment(phoneNumber: string, details: string): Promise<void> {
    try {
      await this.db.executeSafe(sql`
        CREATE TABLE IF NOT EXISTS events (
          id SERIAL PRIMARY KEY, 
          tenant_id UUID,
          phone_number VARCHAR(20), 
          event_type VARCHAR(50), 
          details TEXT, 
          status VARCHAR(20) DEFAULT 'pending', 
          scheduled_date TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

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
      console.error("EventService Error:", e.message);
    }
  }
}
