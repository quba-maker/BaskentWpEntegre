"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { resolvePatientTimezone, formatDualClock, isOverdue, isToday } from "@/lib/utils/timezone";
import type { JourneyStatus, NextBestAction } from "./focus-queue";

// ═══════════════════════════════════════════════════════════
// PHASE 2S-P0 — Patient Tracking & Appointment Management
// Data layer for the new Takip Merkezi list view
// ═══════════════════════════════════════════════════════════

// ── TYPES ──

export interface PatientTrackingRow {
  opportunityId: string;
  tenantId: string;
  patientName: string;
  phoneNumber: string;
  country?: string;
  department?: string;
  stage?: string;
  priority: 'cold' | 'warm' | 'hot';
  source?: string;
  language?: string;

  // Computed display fields
  journeyStatus: JourneyStatus;
  journeyStatusColor: string;
  nextBestAction: NextBestAction;
  actionLabel: string;
  actionColorClass: string;
  priorityScore: number;

  // Activity & time
  lastActivityAt?: string;
  lastActivityLabel: string;
  nextFollowUpAt?: string;
  nextFollowUpTurkey?: string;
  nextFollowUpPatientLocal?: string;
  patientTimezone?: string;
  timezoneNeedsConfirmation: boolean;
  isPatientSleeping: boolean;

  // Summary
  shortSummary: string;
  aiReason?: string;

  // Identifiers
  taskId?: string;
  conversationId?: string;
  leadId?: string;

  // Flags
  isTestWhitelist: boolean;
  hasBotDelegation: boolean;
  hasLeadRawData: boolean;
}

export interface PatientTrackingFilters {
  search?: string;
  stage?: string;
  priority?: string;
  actionStatus?: string;
}

export interface PatientDetailData {
  // Core
  opportunityId: string;
  patientName: string;
  phoneNumber: string;
  country?: string;
  department?: string;
  stage?: string;
  priority: string;
  intentType?: string;
  source?: string;
  language?: string;
  createdAt?: string;
  updatedAt?: string;

  // AI
  summary?: string;
  aiReason?: string;

  // Notes
  notes: any[];

  // Computed
  journeyStatus: JourneyStatus;
  nextBestAction: NextBestAction;
  actionLabel: string;

  // Time Intelligence
  nextFollowUpAt?: string;
  nextFollowUpTurkey?: string;
  nextFollowUpPatientLocal?: string;
  patientTimezone?: string;
  timezoneNeedsConfirmation: boolean;
  isPatientSleeping: boolean;
  turkeyTimeNow: string;
  patientLocalTimeNow?: string;

  // Lead / Form
  leadId?: string;
  leadFormName?: string;
  leadRawData?: Record<string, any>;
  leadCreatedAt?: string;

  // Conversation
  conversationId?: string;
  lastMessageAt?: string;
  lastMessageContent?: string;
  lastOutreachAction?: string;
  lastOutreachAt?: string;

  // Tasks
  tasks: Array<{
    id: string;
    taskType: string;
    title: string;
    description?: string;
    dueAt?: string;
    status: string;
    metadata?: Record<string, any>;
    createdAt: string;
  }>;

  // Bot delegation
  hasBotDelegation: boolean;
  botDelegationMode?: string;

  // Flags
  isTestWhitelist: boolean;

  // Timeline
  timeline: TimelineEntry[];
}

