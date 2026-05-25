import { logger } from "@/lib/core/logger";
import type { TenantQueryGuard } from "@/lib/core/tenant-db";
import type { CrmExtractionType } from "./ai/crm-extractor";

const log = logger.withContext({ module: 'OpportunityService' });

// Stage display labels (Turkish)
export const STAGE_LABELS: Record<string, string> = {
  new_lead: 'Yeni',
  first_contact: 'İlk İletişim',
  engaged: 'Cevap Verdi',
  discovery: 'Keşif',
  report_waiting: 'Rapor Bekleniyor',
  report_received: 'Rapor Geldi',
  doctor_review: 'Doktor İncelemesi',
  qualified: 'Nitelikli',
  offer_sent: 'Teklif Gönderildi',
  appointment_planning: 'Randevu Planlanıyor',
  appointment_booked: 'Randevu Alındı',
  arrived: 'Geldi',
  lost: 'Kayıp',
  not_qualified: 'Uygun Değil',
};

// Priority display
export const PRIORITY_LABELS: Record<string, string> = {
  cold: 'Soğuk',
  warm: 'Ilık',
  hot: 'Sıcak',
};

// Intent type labels
export const INTENT_LABELS: Record<string, string> = {
  appointment_request: 'Randevu Talebi',
  report_sent: 'Rapor Gönderildi',
  report_waiting: 'Rapor Bekleniyor',
  price_inquiry: 'Fiyat Sorgusu',
  travel_planning: 'Seyahat Planı',
  doctor_review: 'Doktor İncelemesi',
  general_info: 'Genel Bilgi',
  follow_up_needed: 'Takip Gerekli',
};

// Map CRM pipeline_stage → opportunity stage
function mapPipelineToOpportunityStage(pipelineStage: string | undefined, intentType: string | undefined): string {
  if (!pipelineStage) return 'new_lead';
  
  const stageMap: Record<string, string> = {
    'new': 'new_lead',
    'contacted': 'first_contact',
    'responded': 'engaged',
    'discovery': 'discovery',
    'qualified': 'qualified',
    'appointed': 'appointment_booked',
    'lost': 'lost',
  };

  // Intent-based override (more specific stage)
  if (intentType === 'report_sent') return 'report_received';
  if (intentType === 'report_waiting') return 'report_waiting';
  if (intentType === 'doctor_review') return 'doctor_review';
  if (intentType === 'appointment_request' && pipelineStage === 'qualified') return 'appointment_planning';

  return stageMap[pipelineStage] || 'new_lead';
}

export interface OpportunityUpsertInput {
  tenantId: string;
  conversationId: string;
  phoneNumber: string;
  channel: string;
  patientName?: string;
  crmData: CrmExtractionType;
  lastCustomerMessageAt?: string;
  traceId: string;
}

export class OpportunityService {
  constructor(private db: TenantQueryGuard) {}

