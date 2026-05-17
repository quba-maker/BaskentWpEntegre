import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";
import { logger } from "@/lib/core/logger";

export class AlertService {
  private db: TenantDB;
  private log = logger.withContext({ module: 'AlertService' });

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Sistem içi alert oluşturur (Dashboard'da görünecek).
   * İleride event-driven yapıya geçince burası message broker'a event atabilir.
   */
  async createAlert(phoneNumber: string, alertType: string, message: string): Promise<void> {
    try {
      // NOTE: alerts table must exist via setup migrations.
      // Runtime DDL has been removed for production safety.
      await this.db.executeSafe(sql`
        INSERT INTO alerts (tenant_id, phone_number, alert_type, message) 
        VALUES (${this.db.tenantId}, ${phoneNumber}, ${alertType}, ${message})
      `);
    } catch (e: any) {
      this.log.error("AlertService Error", e instanceof Error ? e : new Error(String(e)));
    }
  }
}
