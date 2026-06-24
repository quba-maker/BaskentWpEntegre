/**
 * PHASE 2K-P1.1: Signal Aggregation Engine
 * 
 * Collects all CRM signals from a single extraction cycle and produces:
 * - ONE primary task (with all signals in metadata)
 * - ONE primary notification (with aggregated body)
 * 
 * Aggregation scope: message_cycle (P1.1)
 * Time-window aggregation: planned for P1.2 via metadata.aggregation_scope
 * 
 * Task Precedence (highest → lowest):
 * 1. explicit_human_escalation / bot_error
 * 2. appointment_request → appointment_followup
 * 3. callback_requested → callback_scheduled
 * 4. report_sent → doctor_review_pending
 * 5. report_waiting → send_report_reminder
 * 6. standalone hot_lead / requires_human → coordinator_review
 * 
 * Notification Category Precedence (highest → lowest):
 * 1. system_alert / bot_error
 * 2. human_escalation
 * 3. appointment_request
 * 4. callback_requested
 * 5. report_received
 * 6. overdue_task
 * 7. no_response
 * 8. hot_lead
 */

import { cleanString, safeName, formatHumanDate } from './sanitizers';
import type { TaskType } from './task.service';
import type { NotificationCategory, NotificationPriority } from './notification.service';
import { computeTimeMetadata } from '../utils/timezone';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export type TaskGroup = 
  | 'appointment_followup'
  | 'callback_followup'
  | 'doctor_review'
  | 'report_followup'
  | 'coordinator_review';

export interface AggregatedSignal {
  /** Detected signals from CRM extraction */
  signals: string[];
  
  /** Primary task type to create */
  primaryTaskType: TaskType;
  
  /** Task group for dedup */
  primaryTaskGroup: TaskGroup;
  
  /** Primary notification category */
  primaryNotifCategory: NotificationCategory;
  
  /** Task title (null-safe, formatted) */
  taskTitle: string;
  
  /** Task description (aggregated, null-safe) */
  taskDescription: string;
  
  /** Notification title */
  notifTitle: string;
  
  /** Notification body (aggregated, null-safe) */
  notifBody: string;
  
  /** Priority */
  priority: NotificationPriority;
  
  /** Due date ISO string */
  dueAt: string;
  
  /** Aggregation metadata for P1.2 readiness */
  metadata: {
    aggregation_scope: 'message_cycle';
    signals: string[];
    primary_category: string;
    primary_task_group: TaskGroup;
    source_message_id?: string;
    merged_count: number;
    patient_name?: string;
    department?: string;
    country?: string;
    callback_datetime?: string;
  };
}

export interface SignalInput {
  patientName?: string | null;
  phoneNumber: string;
  department?: string | null;
  country?: string | null;
  sourceMessageId?: string;
}

// ═══════════════════════════════════════════════════════════
// SIGNAL LABELS (for description building)
// ═══════════════════════════════════════════════════════════

const SIGNAL_LABELS: Record<string, string> = {
  appointment_request: 'randevu talebi',
  callback_requested: 'arama/telefon görüşmesi talebi',
  hot_lead: 'sıcak fırsat',
  report_sent: 'belge/rapor gönderdi',
  report_waiting: 'rapor bekleniyor',
  requires_human: 'insan onayı gerekiyor',
  human_escalation: 'insan müdahalesi gerekli',
};

// ═══════════════════════════════════════════════════════════
// NOTIFICATION CATEGORY TITLES
// ═══════════════════════════════════════════════════════════

const NOTIF_TITLES: Record<string, string> = {
  appointment_request: '📅 Randevu Talebi',
  callback_requested: '📞 Hasta Aranmak İstiyor',
  hot_lead: '🔥 Yeni Sıcak Fırsat',
  report_received: '📄 Rapor/Belge Alındı',
  human_escalation: '🚨 İnsan Müdahalesi Gerekli',
  system_alert: '⚙️ Sistem Uyarısı',
  coordinator_action: '👤 Koordinatör Aksiyonu',
};