  /**
   * Upsert opportunity from CRM extraction result.
   * Creates new opportunity if none exists for this conversation.
   * Updates existing opportunity if one exists (stage forward-only).
   */
  async upsertFromCrm(input: OpportunityUpsertInput): Promise<string | null> {
    const { tenantId, conversationId, phoneNumber, channel, patientName, crmData, lastCustomerMessageAt, traceId } = input;

    // Guard: Do not create opportunity if AI says no
    if (!crmData.should_create_opportunity) {
      log.info(`[OPP_SKIP] AI decided no opportunity needed`, { traceId, phoneNumber });
      return null;
    }

    try {
      // 1. Check for existing active opportunity for this conversation
      const existing = await this.db.executeSafe({
        text: `SELECT id, stage, priority, intent_type FROM opportunities 
               WHERE conversation_id = $1 AND tenant_id = $2 
               AND stage NOT IN ('lost', 'not_qualified', 'arrived')
               ORDER BY created_at DESC LIMIT 1`,
        values: [conversationId, tenantId]
      }) as any[];

      const newStage = mapPipelineToOpportunityStage(crmData.pipeline_stage, crmData.intent_type);
      const priority = crmData.opportunity_priority || 'warm';
      const followUpHours = crmData.follow_up_hours || 24;
      const nextFollowUp = new Date(Date.now() + followUpHours * 3600 * 1000).toISOString();

      if (existing.length > 0) {
        // UPDATE existing — forward-only stage progression
        const current = existing[0];
        const stageOrder = Object.keys(STAGE_LABELS);
        const currentIdx = stageOrder.indexOf(current.stage);
        const newIdx = stageOrder.indexOf(newStage);

        // Only advance stage, never go backwards
        const finalStage = newIdx > currentIdx ? newStage : current.stage;
        // Priority can escalate (cold→warm→hot) but not de-escalate
        const priorityOrder = ['cold', 'warm', 'hot'];
        const currentPrioIdx = priorityOrder.indexOf(current.priority);
        const newPrioIdx = priorityOrder.indexOf(priority);
        const finalPriority = newPrioIdx > currentPrioIdx ? priority : current.priority;

        await this.db.executeSafe({
          text: `UPDATE opportunities SET
                   stage = $1,
                   priority = $2,
                   intent_type = COALESCE($3, intent_type),
                   department = COALESCE($4, department),
                   country = COALESCE($5, country),
                   language = COALESCE($6, language),
                   patient_name = COALESCE($7, patient_name),
                   summary = COALESCE($8, summary),
                   next_follow_up_at = $9,
                   last_customer_message_at = COALESCE($10, last_customer_message_at),
                   ai_confidence = $11,
                   ai_reason = COALESCE($12, ai_reason),
                   updated_at = NOW()
                 WHERE id = $13 AND tenant_id = $14`,
          values: [
            finalStage,
            finalPriority,
            crmData.intent_type || null,
            crmData.department || null,
            crmData.country || null,
            crmData.language || null,
            patientName || null,
            crmData.opportunity_reason || null,
            nextFollowUp,
            lastCustomerMessageAt || null,
            crmData.country_confidence || null,
            crmData.opportunity_reason || null,
            current.id,
            tenantId
          ]
        });

        log.info(`[OPP_UPDATED] Opportunity updated`, { 
          traceId, oppId: current.id, stage: finalStage, priority: finalPriority 
        });
        return current.id;
      }

      // CREATE new opportunity
      const result = await this.db.executeSafe({
        text: `INSERT INTO opportunities (
                 tenant_id, conversation_id, phone_number,
                 patient_name, country, language,
                 source, source_channel, department,
                 stage, priority, intent_type,
                 next_follow_up_at, automation_status,
                 last_customer_message_at,
                 summary, ai_confidence, ai_reason,
                 tags
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
               RETURNING id`,
        values: [
          tenantId,
          conversationId,
          phoneNumber,
          patientName || null,
          crmData.country || null,
          crmData.language || null,
          channel, // whatsapp | instagram | messenger
          channel,
          crmData.department || null,
          newStage,
          priority,
          crmData.intent_type || null,
          nextFollowUp,
          'manual', // MVP: no auto messaging
          lastCustomerMessageAt || new Date().toISOString(),
          crmData.opportunity_reason || null,
          crmData.country_confidence || null,
          crmData.opportunity_reason || null,
          crmData.tags || []
        ]
      }) as any[];

      const newId = result[0]?.id;
      log.info(`[OPP_CREATED] New opportunity created`, { 
        traceId, oppId: newId, stage: newStage, priority, intentType: crmData.intent_type 
      });
      return newId;

    } catch (e: any) {
      log.error(`[OPP_UPSERT_FAILED] Non-fatal opportunity error`, e instanceof Error ? e : new Error(String(e)), { traceId });
      return null;
    }
  }

