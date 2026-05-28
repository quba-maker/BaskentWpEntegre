"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { resolvePatientTimezone, formatDualClock, isOverdue, isToday } from "@/lib/utils/timezone";

// ── TYPES ──

export type OperationItem = {
  id: string; // task_id
  tenant_id: string;

  source: 'task' | 'opportunity' | 'lead';
  task_id?: string;
  opportunity_id?: string;
  conversation_id?: string;
  lead_id?: string;

  patient_name: string;
  phone_number: string;
  country?: string;
  department?: string;
  stage?: string;

  operation_type:
    | 'call_due'
    | 'appointment_request'
    | 'callback_scheduled'
    | 'form_followup'
    | 'report_waiting'
    | 'doctor_review'
    | 'timezone_confirmation'
    | 'missed_call_followup'
    | 'bot_handoff_followup';

  priority: 'cold' | 'warm' | 'hot';
  status: 'pending' | 'due_today' | 'overdue' | 'completed' | 'cancelled' | 'skipped';

  due_at_utc?: string;
  due_at_turkey?: string;
  due_at_patient_local?: string;
  patient_timezone?: string;
  timezone_needs_confirmation?: boolean;

  last_outreach_action?: string;
  last_outreach_at?: string;
  last_message_preview?: string;
  summary?: string;
  ai_reason?: string;
  notes?: any[];
  language?: string;

  metadata: Record<string, any>;
};

