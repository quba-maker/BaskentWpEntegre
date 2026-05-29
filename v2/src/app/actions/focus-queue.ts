"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { resolvePatientTimezone, formatDualClock, isOverdue, isToday } from "@/lib/utils/timezone";
import { OperationItem } from "./operations"; // We can reuse or extend this type

export type JourneyStatus = 
  | 'Yeni Form Geldi'
  | 'Bot Karşılıyor'
  | 'Bot Cevap Bekliyor'
  | 'İnsan Devri Gerekli'
  | 'Danışman Arayacak'
  | 'Telefon Randevusu Planlandı'
  | 'Telefon Görüşmesi Bekliyor'
  | 'Telefon Görüşmesi Yapıldı'
  | 'Ulaşılamadı'
  | 'Bot Takipte'
  | 'Tekrar Takip Gerekli'
  | 'Rapor Bekleniyor'
  | 'Doktor İncelemesi'
  | 'Klinik Randevusu Alındı'
  | 'Teyit Bekliyor'
  | 'Randevu Yaklaşıyor'
  | 'Geldi'
  | 'Gelmedi / İptal'
  | 'Kapatıldı';

export type NextBestAction = 
  | 'no_action'
  | 'call_now'
  | 'delegate_unreachable_followup_to_bot'
  | 'request_report'
  | 'doctor_review_needed'
  | 'call_today'
  | 'prepare_followup_draft';

export interface FocusQueueItem extends OperationItem {
  journeyStatus: JourneyStatus;
  priorityScore: number;
  nextBestAction: NextBestAction;
  groupId: string;
}

// Compute journey status based on the data
function computeJourneyStatus(row: any): JourneyStatus {
  if (row.opp_stage === 'arrived') return 'Geldi';
  if (row.opp_stage === 'not_show' || row.opp_stage === 'cancelled') return 'Gelmedi / İptal';
  if (row.opp_stage === 'lost' || row.opp_stage === 'not_qualified') return 'Kapatıldı';
  
  if (row.task_metadata?.bot_delegation) return 'Bot Takipte';
  
  if (row.last_outreach_action === 'called_missed') return 'Ulaşılamadı';
  
  if (row.opp_stage === 'report_waiting' || row.task_type === 'send_report_reminder') return 'Rapor Bekleniyor';
  if (row.opp_stage === 'doctor_review' || row.task_type === 'doctor_review_pending') return 'Doktor İncelemesi';
  
  if (row.task_type === 'callback_scheduled') return 'Telefon Randevusu Planlandı';
  
  if (row.conv_status === 'bot') {
    if (row.lead_form_name) return 'Bot Karşılıyor'; // or Bot Cevap Bekliyor
    return 'Bot Cevap Bekliyor';
  }
  
  if (row.conv_status === 'handoff' || row.task_type === 'bot_handoff_followup') return 'İnsan Devri Gerekli';

  if (row.task_type === 'appointment_request' || row.opp_stage === 'appointment_planning') return 'Danışman Arayacak';
  
  if (row.lead_form_name && !row.opp_stage) return 'Yeni Form Geldi';

  return 'Danışman Arayacak'; // Default fallback
}

// Compute Next Best Action
function computeNextBestAction(row: any, journeyStatus: JourneyStatus): NextBestAction {
  if (journeyStatus === 'Geldi' || journeyStatus === 'Kapatıldı' || journeyStatus === 'Gelmedi / İptal') return 'no_action';
  
  if (row.conv_status === 'handoff' || row.task_type === 'bot_handoff_followup') return 'call_now';
  
  if (row.task_type === 'callback_scheduled' && isOverdue(row.task_due_at)) return 'call_now';
  
  if (row.last_outreach_action === 'called_missed') return 'delegate_unreachable_followup_to_bot';
  
  if (journeyStatus === 'Rapor Bekleniyor') return 'request_report';
  
  if (journeyStatus === 'Doktor İncelemesi') return 'doctor_review_needed';
  
  if (isOverdue(row.task_due_at)) return 'call_today'; // could also be prepare_followup_draft
  
  return 'call_today';
}