export interface TimelineEntry {
  id: string;
  type: 'outreach' | 'task' | 'note' | 'stage_change' | 'bot_delegation';
  action: string;
  label: string;
  description?: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface AppointmentRow {
  taskId: string;
  opportunityId?: string;
  patientName: string;
  phoneNumber: string;
  country?: string;
  department?: string;

  appointmentType: 'phone_call' | 'clinic_visit' | 'consultation' | 'doctor_review' | 'report_followup';
  appointmentTypeLabel: string;

  dueAtUtc?: string;
  dueAtTurkey?: string;
  dueAtPatientLocal?: string;
  patientTimezone?: string;

  status: 'planned' | 'approaching' | 'overdue' | 'completed' | 'cancelled' | 'arrived' | 'no_show';
  statusLabel: string;
  statusColor: string;

  confirmationStatus: 'pending' | 'confirmed' | 'none';

  taskTitle: string;
  taskDescription?: string;
  metadata?: Record<string, any>;
}

export interface AppointmentFilters {
  appointmentType?: 'phone_call' | 'clinic_visit' | 'all';
  status?: string;
  dueRange?: 'today' | 'tomorrow' | 'overdue' | 'week' | 'all';
  search?: string;
}

// ── SHARED COMPUTE FUNCTIONS (reuse from focus-queue logic) ──

function computeJourneyStatus(row: any): JourneyStatus {
  if (row.opp_stage === 'arrived') return 'Geldi';
  if (row.opp_stage === 'not_show' || row.opp_stage === 'cancelled') return 'Gelmedi / İptal';
  if (row.opp_stage === 'lost' || row.opp_stage === 'not_qualified') return 'Kapatıldı';
  
  if (row.task_metadata?.bot_delegation) return 'Bot Takipte';
  if (row.last_outreach_action === 'called_missed') return 'Ulaşılamadı';
  if (row.opp_stage === 'report_waiting' || row.task_type === 'send_report_reminder') return 'Rapor Bekleniyor';
  if (row.opp_stage === 'doctor_review' || row.task_type === 'doctor_review_pending') return 'Doktor İncelemesi';
  if (row.task_type === 'callback_scheduled') return 'Telefon Randevusu Planlandı';
  if (row.opp_stage === 'appointment_booked') return 'Klinik Randevusu Alındı';
  if (row.conv_status === 'bot') {
    if (row.lead_form_name) return 'Bot Karşılıyor';
    return 'Bot Cevap Bekliyor';
  }
  if (row.conv_status === 'handoff' || row.task_type === 'bot_handoff_followup') return 'İnsan Devri Gerekli';
  if (row.task_type === 'appointment_request' || row.opp_stage === 'appointment_planning') return 'Danışman Arayacak';
  if (row.lead_form_name && !row.opp_stage) return 'Yeni Form Geldi';
  if (row.opp_stage === 'new_lead') return 'Yeni Form Geldi';
  if (row.opp_stage === 'first_contact') return 'Danışman Arayacak';
  if (row.opp_stage === 'engaged') return 'Telefon Görüşmesi Bekliyor';
  return 'Danışman Arayacak';
}

function computeNextBestAction(row: any, journeyStatus: JourneyStatus): NextBestAction {
  if (journeyStatus === 'Geldi' || journeyStatus === 'Kapatıldı' || journeyStatus === 'Gelmedi / İptal') return 'no_action';
  
  if (row.task_due_at && !isOverdue(row.task_due_at) && !isToday(row.task_due_at)) {
    return 'scheduled_followup';
  }

  if (row.opp_stage === 'appointment_planning' && row.opp_priority === 'hot') {
    return 'continue_appointment_planning';
  }

  if (row.conv_status === 'handoff' || row.task_type === 'bot_handoff_followup') return 'call_now';
  if (row.task_type === 'callback_scheduled' && isOverdue(row.task_due_at)) return 'call_now';
  if (row.last_outreach_action === 'called_missed') return 'delegate_unreachable_followup_to_bot';
  if (journeyStatus === 'Rapor Bekleniyor') return 'request_report';
  if (journeyStatus === 'Doktor İncelemesi') return 'doctor_review_needed';
  if (isOverdue(row.task_due_at)) return 'call_now';
  return 'call_today';
}

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

  return score;
}

// ── LABEL CONFIGS ──

const JOURNEY_STATUS_COLORS: Record<string, string> = {
  'Yeni Form Geldi': 'bg-emerald-100 text-emerald-700',
  'Bot Karşılıyor': 'bg-blue-100 text-blue-700',
  'Bot Cevap Bekliyor': 'bg-blue-100 text-blue-700',
  'İnsan Devri Gerekli': 'bg-amber-100 text-amber-800',
  'Danışman Arayacak': 'bg-indigo-100 text-indigo-700',
  'Telefon Randevusu Planlandı': 'bg-purple-100 text-purple-700',
  'Telefon Görüşmesi Bekliyor': 'bg-violet-100 text-violet-700',
  'Telefon Görüşmesi Yapıldı': 'bg-green-100 text-green-700',
  'Ulaşılamadı': 'bg-gray-100 text-gray-700',
  'Bot Takipte': 'bg-cyan-100 text-cyan-700',
  'Tekrar Takip Gerekli': 'bg-orange-100 text-orange-700',
  'Rapor Bekleniyor': 'bg-orange-100 text-orange-700',
  'Doktor İncelemesi': 'bg-rose-100 text-rose-700',
  'Klinik Randevusu Alındı': 'bg-green-100 text-green-700',
  'Teyit Bekliyor': 'bg-yellow-100 text-yellow-700',
  'Randevu Yaklaşıyor': 'bg-purple-100 text-purple-700',
  'Geldi': 'bg-emerald-100 text-emerald-700',
  'Gelmedi / İptal': 'bg-red-100 text-red-700',
  'Kapatıldı': 'bg-gray-100 text-gray-500',
};

