import { sql } from "@/lib/db";
import { TenantDB } from "@/lib/core/tenant-db";
import { normalizeCountryName } from "@/lib/utils/country";
import { logger } from "@/lib/core/logger";

// ==========================================
// CONVERSATION SERVICE (State Extraction & Locking)
// ==========================================

export class ConversationService {
  private db: TenantDB;
  private log = logger.withContext({ module: 'ConversationService' });

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
      SELECT direction, content, media_type, media_metadata FROM messages 
      WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId} 
      ORDER BY created_at DESC LIMIT ${limit}
    `);
    
    return prev.reverse().map((m: any) => {
      let messageContent: string;
      
      if (m.media_type) {
        // P2I-P0: Inject AI-safe media context instead of emoji placeholder
        const { buildMediaContext } = require('./ai/media-context');
        messageContent = buildMediaContext({
          direction: m.direction,
          mediaType: m.media_type,
          content: m.content || '',
          metadata: m.media_metadata || undefined,
        });
      } else {
        messageContent = String(m.content);
      }
      
      return {
        role: (m.direction === 'in' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: messageContent,
      };
    });
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
      // P1A-FIX: Cancellation detection
      explicitCancellation?: boolean;
      optOutRequested?: boolean;
      cancellationReason?: string;
      shouldStopFollowUp?: boolean;
      newIdentityDetected?: boolean;
    }
  ): Promise<void> {
    if (!data.patientName && !data.country && !data.department && !data.pipelineStage && !data.tags && !data.explicitCancellation && !data.newIdentityDetected) {
      return;
    }

    // Normalize country to Turkish
    const normalizedCountry = data.country ? normalizeCountryName(data.country) : null;

    try {
      const current = await this.db.executeSafe(sql`
        SELECT tags FROM conversations 
        WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
      `);
      
      let mergedTags: string[] = [];
      if (current.length > 0) {
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

      this.log.info(`[CONV_CRM_UPDATE] input`, { phone: phoneNumber, rawCountry: data.country, normalized: normalizedCountry, department: data.department, stage: data.pipelineStage });

      // Update non-stage fields directly (country, department, name, tags)
      await this.db.executeSafe(sql`
        UPDATE conversations 
        SET 
          patient_name = CASE WHEN ${data.newIdentityDetected || false} = true THEN ${data.patientName || null} ELSE COALESCE(${data.patientName || null}, patient_name) END,
          country = COALESCE(${normalizedCountry}, country),
          department = COALESCE(${data.department || null}, department),
          tags = ${JSON.stringify(mergedTags)}::jsonb
        WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
      `);

      this.log.info(`[CONV_CRM_UPDATED] non-stage fields`, { phone: phoneNumber, country: normalizedCountry, department: data.department });

      // Route stage change through UnifiedStageService (AI rules enforced centrally)
      if (data.pipelineStage) {
        try {
          const { UnifiedStageService } = await import('./unified-stage.service');
          const { LEAD_TO_OPP_MAP } = await import('@/lib/config/stage-mapping');

          // Find conversation for proper opportunity resolution
          const convRows = await this.db.executeSafe(sql`
            SELECT id FROM conversations 
            WHERE phone_number = ${phoneNumber} AND tenant_id = ${this.db.tenantId}
          `);
          const conversationId = convRows[0]?.id;

          // Map lead-system pipeline_stage to opportunity stage
          const oppTargetStage = LEAD_TO_OPP_MAP[data.pipelineStage] || data.pipelineStage;

          const result = await UnifiedStageService.update({
            tenantId: this.db.tenantId,
            source: 'ai',
            conversationId,
            phoneNumber,
            targetStage: oppTargetStage,
            explicitCancellation: data.explicitCancellation,
            optOutRequested: data.optOutRequested,
            reason: data.explicitCancellation 
              ? `explicit_customer_cancellation: ${data.cancellationReason || 'müşteri açıkça vazgeçti'}`
              : undefined,
          });

          if (result.blocked) {
            this.log.info(`[CONV_CRM_STAGE_BLOCKED] AI stage blocked`, {
              phone: phoneNumber,
              targetStage: oppTargetStage,
              blockReason: result.blockReason
            });
          } else {
            this.log.info(`[CONV_CRM_STAGE_SYNCED] AI stage unified`, {
              phone: phoneNumber,
              newOppStage: result.newOppStage,
              mirrorLeadStage: result.mirrorLeadStage
            });
          }
        } catch (stageErr) {
          // Non-blocking — stage sync failure shouldn't break CRM pipeline
          this.log.error(`[CONV_CRM_STAGE_ERROR] Non-fatal`,
            stageErr instanceof Error ? stageErr : new Error(String(stageErr)),
            { phone: phoneNumber }
          );
        }
      }
    } catch (e) {
      // Non-blocking log, fail safely
      console.error("[CRM_INTELLIGENCE_UPDATE_ERROR]", e);
    }
  }
}
