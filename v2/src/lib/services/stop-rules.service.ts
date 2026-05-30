/**
 * PHASE 2K: Central Stop Rule Engine
 * 
 * ALL automation (task execution, notifications, future patient messaging)
 * MUST call this before taking action.
 * 
 * P0: Used for internal task/notification gating only.
 * P2: Will be mandatory gate before patient WhatsApp messages.
 * 
 * DESIGN DECISIONS:
 * - patient_responded: Only triggers if inbound message arrived AFTER the
 *   task/automation was created. This prevents newly created callback tasks
 *   from being immediately skipped.
 * - Internal task types (callback_scheduled, coordinator_review, doctor_review_pending)
 *   are NOT blocked by patient_responded.
 * - Terminal stages always block: lost, not_qualified, arrived.
 */

import type { TenantDB } from '@/lib/core/tenant-db';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export type StopReason =
  | 'patient_responded'
  | 'patient_opted_out'
  | 'coordinator_took_over'
  | 'stage_terminal'
  | 'automation_disabled_opp'
  | 'automation_disabled_tenant'
  | 'max_attempts_reached'
  | 'appointment_booked'
  | 'parent_task_completed'
  | 'parent_task_cancelled'
  | 'parent_appointment_arrived'
  | 'parent_appointment_no_show'
  | 'parent_appointment_rescheduled'
  | 'opportunity_terminal_stage';

export interface StopRuleResult {
  shouldStop: boolean;
  reason?: StopReason;
  detail?: string;
}

export interface StopRuleInput {
  tenantId: string;
  opportunityId?: string;
  phoneNumber: string;
  taskType?: string;
  taskCreatedAt?: string;       // ISO string — for patient_responded check
  maxAttempts?: number;
  currentAttempt?: number;
  taskId?: string;              // YENİ: Görevin kendi ID'si
}

// Internal task types that should NOT be blocked by patient_responded
const INTERNAL_TASK_TYPES = new Set([
  'callback_scheduled',
  'coordinator_review',
  'doctor_review_pending',
  'custom',
  'appointment_reminder', // YENİ: Reminders are internal
]);

// Terminal opportunity stages
const TERMINAL_STAGES = new Set(['lost', 'not_qualified', 'arrived']);

// ═══════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════

export class StopRuleEngine {
  constructor(private db: TenantDB) {}

  /**
   * Evaluate all stop rules for a given context.
   * Returns { shouldStop: false } if no rule triggered.
   * 
   * Rule evaluation order (first match wins):
   * 0. Parent task check (for appointment reminders)
   * 1. Opportunity stage is terminal
   * 2. Opportunity automation_status = 'stopped' or 'paused'
   * 3. Opportunity opt_out_requested = true
   * 4. Conversation status = 'human' (coordinator took over)
   * 5. Max attempts reached
   * 6. Patient responded after task creation (only for automated follow-up types)
   * 7. Appointment already booked (stage = 'booked')
   */
  async evaluate(input: StopRuleInput): Promise<StopRuleResult> {
    try {
      // ── Rule 0: Parent task check (for reminders) ──
      if (input.taskType === 'appointment_reminder' && input.taskId) {
        const taskRows = await this.db.executeSafe({
          text: `SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
          values: [input.taskId, input.tenantId]
        }) as any[];
        
        if (taskRows.length > 0) {
          const taskMeta = typeof taskRows[0].metadata === 'string' 
            ? JSON.parse(taskRows[0].metadata) 
            : (taskRows[0].metadata || {});
            
          const parentTaskId = taskMeta.parent_task_id;
          if (parentTaskId) {
            const parentRows = await this.db.executeSafe({
              text: `SELECT status, metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
              values: [parentTaskId, input.tenantId]
            }) as any[];
            
            if (parentRows.length > 0) {
              const parent = parentRows[0];
              const parentMeta = typeof parent.metadata === 'string'
                ? JSON.parse(parent.metadata)
                : (parent.metadata || {});

              if (parent.status === 'completed') {
                const result = parentMeta.appointment_result || 'completed';
                let mappedReason: StopReason = 'parent_task_completed';
                if (result === 'arrived') mappedReason = 'parent_appointment_arrived';
                else if (result === 'no_show') mappedReason = 'parent_appointment_no_show';
                
                return {
                  shouldStop: true,
                  reason: mappedReason,
                  detail: `Parent appointment completed with result: ${result}`,
                };
              }
              
              if (parent.status === 'cancelled') {
                const isRescheduled = parent.skipped_reason === 'parent_appointment_rescheduled';
                return {
                  shouldStop: true,
                  reason: isRescheduled ? 'parent_appointment_rescheduled' : 'parent_task_cancelled',
                  detail: isRescheduled 
                    ? 'Parent appointment has been rescheduled' 
                    : 'Parent appointment has been cancelled',
                };
              }
            } else {
              return {
                shouldStop: true,
                reason: 'parent_task_cancelled',
                detail: 'Parent appointment task not found',
              };
            }
          }
        }
      }