const ACTION_LABELS: Record<string, { label: string; colorClass: string }> = {
  'call_now': { label: 'Hemen Ara', colorClass: 'text-rose-600 bg-rose-50' },
  'call_today': { label: 'Bugün Ara', colorClass: 'text-blue-600 bg-blue-50' },
  'scheduled_followup': { label: 'Takip Planlandı', colorClass: 'text-purple-600 bg-purple-50' },
  'continue_appointment_planning': { label: 'Randevu Planlamayı Sürdür', colorClass: 'text-indigo-600 bg-indigo-50' },
  'delegate_unreachable_followup_to_bot': { label: 'Bot Takip Önerilir', colorClass: 'text-cyan-600 bg-cyan-50' },
  'request_report': { label: 'Rapor İste', colorClass: 'text-orange-600 bg-orange-50' },
  'doctor_review_needed': { label: 'Doktor İncelemesi', colorClass: 'text-rose-600 bg-rose-50' },
  'prepare_followup_draft': { label: 'Taslak Hazırla', colorClass: 'text-violet-600 bg-violet-50' },
  'no_action': { label: 'İşlem Yok', colorClass: 'text-gray-500 bg-gray-50' },
};

// ── HELPER: Compute last activity ──

function computeLastActivity(row: any): { at: string | null; label: string } {
  const candidates: { at: Date; label: string }[] = [];

  if (row.conv_last_message_at) {
    candidates.push({ at: new Date(row.conv_last_message_at), label: 'Son mesaj' });
  }
  if (row.last_outreach_at) {
    candidates.push({ at: new Date(row.last_outreach_at), label: 'Son aksiyon' });
  }
  if (row.opp_updated_at) {
    candidates.push({ at: new Date(row.opp_updated_at), label: 'Güncelleme' });
  }
  if (row.task_created_at) {
    candidates.push({ at: new Date(row.task_created_at), label: 'Görev oluşturuldu' });
  }
  if (row.opp_created_at) {
    candidates.push({ at: new Date(row.opp_created_at), label: 'Oluşturulma' });
  }

  // Filter out invalid dates
  const valid = candidates.filter(c => !isNaN(c.at.getTime()));
  if (valid.length === 0) return { at: null, label: 'Bilgi yok' };

  valid.sort((a, b) => b.at.getTime() - a.at.getTime());
  const most = valid[0];

  const diffMs = Date.now() - most.at.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  let timeLabel: string;
  if (diffMin < 1) timeLabel = 'Az önce';
  else if (diffMin < 60) timeLabel = `${diffMin} dk önce`;
  else if (diffHour < 24) timeLabel = `${diffHour} saat önce`;
  else if (diffDay === 1) timeLabel = 'Dün';
  else if (diffDay < 7) timeLabel = `${diffDay} gün önce`;
  else {
    timeLabel = most.at.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' });
  }

  return { at: most.at.toISOString(), label: `${most.label}: ${timeLabel}` };
}

// ══════════════════════════════════════════
// 1. getPatientTrackingRows
// ══════════════════════════════════════════

