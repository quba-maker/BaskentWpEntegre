/**
 * PHASE 2K: Follow-up Task Engine
 * 
 * Central task management for all follow-up activities.
 * CRUD + auto-generation from CRM extraction + stop rule integration.
 * 
 * P1.1: Signal aggregation via SignalAggregator.
 *   - generateFromCrm() delegates to SignalAggregator for dedup.
 *   - createAggregated() handles group-based task dedup.
 * 
 * STATUS SEMANTICS:
 * - pending: waiting to be actioned
 * - in_progress: coordinator working on it
 * - completed: done (completed_at + completion_note)
 * - cancelled: terminal stage reached → status = cancelled, skipped_reason = stage_terminal
 * - skipped: stop rule blocked execution → status = skipped, skipped_reason = <stop_reason>
 */

import type { TenantDB } from '@/lib/core/tenant-db';
import { SignalAggregator, type TaskGroup } from './signal-aggregator';
import { cleanString } from './sanitizers';
import { adjustToOperatingHours } from '../utils/timezone';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export const TASK_TYPES = [
  'call_patient',
  'callback_scheduled',
  'send_report_reminder',
  'follow_up_no_response',
  'appointment_reminder',
  'coordinator_review',
  'doctor_review_pending',
  'travel_planning',
  'payment_follow_up',
  'no_reply_followup',
  'template_required_task',
  'bot_handoff_followup',
  'custom',
] as const;

export type TaskType = typeof TASK_TYPES[number];

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'skipped';

export interface Task {
  id: string;
  tenant_id: string;
  opportunity_id: string | null;
  conversation_id: string | null;
  phone_number: string;
  task_type: TaskType;
  title: string;
  description: string | null;
  due_at: string;
  remind_at: string | null;
  assigned_to: string | null;
  status: TaskStatus;
  is_automated: boolean;
  completed_at: string | null;
  completed_by: string | null;
  completion_note: string | null;
  skipped_reason: string | null;
  created_by: string;
  source_event: string | null;
  patient_segment: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  tenantId: string;
  opportunityId?: string;
  conversationId?: string;
  phoneNumber: string;
  taskType: TaskType;
  title: string;
  description?: string;
  dueAt: string;       // ISO string
  remindAt?: string;
  assignedTo?: string;
  isAutomated?: boolean;
  createdBy?: string;
  sourceEvent?: string;
  patientSegment?: string;
  metadata?: Record<string, any>;
}

export interface AggregatedTaskInput {
  tenantId: string;
  opportunityId: string;
  conversationId?: string;
  phoneNumber: string;
  primaryTaskType: TaskType;
  primaryTaskGroup: TaskGroup;
  taskTitle: string;
  taskDescription: string;
  dueAt: string;
  priority?: string;
  signals: string[];
  metadata?: Record<string, any>;
}

export interface TaskFilters {
  status?: TaskStatus | TaskStatus[];
  taskType?: TaskType;
  dateRange?: 'overdue' | 'today' | 'tomorrow' | 'week' | 'all';
  opportunityId?: string;
  phoneNumber?: string;
  limit?: number;
  offset?: number;
}

export interface TaskStats {
  total: number;
  pending: number;
  overdue: number;
  dueToday: number;
  completed: number;
  cancelled: number;
  skipped: number;
}

// ═══════════════════════════════════════════════════════════
// CRM → TASK AUTO-GENERATION CONFIG
// ═══════════════════════════════════════════════════════════

interface CrmTaskRule {
  condition: (crmData: any) => boolean;
  taskType: TaskType;
  title: (crmData: any) => string;
  description?: (crmData: any) => string;
  dueOffsetHours: number | ((crmData: any) => number);
  exactDueAt?: (crmData: any) => string | null;
}

