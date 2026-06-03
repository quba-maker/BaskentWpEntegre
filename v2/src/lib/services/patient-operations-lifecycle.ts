import type { TenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { TASK_LANES, getTaskLane, LANE_PRECEDENCE, type TaskLane } from '../domain/task/lanes';
import { adjustToOperatingHours } from '../utils/timezone';

const log = logger.withContext({ module: 'PatientOperationsLifecycleService' });

export interface LifecycleTaskInput {
  tenantId: string;
  opportunityId: string;
  conversationId?: string;
  phoneNumber: string;
  taskType: string;
  title: string;
  description?: string;
  dueAt: string;
  isAutomated?: boolean;
  createdBy?: string;
  sourceEvent?: string;
  metadata?: Record<string, any>;
}

export interface BotDirectiveInput {
  taskId: string;
  tenantId: string;
  directiveType: 'ask_callback_time' | 'confirm_callback_time' | 'remind_callback' | 'ask_clinic_appointment_time' | 'confirm_clinic_appointment' | 'request_documents';
  directiveText: string;
  userId?: string;
  sourceUi?: string;
}

export class PatientOperationsLifecycleService {
  constructor(private db: TenantDB) {}

  async createOrMergeTask(input: LifecycleTaskInput): Promise<string> {
    const lane = getTaskLane(input.taskType);
    const laneTypes = TASK_LANES[lane];
    const isPrimaryLane = lane === 'appointment_lifecycle' || lane === 'communication_lifecycle';

    let dueAtToUse = input.dueAt;
    const additionalMetadata: Record<string, any> = {};

    if (input.isAutomated) {
      try {
        const adjustment = adjustToOperatingHours(input.dueAt);
        if (adjustment.adjusted) {
          dueAtToUse = adjustment.adjustedUtc;
          additionalMetadata.operation_window_adjusted = true;
          additionalMetadata.original_due_at = adjustment.originalUtc;
          additionalMetadata.adjusted_due_at = adjustment.adjustedUtc;
          additionalMetadata.adjust_reason = "outside_operating_hours";
          log.info(`[LIFECYCLE_OPERATING_HOURS_ADJUST] Shifted automated task due date to operational window`, {
            oppId: input.opportunityId,
            original: adjustment.originalUtc,
            adjusted: adjustment.adjustedUtc
          });
        }
      } catch (err) {
        log.error(`[LIFECYCLE_OPERATING_HOURS_ADJUST_ERROR] Failed to adjust due_at to operating hours`, err as Error);
      }
    }

    // Deduplication key parameters (tenant, active opp, conversation, lane)
    const existingOppTasks = await this.db.executeSafe({
      text: `SELECT id, task_type, title, description, due_at, metadata 
             FROM follow_up_tasks 
             WHERE opportunity_id = $1 AND tenant_id = $2 
               AND status IN ('pending', 'in_progress')
             ORDER BY created_at DESC`,
      values: [input.opportunityId, input.tenantId]
    }) as any[];

    // 1. Check if we have an active task in the same lane
    const sameLaneTask = existingOppTasks.find(t => {
      const tMeta = t.metadata || {};
      return tMeta.lane === lane || (laneTypes as readonly string[]).includes(t.task_type);
    });

    if (sameLaneTask) {
      log.info(`[LIFECYCLE_MERGE] Existing task in lane found. Merging signals`, {
        oppId: input.opportunityId, taskId: sameLaneTask.id, lane, incomingType: input.taskType
      });

      // Same-lane merge & precedence check
      const existingMeta = sameLaneTask.metadata || {};
      const incomingMeta = input.metadata || {};
      
      const existingType = sameLaneTask.task_type;
      const newType = input.taskType;

      const prec = LANE_PRECEDENCE[lane] || {};
      const existingPrec = prec[existingType] ?? 99;
      const incomingPrec = prec[newType] ?? 99;

      let taskTypeToUse = existingType;
      let titleToUse = sameLaneTask.title;

      // Clean title checks
      const isDirty = (t: string) => {
        const lower = t.toLowerCase();
        return lower.includes('null') || lower.includes('undefined') || lower.endsWith('— hasta') || lower.endsWith('— patient');
      };

      if (incomingPrec < existingPrec || isDirty(sameLaneTask.title)) {
        taskTypeToUse = newType;
        titleToUse = input.title;
        log.info(`[LIFECYCLE_MERGE_PRECEDENCE] Upgrading task type due to higher precedence`, {
          taskId: sameLaneTask.id, from: existingType, to: newType
        });
      }

      // Keep more urgent due date
      const existingDue = new Date(sameLaneTask.due_at);
      const incomingDue = new Date(dueAtToUse);
      const finalDueAt = (!isNaN(incomingDue.getTime()) && incomingDue < existingDue) ? dueAtToUse : sameLaneTask.due_at;

      // Check if we should update parent/primary settings of the merged task
      const otherPrimary = existingOppTasks.find(t => t.id !== sameLaneTask.id && t.metadata?.is_primary === true);
      let finalIsPrimary = existingMeta.is_primary;
      let parentTaskId = existingMeta.parent_task_id || null;

      if (otherPrimary) {
        const otherPrimaryLane = otherPrimary.metadata?.lane || getTaskLane(otherPrimary.task_type);
        const otherPrimaryIsOperational = otherPrimaryLane === 'appointment_lifecycle' || otherPrimaryLane === 'communication_lifecycle';

        if (isPrimaryLane && !otherPrimaryIsOperational) {
          // Promote this task, demote otherPrimary
          log.info(`[LIFECYCLE_MERGE_PROMOTE] Demoting non-operational primary and promoting merged operational task`, {
            oppId: input.opportunityId, taskId: sameLaneTask.id, demotedId: otherPrimary.id
          });
          
          const demotedMeta = {
            ...(otherPrimary.metadata || {}),
            is_primary: false,
            parent_task_id: sameLaneTask.id
          };
          await this.db.executeSafe({
            text: `UPDATE follow_up_tasks SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            values: [JSON.stringify(demotedMeta), otherPrimary.id, input.tenantId]
          });

          finalIsPrimary = true;
          parentTaskId = null;
        } else if (!isPrimaryLane) {
          // Child-lane task should be linked to otherPrimary
          finalIsPrimary = false;
          parentTaskId = otherPrimary.id;
        }
      } else {
        // No other primary exists. If this task has no primary flag, make it primary if no other task has it
        if (finalIsPrimary === undefined) {
          const hasAnyPrimary = existingOppTasks.some(t => t.id !== sameLaneTask.id && t.metadata?.is_primary === true);
          finalIsPrimary = !hasAnyPrimary;
        }
      }

      const mergedSignals = [...new Set([...(existingMeta.signals || []), ...(incomingMeta.signals || [])])];
      const mergedMeta = {
        ...existingMeta,
        ...incomingMeta,
        ...additionalMetadata,
        lane,
        last_merged_at: new Date().toISOString(),
        signals: mergedSignals,
        is_primary: finalIsPrimary,
        ...(parentTaskId ? { parent_task_id: parentTaskId } : {})
      };
      if (!parentTaskId) {
        delete mergedMeta.parent_task_id;
      }

      await this.db.executeSafe({
        text: `UPDATE follow_up_tasks 
               SET task_type = $1, title = $2, due_at = $3, metadata = $4::jsonb, updated_at = NOW()
               WHERE id = $5 AND tenant_id = $6`,
        values: [taskTypeToUse, titleToUse, finalDueAt, JSON.stringify(mergedMeta), sameLaneTask.id, input.tenantId]
      });

      return sameLaneTask.id;
    }

    // 2. No same-lane task. We must create a new task.
    // Determine parent-child relationship.
    
    // Find if there is an existing primary task in any lane
    const currentPrimary = existingOppTasks.find(t => (t.metadata?.is_primary === true));

    let finalIsPrimary = false;
    let parentTaskId: string | null = null;

    if (currentPrimary) {
      const currentPrimaryLane = currentPrimary.metadata?.lane || getTaskLane(currentPrimary.task_type);
      const currentPrimaryIsOperational = currentPrimaryLane === 'appointment_lifecycle' || currentPrimaryLane === 'communication_lifecycle';

      if (isPrimaryLane && !currentPrimaryIsOperational) {
        // Demote existing clinical/reminder primary task and promote this operational task
        log.info(`[LIFECYCLE_PROMOTE] Demoting non-operational primary and promoting new operational task`, {
          oppId: input.opportunityId, demotedId: currentPrimary.id
        });

        // Generate uuid for new task first
        const newTaskIdRes = await this.db.executeSafe({ text: `SELECT gen_random_uuid() as id` }) as any[];
        const newTaskId = newTaskIdRes[0].id;

        const demotedMeta = {
          ...(currentPrimary.metadata || {}),
          is_primary: false,
          parent_task_id: newTaskId
        };

        // Execute demotion
        await this.db.executeSafe({
          text: `UPDATE follow_up_tasks SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
          values: [JSON.stringify(demotedMeta), currentPrimary.id, input.tenantId]
        });

        finalIsPrimary = true;

        // Insert new task with explicit ID
        await this.db.executeSafe({
          text: `INSERT INTO follow_up_tasks (
                   id, tenant_id, opportunity_id, conversation_id, phone_number,
                   task_type, title, description, due_at, is_automated, created_by, source_event, metadata
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
          values: [
            newTaskId,
            input.tenantId,
            input.opportunityId,
            input.conversationId || null,
            input.phoneNumber,
            input.taskType,
            input.title,
            input.description || null,
            dueAtToUse,
            input.isAutomated ?? false,
            input.createdBy || 'system',
            input.sourceEvent || null,
            JSON.stringify({
              ...(input.metadata || {}),
              ...additionalMetadata,
              lane,
              is_primary: true
            })
          ]
        });

        return newTaskId;
      } else {
        // Linked to the existing primary task
        finalIsPrimary = false;
        parentTaskId = currentPrimary.id;
        log.info(`[LIFECYCLE_CHILD] New task is childed to primary task`, {
          oppId: input.opportunityId, parentId: parentTaskId, lane
        });
      }
    } else {
      // No primary active task at all. This becomes the primary.
      finalIsPrimary = true;
    }

    const newTaskMeta = {
      ...(input.metadata || {}),
      ...additionalMetadata,
      lane,
      is_primary: finalIsPrimary,
      ...(parentTaskId ? { parent_task_id: parentTaskId } : {})
    };

    const insertRes = await this.db.executeSafe({
      text: `INSERT INTO follow_up_tasks (
               tenant_id, opportunity_id, conversation_id, phone_number,
               task_type, title, description, due_at, is_automated, created_by, source_event, metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id`,
      values: [
        input.tenantId,
        input.opportunityId,
        input.conversationId || null,
        input.phoneNumber,
        input.taskType,
        input.title,
        input.description || null,
        dueAtToUse,
        input.isAutomated ?? false,
        input.createdBy || 'system',
        input.sourceEvent || null,
        JSON.stringify(newTaskMeta)
      ]
    }) as any[];

    return insertRes[0].id;
  }

  /**
   * Set Operator steering directive metadata on a task.
   */
  async setBotDirective(input: BotDirectiveInput): Promise<void> {
    const tasks = await this.db.executeSafe({
      text: `SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
      values: [input.taskId, input.tenantId]
    }) as any[];

    if (tasks.length === 0) {
      throw new Error(`Task ${input.taskId} not found`);
    }

    const currentMeta = tasks[0].metadata || {};
    const directiveState: Record<string, any> = {
      directive_type: input.directiveType,
      directive_status: 'pending',
      active_bot_directive: input.directiveText,
      created_by: input.userId || 'system',
      created_at: new Date().toISOString(),
      source_ui: input.sourceUi || 'focus_queue',
    };

    // Store in metadata
    const updatedMeta = {
      ...currentMeta,
      bot_directive_state: directiveState,
      // Backward compatibility flags
      [`bot_${input.directiveType.replace('_callback', '').replace('_clinic_appointment', '').replace('_time', '')}_sent`]: true,
      active_bot_directive: input.directiveText
    };

    await this.db.executeSafe({
      text: `UPDATE follow_up_tasks SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      values: [JSON.stringify(updatedMeta), input.taskId, input.tenantId]
    });
  }

  /**
   * Consume a pending bot directive (invoked when bot writes an outbound message).
   * Transitions status from 'pending' -> 'sent' or 'waiting_patient'.
   */
  async consumeBotDirective(taskId: string, tenantId: string): Promise<void> {
    const tasks = await this.db.executeSafe({
      text: `SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
      values: [taskId, tenantId]
    }) as any[];

    if (tasks.length === 0) return;

    const metadata = tasks[0].metadata || {};
    const state = metadata.bot_directive_state;
    if (!state || state.directive_status !== 'pending') return;

    // Single-use reminders can be completed immediately.
    // Interactive questions move to 'waiting_patient'.
    const isOneWay = state.directive_type === 'remind_callback';
    const nextStatus = isOneWay ? 'completed' : 'waiting_patient';

    state.directive_status = nextStatus;
    state.consumed_at = new Date().toISOString();
    if (isOneWay) {
      state.completed_at = new Date().toISOString();
      state.result = 'confirmed';
    }

    const updatedMeta = {
      ...metadata,
      bot_directive_state: state,
      bot_instruction_sent: true
    };

    // If one-way, we also complete the task itself
    const statusUpdate = isOneWay ? ", status = 'completed', completed_at = NOW(), completed_by = '00000000-0000-0000-0000-000000000000', completion_note = 'Bot auto-sent reminder'" : "";

    await this.db.executeSafe({
      text: `UPDATE follow_up_tasks 
             SET metadata = $1::jsonb, updated_at = NOW() ${statusUpdate}
             WHERE id = $2 AND tenant_id = $3`,
      values: [JSON.stringify(updatedMeta), taskId, tenantId]
    });
  }

  /**
   * Complete the bot directive when patient responds or operator handles it.
   */
  async completeBotDirective(taskId: string, tenantId: string, result: 'confirmed' | 'declined' | 'no_response' | 'operator_takeover'): Promise<void> {
    const tasks = await this.db.executeSafe({
      text: `SELECT metadata, status FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
      values: [taskId, tenantId]
    }) as any[];

    if (tasks.length === 0) return;

    const task = tasks[0];
    const metadata = task.metadata || {};
    const state = metadata.bot_directive_state;
    if (!state || ['completed', 'cancelled'].includes(state.directive_status)) return;

    state.directive_status = result === 'confirmed' ? 'completed' : 'cancelled';
    state.completed_at = new Date().toISOString();
    state.result = result;

    const updatedMeta = {
      ...metadata,
      bot_directive_state: state
    };

    // Clean up backward compatible properties
    delete updatedMeta.active_bot_directive;
    delete updatedMeta.bot_teyit_sent;
    delete updatedMeta.bot_hatirlat_sent;
    delete updatedMeta.bot_devret_sent;

    // Complete the task itself if confirmed or taken over
    const shouldCompleteTask = result === 'confirmed' && task.status !== 'completed';
    const statusUpdate = shouldCompleteTask ? ", status = 'completed', completed_at = NOW(), completed_by = '00000000-0000-0000-0000-000000000000', completion_note = 'Bot directive successfully resolved'" : "";

    await this.db.executeSafe({
      text: `UPDATE follow_up_tasks 
             SET metadata = $1::jsonb, updated_at = NOW() ${statusUpdate}
             WHERE id = $2 AND tenant_id = $3`,
      values: [JSON.stringify(updatedMeta), taskId, tenantId]
    });
  }

  /**
   * Cancel all tasks for a terminal/superseded opportunity.
   */
  async cancelTasksForOpp(oppId: string, tenantId: string, reason: string = 'stage_terminal'): Promise<number> {
    const result = await this.db.executeSafe({
      text: `UPDATE follow_up_tasks 
             SET status = 'cancelled', 
                 skipped_reason = $1,
                 updated_at = NOW()
             WHERE opportunity_id = $2 AND tenant_id = $3 
               AND status IN ('pending', 'in_progress')
             RETURNING id`,
      values: [reason, oppId, tenantId]
    }) as any[];

    return result.length;
  }
}