export interface OperationFilters {
  status?: 'pending' | 'due_today' | 'overdue' | 'completed' | 'all';
  dueRange?: 'today' | 'overdue' | 'tomorrow' | 'week' | 'all';
  priority?: 'all' | 'high' | 'hot';
  country?: string;
  department?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

// ── QUERIES ──

export async function getOperationItems(filters?: OperationFilters): Promise<{ items: OperationItem[]; total: number }> {
  return withActionGuard(
    { actionName: 'getOperationItems' },
    async (ctx) => {
      const conditions: string[] = ['t.tenant_id = $1'];
      const values: any[] = [ctx.tenantId];
      let paramIdx = 2;

      // 1. Status & Due Filter mapping
      const statusFilter = filters?.status || 'pending';
      
      if (statusFilter === 'pending') {
        conditions.push(`t.status IN ('pending', 'in_progress')`);
      } else if (statusFilter === 'completed') {
        conditions.push(`t.status = 'completed'`);
      } else if (statusFilter === 'overdue') {
        conditions.push(`t.status IN ('pending', 'in_progress') AND t.due_at < NOW()`);
      } else if (statusFilter === 'due_today') {
        conditions.push(`t.status IN ('pending', 'in_progress') AND t.due_at::date = CURRENT_DATE`);
      }

      // 2. Due Range Filter mapping
      if (filters?.dueRange && filters.dueRange !== 'all') {
        if (filters.dueRange === 'today') {
          conditions.push(`t.due_at::date = CURRENT_DATE`);
        } else if (filters.dueRange === 'overdue') {
          conditions.push(`t.due_at < NOW() AND t.status IN ('pending', 'in_progress')`);
        } else if (filters.dueRange === 'tomorrow') {
          conditions.push(`t.due_at::date = (CURRENT_DATE + INTERVAL '1 day')::date`);
        } else if (filters.dueRange === 'week') {
          conditions.push(`t.due_at BETWEEN date_trunc('week', NOW()) AND date_trunc('week', NOW() + INTERVAL '1 week')`);
        }
      }

      // 3. Priority filter
      if (filters?.priority && filters.priority !== 'all') {
        if (filters.priority === 'high' || filters.priority === 'hot') {
          conditions.push(`(o.priority = 'hot' OR t.metadata->>'priority' IN ('high', 'critical'))`);
        }
      }

      // 4. Country filter
      if (filters?.country && filters.country !== 'all') {
        conditions.push(`COALESCE(o.country, c.country, l.country) = $${paramIdx++}`);
        values.push(filters.country);
      }

      // 5. Department filter
      if (filters?.department && filters.department !== 'all') {
        conditions.push(`COALESCE(o.department, c.department, l.department) = $${paramIdx++}`);
        values.push(filters.department);
      }

      // 6. DB-level Search
      if (filters?.search && filters.search.trim()) {
        const searchVal = `%${filters.search.trim().toLowerCase()}%`;
        conditions.push(`(
          LOWER(COALESCE(o.patient_name, c.patient_name, l.patient_name, '')) LIKE $${paramIdx} OR
          t.phone_number LIKE $${paramIdx} OR
          LOWER(COALESCE(o.department, c.department, l.department, '')) LIKE $${paramIdx}
        )`);
        values.push(searchVal);
        paramIdx++;
      }

      // Default: Exclude terminal stage opportunities from the operation dashboard (lost, not_qualified, arrived)
      // unless we explicitly ask for 'all' status or kapatılanlar.
      if (statusFilter !== 'all') {
        conditions.push(`(o.stage IS NULL OR o.stage NOT IN ('lost', 'not_qualified', 'arrived'))`);
      }

      const limit = filters?.limit || 50;
      const offset = filters?.offset || 0;

      const query = `
        SELECT 
          t.id as task_id,
          t.tenant_id,
          t.opportunity_id,
          t.conversation_id,
          t.phone_number,
          t.task_type,
          t.title as task_title,
          t.description as task_description,
          t.due_at as task_due_at,
          t.status as task_status,
          t.metadata as task_metadata,
          t.created_at as task_created_at,
          
          -- Opportunity details
          o.patient_name as opp_patient_name,
          o.country as opp_country,
          o.department as opp_department,
          o.stage as opp_stage,
          o.priority as opp_priority,
          o.intent_type as opp_intent_type,
          o.requires_human_confirmation as opp_requires_human_confirmation,
          o.ai_reason as opp_ai_reason,
          o.summary as opp_summary,
          o.notes as opp_notes,
          o.language as opp_language,
          o.source as opp_source,
          o.created_at as opp_created_at,
          o.updated_at as opp_updated_at,

          -- Conversation details
          c.status as conv_status,
          c.last_message_content as conv_last_message,
          c.last_message_at as conv_last_message_at,

          -- Lead details
          l.id as lead_id,
          l.form_name as lead_form_name,
          l.raw_data as lead_raw_data,

          -- Outreach details
          ol.action as last_outreach_action,
          ol.created_at as last_outreach_at,
          ol.metadata as last_outreach_metadata
        FROM follow_up_tasks t
        LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
        LEFT JOIN conversations c ON c.id::text = t.conversation_id AND c.tenant_id = t.tenant_id
        LEFT JOIN leads l ON l.linked_opportunity_id = o.id AND l.tenant_id = t.tenant_id
        LEFT JOIN LATERAL (
          SELECT action, created_at, metadata
          FROM outreach_logs
          WHERE (opportunity_id = t.opportunity_id::text OR lead_id = l.id) AND tenant_id = t.tenant_id::text
          ORDER BY created_at DESC
          LIMIT 1
        ) ol ON TRUE
        WHERE ${conditions.join(' AND ')}
        ORDER BY 
          CASE t.status 
            WHEN 'pending' THEN 0 
            WHEN 'in_progress' THEN 1 
            ELSE 2 
          END,
          t.due_at ASC
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `;

      const rows = await ctx.db.executeSafe({
        text: query,
        values: [...values, limit, offset]
      }) as any[];

      const countQuery = `
        SELECT COUNT(*) as total 
        FROM follow_up_tasks t
        LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
        LEFT JOIN conversations c ON c.id::text = t.conversation_id AND c.tenant_id = t.tenant_id
        LEFT JOIN leads l ON l.linked_opportunity_id = o.id AND l.tenant_id = t.tenant_id
        WHERE ${conditions.join(' AND ')}
      `;

      const countResult = await ctx.db.executeSafe({
        text: countQuery,
        values: values
      }) as any[];

      const items: OperationItem[] = rows.map((row) => {
        const resolvedCountry = row.opp_country || row.lead_raw_data?.country || null;
        
        // Resolve Timezone
        const tzRes = resolvePatientTimezone(resolvedCountry);
        const dualClock = formatDualClock(row.task_due_at, resolvedCountry);

        // Map Operation Type
        let opType: OperationItem['operation_type'] = 'call_due';
        
        if (row.opp_intent_type === 'appointment_request' || row.opp_stage === 'appointment_planning') {
          opType = 'appointment_request';
        } else if (row.task_type === 'callback_scheduled' || row.last_outreach_action === 'callback_scheduled') {
          opType = 'callback_scheduled';
        } else if (row.task_type === 'doctor_review_pending' || row.opp_stage === 'doctor_review') {
          opType = 'doctor_review';
        } else if (row.task_type === 'send_report_reminder' || row.opp_stage === 'report_waiting') {
          opType = 'report_waiting';
        } else if (row.task_type === 'coordinator_review') {
          opType = 'form_followup';
        } else if (row.last_outreach_action === 'called_missed') {
          opType = 'missed_call_followup';
        } else if (row.conv_status === 'bot' && row.lead_form_name) {
          opType = 'bot_handoff_followup';
        }

        // Timezone ambiguity overrides type
        if (tzRes.needs_confirmation) {
          opType = 'timezone_confirmation';
        }

        // Resolve Status
        let calculatedStatus: OperationItem['status'] = 'pending';
        if (row.task_status === 'completed') {
          calculatedStatus = 'completed';
        } else if (row.task_status === 'cancelled') {
          calculatedStatus = 'cancelled';
        } else if (row.task_status === 'skipped') {
          calculatedStatus = 'skipped';
        } else if (isOverdue(row.task_due_at)) {
          calculatedStatus = 'overdue';
        } else if (isToday(row.task_due_at)) {
          calculatedStatus = 'due_today';
        }

        // Resolve Priority
        let calculatedPrio: OperationItem['priority'] = 'warm';
        if (row.opp_priority === 'hot' || row.task_metadata?.priority === 'high' || row.task_metadata?.priority === 'critical') {
          calculatedPrio = 'hot';
        } else if (row.opp_priority === 'cold') {
          calculatedPrio = 'cold';
        }

        return {
          id: row.task_id,
          tenant_id: row.tenant_id,
          source: row.opportunity_id ? 'opportunity' : (row.lead_id ? 'lead' : 'task'),
          task_id: row.task_id,
          opportunity_id: row.opportunity_id || undefined,
          conversation_id: row.conversation_id || undefined,
          lead_id: row.lead_id || undefined,
          patient_name: row.opp_patient_name || row.lead_raw_data?.patient_name || row.lead_raw_data?.Name || 'İsimsiz Form',
          phone_number: row.phone_number,
          country: resolvedCountry || undefined,
          department: row.opp_department || row.lead_raw_data?.department || row.lead_raw_data?.Bölüm || 'Genel',
          stage: row.opp_stage || undefined,
          operation_type: opType,
          priority: calculatedPrio,
          status: calculatedStatus,
          due_at_utc: row.task_due_at,
          due_at_turkey: dualClock.tenantTime,
          due_at_patient_local: dualClock.patientTime || undefined,
          patient_timezone: tzRes.timezone,
          timezone_needs_confirmation: tzRes.needs_confirmation,
          last_outreach_action: row.last_outreach_action || undefined,
          last_outreach_at: row.last_outreach_at || undefined,
          last_message_preview: row.conv_last_message || undefined,
          summary: row.opp_summary || undefined,
          ai_reason: row.opp_ai_reason || undefined,
          notes: typeof row.opp_notes === 'string' ? JSON.parse(row.opp_notes) : (row.opp_notes || []),
          language: row.opp_language || undefined,
          metadata: {
            ...row.task_metadata,
            opp_language: row.opp_language,
            opp_source: row.opp_source || 'form',
            opp_created_at: row.opp_created_at,
            opp_updated_at: row.opp_updated_at,
            conv_last_message_at: row.conv_last_message_at
          },
        };
      });

      return {
        items,
        total: parseInt(countResult[0]?.total || '0')
      };
    }
  ).then(res => res.data || { items: [], total: 0 });
}

export async function getOperationStats(): Promise<{
  overdue: number;
  dueToday: number;
  requests: number;
  ambiguousTimezones: number;
  medicalPending: number;
}> {
  return withActionGuard(
    { actionName: 'getOperationStats' },
    async (ctx) => {
      const query = `
        SELECT 
          COUNT(*) FILTER (WHERE t.status IN ('pending', 'in_progress') AND t.due_at < NOW() AND (o.stage IS NULL OR o.stage NOT IN ('lost', 'not_qualified', 'arrived'))) as overdue,
          COUNT(*) FILTER (WHERE t.status IN ('pending', 'in_progress') AND t.due_at::date = CURRENT_DATE AND (o.stage IS NULL OR o.stage NOT IN ('lost', 'not_qualified', 'arrived'))) as due_today,
          COUNT(*) FILTER (WHERE t.status IN ('pending', 'in_progress') AND (o.intent_type = 'appointment_request' OR o.stage = 'appointment_planning') AND (o.stage IS NULL OR o.stage NOT IN ('lost', 'not_qualified', 'arrived'))) as appointment_requests,
          COUNT(*) FILTER (WHERE t.status IN ('pending', 'in_progress') AND o.country IN ('ABD', 'USA', 'US', 'Kanada', 'Canada', 'CA', 'Rusya', 'Russia', 'RU', 'Avustralya', 'Australia', 'AU', 'Brezilya', 'Brazil', 'BR', 'Endonezya', 'Indonesia', 'ID', 'Meksika', 'Mexico', 'MX') AND (o.stage IS NULL OR o.stage NOT IN ('lost', 'not_qualified', 'arrived'))) as ambiguous_timezones,
          COUNT(*) FILTER (WHERE t.status IN ('pending', 'in_progress') AND (t.task_type IN ('doctor_review_pending', 'send_report_reminder') OR o.stage IN ('doctor_review', 'report_waiting')) AND (o.stage IS NULL OR o.stage NOT IN ('lost', 'not_qualified', 'arrived'))) as medical_pending
        FROM follow_up_tasks t
        LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1
      `;

      const result = await ctx.db.executeSafe({
        text: query,
        values: [ctx.tenantId]
      }) as any[];

      const r = result[0] || {};
      return {
        overdue: parseInt(r.overdue) || 0,
        dueToday: parseInt(r.due_today) || 0,
        requests: parseInt(r.appointment_requests) || 0,
        ambiguousTimezones: parseInt(r.ambiguous_timezones) || 0,
        medicalPending: parseInt(r.medical_pending) || 0
      };
    }
  ).then(res => res.data || { overdue: 0, dueToday: 0, requests: 0, ambiguousTimezones: 0, medicalPending: 0 });
}
