import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";

// ==========================================
// CONVERSATION SERVICE (State Extraction & Locking)
// ==========================================

export class ConversationService {
  private db: TenantDB;

  constructor(db: TenantDB) {
    this.db = db;
  }

  /**
   * Postgres Advisory Lock kullanarak Conversation seviyesinde distributed lock alır.
   * Aynı telefon numarası için parallel AI/Webhook transactionlarını serialize eder.
   */
  async acquireLock(phoneNumber: string): Promise<void> {
    // String hash'ini integer lock ID'ye çeviriyoruz
    let hash = 0;
    for (let i = 0; i < phoneNumber.length; i++) {
      hash = ((hash << 5) - hash) + phoneNumber.charCodeAt(i);
      hash |= 0;
    }
    
    // xact_lock: Transaction bitene kadar otomatik lock tutar (Commit/Rollback'te düşer)
    await this.db.executeSafe(sql`SELECT pg_advisory_xact_lock(${hash})`);
  }

  /**
   * Conversation Status (human/bot) state okuma
   */
  async getStatus(phoneNumber: string): Promise<'bot' | 'human'> {
    const res = await this.db.executeSafe(sql`
      SELECT status FROM conversations 
      WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
    `);
    return res.length > 0 ? (res[0].status as 'bot' | 'human') : 'bot';
  }

  /**
   * AI Workflow Phase ve Temperature state okuma
   */
  async getState(phoneNumber: string): Promise<{ phase: string, temperature: string }> {
    const res = await this.db.executeSafe(sql`
      SELECT phase, temperature FROM conversations 
      WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
    `);
    if (res.length > 0) {
      return { 
        phase: res[0].phase || 'greeting', 
        temperature: res[0].temperature || 'cold' 
      };
    }
    return { phase: 'greeting', temperature: 'cold' };
  }

  /**
   * AI Workflow Phase ve Temperature state güncelleme
   */
  async updateState(phoneNumber: string, phase?: string, temperature?: string): Promise<void> {
    if (phase && temperature) {
      await this.db.executeSafe(sql`
        UPDATE conversations 
        SET phase = ${phase}, temperature = ${temperature} 
        WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
      `);
    } else if (phase) {
      await this.db.executeSafe(sql`
        UPDATE conversations 
        SET phase = ${phase} 
        WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
      `);
    } else if (temperature) {
      await this.db.executeSafe(sql`
        UPDATE conversations 
        SET temperature = ${temperature} 
        WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
      `);
    }
  }

  /**
   * AI Workflow için Konuşma Geçmişi Alma
   */
  async getHistory(phoneNumber: string, limit: number = 20) {
    const prev = await this.db.executeSafe(sql`
      SELECT direction, content FROM messages 
      WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId} 
      ORDER BY created_at DESC LIMIT ${limit}
    `);
    
    return prev.reverse().map((m: any) => ({
      role: (m.direction === 'in' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: String(m.content)
    }));
  }

  /**
   * Follow up count reset
   */
  async resetFollowUpCount(phoneNumber: string): Promise<void> {
    await this.db.executeSafe(sql`
      UPDATE conversations 
      SET follow_up_count = 0 
      WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
    `);
  }
}