export async function getPatientTrackingRows(filters?: PatientTrackingFilters): Promise<{ items: PatientTrackingRow[]; total: number }> {
  return withActionGuard(
    { actionName: 'getPatientTrackingRows' },
    async (ctx) => {
      const query = `
        SELECT 
          t.id as task_id,
          t.tenant_id,
          COALESCE(o.id, t.opportunity_id) as opportunity_id,
          t.conversation_id,
          COALESCE(o.phone_number, t.phone_number) as phone_number,
          t.task_type,
          t.title as task_title,
          t.description as task_description,
          t.due_at as task_due_at,
          t.status as task_status,
          t.metadata as task_metadata,
          t.created_at as task_created_at,
          
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
          o.next_follow_up_at as opp_next_follow_up_at,

          c.status as conv_status,
          c.last_message_content as conv_last_message,
          c.last_message_at as conv_last_message_at,
          c.active_opportunity_id as conv_active_opportunity_id,

          l.id as lead_id,
          l.form_name as lead_form_name,
          l.raw_data as lead_raw_data,
          l.linked_opportunity_id as lead_linked_opportunity_id,
          l.created_at as lead_created_at,

          ol.action as last_outreach_action,
          ol.created_at as last_outreach_at,
          ol.metadata as last_outreach_metadata
        FROM opportunities o
        LEFT JOIN LATERAL (
          SELECT * FROM follow_up_tasks 
          WHERE opportunity_id = o.id AND tenant_id = o.tenant_id AND status IN ('pending', 'in_progress')
          ORDER BY due_at ASC LIMIT 1
        ) t ON TRUE
        LEFT JOIN conversations c ON c.active_opportunity_id = o.id AND c.tenant_id = o.tenant_id
        LEFT JOIN leads l ON l.linked_opportunity_id = o.id AND l.tenant_id = o.tenant_id
        LEFT JOIN LATERAL (
          SELECT action, created_at, metadata
          FROM outreach_logs
          WHERE (opportunity_id = o.id::text OR lead_id = l.id) AND tenant_id = o.tenant_id::text
          ORDER BY created_at DESC
          LIMIT 1
        ) ol ON TRUE
        WHERE o.tenant_id = $1 
          AND o.stage NOT IN ('lost', 'not_qualified', 'arrived', 'not_interested', 'cancelled', 'completed')
          AND (
            t.id IS NOT NULL
            OR o.priority IN ('hot', 'high', 'sıcak')
            OR o.stage IN ('new_lead', 'first_contact', 'engaged', 'qualified', 'appointment_planning', 'appointment_booked', 'report_waiting', 'doctor_review')
            OR o.intent_type IN ('appointment_request', 'follow_up_needed', 'hot_lead')
            OR o.next_follow_up_at IS NOT NULL
            OR ol.action IN ('called_missed', 'callback_scheduled', 'greeting_sent', 'bot_activated')
            OR t.metadata->>'bot_delegation' IS NOT NULL
          )
      `;

      const rows = await ctx.db.executeSafe({
        text: query,
        values: [ctx.tenantId]
      }) as any[];

      // Group by opportunity (same logic as focus-queue)
      const groupedMap = new Map<string, any>();

      rows.forEach(row => {
        let groupId = '';
        if (row.conv_active_opportunity_id) {
          groupId = `opp_${row.conv_active_opportunity_id}`;
        } else if (row.opportunity_id) {
          groupId = `opp_${row.opportunity_id}`;
        } else if (row.lead_linked_opportunity_id) {
          groupId = `opp_${row.lead_linked_opportunity_id}`;
        } else if (row.conversation_id) {
          groupId = `conv_${row.conversation_id}`;
        } else if (row.phone_number) {
          groupId = `phone_${row.phone_number}`;
        } else {
          groupId = `task_${row.task_id}`;
        }

        const journeyStatus = computeJourneyStatus(row);
        const nextBestAction = computeNextBestAction(row, journeyStatus);
        const priorityScore = computePriorityScore(row, journeyStatus, nextBestAction);

        if (groupedMap.has(groupId)) {
          const existing = groupedMap.get(groupId)!;
          if (priorityScore > existing._priorityScore) {
            groupedMap.set(groupId, { ...row, _journeyStatus: journeyStatus, _nextBestAction: nextBestAction, _priorityScore: priorityScore });
          }
        } else {
          groupedMap.set(groupId, { ...row, _journeyStatus: journeyStatus, _nextBestAction: nextBestAction, _priorityScore: priorityScore });
        }
      });

      // Transform to PatientTrackingRow
      let items: PatientTrackingRow[] = Array.from(groupedMap.values()).map(row => {
        const journeyStatus = row._journeyStatus as JourneyStatus;
        const nextBestAction = row._nextBestAction as NextBestAction;
        const priorityScore = row._priorityScore as number;
        const resolvedCountry = row.opp_country || row.lead_raw_data?.country || null;
        const tzRes = resolvePatientTimezone(resolvedCountry);
        const dueAt = row.task_due_at || row.opp_next_follow_up_at;
        const dualClock = dueAt ? formatDualClock(dueAt, resolvedCountry) : { tenantTime: undefined, patientTime: undefined };
        const lastActivity = computeLastActivity(row);

        const isTestWhitelist = !!process.env.TEST_BOT_WHITELIST_NUMBERS &&
          process.env.TEST_BOT_WHITELIST_NUMBERS.split(',').map(s => s.trim()).includes(row.phone_number);

        let isPatientSleeping = false;
        if (tzRes.timezone && !tzRes.needs_confirmation) {
          try {
            const patientNow = new Date().toLocaleString('en-US', { timeZone: tzRes.timezone, hour12: false });
            const hour = new Date(patientNow).getHours();
            if (hour >= 22 || hour < 8) isPatientSleeping = true;
          } catch (_) {}
        }

        const rawSummary = row.opp_summary || '';
        const shortSummary = rawSummary.length > 80 ? rawSummary.substring(0, 80) + '…' : (rawSummary || 'Henüz AI özeti oluşmamış.');

        const actionConfig = ACTION_LABELS[nextBestAction] || ACTION_LABELS['no_action'];
        const statusColorClass = JOURNEY_STATUS_COLORS[journeyStatus] || 'bg-gray-100 text-gray-700';

        let calcPriority: 'cold' | 'warm' | 'hot' = 'warm';
        if (row.opp_priority === 'hot' || row.task_metadata?.priority === 'high' || row.task_metadata?.priority === 'critical') calcPriority = 'hot';
        else if (row.opp_priority === 'cold') calcPriority = 'cold';

        const hasLeadRawData = !!(row.lead_raw_data && typeof row.lead_raw_data === 'object' && Object.keys(row.lead_raw_data).length > 0);

        return {
          opportunityId: row.opportunity_id,
          tenantId: row.tenant_id,
          patientName: row.opp_patient_name || row.lead_raw_data?.patient_name || row.lead_raw_data?.Name || 'İsimsiz',
          phoneNumber: row.phone_number || '',
          country: resolvedCountry || undefined,
          department: row.opp_department || row.lead_raw_data?.department || 'Genel',
          stage: row.opp_stage || undefined,
          priority: calcPriority,
          source: row.opp_source || 'form',
          language: row.opp_language || undefined,

          journeyStatus,
          journeyStatusColor: statusColorClass,
          nextBestAction,
          actionLabel: actionConfig.label,
          actionColorClass: actionConfig.colorClass,
          priorityScore,

          lastActivityAt: lastActivity.at || undefined,
          lastActivityLabel: lastActivity.label,
          nextFollowUpAt: dueAt || undefined,
          nextFollowUpTurkey: dualClock.tenantTime || undefined,
          nextFollowUpPatientLocal: dualClock.patientTime || undefined,
          patientTimezone: tzRes.timezone,
          timezoneNeedsConfirmation: tzRes.needs_confirmation,
          isPatientSleeping,

          shortSummary,
          aiReason: row.opp_ai_reason || undefined,

          taskId: row.task_id || undefined,
          conversationId: row.conversation_id || undefined,
          leadId: row.lead_id || undefined,

          isTestWhitelist,
          hasBotDelegation: !!row.task_metadata?.bot_delegation,
          hasLeadRawData,
        };
      });

      // Client-side search filter
      if (filters?.search) {
        const s = filters.search.toLowerCase();
        items = items.filter(i =>
          i.patientName.toLowerCase().includes(s) ||
          i.phoneNumber.includes(s) ||
          (i.department || '').toLowerCase().includes(s) ||
          (i.country || '').toLowerCase().includes(s)
        );
      }

      // Stage filter
      if (filters?.stage && filters.stage !== 'all') {
        items = items.filter(i => i.stage === filters.stage);
      }

      // Priority filter
      if (filters?.priority && filters.priority !== 'all') {
        items = items.filter(i => i.priority === filters.priority);
      }

      // Sort by priority score descending
      items.sort((a, b) => b.priorityScore - a.priorityScore);

      return { items, total: items.length };
    }
  ).then(res => res.data || { items: [], total: 0 });
}

