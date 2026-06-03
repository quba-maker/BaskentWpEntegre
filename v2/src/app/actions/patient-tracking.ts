"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { resolvePatientTimezone, formatDualClock, isOverdue, isToday, formatTimeTR, resolvePatientTimeDisplay } from "@/lib/utils/timezone";
import type { JourneyStatus, NextBestAction } from "./focus-queue";
import { resolvePatientDisplayName } from "@/lib/utils/patient-name-resolver";

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
  phoneTaskStatus?: string;
  clinicTaskStatus?: string;
  mostRecentNote?: string;
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
  lastIncomingMessageAt?: string;
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

  // Media & Documents
  mediaFiles?: Array<{
    id: string;
    mediaType: string;
    mediaUrl: string;
    mediaMetadata: any;
    createdAt: string;
  }>;
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
  priority: 'cold' | 'warm' | 'hot';
  hasClinicVisit?: boolean;

  appointmentType: 'phone_call' | 'clinic_visit' | 'pre_consultation' | 'consultation' | 'doctor_review' | 'report_followup';
  appointmentTypeLabel: string;

  dueAtUtc?: string;
  dueAtTurkey?: string;
  dueAtPatientLocal?: string;
  patientTimezone?: string;

  status: 'planned' | 'approaching' | 'overdue' | 'completed' | 'cancelled' | 'arrived' | 'no_show';
  statusLabel: string;
  statusColor: string;

  confirmationStatus: 'pending' | 'confirmed' | 'declined' | 'no_response' | 'not_required' | 'none';
  appointmentResult?: 'completed' | 'arrived' | 'no_show' | 'cancelled' | 'rescheduled';
  appointmentNote?: string;

  taskTitle: string;
  taskDescription?: string;
  metadata?: Record<string, any>;
}

export interface AppointmentFilters {
  appointmentType?: 'phone_call' | 'clinic_visit' | 'all';
  status?: string;
  confirmationStatus?: string;
  completed?: boolean;
  dueRange?: 'today' | 'tomorrow' | 'overdue' | 'week' | 'all';
  search?: string;
}

function getTzCityLabel(tzString?: string | null): string {
  if (!tzString) return '';
  const parts = tzString.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}

function safeJsonParse(str: any, fallback: any = {}): any {
  if (!str) return fallback;
  if (typeof str !== 'string') return str;
  try {
    return JSON.parse(str);
  } catch (_) {
    return fallback;
  }
}

export type UiBucket =
  | 'bot_suggestion_pending'
  | 'open'
  | 'scheduled'
  | 'confirmed'
  | 'overdue'
  | 'completed'
  | 'unreachable'
  | 'cancelled';

export interface OperationsTaskProjected {
  taskId: string | null;
  opportunityId: string | null;
  phoneNumber: string;
  taskType: string;
  taskTitle: string;
  taskDescription: string | null;
  dueAtUtc: string | null;
  dueAtTurkey: string | null;
  dueAtPatientLocal: string | null;
  patientTimezone: string | null;
  isPrimary: boolean;
  status: string;
  uiBucket: UiBucket;
  confirmationStatus: 'pending' | 'confirmed' | 'declined' | 'no_response' | 'none';
  appointmentType: 'phone_call' | 'clinic_visit' | 'consultation' | 'doctor_review' | 'report_followup';
  timeDisplay: string;
  timezoneNeedsClarification: boolean;
}

function buildOperationsTaskProjection(
  task: any,
  opp?: any
): OperationsTaskProjected {
  const metadata = task?.metadata || {};
  const status = task?.status || 'pending';
  const dueAt = task?.due_at;

  const isClinic = metadata.appointment_type === 'clinic_visit';
  const confirmationStatus = metadata.confirmation_status || 'none';

  // 1. uiBucket Calculation
  let uiBucket: UiBucket = 'open';

  if (status === 'cancelled' || metadata.appointment_result === 'cancelled') {
    uiBucket = 'cancelled';
  } else if (status === 'completed') {
    if (metadata.appointment_result === 'no_show') {
      uiBucket = 'unreachable';
    } else {
      uiBucket = 'completed';
    }
  } else if (status === 'no_show' || metadata.appointment_result === 'no_show') {
    uiBucket = 'unreachable';
  } else if (isClinic && confirmationStatus === 'no_response') {
    uiBucket = 'unreachable';
  } else if (status === 'pending' || status === 'in_progress') {
    const isTaskOverdue = dueAt && new Date(dueAt).getTime() < Date.now();
    if (isTaskOverdue) {
      uiBucket = 'overdue';
    } else if (metadata.bot_suggestion?.status === 'pending') {
      uiBucket = 'bot_suggestion_pending';
    } else if (confirmationStatus === 'confirmed') {
      uiBucket = 'confirmed';
    } else if (task?.task_type === 'callback_scheduled' || isClinic) {
      uiBucket = 'scheduled';
    } else {
      uiBucket = 'open';
    }
  }

  // 2. Appointment Type
  let appointmentType: OperationsTaskProjected['appointmentType'] = 'phone_call';
  if (isClinic) {
    appointmentType = 'clinic_visit';
  } else if (metadata.appointment_type === 'consultation') {
    appointmentType = 'consultation';
  } else if (task?.task_type === 'doctor_review_pending') {
    appointmentType = 'doctor_review';
  } else if (task?.task_type === 'send_report_reminder') {
    appointmentType = 'report_followup';
  } else if (metadata.appointment_type === 'phone_call') {
    appointmentType = 'phone_call';
  }

  // 3. Time Display using resolvePatientTimeDisplay
  let scheduledUtc = metadata.scheduled_for_utc || dueAt || null;
  
  const timeDisplayRes = resolvePatientTimeDisplay({
    country: opp?.opp_country || opp?.country,
    city: opp?.lead_raw_data?.city || opp?.lead_raw_data?.patient_city || metadata.patient_city || opp?.opp_metadata?.patient_city || opp?.metadata?.patient_city,
    timezone: metadata.patient_timezone || opp?.opp_metadata?.patient_timezone || opp?.metadata?.patient_timezone,
    phoneNumber: opp?.phone_number || null,
    metadata: metadata,
    oppMetadata: opp?.opp_metadata || opp?.metadata,
    referenceDate: scheduledUtc
  });

  const trTime = timeDisplayRes.turkeyTime;
  const patientTime = timeDisplayRes.patientLocalTime;
  const patientTz = timeDisplayRes.patientTimezone;
  const needsClarification = timeDisplayRes.needsTimezoneClarification;
  const timeDisplay = timeDisplayRes.displayLabel;

  // 4. Primary Task check
  const isPrimary = metadata.is_primary === true || (!metadata.parent_task_id && metadata.is_primary !== false);

  return {
    taskId: task?.id || null,
    opportunityId: task?.opportunity_id || null,
    phoneNumber: task?.phone_number || '',
    taskType: task?.task_type || '',
    taskTitle: task?.title || '',
    taskDescription: task?.description || null,
    dueAtUtc: scheduledUtc,
    dueAtTurkey: trTime || null,
    dueAtPatientLocal: patientTime || null,
    patientTimezone: patientTz || null,
    isPrimary,
    status,
    uiBucket,
    confirmationStatus,
    appointmentType,
    timeDisplay,
    timezoneNeedsClarification: needsClarification
  };
}

// ── SHARED COMPUTE FUNCTIONS (reuse from focus-queue logic) ──

function computeJourneyStatus(row: any): JourneyStatus {
  if (row.opp_stage) {
    if (row.opp_stage === 'new_lead') return 'Yeni';
    if (row.opp_stage === 'first_contact') return 'İlk İletişim';
    if (row.opp_stage === 'engaged') return 'Cevap Alındı';
    if (row.opp_stage === 'discovery') return 'Keşif/Analiz';
    if (row.opp_stage === 'qualified') return 'Nitelikli';
    if (row.opp_stage === 'phone_call_planning') return 'Telefon Görüşmesi Planlanıyor';
    if (row.opp_stage === 'appointment_planning') return 'Randevu Planlanıyor';
    if (row.opp_stage === 'appointment_booked') return 'Randevu Alındı';
    if (row.opp_stage === 'arrived') return 'Geldi';
    if (row.opp_stage === 'not_qualified' || row.opp_stage === 'lost') return 'Uygun Değil';
    
    // Backwards compatibility for old stages
    if (row.opp_stage === 'report_waiting' || row.opp_stage === 'report_received') return 'Keşif/Analiz';
    if (row.opp_stage === 'doctor_review') return 'Nitelikli';
  }
  
  if (row.task_metadata?.bot_delegation) return 'Bot Takipte';
  if (row.last_outreach_action === 'called_missed') return 'Ulaşılamadı';
  
  if (row.task_type === 'callback_scheduled') return 'Telefon Randevusu Planlandı';
  
  if (row.conv_status === 'bot') {
    if (row.lead_form_name) return 'Yeni';
    return 'Bot Cevap Bekliyor';
  }
  
  if (row.conv_status === 'handoff' || row.task_type === 'bot_handoff_followup') return 'İnsan Devri Gerekli';
  if (row.lead_form_name && !row.opp_stage) return 'Yeni';

  return 'Yeni'; // Default fallback
}