// Compute Priority Score
function computePriorityScore(row: any, journeyStatus: JourneyStatus, nextBestAction: NextBestAction): number {
  let score = 0;
  
  if (journeyStatus === 'Kapatıldı' || journeyStatus === 'Geldi' || journeyStatus === 'Gelmedi / İptal') return -200;
  
  if (journeyStatus === 'İnsan Devri Gerekli') score += 130;
  else if (journeyStatus === 'Telefon Randevusu Planlandı' && isOverdue(row.task_due_at)) score += 120;
  else if (row.opp_intent_type === 'appointment_request') score += 110;
  else if (isOverdue(row.task_due_at)) score += 100;
  else if (row.opp_priority === 'hot' || row.task_metadata?.priority === 'high') score += 90;
  else if (isToday(row.task_due_at)) score += 80;
  else if (journeyStatus === 'Yeni Form Geldi') score += 70;
  else if (journeyStatus === 'Ulaşılamadı') score += 60;
  else if (journeyStatus === 'Rapor Bekleniyor') score += 50;
  else if (journeyStatus === 'Doktor İncelemesi') score += 40;
  else if (journeyStatus === 'Bot Takipte') score += 30;

  // Timezone penalty
  const tzRes = resolvePatientTimezone(row.opp_country || row.lead_raw_data?.country);
  if (tzRes.needs_confirmation) {
    // We could penalize or boost, but we need local time to know if it's night.
    // For now, if we don't know, we don't penalize.
  }
  
  return score;
}

