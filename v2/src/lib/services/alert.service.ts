import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";

export class AlertService {
  private db: TenantDB;

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Sistem içi alert oluşturur (Dashboard'da görünecek).
   * İleride event-driven yapıya geçince burası message broker'a event atabilir.
   */
  async createAlert(phoneNumber: string, alertType: string, message: string): Promise<void> {
    try {
      // Tablo yoksa oluştur (Legacy fallback, idealde setup'ta olmalı)
      await this.db.executeSafe(sql`
        CREATE TABLE IF NOT EXISTS alerts (
          id SERIAL PRIMARY KEY, 
          tenant_id UUID,
          phone_number VARCHAR(20), 
          alert_type VARCHAR(50), 
          message TEXT, 
          is_read BOOLEAN DEFAULT false, 
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await this.db.executeSafe(sql`
        INSERT INTO alerts (tenant_id, phone_number, alert_type, message) 
        VALUES (${this.db.tenantId}, ${phoneNumber}, ${alertType}, ${message})
      `);
    } catch (e: any) {
      console.error("AlertService Error:", e.message);
    }
  }
}