// ═══════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════

export class SignalAggregator {

  /**
   * Aggregates all CRM signals into a single task + notification output.
   * Returns null if no actionable signal is detected.
   */
  aggregate(crmData: any, input: SignalInput): AggregatedSignal | null {
    if (!crmData) return null;

    // ── 1. Collect all active signals ──
    const signals: string[] = [];

    // Human escalation (true escalation, not just requires_human_confirmation)
    if (crmData.explicit_human_escalation || crmData.bot_error) {
      signals.push('human_escalation');
    }

    // Appointment request
    if (crmData.intent_type === 'appointment_request') {
      signals.push('appointment_request');
    }

    // Callback requested
    if (cleanString(crmData.requested_callback_datetime)) {
      signals.push('callback_requested');
    }

    // Report sent (doctor review needed)
    if (crmData.report_status === 'sent') {
      signals.push('report_sent');
    }

    // Report waiting
    if (crmData.report_status === 'waiting') {
      signals.push('report_waiting');
    }

    // Hot lead
    if (crmData.opportunity_priority === 'hot') {
      signals.push('hot_lead');
    }

    // Requires human confirmation (generic — lowest priority, never overrides above)
    if (crmData.requires_human_confirmation && signals.length === 0) {
      signals.push('requires_human');
    }

    // No actionable signals
    if (signals.length === 0) return null;

    // ── 2. Determine primary task ──
    const { taskType, taskGroup } = this.resolveTaskPrimary(signals);

    // ── 3. Determine primary notification category ──
    const notifCategory = this.resolveNotifPrimary(signals);

    // ── 4. Build sanitized content ──
    const name = safeName(input.patientName, input.phoneNumber);
    const dept = cleanString(input.department) || '';
    const callbackDt = cleanString(crmData.requested_callback_datetime) || null;
    const country = cleanString(input.country) || '';
    const taskTitle = this.buildTaskTitle(taskGroup, name);

    // Due date: callback datetime → 1h from now → 2h from now
    const dueAt = this.resolveDueAt(signals, callbackDt);

    // Resolve callback timezone metadata
    const timeMeta = computeTimeMetadata(
      callbackDt,
      input.country,
      crmData.patient_city,
      {
        needs_timezone_clarification: crmData.needs_timezone_clarification,
        timezone_source: crmData.timezone_source,
        time_confirmed_by_patient: crmData.time_confirmed_by_patient,
        patient_timezone: crmData.patient_timezone
      }
    );

    // Task description
    const taskDescription = this.buildTaskDescription(signals, name, dept, callbackDt, timeMeta);

    // Notification title + body
    const notifTitle = NOTIF_TITLES[notifCategory] || '🔔 Bildirim';
    const notifBody = this.buildNotifBody(signals, notifCategory, name, dept, country, callbackDt, timeMeta);

    // Priority
    const priority = this.resolvePriority(signals);

    return {
      signals,
      primaryTaskType: taskType,
      primaryTaskGroup: taskGroup,
      primaryNotifCategory: notifCategory,
      taskTitle,
      taskDescription,
      notifTitle,
      notifBody,
      priority,
      dueAt,
      metadata: {
        aggregation_scope: 'message_cycle',
        signals,
        primary_category: notifCategory,
        primary_task_group: taskGroup,
        source_message_id: input.sourceMessageId,
        merged_count: signals.length,
        patient_name: cleanString(input.patientName) || undefined,
        department: cleanString(input.department) || undefined,
        country: cleanString(input.country) || undefined,
        callback_datetime: callbackDt || undefined,
        ...(timeMeta || {})
      },
    };
  }

