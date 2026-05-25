import { logger } from "@/lib/core/logger";
import type { TenantDB } from "@/lib/core/tenant-db";
import type { CrmExtractionType } from "./ai/crm-extractor";
import { oppStageToLeadStage } from '@/lib/config/stage-mapping';

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
  externalCountry?: string; // Deterministic country from phone prefix
}

export class OpportunityService {
  constructor(private db: TenantDB) {}

  /**
   * Upsert opportunity from CRM extraction result.
   * Creates new opportunity if none exists for this conversation.
   * Updates existing opportunity if one exists (stage forward-only).
   */
  /**
   * Compute the best next_follow_up_at from CRM extraction.
   * Priority: requested_callback_datetime > follow_up_hours > 24h default
   */
  private computeNextFollowUp(crmData: CrmExtractionType): string {
    // 1. AI extracted a specific callback datetime (e.g. "yarın 14:00")
    if (crmData.requested_callback_datetime) {
      try {
        const parsed = new Date(crmData.requested_callback_datetime);
        if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
          return parsed.toISOString();
        }
      } catch {
        // Fall through to follow_up_hours
      }
    }
    // 2. AI suggested follow_up_hours
    const followUpHours = crmData.follow_up_hours || 24;
    return new Date(Date.now() + followUpHours * 3600 * 1000).toISOString();
  }

  /**
   * Build metadata JSONB from CRM extraction.
   */
  private buildMetadata(crmData: CrmExtractionType): Record<string, any> {
    const meta: Record<string, any> = {};
    if (crmData.requested_callback_datetime) meta.requested_callback_datetime = crmData.requested_callback_datetime;
    if (crmData.travel_date) meta.travel_date_raw = crmData.travel_date;
    if (crmData.report_status && crmData.report_status !== 'none') meta.report_status = crmData.report_status;
    if (crmData.next_best_action) meta.next_best_action = crmData.next_best_action;
    if (crmData.requires_human_confirmation) meta.requires_human_confirmation = true;
    return meta;
  }

  async upsertFromCrm(input: OpportunityUpsertInput): Promise<string | null> {
    const { tenantId, conversationId, phoneNumber, channel, patientName, crmData, lastCustomerMessageAt, traceId, externalCountry } = input;

    // Resolve country: externalCountry (deterministic) > crmData.country
    // Resolve country: AI extraction (patient's own words) > phone prefix (deterministic guess)
    // Medical tourism: patient may have +90 phone but live in Germany
    const resolvedCountry = crmData.country || externalCountry || null;

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
      const nextFollowUp = this.computeNextFollowUp(crmData);
      const metadata = this.buildMetadata(crmData);

      // Parse travel_date
      let travelDate: string | null = null;
      if (crmData.travel_date) {
        try {
          const td = new Date(crmData.travel_date);
          if (!isNaN(td.getTime())) travelDate = td.toISOString().split('T')[0];
        } catch { /* ignore */ }
      }

      if (existing.length > 0) {
        // UPDATE existing — metadata/enrichment only, NO stage write
        // Stage is exclusively managed by UnifiedStageService
        const current = existing[0];

        // Priority can escalate (cold→warm→hot) but not de-escalate
        const priorityOrder = ['cold', 'warm', 'hot'];
        const currentPrioIdx = priorityOrder.indexOf(current.priority);
        const newPrioIdx = priorityOrder.indexOf(priority);
        const finalPriority = newPrioIdx > currentPrioIdx ? priority : current.priority;

        // ═══ DIAGNOSTIC: Opportunity Update Values ═══
        log.info(`[OPP_UPDATE_TRACE] Metadata-only update (stage managed by UnifiedStageService)`, {
          traceId,
          oppId: current.id,
          existing_department: current.department || '(null)',
          new_department_param: crmData.department || '(empty→will keep existing)',
          existing_country: current.country || '(null)',
          new_country_param: resolvedCountry || '(empty→will keep existing)',
          travel_date_param: travelDate || '(null→will keep existing)',
          currentStage: current.stage,
          priority: `${current.priority} → ${finalPriority}`
        });

        await this.db.executeSafe({
          text: `UPDATE opportunities SET
                   priority = $1,
                   intent_type = COALESCE(NULLIF($2, ''), intent_type),
                   department = COALESCE(NULLIF($3, ''), department),
                   country = COALESCE(NULLIF($4, ''), country),
                   language = COALESCE(NULLIF($5, ''), language),
                   patient_name = COALESCE(NULLIF($6, ''), patient_name),
                   summary = COALESCE(NULLIF($7, ''), summary),
                   next_follow_up_at = COALESCE($8, next_follow_up_at),
                   last_customer_message_at = COALESCE($9, last_customer_message_at),
                   ai_confidence = COALESCE($10, ai_confidence),
                   ai_reason = COALESCE(NULLIF($11, ''), ai_reason),
                   travel_date = COALESCE($12::date, travel_date),
                   report_status = COALESCE(NULLIF($13, ''), NULLIF($13, 'none'), report_status),
                   requires_human_confirmation = CASE WHEN $14 = true THEN true ELSE requires_human_confirmation END,
                   metadata = metadata || $15::jsonb,
                   updated_at = NOW()
                 WHERE id = $16 AND tenant_id = $17`,
          values: [
            finalPriority,
            crmData.intent_type || '',
            crmData.department || '',
            resolvedCountry || '',
            crmData.language || '',
            patientName || '',
            crmData.opportunity_reason || '',
            nextFollowUp,
            lastCustomerMessageAt || null,
            crmData.country_confidence || null,
            crmData.opportunity_reason || '',
            travelDate,
            crmData.report_status || '',
            crmData.requires_human_confirmation || false,
            JSON.stringify(metadata),
            current.id,
            tenantId
          ]
        });

        log.info(`[OPP_UPDATED] Opportunity metadata updated (stage unchanged)`, { 
          traceId, oppId: current.id, currentStage: current.stage, priority: finalPriority,
          department: crmData.department, country: resolvedCountry,
          travelDate, reportStatus: crmData.report_status
        });

        // NO mirrorStageToLinked — UnifiedStageService is sole stage owner
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
                 tags, travel_date, report_status,
                 requires_human_confirmation, metadata
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::date, $21, $22, $23::jsonb)
               RETURNING id`,
        values: [
          tenantId,
          conversationId,
          phoneNumber,
          patientName || null,
          resolvedCountry,
          crmData.language || null,
          channel,
          channel,
          crmData.department || null,
          newStage,
          priority,
          crmData.intent_type || null,
          nextFollowUp,
          'manual',
          lastCustomerMessageAt || new Date().toISOString(),
          crmData.opportunity_reason || null,
          crmData.country_confidence || null,
          crmData.opportunity_reason || null,
          crmData.tags || [],
          travelDate,
          crmData.report_status || null,
          crmData.requires_human_confirmation || false,
          JSON.stringify(metadata)
        ]
      }) as any[];

      const newId = result[0]?.id;
      log.info(`[OPP_CREATED] New opportunity created`, { 
        traceId, oppId: newId, stage: newStage, priority, intentType: crmData.intent_type,
        travelDate, reportStatus: crmData.report_status
      });

      // NO mirrorStageToLinked on INSERT — UnifiedStageService handles stage sync
      return newId;

    } catch (e: any) {
      log.error(`[OPP_UPSERT_FAILED] Non-fatal opportunity error`, e instanceof Error ? e : new Error(String(e)), { traceId });
      return null;
    }
  }

  /**
   * Partial update: Enrich existing opportunity with new CRM data without full upsert.
   * Used when should_create_opportunity=false but active opportunity exists.
   */
  async enrichExisting(tenantId: string, conversationId: string, crmData: CrmExtractionType, externalCountry?: string, traceId?: string): Promise<boolean> {
    try {
      const existing = await this.db.executeSafe({
        text: `SELECT id FROM opportunities 
               WHERE conversation_id = $1 AND tenant_id = $2 
               AND stage NOT IN ('lost', 'not_qualified', 'arrived')
               ORDER BY created_at DESC LIMIT 1`,
        values: [conversationId, tenantId]
      }) as any[];

      if (existing.length === 0) return false;

      // Resolve country: AI extraction (patient's own words) > phone prefix (deterministic guess)
    // Medical tourism: patient may have +90 phone but live in Germany
    const resolvedCountry = crmData.country || externalCountry || null;
      const metadata = this.buildMetadata(crmData);
      let travelDate: string | null = null;
      if (crmData.travel_date) {
        try {
          const td = new Date(crmData.travel_date);
          if (!isNaN(td.getTime())) travelDate = td.toISOString().split('T')[0];
        } catch { /* ignore */ }
      }

      await this.db.executeSafe({
        text: `UPDATE opportunities SET
                 department = COALESCE(NULLIF($1, ''), department),
                 country = COALESCE(NULLIF($2, ''), country),
                 language = COALESCE(NULLIF($3, ''), language),
                 travel_date = COALESCE($4::date, travel_date),
                 report_status = COALESCE(NULLIF($5, ''), NULLIF($5, 'none'), report_status),
                 requires_human_confirmation = CASE WHEN $6 = true THEN true ELSE requires_human_confirmation END,
                 metadata = metadata || $7::jsonb,
                 last_customer_message_at = NOW(),
                 updated_at = NOW()
               WHERE id = $8 AND tenant_id = $9`,
        values: [
          crmData.department || '',
          resolvedCountry || '',
          crmData.language || '',
          travelDate,
          crmData.report_status || '',
          crmData.requires_human_confirmation || false,
          JSON.stringify(metadata),
          existing[0].id,
          tenantId
        ]
      });

      // ═══ DIAGNOSTIC: Enrich Existing Trace ═══
      log.info(`[OPP_ENRICHED] Existing opportunity enriched (no new opp needed)`, { 
        traceId, oppId: existing[0].id,
        department_param: crmData.department || '(empty)',
        country_param: resolvedCountry || '(empty)',
        travel_date_param: travelDate || '(null)'
      });
      return true;
    } catch (e: any) {
      log.error(`[OPP_ENRICH_FAILED] Non-fatal`, e instanceof Error ? e : new Error(String(e)), { traceId });
      return false;
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

    const isLostFilter = filters?.stage === 'lost';

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

    if (!isLostFilter) {
      // P1B: Default view — exclude terminal states AND deduplicate per conversation
      // Only show the opportunity that matches conversation.active_opportunity_id
      // If conversation has no active_opportunity_id, show non-terminal opps (backward compat)
      conditions.push(`o.stage NOT IN ('lost', 'not_qualified', 'arrived')`);
      conditions.push(`(
        EXISTS (
          SELECT 1 FROM conversations c2
          WHERE c2.active_opportunity_id = o.id AND c2.tenant_id = o.tenant_id
        )
        OR NOT EXISTS (
          SELECT 1 FROM conversations c2
          WHERE c2.id = o.conversation_id AND c2.tenant_id = o.tenant_id
            AND c2.active_opportunity_id IS NOT NULL
        )
      )`);
    } else {
      // Lost filter: show all lost opps (including superseded historical ones)
      conditions.push(`o.stage NOT IN ('arrived')`);
    }

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    const rows = await this.db.executeSafe({
      text: `SELECT 
               o.*,
               -- P1B: Display name resolver (requester_name > patient_name > phone)
               COALESCE(NULLIF(o.requester_name, ''), NULLIF(o.patient_name, ''), o.phone_number) as display_name,
               -- P1B FIX: No global fallback — opp-scoped summary only
               o.summary as ai_summary,
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
    // Delegate to UnifiedStageService for atomic 3-way sync
    const { UnifiedStageService } = await import('./unified-stage.service');
    await UnifiedStageService.update({
      tenantId,
      source: 'system',
      opportunityId: oppId,
      targetStage: newStage,
      reason,
    });
  }

  /**
   * Mirror opportunity stage to linked conversations + leads.
   * Best-effort, non-blocking — used after upsertFromCrm.
   */
  private async mirrorStageToLinked(tenantId: string, conversationId: string, phoneNumber: string, oppStage: string) {
    const mirrorStage = oppStageToLeadStage(oppStage);
    try {
      // Mirror to conversation
      await this.db.executeSafe({
        text: `UPDATE conversations SET lead_stage = $1 WHERE id = $2 AND tenant_id = $3`,
        values: [mirrorStage, conversationId, tenantId]
      });
      // Mirror to leads
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
      await this.db.executeSafe({
        text: `UPDATE leads SET stage = $1 WHERE phone_number LIKE '%' || $2 || '%' AND tenant_id = $3`,
        values: [mirrorStage, last10, tenantId]
      });
    } catch (err) {
      log.error(`[OPP_MIRROR_FAILED] Non-fatal mirror sync`, err instanceof Error ? err : new Error(String(err)));
    }
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