// ══════════════════════════════════════════
// 2. getPatientTrackingDetail
// ══════════════════════════════════════════

export async function getPatientTrackingDetail(opportunityId: string): Promise<PatientDetailData | null> {
  if (!opportunityId) return null;

  return withActionGuard(
    { actionName: 'getPatientTrackingDetail' },
    async (ctx) => {
      // Main opportunity query
      const oppQuery = `
        SELECT 
          o.*,
          c.id as conv_id,
          c.status as conv_status,
          c.last_message_content,
          c.last_message_at,
          c.phone_number as conv_phone,
          l.id as lead_id,
          l.form_name as lead_form_name,
          l.raw_data as lead_raw_data,
          l.created_at as lead_created_at
        FROM opportunities o
        LEFT JOIN conversations c ON c.active_opportunity_id = o.id AND c.tenant_id = o.tenant_id
        LEFT JOIN leads l ON l.linked_opportunity_id = o.id AND l.tenant_id = o.tenant_id
        WHERE o.id = $1 AND o.tenant_id = $2
        LIMIT 1
      `;
      const oppRows = await ctx.db.executeSafe({ text: oppQuery, values: [opportunityId, ctx.tenantId] }) as any[];
      if (oppRows.length === 0) return null;
      const opp = oppRows[0];

      // Tasks for this opportunity
      const tasksQuery = `
        SELECT id, task_type, title, description, due_at, status, metadata, created_at
        FROM follow_up_tasks
        WHERE opportunity_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
        ORDER BY due_at ASC
      `;
      const tasks = await ctx.db.executeSafe({ text: tasksQuery, values: [opportunityId, ctx.tenantId] }) as any[];

      // Last outreach
      const outreachQuery = `
        SELECT action, created_at, metadata
        FROM outreach_logs
        WHERE opportunity_id = $1 AND tenant_id = $2
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const outreach = await ctx.db.executeSafe({ text: outreachQuery, values: [opportunityId, ctx.tenantId] }) as any[];

      // Timeline
      const timeline = await getPatientTimelineInternal(ctx, opportunityId, opp.lead_id);

      // Compute
      const resolvedCountry = opp.country || opp.lead_raw_data?.country || null;
      const tzRes = resolvePatientTimezone(resolvedCountry);
      const leadTask = tasks[0];
      const dueAt = leadTask?.due_at || opp.next_follow_up_at;
      const dualClock = dueAt ? formatDualClock(dueAt, resolvedCountry) : { tenantTime: undefined, patientTime: undefined };

      const fakeRow = {
        opp_stage: opp.stage,
        opp_priority: opp.priority,
        opp_intent_type: opp.intent_type,
        task_type: leadTask?.task_type,
        task_due_at: leadTask?.due_at,
        task_metadata: leadTask?.metadata,
        last_outreach_action: outreach[0]?.action,
        conv_status: opp.conv_status,
        lead_form_name: opp.lead_form_name,
      };

      const journeyStatus = computeJourneyStatus(fakeRow);
      const nextBestAction = computeNextBestAction(fakeRow, journeyStatus);
      const actionConfig = ACTION_LABELS[nextBestAction] || ACTION_LABELS['no_action'];

      let isPatientSleeping = false;
      let patientLocalTimeNow: string | undefined;
      const turkeyTimeNow = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false });

      if (tzRes.timezone && !tzRes.needs_confirmation) {
        try {
          const patientNow = new Date().toLocaleString('en-US', { timeZone: tzRes.timezone, hour12: false });
          const d = new Date(patientNow);
          const hour = d.getHours();
          if (hour >= 22 || hour < 8) isPatientSleeping = true;
          patientLocalTimeNow = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false });
        } catch (_) {}
      }

      const isTestWhitelist = !!process.env.TEST_BOT_WHITELIST_NUMBERS &&
        process.env.TEST_BOT_WHITELIST_NUMBERS.split(',').map(s => s.trim()).includes(opp.phone_number || opp.conv_phone);

      const botTask = tasks.find((t: any) => t.metadata?.bot_delegation);

      const notes = typeof opp.notes === 'string' ? JSON.parse(opp.notes) : (opp.notes || []);
      const leadRawData = typeof opp.lead_raw_data === 'string' ? JSON.parse(opp.lead_raw_data) : (opp.lead_raw_data || null);

      return {
        opportunityId: opp.id,
        patientName: opp.patient_name || leadRawData?.patient_name || 'İsimsiz',
        phoneNumber: opp.phone_number || opp.conv_phone || '',
        country: resolvedCountry || undefined,
        department: opp.department || undefined,
        stage: opp.stage || undefined,
        priority: opp.priority || 'warm',
        intentType: opp.intent_type || undefined,
        source: opp.source || undefined,
        language: opp.language || undefined,
        createdAt: opp.created_at || undefined,
        updatedAt: opp.updated_at || undefined,

        summary: opp.summary || undefined,
        aiReason: opp.ai_reason || undefined,
        notes,

        journeyStatus,
        nextBestAction,
        actionLabel: actionConfig.label,

        nextFollowUpAt: dueAt || undefined,
        nextFollowUpTurkey: dualClock.tenantTime || undefined,
        nextFollowUpPatientLocal: dualClock.patientTime || undefined,
        patientTimezone: tzRes.timezone,
        timezoneNeedsConfirmation: tzRes.needs_confirmation,
        isPatientSleeping,
        turkeyTimeNow,
        patientLocalTimeNow,

        leadId: opp.lead_id || undefined,
        leadFormName: opp.lead_form_name || undefined,
        leadRawData,
        leadCreatedAt: opp.lead_created_at || undefined,

        conversationId: opp.conv_id || undefined,
        lastMessageAt: opp.last_message_at || undefined,
        lastMessageContent: opp.last_message_content || undefined,
        lastOutreachAction: outreach[0]?.action || undefined,
        lastOutreachAt: outreach[0]?.created_at || undefined,

        tasks: tasks.map((t: any) => ({
          id: t.id,
          taskType: t.task_type,
          title: t.title,
          description: t.description,
          dueAt: t.due_at,
          status: t.status,
          metadata: t.metadata,
          createdAt: t.created_at,
        })),

        hasBotDelegation: !!botTask,
        botDelegationMode: botTask?.metadata?.bot_delegation?.mode || undefined,

        isTestWhitelist,
        timeline,
      };
    }
  ).then(res => res.data || null);
}

// ══════════════════════════════════════════
// 3. getPatientTimeline (internal + exported)
// ══════════════════════════════════════════

async function getPatientTimelineInternal(ctx: any, opportunityId: string, leadId?: string): Promise<TimelineEntry[]> {
  // Outreach logs
  const olQuery = `
    SELECT id, action, metadata, created_at, 'outreach' as event_type
    FROM outreach_logs
    WHERE opportunity_id = $1 AND tenant_id = $2
    ORDER BY created_at DESC
    LIMIT 20
  `;
  const olRows = await ctx.db.executeSafe({ text: olQuery, values: [opportunityId, ctx.tenantId] }) as any[];

  // Task events (completed + cancelled)
  const taskQuery = `
    SELECT id, task_type as action, title, description, metadata, created_at, status, 'task' as event_type
    FROM follow_up_tasks
    WHERE opportunity_id = $1 AND tenant_id = $2
    ORDER BY created_at DESC
    LIMIT 20
  `;
  const taskRows = await ctx.db.executeSafe({ text: taskQuery, values: [opportunityId, ctx.tenantId] }) as any[];

  const OUTREACH_LABELS: Record<string, string> = {
    'greeting_sent': 'Karşılama mesajı gönderildi',
    'bot_activated': 'Bot aktifleştirildi',
    'called_reached': 'Arama yapıldı — ulaşıldı',
    'called_missed': 'Arama yapıldı — ulaşılamadı',
    'callback_scheduled': 'Geri arama planlandı',
    'not_interested': 'İlgilenmiyor olarak işaretlendi',
    'lead_created': 'Lead oluşturuldu',
    'opportunity_created': 'Fırsat oluşturuldu',
    'notification_sent': 'Bildirim gönderildi',
    'test_bot_message_sent': 'Test mesajı gönderildi',
  };

  const entries: TimelineEntry[] = [];

  olRows.forEach((r: any) => {
    entries.push({
      id: r.id || `ol_${r.created_at}`,
      type: 'outreach',
      action: r.action,
      label: OUTREACH_LABELS[r.action] || r.action,
      description: r.metadata?.note || r.metadata?.message_text || undefined,
      createdAt: r.created_at,
      metadata: r.metadata,
    });
  });

  taskRows.forEach((r: any) => {
    const isBotDelegation = !!r.metadata?.bot_delegation;
    entries.push({
      id: r.id,
      type: isBotDelegation ? 'bot_delegation' : 'task',
      action: r.action,
      label: r.title || r.action,
      description: r.description || undefined,
      createdAt: r.created_at,
      metadata: { status: r.status, ...r.metadata },
    });
  });

  // Sort by date descending
  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return entries.slice(0, 20);
}

export async function getPatientTimeline(opportunityId: string): Promise<TimelineEntry[]> {
  if (!opportunityId) return [];

  return withActionGuard(
    { actionName: 'getPatientTimeline' },
    async (ctx) => {
      return getPatientTimelineInternal(ctx, opportunityId);
    }
  ).then(res => res.data || []);
}

// ══════════════════════════════════════════
// 4. getAppointmentRows
// ══════════════════════════════════════════

export async function getAppointmentRows(filters?: AppointmentFilters): Promise<{ items: AppointmentRow[]; total: number }> {
  return withActionGuard(
    { actionName: 'getAppointmentRows' },
    async (ctx) => {
      const conditions = [`t.tenant_id = $1`];
      const values: any[] = [ctx.tenantId];

      // Only appointment-related tasks
      conditions.push(`(
        t.task_type IN ('callback_scheduled', 'doctor_review_pending', 'send_report_reminder')
        OR t.metadata->>'appointment_type' IS NOT NULL
      )`);

      // Status filter
      if (filters?.status && filters.status !== 'all') {
        if (filters.status === 'pending') conditions.push(`t.status IN ('pending', 'in_progress')`);
        else if (filters.status === 'completed') conditions.push(`t.status = 'completed'`);
        else if (filters.status === 'overdue') conditions.push(`t.status IN ('pending', 'in_progress') AND t.due_at < NOW()`);
      } else {
        // Default: show pending/in_progress
        conditions.push(`t.status IN ('pending', 'in_progress')`);
      }

      // Due range
      if (filters?.dueRange && filters.dueRange !== 'all') {
        if (filters.dueRange === 'today') conditions.push(`t.due_at::date = CURRENT_DATE`);
        else if (filters.dueRange === 'tomorrow') conditions.push(`t.due_at::date = (CURRENT_DATE + INTERVAL '1 day')::date`);
        else if (filters.dueRange === 'overdue') conditions.push(`t.due_at < NOW()`);
        else if (filters.dueRange === 'week') conditions.push(`t.due_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`);
      }

      // Appointment type filter
      if (filters?.appointmentType && filters.appointmentType !== 'all') {
        if (filters.appointmentType === 'phone_call') {
          conditions.push(`(t.task_type = 'callback_scheduled' OR t.metadata->>'appointment_type' = 'phone_call')`);
        } else if (filters.appointmentType === 'clinic_visit') {
          conditions.push(`t.metadata->>'appointment_type' = 'clinic_visit'`);
        }
      }

      // Exclude terminal opportunities
      conditions.push(`(o.stage IS NULL OR o.stage NOT IN ('lost', 'not_qualified', 'arrived', 'not_interested', 'cancelled', 'completed'))`);

      const query = `
        SELECT
          t.id as task_id,
          t.opportunity_id,
          t.phone_number,
          t.task_type,
          t.title as task_title,
          t.description as task_description,
          t.due_at,
          t.status as task_status,
          t.metadata as task_metadata,
          t.created_at as task_created_at,
          o.patient_name as opp_patient_name,
          o.country as opp_country,
          o.department as opp_department,
          o.stage as opp_stage,
          o.priority as opp_priority
        FROM follow_up_tasks t
        LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.due_at ASC
        LIMIT 100
      `;

      const rows = await ctx.db.executeSafe({ text: query, values }) as any[];

      const items: AppointmentRow[] = rows.map((row: any) => {
        const resolvedCountry = row.opp_country || null;
        const tzRes = resolvePatientTimezone(resolvedCountry);
        const dualClock = row.due_at ? formatDualClock(row.due_at, resolvedCountry) : { tenantTime: undefined, patientTime: undefined };

        // Determine appointment type
        let appointmentType: AppointmentRow['appointmentType'] = 'phone_call';
        const metaType = row.task_metadata?.appointment_type;
        if (metaType === 'clinic_visit') appointmentType = 'clinic_visit';
        else if (row.task_type === 'doctor_review_pending') appointmentType = 'doctor_review';
        else if (row.task_type === 'send_report_reminder') appointmentType = 'report_followup';

        const TYPE_LABELS: Record<string, string> = {
          phone_call: 'Telefon Görüşmesi',
          clinic_visit: 'Klinik Randevusu',
          consultation: 'Ön Görüşme',
          doctor_review: 'Doktor İncelemesi',
          report_followup: 'Rapor Takibi',
        };

        // Status
        let status: AppointmentRow['status'] = 'planned';
        let statusLabel = 'Planlandı';
        let statusColor = 'bg-blue-100 text-blue-700';

        if (row.task_status === 'completed') {
          status = 'completed'; statusLabel = 'Tamamlandı'; statusColor = 'bg-green-100 text-green-700';
        } else if (row.task_status === 'cancelled') {
          status = 'cancelled'; statusLabel = 'İptal'; statusColor = 'bg-gray-100 text-gray-500';
        } else if (row.due_at && isOverdue(row.due_at)) {
          status = 'overdue'; statusLabel = 'Gecikti'; statusColor = 'bg-red-100 text-red-700';
        } else if (row.due_at && isToday(row.due_at)) {
          // Check if approaching (within 2 hours)
          const diff = new Date(row.due_at).getTime() - Date.now();
          if (diff > 0 && diff < 7200000) {
            status = 'approaching'; statusLabel = 'Yaklaşıyor'; statusColor = 'bg-amber-100 text-amber-700';
          }
        }

        // Confirmation status
        const confirmationStatus: AppointmentRow['confirmationStatus'] = 
          row.task_metadata?.confirmed ? 'confirmed' : 
          (row.task_type === 'callback_scheduled' ? 'pending' : 'none');

        return {
          taskId: row.task_id,
          opportunityId: row.opportunity_id || undefined,
          patientName: row.opp_patient_name || 'İsimsiz',
          phoneNumber: row.phone_number || '',
          country: resolvedCountry || undefined,
          department: row.opp_department || undefined,
          appointmentType,
          appointmentTypeLabel: TYPE_LABELS[appointmentType] || appointmentType,
          dueAtUtc: row.due_at || undefined,
          dueAtTurkey: dualClock.tenantTime || undefined,
          dueAtPatientLocal: dualClock.patientTime || undefined,
          patientTimezone: tzRes.timezone,
          status,
          statusLabel,
          statusColor,
          confirmationStatus,
          taskTitle: row.task_title || '',
          taskDescription: row.task_description || undefined,
          metadata: row.task_metadata || undefined,
        };
      });

      // Client-side search
      let filtered = items;
      if (filters?.search) {
        const s = filters.search.toLowerCase();
        filtered = items.filter(i => 
          i.patientName.toLowerCase().includes(s) ||
          i.phoneNumber.includes(s)
        );
      }

      return { items: filtered, total: filtered.length };
    }
  ).then(res => res.data || { items: [], total: 0 });
}

// ══════════════════════════════════════════
// 5. createClinicAppointmentTask
// ══════════════════════════════════════════

export async function createClinicAppointmentTask(opportunityId: string, dueAtUtc: string, note?: string) {
  return withActionGuard(
    { actionName: 'createClinicAppointmentTask' },
    async (ctx) => {
      const metadata = {
        appointment_type: 'clinic_visit',
        note: note || '',
      };

      await ctx.db.executeSafe({
        text: `
          INSERT INTO follow_up_tasks (tenant_id, opportunity_id, task_type, title, description, status, due_at, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `,
        values: [
          ctx.tenantId,
          opportunityId,
          'callback_scheduled', // Reuse existing type for compatibility
          'Klinik Randevusu',
          note || 'Hasta için klinik randevusu planlandı.',
          'pending',
          dueAtUtc,
          JSON.stringify(metadata)
        ]
      });
      return { success: true };
    }
  );
}