const CRM_TASK_RULES: CrmTaskRule[] = [
  {
    condition: (d) => !!d.requested_callback_datetime,
    taskType: 'callback_scheduled',
    title: (d) => `📞 Geri Arama — ${d.patient_name || 'Hasta'}`,
    description: (d) => `Hasta ${d.requested_callback_datetime} zamanında aranmak istiyor.`,
    dueOffsetHours: 0,
    exactDueAt: (d) => d.requested_callback_datetime, // Use exact datetime from patient
  },
  {
    condition: (d) => d.requires_human_confirmation === true,
    taskType: 'coordinator_review',
    title: (d) => `🔍 Koordinatör İncelemesi — ${d.patient_name || 'Hasta'}`,
    description: (d) => `İnsan onayı gerekiyor: ${d.opportunity_reason || d.department || ''}`,
    dueOffsetHours: 1,
  },
  {
    condition: (d) => d.intent_type === 'appointment_request',
    taskType: 'coordinator_review',
    title: (d) => `📅 Randevu Talebi — ${d.patient_name || 'Hasta'}`,
    description: (d) => d.department
      ? `${d.department} bölümü için randevu talebi.`
      : `Bölüm bilgisi netleşmemiş randevu talebi.`,
    dueOffsetHours: 2,
  },
  {
    condition: (d) => d.report_status === 'waiting',
    taskType: 'send_report_reminder',
    title: (d) => `📄 Rapor Bekleniyor — ${d.patient_name || 'Hasta'}`,
    description: () => 'Hasta rapor/belge göndermesi bekleniyor.',
    dueOffsetHours: 48,
  },
  {
    condition: (d) => d.report_status === 'sent',
    taskType: 'doctor_review_pending',
    title: (d) => `🩺 Doktor İnceleme — ${d.patient_name || 'Hasta'}`,
    description: () => 'Hasta rapor gönderdi, doktor incelemesi bekleniyor.',
    dueOffsetHours: 24,
  },
];

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

export class TaskService {
  constructor(private db: TenantDB) {}

  // ── CREATE ──
  async create(input: CreateTaskInput): Promise<string> {
    let dueAtToUse = input.dueAt;
    const additionalMetadata: Record<string, any> = {};

    if (input.isAutomated) {
      try {
        let wh: any = null;
        if (input.conversationId) {
          try {
            const v2Rows = await this.db.executeSafe({
              text: `
                SELECT cap.business_hours_json 
                FROM conversations c
                JOIN channels ch ON c.channel_id = ch.id
                JOIN channel_groups cg ON ch.group_id = cg.id
                JOIN channel_ai_profiles cap ON cap.group_id = cg.id
                WHERE c.id = $1 AND c.tenant_id = $2
                LIMIT 1
              `,
              values: [input.conversationId, input.tenantId]
            }) as any[];
            if (v2Rows && v2Rows.length > 0 && v2Rows[0].business_hours_json) {
              wh = typeof v2Rows[0].business_hours_json === 'string'
                ? JSON.parse(v2Rows[0].business_hours_json)
                : v2Rows[0].business_hours_json;
            }
          } catch (e) {
            console.warn('[TASK_SERVICE] V2 working hours resolution failed, falling back to V1:', e);
          }
        }
        
        if (!wh) {
          try {
            const v1Rows = await this.db.executeSafe({
              text: `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'working_hours' LIMIT 1`,
              values: [input.tenantId]
            }) as any[];
            if (v1Rows && v1Rows.length > 0 && v1Rows[0].value) {
              wh = typeof v1Rows[0].value === 'string' ? JSON.parse(v1Rows[0].value) : v1Rows[0].value;
            }
          } catch (e) {
            console.warn('[TASK_SERVICE] V1 working hours resolution failed:', e);
          }
        }

        const adjustment = adjustToOperatingHours(input.dueAt, wh);
        if (adjustment.adjusted) {
          dueAtToUse = adjustment.adjustedUtc;
          additionalMetadata.operation_window_adjusted = true;
          additionalMetadata.original_due_at = adjustment.originalUtc;
          additionalMetadata.adjusted_due_at = adjustment.adjustedUtc;
          additionalMetadata.adjust_reason = "outside_operating_hours";
        }
      } catch (err) {
        console.error(`[TASK_SERVICE_CREATE_ADJUST_ERROR] Failed to adjust due_at to operating hours`, err);
      }
    }

    const mergedMetadata = {
      ...(input.metadata || {}),
      ...additionalMetadata
    };

    const rows = await this.db.executeSafe({
      text: `INSERT INTO follow_up_tasks (
               tenant_id, opportunity_id, conversation_id, phone_number,
               task_type, title, description,
               due_at, remind_at, assigned_to,
               is_automated, created_by, source_event, patient_segment,
               metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             RETURNING id`,
      values: [
        input.tenantId,
        input.opportunityId || null,
        input.conversationId || null,
        input.phoneNumber,
        input.taskType,
        input.title,
        input.description || null,
        dueAtToUse,
        input.remindAt || null,
        input.assignedTo || null,
        input.isAutomated ?? false,
        input.createdBy || 'system',
        input.sourceEvent || null,
        input.patientSegment || null,
        JSON.stringify(mergedMetadata),
      ]
    }) as any[];

    return rows[0].id;
  }