function computeNextBestAction(row: any, journeyStatus: JourneyStatus): NextBestAction {
  if (journeyStatus === 'Geldi' || journeyStatus === 'Kapatıldı' || journeyStatus === 'Gelmedi / İptal' || journeyStatus === 'Uygun Değil') return 'no_action';
  
  if (row.task_due_at && !isOverdue(row.task_due_at) && !isToday(row.task_due_at)) {
    return 'scheduled_followup';
  }

  if (row.opp_stage === 'appointment_planning' && row.opp_priority === 'hot') {
    return 'continue_appointment_planning';
  }

  if (row.conv_status === 'handoff' || row.task_type === 'bot_handoff_followup') return 'call_now';
  if (row.task_type === 'callback_scheduled' && isOverdue(row.task_due_at)) return 'call_now';
  if (row.last_outreach_action === 'called_missed') return 'delegate_unreachable_followup_to_bot';
  if (journeyStatus === 'Rapor Bekleniyor' || journeyStatus === 'Keşif/Analiz') return 'request_report';
  if (journeyStatus === 'Doktor İncelemesi' || journeyStatus === 'Nitelikli') return 'doctor_review_needed';
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
  'Yeni': 'bg-[#E6F0FF] text-[#007AFF]',
  'İlk İletişim': 'bg-[#FFF2E6] text-[#FF9500]',
  'Cevap Alındı': 'bg-[#EAF8EB] text-[#34C759]',
  'Keşif/Analiz': 'bg-[#ECEBFC] text-[#5856D6]',
  'Nitelikli': 'bg-[#E6F7F9] text-[#30B0C7]',
  'Telefon Görüşmesi Planlanıyor': 'bg-[#F4EAFB] text-[#AF52DE]',
  'Randevu Planlanıyor': 'bg-[#FFFBE6] text-[#D0A000]',
  'Randevu Alındı': 'bg-[#E6F6EC] text-[#0F9D58]',
  'Geldi': 'bg-[#E6F6EC] text-[#0F9D58]',
  'Uygun Değil': 'bg-[#F2F2F7] text-[#8E8E93]',
  // Backwards compatibility
  'Yeni Form Geldi': 'bg-[#E6F0FF] text-[#007AFF]',
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

          c.patient_name as conv_patient_name,
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
          ol.metadata as last_outreach_metadata,
          (
            SELECT 
              CASE 
                WHEN ft.due_at < NOW() THEN 'Gecikti'
                WHEN ft.task_type = 'callback_scheduled' THEN 'Planlandı'
                ELSE 'Açık'
              END
            FROM follow_up_tasks ft 
            WHERE ft.opportunity_id = o.id 
              AND ft.tenant_id = o.tenant_id
              AND (ft.metadata->>'appointment_type' IS NULL OR ft.metadata->>'appointment_type' != 'clinic_visit')
              AND ft.status IN ('pending', 'in_progress')
              AND (ft.metadata->>'parent_task_id' IS NULL OR (ft.metadata->>'is_primary' IS NOT NULL AND ft.metadata->>'is_primary' = 'true'))
            ORDER BY ft.due_at ASC LIMIT 1
          ) as active_phone_task_status,
          (
            SELECT 
              CASE 
                WHEN ft.status = 'completed' AND ft.metadata->>'appointment_result' = 'arrived' THEN 'Geldi'
                WHEN ft.status = 'completed' AND ft.metadata->>'appointment_result' = 'no_show' THEN 'Gelmedi'
                WHEN ft.status = 'completed' THEN 'Tamamlandı'
                WHEN ft.due_at < NOW() THEN 'Gecikti'
                ELSE 'Planlandı'
              END
            FROM follow_up_tasks ft 
            WHERE ft.opportunity_id = o.id 
              AND ft.tenant_id = o.tenant_id
              AND ft.metadata->>'appointment_type' = 'clinic_visit'
              AND ft.status != 'cancelled'
              AND (ft.metadata->>'parent_task_id' IS NULL OR (ft.metadata->>'is_primary' IS NOT NULL AND ft.metadata->>'is_primary' = 'true'))
            ORDER BY ft.due_at DESC LIMIT 1
          ) as active_clinic_task_status,
          (
            SELECT ft.metadata->>'note' FROM follow_up_tasks ft 
            WHERE ft.opportunity_id = o.id 
              AND ft.tenant_id = o.tenant_id
              AND ft.metadata->>'note' IS NOT NULL 
              AND ft.metadata->>'note' != ''
            ORDER BY ft.updated_at DESC LIMIT 1
          ) as last_task_note,
          (
            SELECT ft.updated_at FROM follow_up_tasks ft 
            WHERE ft.opportunity_id = o.id 
              AND ft.tenant_id = o.tenant_id
              AND ft.metadata->>'note' IS NOT NULL 
              AND ft.metadata->>'note' != ''
            ORDER BY ft.updated_at DESC LIMIT 1
          ) as last_task_note_at
        FROM opportunities o
        LEFT JOIN LATERAL (
          SELECT * FROM follow_up_tasks 
          WHERE opportunity_id = o.id AND tenant_id = o.tenant_id AND status IN ('pending', 'in_progress')
            AND (metadata->>'parent_task_id' IS NULL OR (metadata->>'is_primary' IS NOT NULL AND metadata->>'is_primary' = 'true'))
          ORDER BY due_at ASC LIMIT 1
        ) t ON TRUE
        LEFT JOIN conversations c ON c.phone_number = o.phone_number AND c.tenant_id = o.tenant_id
        LEFT JOIN leads l ON l.linked_opportunity_id = o.id AND l.tenant_id = o.tenant_id
        LEFT JOIN LATERAL (
          SELECT action, created_at, metadata
          FROM outreach_logs
          WHERE (opportunity_id = o.id::text OR lead_id = l.id) AND tenant_id = o.tenant_id::text
          ORDER BY created_at DESC
          LIMIT 1
        ) ol ON TRUE
        WHERE o.tenant_id = $1 
          AND o.stage NOT IN ('not_qualified', 'arrived')
          AND (
            t.id IS NOT NULL
            OR o.priority IN ('hot', 'high', 'sıcak')
            OR o.stage IN ('new_lead', 'first_contact', 'engaged', 'discovery', 'qualified', 'phone_call_planning', 'appointment_planning', 'appointment_booked')
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

      // Group by phone number (or conversation_id) to avoid duplicates for the same patient
      const groupedMap = new Map<string, any[]>();

      rows.forEach(row => {
        const key = row.phone_number || row.conversation_id || `opp_${row.opportunity_id}`;
        if (!groupedMap.has(key)) {
          groupedMap.set(key, []);
        }
        groupedMap.get(key)!.push(row);
      });

      // Transform and select the primary representative row for each patient
      let items: PatientTrackingRow[] = [];

      for (const [key, groupRows] of groupedMap.entries()) {
        // 1. Choose representative: matching active_opportunity_id
        let representative = groupRows.find(
          r => r.opportunity_id && r.opportunity_id === r.conv_active_opportunity_id
        );

        // 2. Fallback: choose the one with the highest priority score
        if (!representative) {
          let bestScore = -999999;
          groupRows.forEach(r => {
            const journeyStatus = computeJourneyStatus(r);
            const nextBestAction = computeNextBestAction(r, journeyStatus);
            const priorityScore = computePriorityScore(r, journeyStatus, nextBestAction);
            if (priorityScore > bestScore) {
              bestScore = priorityScore;
              representative = r;
            }
          });
        }

        if (!representative) {
          representative = groupRows[0];
        }

        const row = representative;
        const journeyStatus = computeJourneyStatus(row);
        const nextBestAction = computeNextBestAction(row, journeyStatus);
        const priorityScore = computePriorityScore(row, journeyStatus, nextBestAction);
        const resolvedCountry = row.opp_country || row.lead_raw_data?.country || null;
        const dueAt = row.task_due_at || row.opp_next_follow_up_at;
        
        const timeDisplayRes = resolvePatientTimeDisplay({
          country: resolvedCountry,
          city: row.lead_raw_data?.city || row.lead_raw_data?.patient_city || row.task_metadata?.patient_city || row.opp_metadata?.patient_city,
          timezone: row.task_metadata?.patient_timezone || row.opp_metadata?.patient_timezone || row.conv_metadata?.patient_timezone,
          phoneNumber: row.phone_number || null,
          metadata: row.task_metadata,
          oppMetadata: row.opp_metadata || row.opp_lead_raw_data || row.lead_raw_data,
          referenceDate: dueAt
        });

        const isPatientSleeping = (() => {
          if (timeDisplayRes.patientTimezone && !timeDisplayRes.needsTimezoneClarification) {
            try {
              const patientHourStr = new Intl.DateTimeFormat('en-US', {
                timeZone: timeDisplayRes.patientTimezone,
                hour: 'numeric',
                hour12: false
              }).format(new Date());
              const hour = parseInt(patientHourStr, 10);
              return hour >= 22 || hour < 8;
            } catch (_) {}
          }
          return false;
        })();
        
        const lastActivity = computeLastActivity(row);

        const isTestWhitelist = !!process.env.TEST_BOT_WHITELIST_NUMBERS &&
          process.env.TEST_BOT_WHITELIST_NUMBERS.split(',').map(s => s.trim()).includes(row.phone_number);

        const rawSummary = row.opp_summary || '';
        const shortSummary = rawSummary.length > 80 ? rawSummary.substring(0, 80) + '…' : (rawSummary || 'Henüz AI özeti oluşmamış.');

        const actionConfig = ACTION_LABELS[nextBestAction] || ACTION_LABELS['no_action'];
        const statusColorClass = JOURNEY_STATUS_COLORS[journeyStatus] || 'bg-gray-100 text-gray-700';

        let calcPriority: 'cold' | 'warm' | 'hot' = 'warm';
        if (row.opp_priority === 'hot' || row.task_metadata?.priority === 'high' || row.task_metadata?.priority === 'critical') calcPriority = 'hot';
        else if (row.opp_priority === 'cold') calcPriority = 'cold';

        const hasLeadRawData = !!(row.lead_raw_data && typeof row.lead_raw_data === 'object' && Object.keys(row.lead_raw_data).length > 0);

        const formRawData = row.lead_raw_data && typeof row.lead_raw_data === 'object' ? row.lead_raw_data : {};
        const formFullName = formRawData.full_name || formRawData['full name'] || formRawData['Full Name'] || formRawData['full_name'];
        const resolvedName = resolvePatientDisplayName({
          manualPatientName: row.conv_patient_name || row.opp_patient_name,
          oppPatientName: row.opp_patient_name,
          convPatientName: row.conv_patient_name,
          whatsappProfileName: row.conv_patient_name,
          formPatientName: row.lead_raw_data?.patient_name,
          formRawDataName: formFullName,
        });

        // Resolve most recent note (from manual notes, phone task notes, clinic visit notes)
        let mostRecentNote = '';
        let mostRecentNoteAt: Date | null = null;

        // 1. Process task notes
        if (row.last_task_note) {
          mostRecentNote = row.last_task_note;
          if (row.last_task_note_at) {
            mostRecentNoteAt = new Date(row.last_task_note_at);
          }
        }

        // 2. Process manual notes
        if (row.opp_notes) {
          let manualNotes: any[] = [];
          if (typeof row.opp_notes === 'string') {
            try { manualNotes = JSON.parse(row.opp_notes); } catch (_) {}
          } else {
            manualNotes = row.opp_notes;
          }

          if (Array.isArray(manualNotes)) {
            manualNotes.forEach((n: any) => {
              const noteText = typeof n === 'string' ? n : (n.text || '');
              const noteDateStr = typeof n === 'object' ? (n.created_at || n.date) : null;
              if (noteText) {
                const noteDate = noteDateStr ? new Date(noteDateStr) : new Date(row.opp_created_at || Date.now());
                if (!mostRecentNoteAt || noteDate > mostRecentNoteAt) {
                  mostRecentNote = noteText;
                  mostRecentNoteAt = noteDate;
                }
              }
            });
          }
        }

        items.push({
          opportunityId: row.opportunity_id,
          tenantId: row.tenant_id,
          patientName: resolvedName,
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
           nextFollowUpTurkey: timeDisplayRes.turkeyTime || undefined,
           nextFollowUpPatientLocal: timeDisplayRes.patientLocalTime || undefined,
           patientTimezone: timeDisplayRes.patientTimezone || undefined,
           timezoneNeedsConfirmation: timeDisplayRes.needsTimezoneClarification,
           isPatientSleeping,

          shortSummary,
          aiReason: row.opp_ai_reason || undefined,

          taskId: row.task_id || undefined,
          conversationId: row.conversation_id || undefined,
          leadId: row.lead_id || undefined,

          isTestWhitelist,
          hasBotDelegation: !!row.task_metadata?.bot_delegation,
          hasLeadRawData,
          phoneTaskStatus: row.active_phone_task_status || undefined,
          clinicTaskStatus: row.active_clinic_task_status || undefined,
          mostRecentNote: mostRecentNote || undefined,
        });
      }

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

export async function getPatientTrackingDetail(opportunityId: string, activeTaskId?: string | null): Promise<PatientDetailData | null> {
  if (!opportunityId) return null;

  return withActionGuard(
    { actionName: 'getPatientTrackingDetail' },
    async (ctx) => {
      // Main opportunity query
      const oppQuery = `
        SELECT DISTINCT ON (o.id)
          o.*,
          c.id as conv_id,
          c.patient_name as conv_patient_name,
          c.status as conv_status,
          c.last_message_content,
          c.last_message_at,
          c.phone_number as conv_phone,
          l.id as lead_id,
          l.form_name as lead_form_name,
          l.raw_data as lead_raw_data,
          l.created_at as lead_created_at
        FROM opportunities o
        LEFT JOIN conversations c ON c.phone_number = o.phone_number AND c.tenant_id = o.tenant_id
        LEFT JOIN leads l ON (l.linked_opportunity_id = o.id OR RIGHT(l.phone_number, 10) = RIGHT(o.phone_number, 10)) AND l.tenant_id = o.tenant_id
        WHERE o.id = $1 AND o.tenant_id = $2
        ORDER BY o.id, l.linked_opportunity_id DESC NULLS LAST, l.created_at DESC
        LIMIT 1
      `;
      const oppRows = await ctx.db.executeSafe({ text: oppQuery, values: [opportunityId, ctx.tenantId] }) as any[];
      if (oppRows.length === 0) return null;
      const opp = oppRows[0];

      // Tasks for this opportunity (always include pending/in_progress, and conditionally activeTaskId even if completed)
      let tasksQuery = '';
      const values: any[] = [opportunityId, ctx.tenantId];
      if (activeTaskId) {
        tasksQuery = `
          SELECT id, task_type, title, description, due_at, status, metadata, created_at
          FROM follow_up_tasks
          WHERE opportunity_id = $1 AND tenant_id = $2 AND (status IN ('pending', 'in_progress') OR id = $3)
          ORDER BY due_at ASC
        `;
        values.push(activeTaskId);
      } else {
        tasksQuery = `
          SELECT id, task_type, title, description, due_at, status, metadata, created_at
          FROM follow_up_tasks
          WHERE opportunity_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
          ORDER BY due_at ASC
        `;
      }
      const tasks = await ctx.db.executeSafe({ text: tasksQuery, values }) as any[];

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

      // Last incoming message from patient
      let lastIncomingMessageAt: string | undefined;
      if (opp.conv_id) {
        const inboundRes = await ctx.db.executeSafe({
          text: `SELECT created_at FROM messages 
                 WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in'
                 ORDER BY created_at DESC LIMIT 1`,
          values: [opp.conv_id, ctx.tenantId]
        }) as any[];
        if (inboundRes.length > 0) {
          lastIncomingMessageAt = inboundRes[0].created_at;
        }
      }

      // Media Files query
      const mediaFilesQuery = `
        SELECT id, media_type, media_url, media_metadata, created_at
        FROM messages
        WHERE (conversation_id = $1 OR RIGHT(phone_number, 10) = RIGHT($2, 10))
          AND tenant_id = $3
          AND media_url IS NOT NULL
          AND media_url <> ''
        ORDER BY created_at DESC
      `;
      const mediaFiles = await ctx.db.executeSafe({
        text: mediaFilesQuery,
        values: [opp.conv_id || '', opp.phone_number || '', ctx.tenantId]
      }) as any[];

      // Compute
      const resolvedCountry = opp.country || opp.lead_raw_data?.country || null;
      const leadTask = tasks[0];
      const dueAt = leadTask?.due_at || opp.next_follow_up_at;
      
      const dueTimeRes = resolvePatientTimeDisplay({
        country: resolvedCountry,
        city: opp.lead_raw_data?.city || opp.lead_raw_data?.patient_city || opp.metadata?.patient_city || opp.opp_metadata?.patient_city,
        timezone: opp.metadata?.patient_timezone || opp.opp_metadata?.patient_timezone || opp.timezone,
        phoneNumber: opp.phone_number || null,
        metadata: leadTask?.metadata || opp.metadata,
        oppMetadata: opp.opp_metadata || opp.metadata,
        referenceDate: dueAt
      });

      const liveTimeRes = resolvePatientTimeDisplay({
        country: resolvedCountry,
        city: opp.lead_raw_data?.city || opp.lead_raw_data?.patient_city || opp.metadata?.patient_city || opp.opp_metadata?.patient_city,
        timezone: opp.metadata?.patient_timezone || opp.opp_metadata?.patient_timezone || opp.timezone,
        phoneNumber: opp.phone_number || null,
        metadata: opp.metadata,
        oppMetadata: opp.opp_metadata || opp.metadata,
        referenceDate: new Date()
      });

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

      const turkeyTimeNow = liveTimeRes.turkeyTime;
      const patientLocalTimeNow = liveTimeRes.patientLocalTime || undefined;
      const isPatientSleeping = (() => {
        if (liveTimeRes.patientTimezone && !liveTimeRes.needsTimezoneClarification) {
          try {
            const patientHourStr = new Intl.DateTimeFormat('en-US', {
              timeZone: liveTimeRes.patientTimezone,
              hour: 'numeric',
              hour12: false
            }).format(new Date());
            const hour = parseInt(patientHourStr, 10);
            return hour >= 22 || hour < 8;
          } catch (_) {}
        }
        return false;
      })();

      const isTestWhitelist = !!process.env.TEST_BOT_WHITELIST_NUMBERS &&
        process.env.TEST_BOT_WHITELIST_NUMBERS.split(',').map(s => s.trim()).includes(opp.phone_number || opp.conv_phone);

      const botTask = tasks.find((t: any) => t.metadata?.bot_delegation);

      let notes = [];
      if (opp.notes) {
        if (typeof opp.notes === 'string') {
          try { notes = JSON.parse(opp.notes); } catch (_) {}
        } else {
          notes = opp.notes;
        }
      }

      let leadRawData = null;
      if (opp.lead_raw_data) {
        if (typeof opp.lead_raw_data === 'string') {
          try { leadRawData = JSON.parse(opp.lead_raw_data); } catch (_) {}
        } else {
          leadRawData = opp.lead_raw_data;
        }
      }

      return {
        opportunityId: opp.id,
        patientName: resolvePatientDisplayName({
          manualPatientName: opp.conv_patient_name || opp.patient_name,
          oppPatientName: opp.patient_name,
          convPatientName: opp.conv_patient_name,
          whatsappProfileName: opp.conv_patient_name,
          formPatientName: leadRawData?.patient_name,
        }),
        phoneNumber: opp.phone_number || opp.conv_phone || '',
        country: resolvedCountry || undefined,
        department: opp.department || leadRawData?.department || 'Genel',
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
        nextFollowUpTurkey: dueTimeRes.turkeyTime || undefined,
        nextFollowUpPatientLocal: dueTimeRes.patientLocalTime || undefined,
        patientTimezone: liveTimeRes.patientTimezone || undefined,
        timezoneNeedsConfirmation: liveTimeRes.needsTimezoneClarification,
        isPatientSleeping,
        turkeyTimeNow,
        patientLocalTimeNow,

        leadId: opp.lead_id || undefined,
        leadFormName: opp.lead_form_name || undefined,
        leadRawData,
        leadCreatedAt: opp.lead_created_at || undefined,

        conversationId: opp.conv_id || undefined,
        lastMessageAt: opp.last_message_at || undefined,
        lastIncomingMessageAt: lastIncomingMessageAt || undefined,
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
        mediaFiles: mediaFiles.map((m: any) => ({
          id: m.id,
          mediaType: m.media_type,
          mediaUrl: m.media_url,
          mediaMetadata: typeof m.media_metadata === 'string' ? JSON.parse(m.media_metadata) : (m.media_metadata || {}),
          createdAt: m.created_at
        })),
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

      // Only patient follow-up and appointment tasks (excluding reminder tasks)
      conditions.push(`t.task_type != 'appointment_reminder'`);

      // Filter by primary tasks only (exclude child tasks from appearing as standalone parent rows)
      conditions.push(`t.metadata->>'parent_task_id' IS NULL AND (t.metadata->>'is_primary' IS NULL OR t.metadata->>'is_primary' != 'false')`);

      // Search filter
      if (filters?.search) {
        conditions.push(`(t.title ILIKE $${values.length + 1} OR t.description ILIKE $${values.length + 1} OR o.patient_name ILIKE $${values.length + 1} OR c.patient_name ILIKE $${values.length + 1} OR t.phone_number LIKE $${values.length + 1})`);
        values.push(`%${filters.search}%`);
      }

      // Map status tab filter to database status query to narrow down the dataset
      if (filters?.status && filters.status !== 'all') {
        if (filters.status === 'completed' || filters.status === 'arrived') {
          conditions.push(`t.status = 'completed'`);
        } else if (filters.status === 'cancelled') {
          conditions.push(`(t.status = 'cancelled' OR t.metadata->>'appointment_result' = 'cancelled')`);
        } else if (filters.status === 'no_show') {
          conditions.push(`(t.status = 'completed' OR t.status = 'no_show')`);
        } else if (filters.status === 'no_response') {
          conditions.push(`(t.status IN ('pending', 'in_progress') OR t.metadata->>'confirmation_status' = 'no_response')`);
        } else if (filters.status === 'overdue') {
          conditions.push(`t.status IN ('pending', 'in_progress') AND t.due_at < NOW()`);
        } else {
          // pending, bot_suggestion, confirmed
          conditions.push(`t.status IN ('pending', 'in_progress')`);
        }
      } else {
        if (filters?.completed) {
          conditions.push(`t.status = 'completed'`);
        } else {
          conditions.push(`t.status IN ('pending', 'in_progress')`);
        }
      }

      // Confirmation Status SQL helper
      if (filters?.confirmationStatus && filters.confirmationStatus !== 'all') {
        if (filters.confirmationStatus === 'none') {
            conditions.push(`(t.metadata->>'confirmation_status' IS NULL OR t.metadata->>'confirmation_status' = 'none')`);
        } else {
            conditions.push(`t.metadata->>'confirmation_status' = $${values.length + 1}`);
            values.push(filters.confirmationStatus);
        }
      }

      // Due range SQL helper
      if (filters?.dueRange && filters.dueRange !== 'all') {
        if (filters.dueRange === 'today') conditions.push(`t.due_at::date = CURRENT_DATE`);
        else if (filters.dueRange === 'tomorrow') conditions.push(`t.due_at::date = (CURRENT_DATE + INTERVAL '1 day')::date`);
        else if (filters.dueRange === 'overdue') conditions.push(`t.due_at < NOW()`);
        else if (filters.dueRange === 'week') conditions.push(`t.due_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`);
      }

      // Appointment type SQL helper
      if (filters?.appointmentType && filters.appointmentType !== 'all') {
        if (filters.appointmentType === 'phone_call') {
          conditions.push(`(t.metadata->>'appointment_type' IS NULL OR t.metadata->>'appointment_type' != 'clinic_visit')`);
        } else if (filters.appointmentType === 'clinic_visit') {
          conditions.push(`t.metadata->>'appointment_type' = 'clinic_visit'`);
        }
      }

      // Exclude terminal opportunities unless looking at completed/cancelled tasks
      const isTerminalFilter = filters?.status === 'completed' || 
                               filters?.status === 'cancelled' || 
                               filters?.status === 'arrived' || 
                               filters?.status === 'no_show' || 
                               filters?.status === 'no_response' || 
                               !!filters?.completed;
      if (!isTerminalFilter) {
        conditions.push(`(o.stage IS NULL OR o.stage NOT IN ('not_qualified', 'arrived'))`);
      }

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
          c.patient_name as conv_patient_name,
          o.patient_name as opp_patient_name,
          o.country as opp_country,
          o.department as opp_department,
          o.stage as opp_stage,
          o.priority as opp_priority,
          (
            SELECT EXISTS(
              SELECT 1 FROM follow_up_tasks ft 
              WHERE ft.tenant_id = t.tenant_id 
                AND ft.metadata->>'appointment_type' = 'clinic_visit' 
                AND ft.status != 'cancelled'
                AND (
                  (ft.opportunity_id = t.opportunity_id AND t.opportunity_id IS NOT NULL)
                  OR 
                  (RIGHT(ft.phone_number, 10) = RIGHT(t.phone_number, 10) AND t.phone_number IS NOT NULL AND t.phone_number != '')
                )
            )
          ) as has_clinic_visit
        FROM follow_up_tasks t
        LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
        LEFT JOIN conversations c ON c.phone_number = COALESCE(o.phone_number, t.phone_number) AND c.tenant_id = t.tenant_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.due_at ASC
        LIMIT 100
      `;

      const rows = await ctx.db.executeSafe({ text: query, values }) as any[];

      const items: AppointmentRow[] = rows.map((row: any) => {
        const taskObj = {
          id: row.task_id,
          status: row.task_status,
          due_at: row.due_at,
          task_type: row.task_type,
          title: row.task_title,
          description: row.task_description,
          metadata: typeof row.task_metadata === 'string' 
            ? safeJsonParse(row.task_metadata, {}) 
            : (row.task_metadata || {})
        };

        const proj = buildOperationsTaskProjection(taskObj, row);

        const TYPE_LABELS: Record<string, string> = {
          phone_call: 'Telefon Görüşmesi',
          clinic_visit: 'Klinik Randevusu',
          consultation: 'Ön Görüşme',
          doctor_review: 'Doktor İncelemesi',
          report_followup: 'Rapor Takibi',
        };

        // Map projection status/colors
        let statusColor = 'bg-blue-100 text-blue-700';
        let statusLabel = 'Planlandı';

        if (proj.uiBucket === 'cancelled') {
          statusColor = 'bg-gray-100 text-gray-500'; statusLabel = 'İptal';
        } else if (proj.uiBucket === 'completed') {
          if (row.task_metadata?.appointment_result === 'arrived') {
            statusColor = 'bg-emerald-100 text-emerald-800'; statusLabel = 'Geldi';
          } else {
            statusColor = 'bg-green-100 text-green-700'; statusLabel = 'Tamamlandı';
          }
        } else if (proj.uiBucket === 'unreachable') {
          if (row.task_metadata?.appointment_result === 'no_show') {
            statusColor = 'bg-red-100 text-red-800'; statusLabel = 'Gelmedi';
          } else {
            statusColor = 'bg-amber-100 text-amber-700'; statusLabel = 'Ulaşılamadı';
          }
        } else if (proj.uiBucket === 'overdue') {
          statusColor = 'bg-red-100 text-red-700'; statusLabel = 'Gecikti';
        } else if (proj.uiBucket === 'bot_suggestion_pending') {
          statusColor = 'bg-indigo-100 text-indigo-700'; statusLabel = 'Öneri Bekliyor';
        } else if (proj.uiBucket === 'confirmed') {
          statusColor = 'bg-green-150 text-green-850'; statusLabel = 'Onaylandı';
        } else if (proj.uiBucket === 'scheduled') {
          statusColor = 'bg-blue-100 text-blue-700'; statusLabel = 'Planlandı';
        }

        const resolvedName = resolvePatientDisplayName({
          manualPatientName: row.conv_patient_name || row.opp_patient_name,
          oppPatientName: row.opp_patient_name,
          convPatientName: row.conv_patient_name,
          whatsappProfileName: row.conv_patient_name,
        });

        const resolvedCountry = row.opp_country || null;
        const tzRes = resolvePatientTimezone(resolvedCountry);

        return {
          taskId: row.task_id,
          opportunityId: row.opportunity_id || undefined,
          patientName: resolvedName,
          phoneNumber: row.phone_number || '',
          country: resolvedCountry || undefined,
          department: row.opp_department || undefined,
          priority: row.opp_priority || 'warm',
          hasClinicVisit: !!row.has_clinic_visit,
          appointmentType: proj.appointmentType,
          appointmentTypeLabel: TYPE_LABELS[proj.appointmentType] || proj.appointmentType,
          dueAtUtc: proj.dueAtUtc || undefined,
          dueAtTurkey: proj.dueAtTurkey || undefined,
          dueAtPatientLocal: proj.dueAtPatientLocal || undefined,
          patientTimezone: tzRes.timezone,
          status: proj.uiBucket === 'cancelled' ? 'cancelled' :
                  proj.uiBucket === 'completed' ? 'completed' :
                  proj.uiBucket === 'unreachable' ? 'no_show' :
                  proj.uiBucket === 'overdue' ? 'overdue' : 'planned',
          statusLabel,
          statusColor,
          confirmationStatus: proj.confirmationStatus,
          appointmentResult: row.task_metadata?.appointment_result,
          appointmentNote: row.task_metadata?.note,
          taskTitle: row.task_title || '',
          taskDescription: row.task_description || undefined,
          metadata: {
            ...taskObj.metadata,
            uiBucket: proj.uiBucket,
            timeDisplay: proj.timeDisplay,
            timezoneNeedsClarification: proj.timezoneNeedsClarification,
            rawStatus: row.task_status
          },
        };
      });

      // Filter items to ensure strict mutual-exclusion based on projected uiBucket
      let filtered = items;
      if (filters?.status && filters.status !== 'all') {
        filtered = items.filter(item => {
          const bucket = item.metadata?.uiBucket;
          
          if (filters.status === 'pending') {
            return bucket === 'open' || bucket === 'scheduled';
          }
          if (filters.status === 'bot_suggestion') {
            return bucket === 'bot_suggestion_pending';
          }
          if (filters.status === 'confirmed') {
            return bucket === 'confirmed';
          }
          if (filters.status === 'completed' || filters.status === 'arrived') {
            return bucket === 'completed';
          }
          if (filters.status === 'no_show') {
            if (item.appointmentType === 'clinic_visit') {
              return bucket === 'unreachable' && (item.appointmentResult === 'no_show' || item.metadata?.rawStatus === 'no_show');
            } else {
              return bucket === 'unreachable';
            }
          }
          if (filters.status === 'no_response') {
            return (bucket === 'unreachable' && item.confirmationStatus === 'no_response' && item.appointmentResult !== 'no_show' && item.metadata?.rawStatus !== 'no_show') || bucket === 'overdue';
          }
          if (filters.status === 'overdue') {
            return bucket === 'overdue';
          }
          if (filters.status === 'cancelled') {
            return bucket === 'cancelled';
          }
          return true;
        });
      }

      return { items: filtered, total: filtered.length };
    }
  ).then(res => res.data || { items: [], total: 0 });
}

// ══════════════════════════════════════════
// 5. APPOINTMENT MANAGEMENT ACTIONS (Phase 2T-P0)
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// REMINDER PLANNING UTILITIES (Phase 2U-P0)
// ══════════════════════════════════════════

function calculateReminderTime(
  dueAtUtc: string, 
  type: '30_days_before' | '14_days_before' | '7_days_before' | '5_days_before' | '3_days_before' | '1_day_before' | 'same_day' | 'custom', 
  customTime?: string
): string | null {
  const appointmentDate = new Date(dueAtUtc);
  if (isNaN(appointmentDate.getTime())) return null;

  try {
    // Europe/Istanbul is permanently UTC+3 (no DST).
    // Extract local year, month, and day by adding 3 hours to the UTC date.
    const localMs = appointmentDate.getTime() + (3 * 3600 * 1000);
    const localDate = new Date(localMs);
    
    const year = localDate.getUTCFullYear();
    const month = localDate.getUTCMonth(); // 0-indexed
    const day = localDate.getUTCDate();
    
    const baseDate = new Date(Date.UTC(year, month, day));
    
    if (type === '30_days_before') {
      baseDate.setUTCDate(baseDate.getUTCDate() - 30);
      // Set to 10:00 local time = 07:00 UTC
      return new Date(baseDate.getTime() + (7 * 3600 * 1000)).toISOString();
    } else if (type === '14_days_before') {
      baseDate.setUTCDate(baseDate.getUTCDate() - 14);
      // Set to 10:00 local time = 07:00 UTC
      return new Date(baseDate.getTime() + (7 * 3600 * 1000)).toISOString();
    } else if (type === '7_days_before') {
      baseDate.setUTCDate(baseDate.getUTCDate() - 7);
      // Set to 10:00 local time = 07:00 UTC
      return new Date(baseDate.getTime() + (7 * 3600 * 1000)).toISOString();
    } else if (type === '5_days_before') {
      baseDate.setUTCDate(baseDate.getUTCDate() - 5);
      // Set to 10:00 local time = 07:00 UTC
      return new Date(baseDate.getTime() + (7 * 3600 * 1000)).toISOString();
    } else if (type === '3_days_before') {
      baseDate.setUTCDate(baseDate.getUTCDate() - 3);
      // Set to 10:00 local time = 07:00 UTC
      return new Date(baseDate.getTime() + (7 * 3600 * 1000)).toISOString();
    } else if (type === '1_day_before') {
      baseDate.setUTCDate(baseDate.getUTCDate() - 1);
      // Set to 10:00 local time = 07:00 UTC
      return new Date(baseDate.getTime() + (7 * 3600 * 1000)).toISOString();
    } else if (type === 'same_day') {
      // Set to 09:00 local time = 06:00 UTC
      return new Date(baseDate.getTime() + (6 * 3600 * 1000)).toISOString();
    } else if (type === 'custom' && customTime) {
      return new Date(customTime).toISOString();
    }
  } catch (err) {
    console.error("calculateReminderTime error:", err);
  }
  return null;
}

async function scheduleReminderTasks(
  db: any,
  tenantId: string,
  userId: string,
  opportunityId: string,
  phoneNumber: string,
  parentTaskId: string,
  appointmentType: string,
  scheduledForAppointmentAt: string,
  reminders: { type: '30_days_before' | '14_days_before' | '7_days_before' | '5_days_before' | '3_days_before' | '1_day_before' | 'same_day' | 'custom'; customTime?: string }[]
) {
  const oppRes = await db.executeSafe({
    text: `SELECT country FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    values: [opportunityId, tenantId]
  }) as any[];
  const country = oppRes[0]?.country || null;
  const tzRes = resolvePatientTimezone(country);

  for (const r of reminders) {
    let reminderDueAtUtc = calculateReminderTime(scheduledForAppointmentAt, r.type as any, r.customTime);
    if (!reminderDueAtUtc) continue;

     // Guard: Past or after/at appointment time
    if (new Date(reminderDueAtUtc).getTime() <= Date.now()) {
      continue; // Skip completely if the reminder time has already passed!
    } else if (new Date(reminderDueAtUtc).getTime() >= new Date(scheduledForAppointmentAt).getTime()) {
      continue; // Skip if it falls after/at the appointment itself
    }

    // Idempotency / Duplication Guard
    const existing = await db.executeSafe({
      text: `SELECT id FROM follow_up_tasks 
             WHERE opportunity_id = $1 AND tenant_id = $2 
             AND status = 'pending'
             AND metadata->>'parent_task_id' = $3
             AND metadata->>'reminder_type' = $4
             AND metadata->>'scheduled_for_appointment_at' = $5
             LIMIT 1`,
      values: [opportunityId, tenantId, parentTaskId, r.type, scheduledForAppointmentAt]
    }) as any[];

    if (existing.length > 0) continue;

    // Time calculations for metadata
    let patientLocalTime = 'Bilinmiyor';
    const timezoneWarning = tzRes.needs_confirmation;
    if (tzRes.timezone) {
      try {
        patientLocalTime = new Date(reminderDueAtUtc).toLocaleString('tr-TR', {
          timeZone: tzRes.timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      } catch (_) {}
    }

    let operationDueAtTr = '';
    try {
      operationDueAtTr = new Date(reminderDueAtUtc).toLocaleString('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {}

    const titleMap: Record<string, string> = {
      '30_days_before': '1 Ay Kala Teyit / Hatırlatma',
      '14_days_before': '2 Hafta Kala Teyit / Hatırlatma',
      '7_days_before': '1 Hafta Kala Teyit / Hatırlatma',
      '5_days_before': '5 Gün Önce Teyit / Hatırlatma',
      '3_days_before': '3 Gün Önce Teyit / Hatırlatma',
      '1_day_before': '1 Gün Önce Teyit / Hatırlatma',
      'same_day': 'Aynı Gün Teyit / Hatırlatma',
      'custom': 'Özel Hatırlatma'
    };

    const metadata = {
      parent_task_id: parentTaskId,
      reminder_type: r.type,
      appointment_type: appointmentType,
      zero_outbound_p0: true,
      initiated_from: 'reminder_planner',
      status: 'pending',
      scheduled_for_appointment_at: scheduledForAppointmentAt,
      operation_due_at_tr: operationDueAtTr,
      patient_local_time: patientLocalTime,
      timezone_warning: timezoneWarning,
      generated_draft: null,
      generated_draft_at: null,
      notification_sent_at: null
    };

    const res = await db.executeSafe({
      text: `
        INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, description, status, due_at, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `,
      values: [
        tenantId,
        opportunityId,
        phoneNumber,
        'appointment_reminder',
        titleMap[r.type] || 'Randevu Hatırlatma',
        `Randevu teyit ve hatırlatma görevi (${r.type}).`,
        'pending',
        reminderDueAtUtc,
        JSON.stringify(metadata)
      ]
    }) as any[];

    // outreach_logs
    await db.executeSafe({
      text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
             VALUES ($1, $2, 'appointment_reminder_scheduled', 'system', $3, $4)`,
      values: [
        tenantId,
        opportunityId,
        userId,
        JSON.stringify({
          parent_task_id: parentTaskId,
          reminder_task_id: res[0].id,
          reminder_type: r.type,
          due_at: reminderDueAtUtc,
          zero_outbound_p0: true
        })
      ]
    });
  }
}

// ══════════════════════════════════════════
// 5. APPOINTMENT MANAGEMENT ACTIONS (Phase 2T-P0)
// ══════════════════════════════════════════

export async function createAppointmentTask(
  opportunityId: string, 
  dueAtUtc: string, 
  appointmentType: 'phone_call' | 'clinic_visit' | 'pre_consultation' | 'doctor_review' | 'report_followup',
  options?: { 
    note?: string; 
    requireConfirmation?: boolean;
    reminders?: { type: '30_days_before' | '14_days_before' | '7_days_before' | '5_days_before' | '3_days_before' | '1_day_before' | 'same_day' | 'custom'; customTime?: string }[];
    customMetadata?: Record<string, any>;
  }
) {
  return withActionGuard(
    { actionName: 'createAppointmentTask' },
    async (ctx) => {
      // 1. Duplication Guard (Only block exact duplicate times for this type)
      const existing = await ctx.db.executeSafe({
        text: `SELECT id FROM follow_up_tasks 
               WHERE opportunity_id = $1 AND tenant_id = $2 
               AND status IN ('pending', 'in_progress')
               AND metadata->>'appointment_type' = $3
               AND due_at = $4
               LIMIT 1`,
        values: [opportunityId, ctx.tenantId, appointmentType, dueAtUtc]
      }) as any[];

      if (existing.length > 0) {
        return { success: false, error: 'Bu tarih ve saatte zaten planlanmış bir randevunuz bulunuyor.' };
      }

      // 2. Fetch Lead/Conversation Info for logs
      const oppRes = await ctx.db.executeSafe({
        text: `SELECT phone_number, id, patient_name FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [opportunityId, ctx.tenantId]
      }) as any[];
      if (oppRes.length === 0) return { success: false, error: 'Fırsat bulunamadı.' };
      const opp = oppRes[0];

      let conversationId: string | null = null;
      let leadId: string | null = null;
      try {
        const convRes = await ctx.db.executeSafe({
          text: `SELECT c.id as conv_id, l.id as lead_id 
                 FROM conversations c
                 LEFT JOIN leads l ON l.phone_number = c.phone_number AND l.tenant_id = c.tenant_id
                 WHERE c.tenant_id = $1 AND RIGHT(c.phone_number, 10) = RIGHT($2, 10) 
                 LIMIT 1`,
          values: [ctx.tenantId, opp.phone_number]
        }) as any[];
        if (convRes.length > 0) {
          conversationId = convRes[0].conv_id || null;
          leadId = convRes[0].lead_id || null;
        }
      } catch (_) {}

      const approvedReminders: Record<string, boolean> = {};
      if (options?.reminders) {
        options.reminders.forEach(r => {
          approvedReminders[r.type] = true;
        });
      }

      const metadata = {
        appointment_type: appointmentType,
        note: options?.note || '',
        confirmation_status: options?.requireConfirmation ? 'pending' : 'not_required',
        zero_outbound_p0: true,
        initiated_from: 'appointment_management',
        reminder_drafts: [],
        approved_reminders: approvedReminders,
        ...(options?.customMetadata || {})
      };

      const titleMap: Record<string, string> = {
        phone_call: 'Telefon Görüşmesi',
        clinic_visit: 'Klinik Randevusu',
        pre_consultation: 'Ön Görüşme',
        doctor_review: 'Doktor İncelemesi',
        report_followup: 'Rapor Takibi'
      };

      const res = await ctx.db.executeSafe({
        text: `
          INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, description, status, due_at, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `,
        values: [
          ctx.tenantId,
          opportunityId,
          opp.phone_number,
          'callback_scheduled', // Reuse for compatibility
          titleMap[appointmentType] || 'Randevu',
          options?.note || `${titleMap[appointmentType]} planlandı.`,
          'pending',
          dueAtUtc,
          JSON.stringify(metadata)
        ]
      }) as any[];
      
      const taskId = res[0].id;

      // 3. Write outreach_log
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, $4, 'appointment_scheduled', 'system', $5, $6)`,
        values: [
          ctx.tenantId, leadId, conversationId, opportunityId, ctx.userId,
          JSON.stringify({
            appointment_type: appointmentType,
            task_id: taskId,
            due_at: dueAtUtc,
            initiated_from: 'appointment_management',
            zero_outbound_p0: true
          })
        ]
      });

      // 4. Schedule Reminders: Only schedule approved reminders if passed explicitly
      if (options?.reminders && options.reminders.length > 0) {
        await scheduleReminderTasks(
          ctx.db,
          ctx.tenantId,
          ctx.userId,
          opportunityId,
          opp.phone_number,
          taskId,
          appointmentType,
          dueAtUtc,
          options.reminders
        );
      }

      return { success: true, taskId };
    }
  );
}

export async function rescheduleAppointmentTask(taskId: string, newDueAtUtc: string, note?: string) {
  return withActionGuard(
    { actionName: 'rescheduleAppointmentTask' },
    async (ctx) => {
      const tasks = await ctx.db.executeSafe({
        text: `SELECT due_at, metadata, opportunity_id, phone_number FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
        values: [taskId, ctx.tenantId]
      }) as any[];
      if (tasks.length === 0) return { success: false, error: 'Görev bulunamadı.' };

      const task = tasks[0];
      const oldDueAt = task.due_at;
      const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
      
      metadata.previous_due_at = oldDueAt;
      metadata.reschedule_count = (metadata.reschedule_count || 0) + 1;
      metadata.last_rescheduled_at = new Date().toISOString();
      if (note) metadata.note = note;

      await ctx.db.executeSafe({
        text: `UPDATE follow_up_tasks SET due_at = $1, metadata = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
        values: [newDueAtUtc, JSON.stringify(metadata), taskId, ctx.tenantId]
      });

      // Outreach log for parent reschedule
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, 'appointment_rescheduled', 'system', $3, $4)`,
        values: [
          ctx.tenantId, task.opportunity_id, ctx.userId,
          JSON.stringify({
            appointment_type: metadata.appointment_type,
            task_id: taskId,
            due_at: newDueAtUtc,
            previous_due_at: oldDueAt,
            initiated_from: 'appointment_management',
            zero_outbound_p0: true
          })
        ]
      });

      // Ertelenen randevunun henüz çalışmamış (pending/in_progress) reminder'larını temizle ve yeniden oluştur
      await ctx.db.executeSafe({
        text: `DELETE FROM follow_up_tasks 
               WHERE tenant_id = $1 AND opportunity_id = $2 
                 AND status IN ('pending', 'in_progress')
                 AND task_type = 'appointment_reminder'
                 AND metadata->>'parent_task_id' = $3`,
        values: [ctx.tenantId, task.opportunity_id, taskId]
      });

      if (metadata.appointment_type === 'clinic_visit') {
        let remindersToSchedule: { type: '30_days_before' | '14_days_before' | '7_days_before' | '5_days_before' | '3_days_before' | '1_day_before' | 'same_day' | 'custom'; customTime?: string }[] = [];
        if (metadata.approved_reminders) {
          remindersToSchedule = Object.keys(metadata.approved_reminders)
            .filter(k => metadata.approved_reminders[k])
            .map(k => ({ type: k as any }));
        }

        if (remindersToSchedule.length > 0) {
          await scheduleReminderTasks(
            ctx.db,
            ctx.tenantId,
            ctx.userId,
            task.opportunity_id,
            task.phone_number,
            taskId,
            metadata.appointment_type,
            newDueAtUtc,
            remindersToSchedule
          );
        }
      }

      return { success: true };
    }
  );
}

export async function updateAppointmentConfirmation(taskId: string, status: 'confirmed' | 'declined' | 'no_response' | 'pending', note?: string) {
  return withActionGuard(
    { actionName: 'updateAppointmentConfirmation' },
    async (ctx) => {
      const tasks = await ctx.db.executeSafe({
        text: `SELECT metadata, opportunity_id, due_at FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
        values: [taskId, ctx.tenantId]
      }) as any[];
      if (tasks.length === 0) return { success: false, error: 'Görev bulunamadı.' };

      const task = tasks[0];
      const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
      
      metadata.confirmation_status = status;
      if (status === 'pending') {
        metadata.bot_teyit_sent = false;
        delete metadata.bot_teyit_sent_at;
        metadata.bot_hatirlat_sent = false;
        delete metadata.bot_hatirlat_sent_at;
        metadata.bot_devret_sent = false;
        delete metadata.bot_devret_sent_at;
      }
      if (note) metadata.note = note;

      await ctx.db.executeSafe({
        text: `UPDATE follow_up_tasks SET metadata = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
        values: [JSON.stringify(metadata), taskId, ctx.tenantId]
      });

      // Outreach log action name based on status
      let actionName = 'appointment_confirmed';
      if (status === 'no_response') actionName = 'appointment_no_response';
      else if (status === 'declined') actionName = 'appointment_cancelled';

      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, 'system', $4, $5)`,
        values: [
          ctx.tenantId, task.opportunity_id, actionName, ctx.userId,
          JSON.stringify({
            appointment_type: metadata.appointment_type,
            task_id: taskId,
            confirmation_status: status,
            due_at: task.due_at,
            initiated_from: 'appointment_management',
            zero_outbound_p0: true
          })
        ]
      });

      return { success: true };
    }
  );
}

export async function completeAppointmentTask(taskId: string, result: 'completed' | 'arrived' | 'no_show' | 'cancelled', note?: string) {
  return withActionGuard(
    { actionName: 'completeAppointmentTask' },
    async (ctx) => {
      const tasks = await ctx.db.executeSafe({
        text: `SELECT metadata, opportunity_id, phone_number, due_at FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
        values: [taskId, ctx.tenantId]
      }) as any[];
      if (tasks.length === 0) return { success: false, error: 'Görev bulunamadı.' };

      const task = tasks[0];
      const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
      
      metadata.appointment_result = result;
      if (note) metadata.note = note;

      let taskStatus = 'completed';
      if (result === 'cancelled') taskStatus = 'cancelled';
      else if (result === 'no_show') taskStatus = 'completed'; // We mark it complete but with no_show result

      await ctx.db.executeSafe({
        text: `UPDATE follow_up_tasks SET status = $1, metadata = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
        values: [taskStatus, JSON.stringify(metadata), taskId, ctx.tenantId]
      });

      let actionName = 'appointment_completed';
      if (result === 'arrived') actionName = 'appointment_arrived';
      else if (result === 'no_show') actionName = 'appointment_no_show';
      else if (result === 'cancelled') actionName = 'appointment_cancelled';

      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, 'system', $4, $5)`,
        values: [
          ctx.tenantId, task.opportunity_id, actionName, ctx.userId,
          JSON.stringify({
            appointment_type: metadata.appointment_type,
            task_id: taskId,
            appointment_result: result,
            due_at: task.due_at,
            initiated_from: 'appointment_management',
            zero_outbound_p0: true
          })
        ]
      });

      // If parent task is completed or cancelled, cancel all active reminders
      if (taskStatus === 'completed' || taskStatus === 'cancelled') {
        const activeReminders = await ctx.db.executeSafe({
          text: `SELECT id, metadata FROM follow_up_tasks 
                 WHERE tenant_id = $1 AND opportunity_id = $2 
                   AND status IN ('pending', 'in_progress')
                   AND task_type = 'appointment_reminder'
                   AND metadata->>'parent_task_id' = $3`,
          values: [ctx.tenantId, task.opportunity_id, taskId]
        }) as any[];

        if (activeReminders.length > 0) {
          const reminderIds = activeReminders.map(r => r.id);
          const cancelReason = result === 'cancelled' 
            ? 'parent_appointment_cancelled' 
            : `parent_appointment_${result}`;

          await ctx.db.executeSafe({
            text: `UPDATE follow_up_tasks 
                   SET status = 'cancelled', 
                       skipped_reason = $1,
                       updated_at = NOW()
                   WHERE id = ANY($2) AND tenant_id = $3`,
            values: [cancelReason, reminderIds, ctx.tenantId]
          });

          // Write outreach logs for each cancelled reminder
          for (const rem of activeReminders) {
            const remMeta = typeof rem.metadata === 'string' ? JSON.parse(rem.metadata) : rem.metadata;
            await ctx.db.executeSafe({
              text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
                     VALUES ($1, $2, 'appointment_reminder_cancelled', 'system', $3, $4)`,
              values: [
                ctx.tenantId,
                task.opportunity_id,
                ctx.userId,
                JSON.stringify({
                  parent_task_id: taskId,
                  reminder_task_id: rem.id,
                  reminder_type: remMeta.reminder_type,
                  reason: cancelReason,
                  zero_outbound_p0: true
                })
              ]
            });
          }
        }
      }

      // Integration with UnifiedStageService for terminal states
      if (result === 'arrived' && metadata.appointment_type === 'clinic_visit') {
        try {
          const { UnifiedStageService } = await import('@/lib/services/unified-stage.service');
          await UnifiedStageService.update({
            tenantId: ctx.tenantId,
            source: 'system',
            opportunityId: task.opportunity_id || undefined,
            phoneNumber: task.phone_number,
            targetStage: 'arrived',
            actorId: ctx.userId,
            reason: 'appointment_arrived'
          });
        } catch (_) {}
      }

      return { success: true };
    }
  );
}

export async function getAppointmentStats() {
  return withActionGuard(
    { actionName: 'getAppointmentStats' },
    async (ctx) => {
      const statsQuery = `
        SELECT
          t.id as task_id,
          t.status as task_status,
          t.due_at,
          t.task_type,
          t.title as task_title,
          t.description as task_description,
          t.metadata as task_metadata,
          o.stage as opp_stage
        FROM follow_up_tasks t
        LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1
          AND t.task_type != 'appointment_reminder'
          AND t.metadata->>'parent_task_id' IS NULL
          AND (t.metadata->>'is_primary' IS NULL OR t.metadata->>'is_primary' != 'false')
          AND (t.status IN ('pending', 'in_progress') OR t.updated_at >= NOW() - INTERVAL '30 days')
      `;

      const rows = await ctx.db.executeSafe({ text: statsQuery, values: [ctx.tenantId] }) as any[];
      
      const stats = {
        overdue_phone: 0, overdue_clinic: 0, overdue: 0,
        confirmation_pending_phone: 0, confirmation_pending_clinic: 0, confirmation_pending: 0,
        phone_open: 0, phone_bot_suggestion: 0, phone_confirmed: 0, phone_completed: 0, phone_no_show: 0, phone_cancelled: 0,
        clinic_open: 0, clinic_bot_suggestion: 0, clinic_confirmed: 0, clinic_arrived: 0, clinic_no_show: 0, clinic_no_response: 0, clinic_cancelled: 0
      };

      rows.forEach((row: any) => {
        const taskObj = {
          id: row.task_id,
          status: row.task_status,
          due_at: row.due_at,
          task_type: row.task_type,
          title: row.task_title,
          description: row.task_description,
          metadata: typeof row.task_metadata === 'string' 
            ? safeJsonParse(row.task_metadata, {}) 
            : (row.task_metadata || {})
        };

        const proj = buildOperationsTaskProjection(taskObj, row);
        const isClinic = proj.appointmentType === 'clinic_visit';

        const isTerminal = proj.uiBucket === 'completed' || proj.uiBucket === 'cancelled' || proj.uiBucket === 'unreachable';
        if (!isTerminal && proj.confirmationStatus === 'pending') {
          if (isClinic) {
            stats.confirmation_pending_clinic++;
          } else {
            stats.confirmation_pending_phone++;
          }
        }

        if (isClinic) {
          if (proj.uiBucket === 'cancelled') stats.clinic_cancelled++;
          else if (proj.uiBucket === 'completed') stats.clinic_arrived++;
          else if (proj.uiBucket === 'unreachable') {
            if (taskObj.metadata.appointment_result === 'no_show' || taskObj.status === 'no_show') {
              stats.clinic_no_show++;
            } else {
              stats.clinic_no_response++;
            }
          }
          else if (proj.uiBucket === 'overdue') {
            stats.overdue_clinic++;
            stats.clinic_no_response++; // clinic overdue is counted under ulaşılamadı tab
          }
          else if (proj.uiBucket === 'bot_suggestion_pending') stats.clinic_bot_suggestion++;
          else if (proj.uiBucket === 'confirmed') stats.clinic_confirmed++;
          else if (proj.uiBucket === 'scheduled' || proj.uiBucket === 'open') stats.clinic_open++;
        } else {
          // Phone
          if (proj.uiBucket === 'cancelled') stats.phone_cancelled++;
          else if (proj.uiBucket === 'completed') stats.phone_completed++;
          else if (proj.uiBucket === 'unreachable') stats.phone_no_show++;
          else if (proj.uiBucket === 'overdue') {
            stats.overdue_phone++;
          }
          else if (proj.uiBucket === 'bot_suggestion_pending') stats.phone_bot_suggestion++;
          else if (proj.uiBucket === 'confirmed') stats.phone_confirmed++;
          else if (proj.uiBucket === 'scheduled' || proj.uiBucket === 'open') stats.phone_open++;
        }
      });

      stats.overdue = stats.overdue_phone + stats.overdue_clinic;
      stats.confirmation_pending = stats.confirmation_pending_phone + stats.confirmation_pending_clinic;

      return stats;
    }
  ).then(res => res.data || { 
    overdue_phone: 0, overdue_clinic: 0, overdue: 0,
    confirmation_pending_phone: 0, confirmation_pending_clinic: 0, confirmation_pending: 0,
    phone_open: 0, phone_confirmed: 0, phone_completed: 0, phone_no_show: 0, phone_cancelled: 0,
    clinic_open: 0, clinic_confirmed: 0, clinic_arrived: 0, clinic_no_show: 0, clinic_no_response: 0, clinic_cancelled: 0
  });
}

export async function deletePatientTask(taskId: string) {
  return withActionGuard(
    { actionName: 'deletePatientTask' },
    async (ctx) => {
      // Get opportunity id for outreach logs before deleting
      const taskRes = await ctx.db.executeSafe({
        text: `SELECT opportunity_id, metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [taskId, ctx.tenantId]
      }) as any[];
      
      if (taskRes.length > 0) {
        const task = taskRes[0];
        const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
        
        await ctx.db.executeSafe({
          text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
                 VALUES ($1, $2, 'task_deleted', 'system', $3, $4)`,
          values: [
            ctx.tenantId, task.opportunity_id, ctx.userId,
            JSON.stringify({
              task_id: taskId,
              appointment_type: metadata.appointment_type,
              zero_outbound_p0: true
            })
          ]
        });
      }

      // Delete the task itself
      await ctx.db.executeSafe({
        text: `DELETE FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
        values: [taskId, ctx.tenantId]
      });

      // Also delete any pending reminders of this task
      await ctx.db.executeSafe({
        text: `DELETE FROM follow_up_tasks WHERE tenant_id = $1 AND metadata->>'parent_task_id' = $2`,
        values: [ctx.tenantId, taskId]
      });

      return { success: true };
    }
  );
}

export async function updatePatientTask(
  taskId: string, 
  dueAtUtc: string, 
  description: string, 
  note: string,
  options?: { 
    reminders?: { type: '30_days_before' | '14_days_before' | '7_days_before' | '5_days_before' | '3_days_before' | '1_day_before' | 'same_day' | 'custom'; customTime?: string }[];
    customMetadata?: Record<string, any>;
  }
) {
  return withActionGuard(
    { actionName: 'updatePatientTask' },
    async (ctx) => {
      const taskRes = await ctx.db.executeSafe({
        text: `SELECT opportunity_id, phone_number, metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [taskId, ctx.tenantId]
      }) as any[];

      if (taskRes.length === 0) return { success: false, error: 'Görev bulunamadı.' };
      const task = taskRes[0];
      const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});

      metadata.note = note;
      metadata.last_edited_at = new Date().toISOString();

      if (options?.customMetadata) {
        Object.assign(metadata, options.customMetadata);
      }

      if (options?.reminders) {
        const approvedReminders: Record<string, boolean> = {};
        options.reminders.forEach(r => {
          approvedReminders[r.type] = true;
        });
        metadata.approved_reminders = approvedReminders;
      }

      await ctx.db.executeSafe({
        text: `UPDATE follow_up_tasks 
               SET due_at = $1, description = $2, metadata = $3, updated_at = NOW() 
               WHERE id = $4 AND tenant_id = $5`,
        values: [dueAtUtc, description, JSON.stringify(metadata), taskId, ctx.tenantId]
      });

      // Write outreach log for task edit
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, 'task_updated', 'system', $3, $4)`,
        values: [
          ctx.tenantId, task.opportunity_id, ctx.userId,
          JSON.stringify({
            task_id: taskId,
            appointment_type: metadata.appointment_type,
            due_at: dueAtUtc,
            zero_outbound_p0: true
          })
        ]
      });

      // Cascade update reminders if this is a clinic visit
      if (metadata.appointment_type === 'clinic_visit') {
        // Delete pending reminders of this task
        await ctx.db.executeSafe({
          text: `DELETE FROM follow_up_tasks 
                 WHERE tenant_id = $1 AND opportunity_id = $2 
                   AND status IN ('pending', 'in_progress')
                   AND task_type = 'appointment_reminder'
                   AND metadata->>'parent_task_id' = $3`,
          values: [ctx.tenantId, task.opportunity_id, taskId]
        });

        // Re-schedule reminders based on the new date and approved reminders list
        let remindersToSchedule = options?.reminders;
        if (!remindersToSchedule && metadata.approved_reminders) {
          remindersToSchedule = Object.keys(metadata.approved_reminders)
            .filter(k => metadata.approved_reminders[k])
            .map(k => ({ type: k as any }));
        }

        if (remindersToSchedule && remindersToSchedule.length > 0) {
          await scheduleReminderTasks(
            ctx.db,
            ctx.tenantId,
            ctx.userId,
            task.opportunity_id,
            task.phone_number,
            taskId,
            metadata.appointment_type,
            dueAtUtc,
            remindersToSchedule
          );
        }
      }

      return { success: true };
    }
  );
}

export async function manuallyUpdateAppointmentStatus(
  taskId: string, 
  status: 'pending' | 'completed' | 'cancelled', 
  appointmentResult?: 'completed' | 'arrived' | 'no_show' | 'cancelled' | 'none',
  confirmationStatus?: 'pending' | 'confirmed' | 'declined' | 'no_response' | 'none' | 'overdue'
) {
  return withActionGuard(
    { actionName: 'manuallyUpdateAppointmentStatus' },
    async (ctx) => {
      const tasks = await ctx.db.executeSafe({
        text: `SELECT t.metadata, t.opportunity_id, t.phone_number, t.due_at, o.stage as opp_stage 
               FROM follow_up_tasks t
               LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
               WHERE t.id = $1 AND t.tenant_id = $2`,
        values: [taskId, ctx.tenantId]
      }) as any[];
      if (tasks.length === 0) return { success: false, error: 'Görev bulunamadı.' };

      const task = tasks[0];
      const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});

      // 1. Update confirmation status in metadata
      if (confirmationStatus) {
        if (confirmationStatus === 'none' || confirmationStatus === 'overdue') {
          delete metadata.confirmation_status;
        } else {
          metadata.confirmation_status = confirmationStatus;
        }
      }

      // 2. Update status and result
      let finalStatus = status;
      if (status === 'pending') {
        delete metadata.appointment_result;
        metadata.bot_teyit_sent = false;
        delete metadata.bot_teyit_sent_at;
        metadata.bot_hatirlat_sent = false;
        delete metadata.bot_hatirlat_sent_at;
        metadata.bot_devret_sent = false;
        delete metadata.bot_devret_sent_at;
        
        // Reset opportunity stage if it's currently a terminal stage
        const oppStage = task.opp_stage;
        const terminalStages = ['lost', 'not_qualified', 'arrived', 'not_interested', 'cancelled', 'completed'];
        if (oppStage && terminalStages.includes(oppStage)) {
          const newStage = metadata.appointment_type === 'clinic_visit' ? 'appointment_booked' : 'engaged';
          
          try {
            const { UnifiedStageService } = await import('@/lib/services/unified-stage.service');
            await UnifiedStageService.update({
              tenantId: ctx.tenantId,
              source: 'system',
              opportunityId: task.opportunity_id || undefined,
              phoneNumber: task.phone_number,
              targetStage: newStage,
              actorId: ctx.userId,
              reason: 'appointment_reverted_to_pending'
            });
          } catch (err) {
            // Direct SQL fallback if UnifiedStageService has problems
            await ctx.db.executeSafe({
              text: `UPDATE opportunities SET stage = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
              values: [newStage, task.opportunity_id, ctx.tenantId]
            });
          }
        }

        // Reactivate reminders that were cancelled due to parent completion
        await ctx.db.executeSafe({
          text: `UPDATE follow_up_tasks 
                 SET status = 'pending', skipped_reason = null, updated_at = NOW() 
                 WHERE tenant_id = $1 AND opportunity_id = $2 
                   AND status = 'cancelled'
                   AND task_type = 'appointment_reminder'
                   AND metadata->>'parent_task_id' = $3
                   AND due_at > NOW()`,
          values: [ctx.tenantId, task.opportunity_id, taskId]
        });
      } else if (status === 'completed') {
        metadata.appointment_result = appointmentResult && appointmentResult !== 'none' ? appointmentResult : 'completed';
      } else if (status === 'cancelled') {
        metadata.appointment_result = 'cancelled';
      }

      let finalDueAt = task.due_at;
      if (confirmationStatus === 'overdue') {
        finalDueAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      }

      // 3. Update task row
      await ctx.db.executeSafe({
        text: `UPDATE follow_up_tasks SET status = $1, metadata = $2, due_at = $3, updated_at = NOW() WHERE id = $4 AND tenant_id = $5`,
        values: [finalStatus, JSON.stringify(metadata), finalDueAt, taskId, ctx.tenantId]
      });

      // 4. Cancel active reminders if completed/cancelled
      if (finalStatus === 'completed' || finalStatus === 'cancelled') {
        const activeReminders = await ctx.db.executeSafe({
          text: `SELECT id, metadata FROM follow_up_tasks 
                 WHERE tenant_id = $1 AND opportunity_id = $2 
                   AND status IN ('pending', 'in_progress')
                   AND task_type = 'appointment_reminder'
                   AND metadata->>'parent_task_id' = $3`,
          values: [ctx.tenantId, task.opportunity_id, taskId]
        }) as any[];

        if (activeReminders.length > 0) {
          const reminderIds = activeReminders.map(r => r.id);
          const cancelReason = finalStatus === 'cancelled' 
            ? 'parent_appointment_cancelled' 
            : `parent_appointment_${metadata.appointment_result || 'completed'}`;

          await ctx.db.executeSafe({
            text: `UPDATE follow_up_tasks 
                   SET status = 'cancelled', 
                       skipped_reason = $1,
                       updated_at = NOW()
                   WHERE id = ANY($2) AND tenant_id = $3`,
            values: [cancelReason, reminderIds, ctx.tenantId]
          });
        }
      }

      // 5. Audit Log (Outreach)
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, 'appointment_status_manually_updated', 'system', $3, $4)`,
        values: [
          ctx.tenantId, task.opportunity_id, ctx.userId,
          JSON.stringify({
            appointment_type: metadata.appointment_type,
            task_id: taskId,
            status: finalStatus,
            appointment_result: metadata.appointment_result,
            confirmation_status: metadata.confirmation_status,
            due_at: task.due_at,
            initiated_from: 'manual_update',
            zero_outbound_p0: true
          })
        ]
      });

      return { success: true };
    }
  );
}

export async function recordAppointmentReminder(taskId: string) {
  return withActionGuard(
    { actionName: 'recordAppointmentReminder' },
    async (ctx) => {
      const tasks = await ctx.db.executeSafe({
        text: `SELECT metadata, opportunity_id FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
        values: [taskId, ctx.tenantId]
      }) as any[];
      if (tasks.length === 0) return { success: false, error: 'Görev bulunamadı.' };

      const task = tasks[0];
      const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});

      metadata.last_manual_reminder_at = new Date().toISOString();

      await ctx.db.executeSafe({
        text: `UPDATE follow_up_tasks SET metadata = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
        values: [JSON.stringify(metadata), taskId, ctx.tenantId]
      });

      return { success: true };
    }
  );
}

export async function recordBotDirectiveSent(taskId: string, type: 'teyit' | 'hatirlat' | 'devret') {
  return withActionGuard(
    { actionName: 'recordBotDirectiveSent' },
    async (ctx) => {
      const tasks = await ctx.db.executeSafe({
        text: `SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
        values: [taskId, ctx.tenantId]
      }) as any[];
      if (tasks.length === 0) return { success: false, error: 'Görev bulunamadı.' };

      const task = tasks[0];
      const metadata = task.metadata || {};
      const directiveText = metadata.active_bot_directive || (
        type === 'teyit' ? 'Hastanın randevu/arama zamanını teyit et.' :
        type === 'hatirlat' ? 'Hastaya planlanan arama/randevu vaktini hatırlat.' :
        'Hastadan arama veya klinik ön görüşmesi için uygun gün ve saat bilgisini öğren.'
      );

      let directiveType: 'ask_callback_time' | 'confirm_callback_time' | 'remind_callback' | 'ask_clinic_appointment_time' | 'confirm_clinic_appointment' | 'request_documents' = 'ask_callback_time';
      
      const apptType = metadata.appointment_type;
      if (type === 'teyit') {
        directiveType = apptType === 'clinic_visit' ? 'confirm_clinic_appointment' : 'confirm_callback_time';
      } else if (type === 'hatirlat') {
        directiveType = 'remind_callback';
      } else if (type === 'devret') {
        directiveType = apptType === 'clinic_visit' ? 'ask_clinic_appointment_time' : 'ask_callback_time';
      }

      const { PatientOperationsLifecycleService } = await import('@/lib/services/patient-operations-lifecycle');
      const lifecycleService = new PatientOperationsLifecycleService(ctx.db);
      await lifecycleService.setBotDirective({
        taskId,
        tenantId: ctx.tenantId,
        directiveType,
        directiveText,
        userId: ctx.userId,
        sourceUi: 'phone_tracking'
      });

      return { success: true };
    }
  );
}

export async function approveBotSuggestion(taskId: string, proposedDate?: string) {
  return withActionGuard(
    { actionName: 'approveBotSuggestion' },
    async (ctx) => {
      const tasks = await ctx.db.executeSafe({
        text: `SELECT metadata, opportunity_id, conversation_id FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
        values: [taskId, ctx.tenantId]
      }) as any[];
      if (tasks.length === 0) return { success: false, error: 'Görev bulunamadı.' };

      const task = tasks[0];
      const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});

      // 1. Update suggestion status
      if (metadata.bot_suggestion) {
        metadata.bot_suggestion.status = 'approved';
        metadata.bot_suggestion.approved_at = new Date().toISOString();
      }

      // 2. Clear bot delegation flags
      metadata.bot_teyit_sent = false;
      metadata.bot_hatirlat_sent = false;
      metadata.bot_devret_sent = false;
      delete metadata.bot_teyit_sent_at;
      delete metadata.bot_hatirlat_sent_at;
      delete metadata.bot_devret_sent_at;

      // 3. Reschedule and confirm status
      metadata.confirmation_status = 'confirmed';
      metadata.confirmed = true;

      const targetDate = (proposedDate && proposedDate.trim().length > 0) ? proposedDate : null;

      await ctx.db.executeSafe({
        text: `UPDATE follow_up_tasks 
               SET due_at = COALESCE($1::timestamp with time zone, due_at), status = 'pending', metadata = $2, updated_at = NOW() 
               WHERE id = $3 AND tenant_id = $4`,
        values: [targetDate, JSON.stringify(metadata), taskId, ctx.tenantId]
      });

      // 4. Log successful approval to outreach logs
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, conversation_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, 'bot_suggestion_approved', 'system', $4, $5::jsonb)`,
        values: [
          ctx.tenantId,
          task.opportunity_id || null,
          task.conversation_id || null,
          ctx.userId,
          JSON.stringify({
            task_id: taskId,
            approved_date: proposedDate,
            approved_at: new Date().toISOString()
          })
        ]
      });

      return { success: true };
    }
  );
}

export async function rejectBotSuggestion(taskId: string) {
  return withActionGuard(
    { actionName: 'rejectBotSuggestion' },
    async (ctx) => {
      const tasks = await ctx.db.executeSafe({
        text: `SELECT metadata, opportunity_id, conversation_id FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
        values: [taskId, ctx.tenantId]
      }) as any[];
      if (tasks.length === 0) return { success: false, error: 'Görev bulunamadı.' };

      const task = tasks[0];
      const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});

      // 1. Update suggestion status
      if (metadata.bot_suggestion) {
        metadata.bot_suggestion.status = 'rejected';
        metadata.bot_suggestion.rejected_at = new Date().toISOString();
      }

      await ctx.db.executeSafe({
        text: `UPDATE follow_up_tasks SET metadata = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
        values: [JSON.stringify(metadata), taskId, ctx.tenantId]
      });

      // 2. Log rejection to outreach logs
      await ctx.db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, conversation_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, 'bot_suggestion_rejected', 'system', $4, $5::jsonb)`,
        values: [
          ctx.tenantId,
          task.opportunity_id || null,
          task.conversation_id || null,
          ctx.userId,
          JSON.stringify({
            task_id: taskId,
            rejected_at: new Date().toISOString()
          })
        ]
      });

      return { success: true };
    }
  );
}





