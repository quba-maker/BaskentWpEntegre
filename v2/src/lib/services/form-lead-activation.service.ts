/**
 * PHASE 2L-P0: Form Lead Activation Service
 * 
 * Orchestrator: Form lead → operational pipeline.
 * Called after ingestSheetRow creates a new lead.
 * 
 * Pipeline:
 * 1. Ensure conversation exists (INSERT ON CONFLICT)
 * 2. Create opportunity (new_lead, warm, source=form)
 * 3. Link conversation → active_opportunity_id
 * 4. Link lead → linked_opportunity_id
 * 5. Create follow-up task (coordinator_review)
 * 6. Send panel + Telegram notification (hot_lead)
 * 
 * P0 CONSTRAINT: No automatic WhatsApp message to patient.
 * All outreach is coordinator-initiated via outreach.ts actions.
 * 
 * IDEMPOTENCY: Guards by lead.linked_opportunity_id —
 * if lead already has an opportunity linked, skip entire pipeline.
 */

import { withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';

const log = logger.withContext({ module: 'FormLeadActivation' });

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface ActivationParams {
  tenantId: string;
  tenantName?: string;
  leadId: string;          // UUID from leads table
  phoneNumber: string;
  patientName?: string;
  formName: string;
  email?: string;
  source: string;          // 'webhook' | 'manual_sync' | 'cron_sync'
}

export interface ActivationResult {
  activated: boolean;
  conversationId?: string;
  opportunityId?: string;
  taskId?: string;
  notificationId?: string;
  skipped?: boolean;
  skipReason?: string;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

export class FormLeadActivationService {

  /**
   * Activate a newly created form lead into the operational pipeline.
   * Non-fatal by design — caller catches all errors.
   */
  static async activate(params: ActivationParams): Promise<ActivationResult> {
    const {
      tenantId, tenantName, leadId, phoneNumber,
      patientName, formName, email, source
    } = params;

    const db = withTenantDB(tenantId);

    // ── IDEMPOTENCY: Skip if lead already activated ──
    try {
      const leadCheck = await db.executeSafe({
        text: `SELECT linked_opportunity_id FROM leads WHERE id = $1 AND tenant_id = $2`,
        values: [leadId, tenantId]
      }) as any[];

      if (leadCheck.length > 0 && leadCheck[0].linked_opportunity_id) {
        log.info('[ACTIVATION_SKIP] Lead already has linked opportunity', {
          leadId, oppId: leadCheck[0].linked_opportunity_id
        });
        return {
          activated: false,
          skipped: true,
          skipReason: 'lead_already_activated',
          opportunityId: leadCheck[0].linked_opportunity_id,
        };
      }
    } catch (err) {
      log.warn('[ACTIVATION_IDEMP_CHECK] Non-fatal', { leadId, error: String(err) });
    }

    const displayName = patientName || 'İsimsiz Form';
    let conversationId: string | undefined;
    let opportunityId: string | undefined;
    let taskId: string | undefined;
    let notificationId: string | undefined;

    // Resolve all potential phone numbers from lead raw_data
    let allPhones: string[] = [];
    try {
      const leadData = await db.executeSafe({
        text: `SELECT phone_number, raw_data FROM leads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [leadId, tenantId]
      }) as any[];
      if (leadData.length > 0) {
        const leadRow = leadData[0];
        const { parseAllPhones } = await import('@/lib/utils/phone-identity');
        let parsedRaw: any = {};
        if (leadRow.raw_data) {
          parsedRaw = typeof leadRow.raw_data === 'string' ? JSON.parse(leadRow.raw_data) : leadRow.raw_data;
        }
        allPhones = parseAllPhones(parsedRaw?._all_phones);
      }
    } catch (err) {
      log.warn('[ACTIVATION_GET_PHONES_ERROR] Non-fatal', { leadId, error: String(err) });
    }
    if (!allPhones.includes(phoneNumber)) {
      allPhones.unshift(phoneNumber);
    }

    let existingActiveOpportunityId: string | null = null;

    // ── STEP 1: Ensure conversation exists ──
    try {
      const suffixes = allPhones.map(p => p.slice(-10));
      // Check existing conversation by phone (last 10 digits) matching any of lead's phones
      const existing = await db.executeSafe({
        text: `SELECT id, active_opportunity_id, phone_number FROM conversations 
               WHERE tenant_id = $1 AND RIGHT(phone_number, 10) = ANY($2)
               ORDER BY CASE WHEN phone_number = $3 THEN 0 ELSE 1 END ASC
               LIMIT 1`,
        values: [tenantId, suffixes, phoneNumber]
      }) as any[];

      if (existing.length > 0) {
        conversationId = existing[0].id;
        const potentialOppId = existing[0].active_opportunity_id;
        if (potentialOppId) {
          // Verify if the referenced opportunity is actually active (not in lost, not_qualified, arrived stage)
          const oppCheck = await db.executeSafe({
            text: `SELECT id, stage FROM opportunities WHERE id = $1 AND tenant_id = $2`,
            values: [potentialOppId, tenantId]
          }) as any[];
          if (oppCheck.length > 0) {
            const stage = oppCheck[0].stage;
            const isTerminal = ['lost', 'not_qualified', 'arrived'].includes(stage);
            if (!isTerminal) {
              existingActiveOpportunityId = potentialOppId;
            }
          }
        }
      } else {
        // Create new conversation
        const tags = [formName].filter(Boolean);
        const newConv = await db.executeSafe({
          text: `INSERT INTO conversations (tenant_id, phone_number, patient_name, tags, status, department, channel)
                 VALUES ($1, $2, $3, $4, 'active', 'Genel', 'whatsapp')
                 RETURNING id`,
          values: [tenantId, phoneNumber, displayName, JSON.stringify(tags)]
        }) as any[];
        conversationId = newConv?.[0]?.id;
      }

      log.info('[ACTIVATION_CONV]', { leadId, conversationId, isNew: existing.length === 0, existingActiveOpportunityId });
    } catch (err) {
      log.error('[ACTIVATION_CONV_ERROR]', err instanceof Error ? err : new Error(String(err)));
    }

    // ── STEP 2: Create or reuse opportunity ──
    if (existingActiveOpportunityId) {
      opportunityId = existingActiveOpportunityId;
      log.info('[ACTIVATION_OPP_REUSED] Reusing active opportunity to prevent duplicate opportunities', { leadId, opportunityId });
    } else {
      try {
        const oppResult = await db.executeSafe({
          text: `INSERT INTO opportunities (
                   tenant_id, conversation_id, phone_number,
                   patient_name, requester_name,
                   stage, priority, source,
                   department, automation_status,
                   intent_type, metadata
                 ) VALUES ($1, $2, $3, $4, $5, 'new_lead', 'warm', 'form', 'Genel', 'manual', 'form_submission', $6)
                 RETURNING id`,
          values: [
            tenantId,
            conversationId || null,
            phoneNumber,
            displayName,
            displayName,
            JSON.stringify({
              form_name: formName,
              lead_id: leadId,
              source,
              email: email || null,
              activated_at: new Date().toISOString(),
            })
          ]
        }) as any[];

        opportunityId = oppResult?.[0]?.id;
        log.info('[ACTIVATION_OPP_CREATED] Created new opportunity', { leadId, opportunityId });
      } catch (err) {
        log.error('[ACTIVATION_OPP_ERROR]', err instanceof Error ? err : new Error(String(err)));
      }
    }

    // ── STEP 3: Link conversation → active_opportunity_id ──
    if (conversationId && opportunityId) {
      try {
        const { ActiveOpportunityResolver } = await import('./active-opportunity-resolver');
        const resolver = new ActiveOpportunityResolver(db);
        await resolver.setActive(tenantId, conversationId, opportunityId);
        log.info('[ACTIVATION_LINK_CONV]', { conversationId, opportunityId });
      } catch (err) {
        // Fallback: direct UPDATE (if setActive validation fails for new opp)
        try {
          await db.executeSafe({
            text: `UPDATE conversations SET active_opportunity_id = $1 WHERE id = $2 AND tenant_id = $3`,
            values: [opportunityId, conversationId, tenantId]
          });
          log.info('[ACTIVATION_LINK_CONV_FALLBACK]', { conversationId, opportunityId });
        } catch (fallbackErr) {
          log.warn('[ACTIVATION_LINK_CONV_FALLBACK_ERROR]', { error: String(fallbackErr) });
        }
      }
    }

    // ── STEP 4: Link lead → linked_opportunity_id ──
    if (opportunityId) {
      try {
        await db.executeSafe({
          text: `UPDATE leads SET linked_opportunity_id = $1 WHERE id = $2 AND tenant_id = $3`,
          values: [opportunityId, leadId, tenantId]
        });
        log.info('[ACTIVATION_LINK_LEAD]', { leadId, opportunityId });
      } catch (err) {
        log.warn('[ACTIVATION_LINK_LEAD_ERROR]', { error: String(err) });
      }
    }

    // ── STEP 5: Create follow-up task (coordinator_review) ──
    try {
      const { TaskService } = await import('./task.service');
      const taskService = new TaskService(db);

      const dueAt = new Date();
      dueAt.setHours(dueAt.getHours() + 1); // Due in 1 hour

      taskId = await taskService.create({
        tenantId,
        opportunityId: opportunityId || undefined,
        conversationId: conversationId || undefined,
        phoneNumber,
        taskType: 'coordinator_review',
        title: `📋 Yeni Form Lead — ${displayName}`,
        description: `${formName} formundan gelen yeni lead. İlk iletişim bekleniyor.`,
        dueAt: dueAt.toISOString(),
        isAutomated: true,
        createdBy: 'form_activation',
        sourceEvent: `form_lead_${source}`,
        metadata: {
          form_name: formName,
          lead_id: leadId,
          source,
        },
      });

      log.info('[ACTIVATION_TASK]', { leadId, taskId });
    } catch (err) {
      log.error('[ACTIVATION_TASK_ERROR]', err instanceof Error ? err : new Error(String(err)));
    }

    // ── STEP 6: Send notification (panel + Telegram) ──
    try {
      const { NotificationService } = await import('./notification.service');
      const notifService = new NotificationService(db);

      const tenantLabel = tenantName || 'Sistem';
      notificationId = await notifService.send({
        tenantId,
        category: 'hot_lead',
        priority: 'high',
        title: `🔥 Yeni Form Lead — ${displayName}`,
        body: `${formName} formundan yeni lead geldi. Telefon: ${phoneNumber}. İlk iletişim için aksiyona geçin.`,
        opportunityId: opportunityId || undefined,
        taskId: taskId || undefined,
        conversationId: conversationId || undefined,
        phoneNumber,
        metadata: {
          form_name: formName,
          lead_id: leadId,
          source,
          tenant_name: tenantLabel,
        },
      });

      log.info('[ACTIVATION_NOTIF]', { leadId, notificationId });
    } catch (err) {
      log.error('[ACTIVATION_NOTIF_ERROR]', err instanceof Error ? err : new Error(String(err)));
    }

    // ── STEP 7: Trigger RuleEvaluatorService (Automation Rules Foundation) ──
    try {
      const { RuleEvaluatorService } = await import('./automation/rule-evaluator.service');
      const evaluator = new RuleEvaluatorService(db);
      
      const leadData = await db.executeSafe({
        text: `SELECT country FROM leads WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [leadId, params.tenantId]
      }) as any[];
      const resolvedCountry = leadData[0]?.country || null;

      const context = {
        tenantId,
        entityType: 'lead' as const,
        entityId: leadId,
        dedupeKey: `form_submission:${leadId}`,
        phone_number: phoneNumber,
        opportunity_id: opportunityId || null,
        lead_id: leadId,
        patient_name: displayName,
        patient: {
          name: displayName,
          country: resolvedCountry,
        },
        lead: {
          form_name: formName,
          source,
          email: email || null
        },
        opportunity: {
          stage: 'new_lead',
          priority: 'warm',
          department: 'Genel',
          intent_type: 'form_submission'
        }
      };

      await evaluator.evaluate('form_submission', context);
      log.info('[ACTIVATION_AUTOMATION_EVALUATE] Rule evaluator matching finished', { leadId });
    } catch (autoErr) {
      log.error('[ACTIVATION_AUTOMATION_ERROR] Rule evaluator failed non-fatally', autoErr instanceof Error ? autoErr : new Error(String(autoErr)));
    }

    // ── STEP 8: Trigger Form Autopilot Orchestrator (Safe After Activation) ──
    if (conversationId && leadId) {
      try {
        const { FormAutopilotOrchestrator } = await import('./forms/form-autopilot-orchestrator');
        await FormAutopilotOrchestrator.execute(tenantId, leadId, conversationId, db);
      } catch (autopilotErr) {
        log.error(
          '[ACTIVATION_AUTOPILOT_ERROR] Non-fatal error during safeAfter execution',
          autopilotErr instanceof Error ? autopilotErr : new Error(String(autopilotErr)),
          { tenantId, leadId, conversationId }
        );
      }
    }

    log.info('[ACTIVATION_COMPLETE]', {
      leadId,
      conversationId,
      opportunityId,
      taskId,
      notificationId,
    });

    return {
      activated: true,
      conversationId,
      opportunityId,
      taskId,
      notificationId,
    };
  }
}
