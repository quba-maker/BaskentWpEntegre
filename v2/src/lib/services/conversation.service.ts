import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";
import { normalizeCountryName } from "@/lib/utils/country";

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

  /**
   * CRM Intelligence Updates
   * Sadece var olan değerleri veya AI çıkarımlarını birleştirir.
   * patient_name: AI konuşmadan gerçek isim çıkardığında günceller (sosyal profil adını override eder)
   * country: Türkçe normalize edilir ve uygun bayrak ikonuyla eşleştirilir
   */
  async updateCrmIntelligence(
    phoneNumber: string,
    data: {
      patientName?: string;
      country?: string;
      department?: string;
      pipelineStage?: string;
      tags?: string[];
    }
  ): Promise<void> {
    if (!data.patientName && !data.country && !data.department && !data.pipelineStage && !data.tags) {
      return;
    }

    // Normalize country to Turkish
    const normalizedCountry = data.country ? normalizeCountryName(data.country) : null;

    // Forward-only pipeline stage order
    const STAGE_ORDER = ['new', 'contacted', 'responded', 'discovery', 'qualified', 'appointed', 'lost'];

    try {
      const current = await this.db.executeSafe(sql`
        SELECT tags, lead_stage FROM conversations 
        WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
      `);
      
      let mergedTags: string[] = [];
      let currentStage = 'new';
      if (current.length > 0) {
        currentStage = current[0].lead_stage || 'new';
        if (current[0].tags) {
          try {
            mergedTags = typeof current[0].tags === 'string' ? JSON.parse(current[0].tags) : current[0].tags;
          } catch {
             mergedTags = [];
          }
        }
      }
      
      if (data.tags && Array.isArray(data.tags)) {
        mergedTags = Array.from(new Set([...mergedTags, ...data.tags]));
      }

      // Forward-only stage protection: AI can only advance, never regress
      let finalStage = data.pipelineStage || null;
      if (finalStage) {
        const currentIdx = STAGE_ORDER.indexOf(currentStage);
        const newIdx = STAGE_ORDER.indexOf(finalStage);
        // If current stage is more advanced (or same), keep current
        // Exception: 'lost' can only be set manually or by AI, but can't go back from it
        if (currentIdx >= 0 && newIdx >= 0 && newIdx <= currentIdx) {
          finalStage = null; // Don't regress
        }
      }

      // ═══ DIAGNOSTIC: Conversation CRM Update ═══
      console.log(`[CONV_CRM_UPDATE] Params → patientName=${data.patientName || '(empty)'}, country=${normalizedCountry || '(null)'}, department=${data.department || '(null)'}, stage=${finalStage || '(null/no-change)'}, phone=${phoneNumber}`);

      // ═══ DIAGNOSTIC DB WRITE — inside updateCrmIntelligence ═══
      try {
        await this.db.executeSafe({
          text: `INSERT INTO messages (tenant_id, phone_number, direction, content, channel, provider_message_id)
                 VALUES ($1, $2, 'system', $3, 'whatsapp', $4)`,
          values: [
            this.db.tenantId,
            phoneNumber,
            `[CRM_INTEL_DIAG] raw_country=${data.country || '(undef)'} | normalized=${normalizedCountry || '(null)'} | department=${data.department || '(undef)'} | patientName=${data.patientName || '(undef)'} | stage=${finalStage || '(null)'}`,
            `crm_intel_${Date.now()}`
          ]
        });
      } catch (_) { /* non-blocking */ }

      await this.db.executeSafe(sql`
        UPDATE conversations 
        SET 
          patient_name = COALESCE(${data.patientName || null}, patient_name),
          country = COALESCE(${normalizedCountry}, country),
          department = COALESCE(${data.department || null}, department),
          lead_stage = COALESCE(${finalStage}, lead_stage),
          tags = ${JSON.stringify(mergedTags)}::jsonb
        WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
      `);

      console.log(`[CONV_CRM_UPDATED] OK → phone=${phoneNumber}, country=${normalizedCountry}, department=${data.department}`);

      // Sync stage to leads table (bi-directional consistency)
      if (finalStage) {
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
        try {
          await this.db.executeSafe(sql`
            UPDATE leads SET stage = ${finalStage}
            WHERE phone_number LIKE ${'%' + last10 + '%'} 
              AND tenant_id = ${this.db.tenantId}
              AND stage NOT IN ('appointed', 'lost')
          `);
        } catch (_) {
          // Non-blocking — leads table sync is best-effort
        }
      }
    } catch (e) {
      // Non-blocking log, fail safely
      console.error("[CRM_INTELLIGENCE_UPDATE_ERROR]", e);
    }
  }
}