  // ── Task Primary Resolution ──
  private resolveTaskPrimary(signals: string[]): { taskType: TaskType; taskGroup: TaskGroup } {
    // Precedence order (user-approved):
    // 1. human_escalation → coordinator_review
    if (signals.includes('human_escalation')) {
      return { taskType: 'coordinator_review', taskGroup: 'coordinator_review' };
    }
    // 2. appointment_request → coordinator_review (appointment context)
    if (signals.includes('appointment_request')) {
      return { taskType: 'coordinator_review', taskGroup: 'appointment_followup' };
    }
    // 3. callback_requested → callback_scheduled
    if (signals.includes('callback_requested')) {
      return { taskType: 'callback_scheduled', taskGroup: 'callback_followup' };
    }
    // 4. report_sent → doctor_review_pending
    if (signals.includes('report_sent')) {
      return { taskType: 'doctor_review_pending', taskGroup: 'doctor_review' };
    }
    // 5. report_waiting → send_report_reminder
    if (signals.includes('report_waiting')) {
      return { taskType: 'send_report_reminder', taskGroup: 'report_followup' };
    }
    // 6. standalone hot_lead or requires_human → coordinator_review
    return { taskType: 'coordinator_review', taskGroup: 'coordinator_review' };
  }

  // ── Notification Category Resolution ──
  private resolveNotifPrimary(signals: string[]): NotificationCategory {
    // Precedence order (user-approved):
    if (signals.includes('human_escalation')) return 'human_escalation';
    if (signals.includes('appointment_request')) return 'appointment_request';
    if (signals.includes('callback_requested')) return 'callback_requested';
    if (signals.includes('report_sent')) return 'report_received';
    if (signals.includes('report_waiting')) return 'report_received';
    if (signals.includes('hot_lead')) return 'hot_lead';
    return 'coordinator_action';
  }

  // ── Task Title Builder ──
  private buildTaskTitle(group: TaskGroup, name: string): string {
    switch (group) {
      case 'appointment_followup':
        return `📅 Randevu / Telefon Görüşmesi Takibi — ${name}`;
      case 'callback_followup':
        return `📞 Geri Arama Takibi — ${name}`;
      case 'doctor_review':
        return `🩺 Doktor İnceleme — ${name}`;
      case 'report_followup':
        return `📄 Rapor Takibi — ${name}`;
      case 'coordinator_review':
        return `🔍 Koordinatör İncelemesi — ${name}`;
      default:
        return `📌 Görev — ${name}`;
    }
  }

  // ── Task Description Builder ──
  private buildTaskDescription(
    signals: string[], 
    name: string, 
    dept: string, 
    callbackDt: string | null,
    timeMeta: any | null
  ): string {
    const parts: string[] = [];

    // Primary action
    if (signals.includes('appointment_request')) {
      parts.push(dept
        ? `${name}, ${dept} bölümü için randevu talep ediyor.`
        : `${name}, bölüm bilgisi netleşmemiş randevu talep ediyor.`);
    } else if (signals.includes('callback_requested')) {
      if (callbackDt) {
        let timeStr = formatHumanDate(callbackDt);
        if (timeMeta && timeMeta.patient_local_time && timeMeta.callback_time_tr) {
          const tzLabel = timeMeta.patient_timezone ? timeMeta.patient_timezone.split('/').pop()?.replace('_', ' ') : 'Yerel';
          timeStr = `${timeMeta.callback_time_tr} TS (Türkiye) / ${timeMeta.patient_local_time} ${tzLabel}`;
        }
        parts.push(`${name} aranmak istiyor. Tercih edilen zaman: ${timeStr}.`);
      } else {
        parts.push(`${name} aranmak istiyor. Arama zamanı teyidi gerekiyor.`);
      }
      if (timeMeta?.needs_timezone_clarification) {
        parts.push(`UYARI: Saat dilimi belirsiz; şehir/eyalet teyidi gerekiyor.`);
      }
      if (timeMeta?.operation_window_valid === false) {
        parts.push(`UYARI: Talep edilen saat Türkiye operasyon saati dışında!`);
      }
    } else if (signals.includes('report_sent')) {
      parts.push(`${name} rapor/belge gönderdi, doktor incelemesi bekleniyor.`);
    } else if (signals.includes('report_waiting')) {
      parts.push(`${name} rapor/belge göndereceğini belirtti, takip gerekiyor.`);
    } else if (signals.includes('human_escalation')) {
      parts.push(`${name} için insan müdahalesi gerekiyor.`);
    } else if (signals.includes('hot_lead')) {
      parts.push(dept
        ? `${name}, ${dept} hakkında ciddi ilgi gösteriyor — sıcak fırsat.`
        : `${name}, sağlık talebi hakkında ciddi ilgi gösteriyor — sıcak fırsat.`);
    } else {
      parts.push(`${name} için koordinatör incelemesi gerekiyor.`);
    }

    // Secondary signals
    const secondaryLabels = signals
      .filter(s => !this.isPrimarySignal(s, signals))
      .map(s => SIGNAL_LABELS[s])
      .filter(Boolean);
    
    if (secondaryLabels.length > 0) {
      parts.push(`Ek sinyaller: ${secondaryLabels.join(', ')}.`);
    }

    return parts.join(' ');
  }