export async function getFocusQueueItems(): Promise<{ items: FocusQueueItem[]; total: number }> {
  return withActionGuard(
    { actionName: 'getFocusQueueItems' },
    async (ctx) => {
      // 1. Fetch data similar to getOperationItems, but without restrictive status filters (we want all active tasks)
      // Exclude terminal stages by default, or handle them via grouping.
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
          c.active_opportunity_id as conv_active_opportunity_id,

          -- Lead details
          l.id as lead_id,
          l.form_name as lead_form_name,
          l.raw_data as lead_raw_data,
          l.linked_opportunity_id as lead_linked_opportunity_id,

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
        WHERE t.tenant_id = $1 
          AND t.status IN ('pending', 'in_progress')
          AND (o.stage IS NULL OR o.stage NOT IN ('lost', 'not_qualified', 'arrived'))
      `;

      const rows = await ctx.db.executeSafe({
        text: query,
        values: [ctx.tenantId]
      }) as any[];

      // 2. Grouping
      // Grouping priority: 
      // 1. conversations.active_opportunity_id
      // 2. opportunity_id
      // 3. leads.linked_opportunity_id
      // 4. conversation_id + active_opportunity_id (already handled by 1 if conv exists)
      // 5. phone_number fallback
      
      const groupedMap = new Map<string, FocusQueueItem>();

      rows.forEach(row => {
        let groupId = '';
        if (row.conv_active_opportunity_id) {
          groupId = \`opp_\${row.conv_active_opportunity_id}\`;
        } else if (row.opportunity_id) {
          groupId = \`opp_\${row.opportunity_id}\`;
        } else if (row.lead_linked_opportunity_id) {
          groupId = \`opp_\${row.lead_linked_opportunity_id}\`;
        } else if (row.conversation_id) {
          groupId = \`conv_\${row.conversation_id}\`;
        } else if (row.phone_number) {
          groupId = \`phone_\${row.phone_number}\`;
        } else {
          groupId = \`task_\${row.task_id}\`;
        }

        const resolvedCountry = row.opp_country || row.lead_raw_data?.country || null;
        const tzRes = resolvePatientTimezone(resolvedCountry);
        const dualClock = formatDualClock(row.task_due_at, resolvedCountry);

        let opType: OperationItem['operation_type'] = 'call_due';
        if (row.opp_intent_type === 'appointment_request' || row.opp_stage === 'appointment_planning') opType = 'appointment_request';
        else if (row.task_type === 'callback_scheduled' || row.last_outreach_action === 'callback_scheduled') opType = 'callback_scheduled';
        else if (row.task_type === 'doctor_review_pending' || row.opp_stage === 'doctor_review') opType = 'doctor_review';
        else if (row.task_type === 'send_report_reminder' || row.opp_stage === 'report_waiting') opType = 'report_waiting';
        else if (row.task_type === 'coordinator_review') opType = 'form_followup';
        else if (row.last_outreach_action === 'called_missed') opType = 'missed_call_followup';
        else if (row.conv_status === 'bot' && row.lead_form_name) opType = 'bot_handoff_followup';
        if (tzRes.needs_confirmation) opType = 'timezone_confirmation';

        let calculatedStatus: OperationItem['status'] = 'pending';
        if (isOverdue(row.task_due_at)) calculatedStatus = 'overdue';
        else if (isToday(row.task_due_at)) calculatedStatus = 'due_today';

        let calculatedPrio: OperationItem['priority'] = 'warm';
        if (row.opp_priority === 'hot' || row.task_metadata?.priority === 'high' || row.task_metadata?.priority === 'critical') calculatedPrio = 'hot';
        else if (row.opp_priority === 'cold') calculatedPrio = 'cold';

        const journeyStatus = computeJourneyStatus(row);
        const nextBestAction = computeNextBestAction(row, journeyStatus);
        const priorityScore = computePriorityScore(row, journeyStatus, nextBestAction);

        const item: FocusQueueItem = {
          id: row.task_id, // we might have multiple tasks per group, but FocusQueueItem represents the group's "lead" task
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
          journeyStatus,
          priorityScore,
          nextBestAction,
          groupId
        };

        // If group already exists, we should decide which task is more important.
        // For P0, we take the one with the highest priorityScore.
        if (groupedMap.has(groupId)) {
          const existing = groupedMap.get(groupId)!;
          if (priorityScore > existing.priorityScore) {
            groupedMap.set(groupId, item);
          }
        } else {
          groupedMap.set(groupId, item);
        }
      });

      // 3. Sorting
      const items = Array.from(groupedMap.values()).sort((a, b) => b.priorityScore - a.priorityScore);

      return {
        items,
        total: items.length
      };
    }
  ).then(res => res.data || { items: [], total: 0 });
}

export type BotDelegationMode = 
  | 'unreachable_followup'
  | 'collect_phone_call_time'
  | 'confirm_phone_call'
  | 'clinic_appointment_reminder'
  | 'request_report'
  | 'no_response_followup';

export interface BotDelegationOptions {
  mode: BotDelegationMode;
  goal: string;
  maxAttempts?: number;
  attemptIntervalMinutes?: number;
}

export async function createBotDelegationTask(opportunityId: string, options: BotDelegationOptions) {
  return withActionGuard(
    { actionName: 'createBotDelegationTask' },
    async (ctx) => {
      // Create a follow-up task representing bot delegation without sending messages outward.
      const query = \`
        INSERT INTO follow_up_tasks (
          tenant_id, 
          opportunity_id, 
          task_type, 
          title, 
          description, 
          status, 
          due_at, 
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '5 minutes', $7)
        RETURNING id
      \`;

      const metadata = {
        bot_delegation: {
          mode: options.mode,
          goal: options.goal,
          max_attempts: options.maxAttempts || 3,
          attempt_interval_minutes: options.attemptIntervalMinutes || 120,
          attempt_count: 0,
          status: 'pending',
          zero_outbound_p0: true
        }
      };

      await ctx.db.executeSafe({
        text: query,
        values: [
          ctx.tenantId,
          opportunityId,
          'bot_handoff_followup', // Or a custom type
          \`Bot Takip: \${options.mode}\`,
          options.goal,
          'pending',
          JSON.stringify(metadata)
        ]
      });

      return { success: true };
    }
  );
}