  /**
   * List opportunities with filters (for Takip Merkezi UI)
   */
  async list(tenantId: string, filters?: {
    stage?: string;
    priority?: string;
    department?: string;
    source?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions = ['o.tenant_id = $1'];
    const values: any[] = [tenantId];
    let paramIdx = 2;

    if (filters?.stage) {
      conditions.push(`o.stage = $${paramIdx++}`);
      values.push(filters.stage);
    }
    if (filters?.priority) {
      conditions.push(`o.priority = $${paramIdx++}`);
      values.push(filters.priority);
    }
    if (filters?.department) {
      conditions.push(`o.department = $${paramIdx++}`);
      values.push(filters.department);
    }
    if (filters?.source) {
      conditions.push(`o.source = $${paramIdx++}`);
      values.push(filters.source);
    }

    // Exclude terminal states by default
    conditions.push(`o.stage NOT IN ('arrived')`);

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    const rows = await this.db.executeSafe({
      text: `SELECT 
               o.*,
               cm.summary_text as ai_summary,
               cm.buying_intent,
               cm.sentiment,
               c.last_message_content,
               c.last_message_at as conv_last_message_at,
               c.channel as conv_channel,
               c.message_count
             FROM opportunities o
             LEFT JOIN conversations c ON o.conversation_id = c.id AND c.tenant_id = o.tenant_id
             LEFT JOIN conversation_memory cm ON c.id = cm.conversation_id AND cm.tenant_id = o.tenant_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY 
               CASE o.priority WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 WHEN 'cold' THEN 2 END,
               o.next_follow_up_at ASC NULLS LAST,
               o.updated_at DESC
             LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      values: [...values, limit, offset]
    });

    // Count
    const countResult = await this.db.executeSafe({
      text: `SELECT COUNT(*) as total FROM opportunities o WHERE ${conditions.join(' AND ')}`,
      values: values
    }) as any[];

    return {
      items: rows,
      total: parseInt(countResult[0]?.total || '0'),
    };
  }

  /**
   * Update stage manually
   */
  async updateStage(tenantId: string, oppId: string, newStage: string, reason?: string) {
    await this.db.executeSafe({
      text: `UPDATE opportunities SET 
               stage = $1, 
               closed_at = CASE WHEN $1 IN ('lost', 'not_qualified', 'arrived') THEN NOW() ELSE NULL END,
               closed_reason = CASE WHEN $1 IN ('lost', 'not_qualified') THEN $4 ELSE NULL END,
               updated_at = NOW()
             WHERE id = $2 AND tenant_id = $3`,
      values: [newStage, oppId, tenantId, reason || null]
    });
  }

  /**
   * Add a note
   */
  async addNote(tenantId: string, oppId: string, author: string, text: string) {
    await this.db.executeSafe({
      text: `UPDATE opportunities SET 
               notes = notes || $1::jsonb,
               updated_at = NOW()
             WHERE id = $2 AND tenant_id = $3`,
      values: [
        JSON.stringify([{ author, text, created_at: new Date().toISOString() }]),
        oppId,
        tenantId
      ]
    });
  }

  /**
   * Get stats for dashboard
   */
  async getStats(tenantId: string) {
    const result = await this.db.executeSafe({
      text: `SELECT 
               COUNT(*) FILTER (WHERE stage NOT IN ('lost','not_qualified','arrived')) as active,
               COUNT(*) FILTER (WHERE priority = 'hot' AND stage NOT IN ('lost','not_qualified','arrived')) as hot,
               COUNT(*) FILTER (WHERE next_follow_up_at < NOW() AND stage NOT IN ('lost','not_qualified','arrived')) as overdue,
               COUNT(*) FILTER (WHERE next_follow_up_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours' AND stage NOT IN ('lost','not_qualified','arrived')) as due_today
             FROM opportunities WHERE tenant_id = $1`,
      values: [tenantId]
    }) as any[];

    return result[0] || { active: 0, hot: 0, overdue: 0, due_today: 0 };
  }
}