      // ── Rule 1-3: Opportunity-level checks (single query) ──
      if (input.opportunityId) {
        const oppRows = await this.db.executeSafe({
          text: `SELECT stage, automation_status, 
                         COALESCE((metadata->>'opt_out_requested')::boolean, false) as opt_out
                  FROM opportunities 
                  WHERE id = $1 AND tenant_id = $2`,
          values: [input.opportunityId, input.tenantId]
        }) as any[];

        if (oppRows.length > 0) {
          const opp = oppRows[0];

          // Rule 1: Terminal stage
          if (TERMINAL_STAGES.has(opp.stage)) {
            return {
              shouldStop: true,
              reason: 'opportunity_terminal_stage',
              detail: `Opportunity stage is terminal: ${opp.stage}`,
            };
          }

          // Rule 7: Appointment booked
          if (opp.stage === 'booked') {
            return {
              shouldStop: true,
              reason: 'appointment_booked',
              detail: 'Appointment already booked',
            };
          }

          // Rule 2: Automation disabled on opportunity
          if (opp.automation_status === 'stopped' || opp.automation_status === 'paused') {
            return {
              shouldStop: true,
              reason: 'automation_disabled_opp',
              detail: `Opportunity automation_status: ${opp.automation_status}`,
            };
          }

          // Rule 3: Patient opted out
          if (opp.opt_out) {
            return {
              shouldStop: true,
              reason: 'patient_opted_out',
              detail: 'Patient requested opt-out',
            };
          }
        }
      }

      // ── Rule 4: Coordinator took over ──
      const convRows = await this.db.executeSafe({
        text: `SELECT status FROM conversations 
               WHERE phone_number = $1 AND tenant_id = $2
               ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
        values: [input.phoneNumber, input.tenantId]
      }) as any[];

      if (convRows.length > 0 && convRows[0].status === 'human') {
        return {
          shouldStop: true,
          reason: 'coordinator_took_over',
          detail: 'Conversation handed over to human coordinator',
        };
      }

      // ── Rule 5: Max attempts reached ──
      if (input.maxAttempts && input.currentAttempt !== undefined) {
        if (input.currentAttempt >= input.maxAttempts) {
          return {
            shouldStop: true,
            reason: 'max_attempts_reached',
            detail: `Attempt ${input.currentAttempt}/${input.maxAttempts}`,
          };
        }
      }

      // ── Rule 6: Patient responded after task creation ──
      // CRITICAL: Only applies to automated follow-up types, NOT internal tasks
      // CRITICAL: Only counts inbound messages AFTER the task was created
      if (
        input.taskType &&
        !INTERNAL_TASK_TYPES.has(input.taskType) &&
        input.taskCreatedAt
      ) {
        const inboundRows = await this.db.executeSafe({
          text: `SELECT 1 FROM messages 
                 WHERE phone_number = $1 AND tenant_id = $2 
                   AND direction = 'in'
                   AND created_at > $3::timestamptz
                 LIMIT 1`,
          values: [input.phoneNumber, input.tenantId, input.taskCreatedAt]
        }) as any[];

        if (inboundRows.length > 0) {
          return {
            shouldStop: true,
            reason: 'patient_responded',
            detail: 'Patient sent inbound message after task creation',
          };
        }
      }

      // ── All rules passed — proceed ──
      return { shouldStop: false };

    } catch (err) {
      // On error, default to NOT stopping (don't block valid tasks due to query failure)
      console.error('[STOP_RULE_ERROR] Non-fatal evaluation error:', err);
      return { shouldStop: false };
    }
  }
}