  private isPrimarySignal(signal: string, allSignals: string[]): boolean {
    // The first signal that matches precedence is primary
    const precedence = ['human_escalation', 'appointment_request', 'callback_requested', 'report_sent', 'report_waiting', 'hot_lead', 'requires_human'];
    for (const p of precedence) {
      if (allSignals.includes(p)) return p === signal;
    }
    return false;
  }

  // ── Notification Body Builder ──
  private buildNotifBody(
    signals: string[],
    _primaryCategory: NotificationCategory,
    name: string,
    dept: string,
    country: string,
    callbackDt: string | null,
    timeMeta: any | null
  ): string {
    const parts: string[] = [];
    
    // Primary info
    const location = [dept, country].filter(Boolean).join(' — ');
    parts.push(`${name}${location ? ` — ${location}` : ''}`);

    // Callback time (human readable)
    if (signals.includes('callback_requested') && callbackDt) {
      let timeStr = formatHumanDate(callbackDt);
      if (timeMeta && timeMeta.patient_local_time && timeMeta.callback_time_tr) {
        const tzLabel = timeMeta.patient_timezone ? timeMeta.patient_timezone.split('/').pop()?.replace('_', ' ') : 'Yerel';
        timeStr = `${timeMeta.callback_time_tr} TR / ${timeMeta.patient_local_time} ${tzLabel}`;
      }
      parts.push(`Tercih edilen arama: ${timeStr}`);
    }

    // Extra signals summary
    const extraLabels = signals
      .filter(s => !this.isPrimarySignal(s, signals))
      .map(s => SIGNAL_LABELS[s])
      .filter(Boolean);
    
    if (extraLabels.length > 0) {
      parts.push(`Ek: ${extraLabels.join(', ')}`);
    }

    return parts.join('. ').replace(/\.\./g, '.').trim();
  }

  // ── Priority Resolution ──
  private resolvePriority(signals: string[]): NotificationPriority {
    if (signals.includes('human_escalation')) return 'critical';
    if (signals.includes('appointment_request')) return 'high';
    if (signals.includes('callback_requested')) return 'high';
    if (signals.includes('hot_lead')) return 'high';
    if (signals.includes('report_sent')) return 'normal';
    return 'normal';
  }

  // ── Due Date Resolution ──
  private resolveDueAt(signals: string[], callbackDt?: string | null): string {
    // If callback datetime is specified and valid, use it
    if (callbackDt) {
      const d = new Date(callbackDt);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    // Human escalation: 30 min
    if (signals.includes('human_escalation')) {
      return new Date(Date.now() + 30 * 60 * 1000).toISOString();
    }
    // Appointment: 1 hour
    if (signals.includes('appointment_request')) {
      return new Date(Date.now() + 1 * 3600 * 1000).toISOString();
    }
    // Callback (no exact time): 2 hours
    if (signals.includes('callback_requested')) {
      return new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    }
    // Report: 24 hours
    if (signals.includes('report_sent')) {
      return new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    }
    // Default: 2 hours
    return new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  }
}