  // ── COMPLETE ──
  async complete(taskId: string, tenantId: string, note?: string, completedBy?: string): Promise<void> {
    await this.db.executeSafe({
      text: `UPDATE follow_up_tasks 
             SET status = 'completed', 
                 completed_at = NOW(), 
                 completed_by = $3,
                 completion_note = $4,
                 updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')`,
      values: [taskId, tenantId, completedBy || null, note || null]
    });
  }

  // ── CANCEL (terminal stage) ──
  async cancel(taskId: string, tenantId: string, reason: string): Promise<void> {
    await this.db.executeSafe({
      text: `UPDATE follow_up_tasks 
             SET status = 'cancelled', 
                 skipped_reason = $3,
                 updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')`,
      values: [taskId, tenantId, reason]
    });
  }

  // ── SKIP (stop rule blocked) ──
  async skip(taskId: string, tenantId: string, stopReason: string): Promise<void> {
    await this.db.executeSafe({
      text: `UPDATE follow_up_tasks 
             SET status = 'skipped', 
                 skipped_reason = $3,
                 updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')`,
      values: [taskId, tenantId, stopReason]
    });
  }

  // ── RESCHEDULE ──
  async reschedule(taskId: string, tenantId: string, newDueAt: string): Promise<void> {
    await this.db.executeSafe({
      text: `UPDATE follow_up_tasks 
             SET due_at = $3, 
                 status = 'pending',
                 updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')`,
      values: [taskId, tenantId, newDueAt]
    });
  }

