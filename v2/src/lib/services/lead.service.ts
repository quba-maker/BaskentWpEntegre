import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";

export class LeadService {
  private db: TenantDB;

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Lead Skorunu günceller.
   * Mevcut skordan yüksekse yazar (GREATEST).
   */
  async updateScore(phoneNumber: string, newScore: number): Promise<void> {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
    const likePattern = `%${last10}%`;

    await this.db.executeTransaction([
      sql`
        UPDATE leads 
        SET score = GREATEST(COALESCE(score, 0), ${newScore}) 
        WHERE phone_number LIKE ${likePattern} AND tenant_id = ${this.db.tenantId}
      `,
      sql`
        UPDATE conversations 
        SET lead_score = GREATEST(COALESCE(lead_score, 0), ${newScore}) 
        WHERE phone_number LIKE ${likePattern} AND tenant_id = ${this.db.tenantId}
      `
    ]);
  }

  /**
   * Lead Pipeline stage günceller (Sadece ileriye doğru).
   */
  async advanceStage(phoneNumber: string, newStage: string): Promise<void> {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
    const likePattern = `%${last10}%`;

    // appointed ve lost durumlarından geri dönülmez
    await this.db.executeTransaction([
      sql`
        UPDATE leads 
        SET stage = ${newStage} 
        WHERE phone_number LIKE ${likePattern} 
          AND tenant_id = ${this.db.tenantId}
          AND stage NOT IN ('appointed', 'lost')
      `,
      sql`
        UPDATE conversations 
        SET lead_stage = ${newStage} 
        WHERE phone_number LIKE ${likePattern} 
          AND tenant_id = ${this.db.tenantId}
      `
    ]);
  }
}
