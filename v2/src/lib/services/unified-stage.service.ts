/**
 * 🎯 Unified Stage Service — Single Point of Stage Truth
 * 
 * All stage changes across all surfaces (takip, forms, inbox, AI, system)
 * go through this service. It:
 * 1. Resolves the linked opportunity (safe, ambiguity-aware)
 * 2. Enforces direction rules (AI restrictions, forms backward protection)
 * 3. Updates opportunity.stage (master)
 * 4. Mirrors to conversations.lead_stage
 * 5. Mirrors to leads.stage
 * 6. Writes audit log to ai_events
 * 
 * All updates happen in a single atomic transaction via TenantDB.executeTransaction().
 * No circular imports: uses raw SQL only, does NOT import OpportunityService.
 */

import { TenantDB, withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import {
  OPP_STAGE_ORDER,
  OPP_TO_LEAD_MAP,
  LEAD_TO_OPP_MAP,
  AI_FORBIDDEN_STAGES,
  isOppStageAhead,
  oppStageToLeadStage,
} from '@/lib/config/stage-mapping';

const log = logger.withContext({ module: 'UnifiedStageService' });

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

export type StageUpdateSource = 'takip' | 'forms' | 'inbox' | 'ai' | 'system';

export interface UnifiedStageUpdateInput {
  tenantId: string;
  source: StageUpdateSource;
  /** Direct opportunity ID — fastest path */
  opportunityId?: string;
  /** Conversation ID — finds latest active opportunity */
  conversationId?: string;
  /** Lead ID — finds linked opportunity via customer_id or phone */
  leadId?: number;
  /** Phone number — finds opportunity if single unambiguous match */
  phoneNumber?: string;
  /** Target stage in opportunity stage system */
  targetStage: string;
  /** Who initiated this change */
  actorId?: string;
  /** Reason for the change */
  reason?: string;
  /** P1A-FIX: Customer explicitly cancelled/opted out — bypasses AI 'lost' restriction */
  explicitCancellation?: boolean;
  /** P1A-FIX: Customer requested no further contact */
  optOutRequested?: boolean;
}

export interface UnifiedStageResult {
  success: boolean;
  opportunityId?: string;
  previousOppStage?: string;
  newOppStage?: string;
  mirrorLeadStage?: string;
  mirrorConvStage?: string;
  blocked?: boolean;
  blockReason?: string;
  /** True when no linked opportunity was found — only lead/conv updated */
  legacyFallback?: boolean;
}

// ══════════════════════════════════════════════
// SERVICE
// ══════════════════════════════════════════════

export class UnifiedStageService {
  /**
   * Central stage update — atomic transaction, all-or-nothing.
   */
  static async update(input: UnifiedStageUpdateInput): Promise<UnifiedStageResult> {
    const { tenantId, source, targetStage, actorId, reason } = input;
    const db = withTenantDB(tenantId);

    // Declare outside try for catch fallback access
    let queries: any[] = [];
    let normalizedTarget = targetStage;
    let resolvedOppId: string | undefined;

    try {
      // ── 1. Resolve opportunity ──
      const oppResolution = await this.resolveOpportunity(db, input);

      if (oppResolution.ambiguous) {
        const result: UnifiedStageResult = {
          success: false,
          blocked: true,
          blockReason: `Bu telefon numarasıyla birden fazla eşleşme bulundu. Lütfen Takip Merkezi'nden güncelleyin.`,
        };
        // Log the ambiguous attempt
        this.emitAuditLog(db, tenantId, {
          source, actorId, reason,
          blocked: true,
          blockReason: 'ambiguous_match',
          targetStage,
          conversationId: input.conversationId,
        });
        return result;
      }

      // ── 2. No opportunity found — legacy fallback ──
      if (!oppResolution.opportunity) {
        return this.legacyFallback(db, input, oppResolution);
      }

      const opp = oppResolution.opportunity;
      resolvedOppId = opp.id;
      const previousOppStage = opp.stage;

      // ── 3. Normalize targetStage ──
      // If source sends a lead-system stage, map it to opportunity stage
      normalizedTarget = targetStage;
      if (LEAD_TO_OPP_MAP[targetStage]) {
        normalizedTarget = LEAD_TO_OPP_MAP[targetStage];
      }
      // Validate it's a known opp stage
      if (!OPP_STAGE_ORDER.includes(normalizedTarget)) {
        return {
          success: false,
          blocked: true,
          blockReason: `Bilinmeyen stage: ${normalizedTarget}`,
        };
      }

      // ── 4. Direction rules ──
      const directionCheck = this.checkDirectionRules(source, previousOppStage, normalizedTarget, input.explicitCancellation);
      if (directionCheck.blocked) {
        const result: UnifiedStageResult = {
          success: false,
          opportunityId: opp.id,
          previousOppStage,
          blocked: true,
          blockReason: directionCheck.blockReason,
        };
        this.emitAuditLog(db, tenantId, {
          source, actorId, reason,
          opportunityId: opp.id,
          conversationId: opp.conversation_id,
          previousOppStage,
          targetStage: normalizedTarget,
          blocked: true,
          blockReason: directionCheck.blockReason!,
        });
        return result;
      }

      // ── 5. If stage hasn't changed, skip ──
      if (normalizedTarget === previousOppStage) {
        return {
          success: true,
          opportunityId: opp.id,
          previousOppStage,
          newOppStage: normalizedTarget,
          mirrorLeadStage: oppStageToLeadStage(normalizedTarget),
          mirrorConvStage: oppStageToLeadStage(normalizedTarget),
        };
      }

      // ── 6. Compute mirror stages ──
      const mirrorLeadStage = oppStageToLeadStage(normalizedTarget);

      // ── 7. Atomic transaction: opp + conv + lead + audit ──
      queries = [];

      // 7a. Update opportunity
      const isCancellation = input.explicitCancellation && normalizedTarget === 'lost';
      queries.push({
        text: `UPDATE opportunities SET 
                 stage = $1, 
                 closed_at = CASE WHEN $1 IN ('lost', 'not_qualified', 'arrived') THEN NOW() ELSE NULL END,
                 closed_reason = CASE WHEN $1 IN ('lost', 'not_qualified') THEN $4 ELSE NULL END,
                 next_follow_up_at = CASE WHEN $5 = true THEN NULL ELSE next_follow_up_at END,
                 automation_status = CASE WHEN $5 = true THEN 'paused' ELSE automation_status END,
                 metadata = CASE 
                   WHEN $5 = true THEN metadata || jsonb_build_object(
                     'opt_out_requested', $6,
                     'opt_out_at', NOW()::text,
                     'opt_out_reason', $4
                   )
                   ELSE metadata 
                 END,
                 updated_at = NOW()
               WHERE id = $2 AND tenant_id = $3`,
        values: [normalizedTarget, opp.id, tenantId, reason || null, isCancellation, input.optOutRequested || false]
      });

      // 7b. Mirror to conversations.lead_stage (via conversation_id)
      if (opp.conversation_id) {
        queries.push({
          text: `UPDATE conversations SET lead_stage = $1 WHERE id = $2 AND tenant_id = $3`,
          values: [mirrorLeadStage, opp.conversation_id, tenantId]
        });
      }

      // 7c. Mirror to leads.stage (via phone match)
      if (opp.phone_number) {
        const cleanPhone = opp.phone_number.replace(/\D/g, '');
        const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
        queries.push({
          text: `UPDATE leads SET stage = $1 
                 WHERE phone_number LIKE '%' || $2 || '%' 
                   AND tenant_id = $3`,
          values: [mirrorLeadStage, last10, tenantId]
        });
      }

      // 7d. Audit log in ai_events
      queries.push({
        text: `INSERT INTO ai_events (tenant_id, conversation_id, event_type, event_category, payload, severity)
               VALUES ($1, $2, 'stage_changed', 'stage', $3::jsonb, 'info')`,
        values: [
          tenantId,
          opp.conversation_id || null,
          JSON.stringify({
            source,
            actor_id: actorId || null,
            opportunity_id: opp.id,
            lead_id: oppResolution.leadId || null,
            conversation_id: opp.conversation_id || null,
            previous_opp_stage: previousOppStage,
            new_opp_stage: normalizedTarget,
            mirror_lead_stage: mirrorLeadStage,
            mirror_conv_stage: mirrorLeadStage,
            blocked: false,
            block_reason: null,
            reason: reason || null,
          })
        ]
      });

      // Execute all in single atomic transaction
      await db.executeTransaction(queries);

      log.info(`[UNIFIED_STAGE_OK] ${source} → ${previousOppStage} → ${normalizedTarget}`, {
        oppId: opp.id, mirrorLeadStage, actorId
      });

      return {
        success: true,
        opportunityId: opp.id,
        previousOppStage,
        newOppStage: normalizedTarget,
        mirrorLeadStage,
        mirrorConvStage: mirrorLeadStage,
      };

    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      const errorCode = error?.code || 'UNKNOWN';
      const errorDetail = error?.detail || error?.hint || null;
      
      log.error(`[UNIFIED_STAGE_FAIL] Atomic transaction failed`, 
        error instanceof Error ? error : new Error(String(error)),
        { source, targetStage, actorId, errorCode, errorDetail, errorMessage }
      );

      // ═══ P1A-FIX5: Sequential fallback when transaction fails ═══
      // Neon HTTP driver transaction can fail due to connection/batching issues.
      // Fall back to sequential execution to ensure stage update happens.
      if (queries.length > 0) {
        log.warn(`[UNIFIED_STAGE_FALLBACK] Attempting sequential execution`, {
          queryCount: queries.length, source, targetStage
        });
        try {
          for (const q of queries) {
            await db.executeSafe(q);
          }
          log.info(`[UNIFIED_STAGE_FALLBACK_OK] Sequential execution succeeded`, {
            source, targetStage, actorId
          });
          // Return success since sequential worked
          return {
            success: true,
            opportunityId: resolvedOppId || input.opportunityId,
            newOppStage: targetStage,
            mirrorLeadStage: OPP_TO_LEAD_MAP[targetStage] || targetStage,
            mirrorConvStage: OPP_TO_LEAD_MAP[targetStage] || targetStage,
          };
        } catch (seqErr: any) {
          log.error(`[UNIFIED_STAGE_FALLBACK_FAIL] Sequential also failed`,
            seqErr instanceof Error ? seqErr : new Error(String(seqErr)),
            { source, targetStage }
          );
        }
      }

      return {
        success: false,
        blocked: true,
        blockReason: `Stage güncelleme hatası: ${errorCode} — ${errorMessage.substring(0, 200)}`,
      };
    }
  }

  // ══════════════════════════════════════════════
  // OPPORTUNITY RESOLUTION
  // ══════════════════════════════════════════════

  private static async resolveOpportunity(
    db: TenantDB,
    input: UnifiedStageUpdateInput
  ): Promise<{
    opportunity: any | null;
    ambiguous: boolean;
    leadId?: number;
  }> {
    const { tenantId, opportunityId, conversationId, leadId, phoneNumber } = input;

    // Path 1: Direct opportunityId
    if (opportunityId) {
      const rows = await db.executeSafe({
        text: `SELECT id, stage, conversation_id, phone_number FROM opportunities 
               WHERE id = $1 AND tenant_id = $2`,
        values: [opportunityId, tenantId]
      }) as any[];
      return { opportunity: rows[0] || null, ambiguous: false };
    }

    // Path 2: conversationId → latest active opportunity
    if (conversationId) {
      const rows = await db.executeSafe({
        text: `SELECT id, stage, conversation_id, phone_number FROM opportunities 
               WHERE conversation_id = $1 AND tenant_id = $2 
               ORDER BY updated_at DESC LIMIT 1`,
        values: [conversationId, tenantId]
      }) as any[];
      return { opportunity: rows[0] || null, ambiguous: false };
    }

    // Path 3: leadId → find via customer_id or phone
    if (leadId) {
      const leadRows = await db.executeSafe({
        text: `SELECT phone_number, customer_id FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [leadId, tenantId]
      }) as any[];
      
      if (leadRows.length === 0) return { opportunity: null, ambiguous: false, leadId };

      const lead = leadRows[0];
      
      // Try customer_id link first
      if (lead.customer_id) {
        const oppRows = await db.executeSafe({
          text: `SELECT o.id, o.stage, o.conversation_id, o.phone_number 
                 FROM opportunities o
                 JOIN conversations c ON o.conversation_id = c.id AND c.tenant_id = o.tenant_id
                 WHERE c.customer_id = $1 AND o.tenant_id = $2
                 ORDER BY o.updated_at DESC LIMIT 1`,
          values: [lead.customer_id, tenantId]
        }) as any[];
        if (oppRows.length > 0) return { opportunity: oppRows[0], ambiguous: false, leadId };
      }

      // Fallback: phone match (only if unambiguous)
      const cleanPhone = lead.phone_number.replace(/\D/g, '');
      const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
      
      const oppRows = await db.executeSafe({
        text: `SELECT o.id, o.stage, o.conversation_id, o.phone_number
               FROM opportunities o
               WHERE o.phone_number LIKE '%' || $1 || '%' AND o.tenant_id = $2
               ORDER BY o.updated_at DESC`,
        values: [last10, tenantId]
      }) as any[];

      if (oppRows.length === 1) return { opportunity: oppRows[0], ambiguous: false, leadId };
      if (oppRows.length > 1) return { opportunity: null, ambiguous: true, leadId };
      return { opportunity: null, ambiguous: false, leadId };
    }

    // Path 4: phoneNumber → only if single unambiguous match
    if (phoneNumber) {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
      
      const oppRows = await db.executeSafe({
        text: `SELECT o.id, o.stage, o.conversation_id, o.phone_number
               FROM opportunities o
               WHERE o.phone_number LIKE '%' || $1 || '%' AND o.tenant_id = $2
               ORDER BY o.updated_at DESC`,
        values: [last10, tenantId]
      }) as any[];

      if (oppRows.length === 1) return { opportunity: oppRows[0], ambiguous: false };
      if (oppRows.length > 1) return { opportunity: null, ambiguous: true };
    }

    return { opportunity: null, ambiguous: false };
  }

  // ══════════════════════════════════════════════
  // DIRECTION RULES
  // ══════════════════════════════════════════════

  private static checkDirectionRules(
    source: StageUpdateSource,
    currentStage: string,
    targetStage: string,
    explicitCancellation?: boolean
  ): { blocked: boolean; blockReason?: string } {

    // AI restrictions: forbidden stages
    if (source === 'ai' && AI_FORBIDDEN_STAGES.has(targetStage)) {
      // P1A-FIX: Exception for explicit customer cancellation
      if (targetStage === 'lost' && explicitCancellation) {
        // Customer explicitly said "gelmeyeceğim", "aramayın" etc.
        // This is not AI speculation — it's customer action. Allow it.
        return { blocked: false };
      }
      return {
        blocked: true,
        blockReason: `AI bu aşamayı ayarlayamaz: ${targetStage}. İnsan onayı gereklidir.`,
      };
    }

    // AI restrictions: can only advance, never regress
    if (source === 'ai') {
      const currentIdx = OPP_STAGE_ORDER.indexOf(currentStage);
      const targetIdx = OPP_STAGE_ORDER.indexOf(targetStage);
      if (currentIdx >= 0 && targetIdx >= 0 && targetIdx <= currentIdx) {
        return {
          blocked: true,
          blockReason: `AI stage'i geriye taşıyamaz: ${currentStage} → ${targetStage}`,
        };
      }
    }

    // Forms backward protection: can't regress an advanced opportunity
    if (source === 'forms') {
      if (isOppStageAhead(currentStage, targetStage)) {
        return {
          blocked: true,
          blockReason: `Bu hasta Takip Merkezi'nde daha ileri aşamada (${currentStage}). Geri almak için Takip Merkezi'ni kullanın.`,
        };
      }
    }

    // takip, inbox, system: full control, no restrictions
    return { blocked: false };
  }

  // ══════════════════════════════════════════════
  // LEGACY FALLBACK (no linked opportunity)
  // ══════════════════════════════════════════════

  /**
   * When no opportunity exists, update lead/conversation directly.
   * This preserves backward compatibility for forms/inbox without opportunity.
   */
  private static async legacyFallback(
    db: TenantDB,
    input: UnifiedStageUpdateInput,
    resolution: { leadId?: number }
  ): Promise<UnifiedStageResult> {
    const { tenantId, source, targetStage, actorId, reason, phoneNumber, leadId } = input;

    // Normalize: if they sent an opp stage, convert to lead stage
    const mirrorStage = OPP_TO_LEAD_MAP[targetStage] || targetStage;
    const queries: any[] = [];

    // Update lead if we have leadId
    const actualLeadId = leadId || resolution.leadId;
    if (actualLeadId) {
      queries.push({
        text: `UPDATE leads SET stage = $1 WHERE id = $2 AND tenant_id = $3`,
        values: [mirrorStage, actualLeadId, tenantId]
      });

      // Get phone for conv mirror
      if (!phoneNumber) {
        const leadRows = await db.executeSafe({
          text: `SELECT phone_number FROM leads WHERE id = $1 AND tenant_id = $2`,
          values: [actualLeadId, tenantId]
        }) as any[];
        if (leadRows.length > 0) {
          const cleanPhone = leadRows[0].phone_number.replace(/\D/g, '');
          const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
          queries.push({
            text: `UPDATE conversations SET lead_stage = $1 WHERE RIGHT(phone_number, 10) = $2 AND tenant_id = $3`,
            values: [mirrorStage, last10, tenantId]
          });
        }
      }
    }

    // Update conversation if we have phone
    if (phoneNumber) {
      queries.push({
        text: `UPDATE conversations SET lead_stage = $1 WHERE phone_number = $2 AND tenant_id = $3`,
        values: [mirrorStage, phoneNumber, tenantId]
      });
      // Also sync lead by phone
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const last10 = cleanPhone.length > 10 ? cleanPhone.substring(cleanPhone.length - 10) : cleanPhone;
      queries.push({
        text: `UPDATE leads SET stage = $1 
               WHERE phone_number LIKE '%' || $2 || '%' AND tenant_id = $3`,
        values: [mirrorStage, last10, tenantId]
      });
    }

    // Audit log
    queries.push({
      text: `INSERT INTO ai_events (tenant_id, event_type, event_category, payload, severity)
             VALUES ($1, 'stage_changed', 'stage', $2::jsonb, 'info')`,
      values: [
        tenantId,
        JSON.stringify({
          source,
          actor_id: actorId || null,
          opportunity_id: null,
          lead_id: actualLeadId || null,
          conversation_id: null,
          previous_opp_stage: null,
          new_opp_stage: null,
          mirror_lead_stage: mirrorStage,
          mirror_conv_stage: mirrorStage,
          blocked: false,
          block_reason: null,
          reason: reason || null,
          legacy_fallback: true,
        })
      ]
    });

    if (queries.length > 0) {
      await db.executeTransaction(queries);
    }

    log.info(`[UNIFIED_STAGE_LEGACY] ${source} → ${mirrorStage} (no opportunity)`, {
      leadId: actualLeadId, phoneNumber
    });

    return {
      success: true,
      mirrorLeadStage: mirrorStage,
      mirrorConvStage: mirrorStage,
      legacyFallback: true,
    };
  }

  // ══════════════════════════════════════════════
  // FIRE-AND-FORGET AUDIT (for blocked/ambiguous cases)
  // ══════════════════════════════════════════════

  private static emitAuditLog(
    db: TenantDB,
    tenantId: string,
    payload: Record<string, any>
  ): void {
    // Non-blocking audit for edge cases
    setImmediate(async () => {
      try {
        await db.executeSafe({
          text: `INSERT INTO ai_events (tenant_id, conversation_id, event_type, event_category, payload, severity)
                 VALUES ($1, $2, 'stage_changed', 'stage', $3::jsonb, 'warning')`,
          values: [
            tenantId,
            payload.conversationId || null,
            JSON.stringify(payload)
          ]
        });
      } catch (err) {
        log.error(`[AUDIT_LOG_FAILED] Non-fatal`, err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