  // ── LIST ──
  async list(tenantId: string, filters?: TaskFilters): Promise<{ items: Task[]; total: number }> {
    const conditions: string[] = ['t.tenant_id = $1'];
    const values: any[] = [tenantId];
    let paramIdx = 2;

    // Status filter
    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(`t.status = ANY($${paramIdx})`);
        values.push(filters.status);
        paramIdx++;
      } else {
        conditions.push(`t.status = $${paramIdx}`);
        values.push(filters.status);
        paramIdx++;
      }
    }

    // Task type filter
    if (filters?.taskType) {
      conditions.push(`t.task_type = $${paramIdx}`);
      values.push(filters.taskType);
      paramIdx++;
    }

    // Opportunity filter
    if (filters?.opportunityId) {
      conditions.push(`t.opportunity_id = $${paramIdx}`);
      values.push(filters.opportunityId);
      paramIdx++;
    }

    // Phone filter
    if (filters?.phoneNumber) {
      conditions.push(`t.phone_number LIKE '%' || $${paramIdx} || '%'`);
      values.push(filters.phoneNumber.replace(/\D/g, '').slice(-10));
      paramIdx++;
    }

    // Date range filter
    if (filters?.dateRange && filters.dateRange !== 'all') {
      switch (filters.dateRange) {
        case 'overdue':
          conditions.push(`t.due_at < NOW() AND t.status = 'pending'`);
          break;
        case 'today':
          conditions.push(`t.due_at::date = CURRENT_DATE`);
          break;
        case 'tomorrow':
          conditions.push(`t.due_at::date = CURRENT_DATE + 1`);
          break;
        case 'week':
          conditions.push(`t.due_at::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`);
          break;
      }
    }

    const whereClause = conditions.join(' AND ');
    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    // Get items
    const items = await this.db.executeSafe({
      text: `SELECT t.*, 
                    o.patient_name, o.department, o.country, o.stage as opp_stage
             FROM follow_up_tasks t
             LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
             WHERE ${whereClause}
             ORDER BY 
               CASE t.status 
                 WHEN 'pending' THEN 0 
                 WHEN 'in_progress' THEN 1 
                 ELSE 2 
               END,
               t.due_at ASC
             LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      values: [...values, limit, offset]
    }) as any[];

    // Get total count
    const countRows = await this.db.executeSafe({
      text: `SELECT COUNT(*) as total FROM follow_up_tasks t WHERE ${whereClause}`,
      values: values
    }) as any[];

    return {
      items: items as Task[],
      total: parseInt(countRows[0]?.total) || 0,
    };
  }

  // ── STATS ──
  async getStats(tenantId: string): Promise<TaskStats> {
    const rows = await this.db.executeSafe({
      text: `SELECT 
               COUNT(*) as total,
               COUNT(*) FILTER (WHERE status = 'pending') as pending,
               COUNT(*) FILTER (WHERE status = 'pending' AND due_at < NOW()) as overdue,
               COUNT(*) FILTER (WHERE status = 'pending' AND due_at::date = CURRENT_DATE) as due_today,
               COUNT(*) FILTER (WHERE status = 'completed') as completed,
               COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
               COUNT(*) FILTER (WHERE status = 'skipped') as skipped
             FROM follow_up_tasks
             WHERE tenant_id = $1`,
      values: [tenantId]
    }) as any[];

    const r = rows[0] || {};
    return {
      total: parseInt(r.total) || 0,
      pending: parseInt(r.pending) || 0,
      overdue: parseInt(r.overdue) || 0,
      dueToday: parseInt(r.due_today) || 0,
      completed: parseInt(r.completed) || 0,
      cancelled: parseInt(r.cancelled) || 0,
      skipped: parseInt(r.skipped) || 0,
    };
  }

  // ── OVERDUE ──
  async getOverdue(tenantId: string): Promise<Task[]> {
    return await this.db.executeSafe({
      text: `SELECT * FROM follow_up_tasks 
             WHERE tenant_id = $1 AND status = 'pending' AND due_at < NOW()
             ORDER BY due_at ASC LIMIT 100`,
      values: [tenantId]
    }) as any[];
  }

  // ── MARK OVERDUE (batch operation for cron) ──
  // Note: We don't change status — overdue is computed from due_at < NOW() + status = 'pending'
  // This is a query-time check, not a status change.

  // ── CANCEL ALL PENDING FOR TERMINAL OPP ──
  async cancelForTerminalOpp(oppId: string, tenantId: string): Promise<number> {
    const result = await this.db.executeSafe({
      text: `UPDATE follow_up_tasks 
             SET status = 'cancelled', 
                 skipped_reason = 'stage_terminal',
                 updated_at = NOW()
             WHERE opportunity_id = $1 AND tenant_id = $2 
               AND status IN ('pending', 'in_progress')
             RETURNING id`,
      values: [oppId, tenantId]
    }) as any[];

    return result.length;
  }

  // ── AUTO-GENERATION FROM CRM (P1.1: Delegates to SignalAggregator) ──
  async generateFromCrm(input: {
    tenantId: string;
    opportunityId: string;
    phoneNumber: string;
    conversationId?: string;
    crmData: any;
    patientName?: string;
  }): Promise<string[]> {
    // P1.1: Use SignalAggregator for dedup + aggregation
    const aggregator = new SignalAggregator();
    const aggregated = aggregator.aggregate(input.crmData, {
      patientName: input.crmData?.patient_name || input.patientName,
      phoneNumber: input.phoneNumber,
      department: input.crmData?.department,
      country: input.crmData?.country,
    });

    if (!aggregated) return [];

    try {
      const taskId = await this.createAggregated({
        tenantId: input.tenantId,
        opportunityId: input.opportunityId,
        conversationId: input.conversationId,
        phoneNumber: input.phoneNumber,
        primaryTaskType: aggregated.primaryTaskType,
        primaryTaskGroup: aggregated.primaryTaskGroup,
        taskTitle: aggregated.taskTitle,
        taskDescription: aggregated.taskDescription,
        dueAt: aggregated.dueAt,
        priority: aggregated.priority,
        signals: aggregated.signals,
        metadata: aggregated.metadata,
      });
      return taskId ? [taskId] : [];
    } catch (err) {
      console.error(`[TASK_AGGREGATED_ERROR] Failed:`, err);
      return [];
    }
  }

  // ── CREATE AGGREGATED (P1.1: Redirected to PatientOperationsLifecycleService facade) ──
  async createAggregated(input: AggregatedTaskInput): Promise<string | null> {
    const { PatientOperationsLifecycleService } = await import('./patient-operations-lifecycle');
    const lifecycleService = new PatientOperationsLifecycleService(this.db);
    return lifecycleService.createOrMergeTask({
      tenantId: input.tenantId,
      opportunityId: input.opportunityId,
      conversationId: input.conversationId,
      phoneNumber: input.phoneNumber,
      taskType: input.primaryTaskType,
      title: input.taskTitle,
      description: input.taskDescription,
      dueAt: input.dueAt,
      isAutomated: true,
      createdBy: 'crm_auto',
      sourceEvent: 'crm_extraction',
      metadata: {
        ...input.metadata,
        signals: input.signals
      }
    });
  }

  // ── FIND PENDING IN SAME TASK GROUP ──
  private async findPendingInGroup(
    oppId: string, taskGroup: TaskGroup, tenantId: string
  ): Promise<{ id: string; metadata: any } | null> {
    // Map task group to possible task types
    const groupTypes: Record<TaskGroup, string[]> = {
      appointment_followup: ['coordinator_review', 'callback_scheduled', 'appointment_reminder'],
      callback_followup: ['callback_scheduled', 'call_patient'],
      doctor_review: ['doctor_review_pending'],
      report_followup: ['send_report_reminder'],
      coordinator_review: ['coordinator_review'],
    };

    const types = groupTypes[taskGroup] || [taskGroup];

    const rows = await this.db.executeSafe({
      text: `SELECT id, metadata FROM follow_up_tasks 
             WHERE opportunity_id = $1 AND task_type = ANY($2) AND tenant_id = $3
               AND status IN ('pending', 'in_progress')
             ORDER BY created_at DESC
             LIMIT 1`,
      values: [oppId, types, tenantId]
    }) as any[];

    if (rows.length === 0) return null;
    return { id: rows[0].id, metadata: rows[0].metadata || {} };
  }

  // ── DIRTY TITLE GUARD ──
  private isDirtyTitle(title?: string | null): boolean {
    if (!title || title.trim() === '') return true;
    const t = title.toLowerCase();
    return (
      t.includes('null') ||
      t.includes('undefined') ||
      t.endsWith('— hasta') ||
      t.endsWith('— patient')
    );
  }

  // ── MERGE SIGNALS INTO EXISTING TASK ──
  private async mergeSignals(
    taskId: string, 
    tenantId: string, 
    newSignals: string[],
    newTitle: string,
    newDescription: string,
    newDueAt: string,
    newPriority?: string,
    newMetadata?: Record<string, any>
  ): Promise<void> {
    // Read current metadata + title
    const rows = await this.db.executeSafe({
      text: `SELECT title, metadata, due_at, description FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
      values: [taskId, tenantId]
    }) as any[];

    if (rows.length === 0) return;

    const current = rows[0];
    const currentMeta = current.metadata || {};
    const existingSignals: string[] = currentMeta.signals || [];

    // Merge signals (deduplicate)
    const mergedSignals = [...new Set([...existingSignals, ...newSignals])];

    // Keep the earlier (more urgent) due_at
    const currentDue = new Date(current.due_at);
    const incomingDue = new Date(newDueAt);
    const keepDue = (!isNaN(incomingDue.getTime()) && incomingDue < currentDue) 
      ? newDueAt 
      : current.due_at;

    // Fix dirty titles: if existing title contains null/undefined, replace with clean title
    const shouldUpdateTitle = this.isDirtyTitle(current.title);
    const finalTitle = shouldUpdateTitle ? newTitle : current.title;

    const timeKeys = [
      'callback_time_tr',
      'patient_local_time',
      'patient_timezone',
      'timezone_source',
      'time_confirmed_by_patient',
      'needs_timezone_clarification',
      'operation_window_valid',
      'scheduled_for_utc',
      'patient_city'
    ];

    const timeMetaToMerge: Record<string, any> = {};
    if (newMetadata) {
      for (const k of timeKeys) {
        if (newMetadata[k] !== undefined) {
          timeMetaToMerge[k] = newMetadata[k];
        }
      }
    }

    const updatedMeta = {
      ...currentMeta,
      ...timeMetaToMerge, // Merge incoming timezone metadata
      signals: mergedSignals,
      merged_count: mergedSignals.length,
      last_merged_at: new Date().toISOString(),
    };

    await this.db.executeSafe({
      text: `UPDATE follow_up_tasks 
             SET title = $3,
                 metadata = $4::jsonb, 
                 description = $5,
                 due_at = $6,
                 updated_at = NOW()
             WHERE id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')`,
      values: [taskId, tenantId, finalTitle, JSON.stringify(updatedMeta), newDescription, keepDue]
    });
  }

  // ── IDEMPOTENCY GUARD ──
  private async hasPendingTask(
    oppId: string, taskType: string, tenantId: string
  ): Promise<boolean> {
    const rows = await this.db.executeSafe({
      text: `SELECT 1 FROM follow_up_tasks 
             WHERE opportunity_id = $1 AND task_type = $2 AND tenant_id = $3
               AND status IN ('pending', 'in_progress')
             LIMIT 1`,
      values: [oppId, taskType, tenantId]
    }) as any[];

    return rows.length > 0;
  }
}
