export type CanonicalFollowUpLane =
  | 'phone_followup'
  | 'clinic_appointment'
  | 'reply_followup'
  | 'human_review'
  | 'document_followup'
  | 'reminder'
  | 'other';

export type CanonicalFollowUpState =
  | 'open'
  | 'scheduled'
  | 'confirmed'
  | 'due_today'
  | 'overdue'
  | 'waiting_reply'
  | 'needs_template'
  | 'completed'
  | 'cancelled'
  | 'unreachable';

export type CanonicalAppointmentType =
  | 'phone_call'
  | 'clinic_visit'
  | 'consultation'
  | 'doctor_review'
  | 'report_followup';

export type CanonicalNextAction =
  | 'no_action'
  | 'call_now'
  | 'delegate_unreachable_followup_to_bot'
  | 'request_report'
  | 'doctor_review_needed'
  | 'call_today'
  | 'prepare_followup_draft'
  | 'scheduled_followup'
  | 'continue_appointment_planning'
  | 'review_required';

export interface CanonicalFollowUpInput {
  taskType?: string | null;
  status?: string | null;
  dueAt?: string | Date | null;
  metadata?: any;
  oppStage?: string | null;
  oppIntentType?: string | null;
  convStatus?: string | null;
  lastOutreachAction?: string | null;
  now?: Date;
}

export interface CanonicalFollowUp {
  lane: CanonicalFollowUpLane;
  state: CanonicalFollowUpState;
  appointmentType: CanonicalAppointmentType;
  categoryLabel: string;
  displayLabel: string;
  journeyStatus: string;
  nextBestAction: CanonicalNextAction;
  actionLabel: string;
  actionColorClass: string;
  priorityBoost: number;
  isPhone: boolean;
  isClinic: boolean;
  isReplyFollowUp: boolean;
  isDocumentFollowUp: boolean;
  isHumanReview: boolean;
  isReminder: boolean;
  isTerminal: boolean;
  isOverdue: boolean;
  isDueToday: boolean;
  confirmationStatus: 'pending' | 'confirmed' | 'declined' | 'no_response' | 'none';
  uiBucket: 'bot_suggestion_pending' | 'open' | 'scheduled' | 'confirmed' | 'overdue' | 'completed' | 'unreachable' | 'cancelled';
}

function safeMetadata(metadata: any): Record<string, any> {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) || {};
    } catch {
      return {};
    }
  }
  if (typeof metadata === 'object') return metadata;
  return {};
}

function normalizeAppointmentType(value: any): string | null {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'clinic' || normalized === 'clinic_visit' || normalized === 'hospital_visit') return 'clinic_visit';
  if (normalized === 'phone' || normalized === 'phone_call' || normalized === 'callback') return 'phone_call';
  if (normalized === 'pre_consultation' || normalized === 'consultation') return 'consultation';
  if (normalized === 'doctor_review') return 'doctor_review';
  if (normalized === 'report_followup' || normalized === 'report') return 'report_followup';
  return normalized;
}

function hasSignal(metadata: Record<string, any>, signal: string): boolean {
  const signals = metadata.signals;
  return Array.isArray(signals) && signals.includes(signal);
}

function parseDue(dueAt?: string | Date | null): Date | null {
  if (!dueAt) return null;
  const date = dueAt instanceof Date ? dueAt : new Date(dueAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ymdInIstanbul(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function resolveLane(input: Required<Pick<CanonicalFollowUpInput, 'taskType' | 'oppIntentType' | 'convStatus' | 'lastOutreachAction'>> & { metadata: Record<string, any> }): CanonicalFollowUpLane {
  const type = input.taskType || '';
  const appointmentType = normalizeAppointmentType(input.metadata.appointment_type || input.metadata.appointmentType);

  if (type === 'template_required_task' || type === 'no_reply_followup' || type === 'follow_up_no_response') {
    return 'reply_followup';
  }

  if (type === 'bot_handoff_followup' || type === 'internal_bot_directive' || type === 'bot_steering_only') {
    return 'human_review';
  }

  if (type === 'send_report_reminder' || type === 'missing_info' || type === 'form_missing' || type === 'report_request') {
    return 'document_followup';
  }

  if (type === 'doctor_review_pending') {
    return 'document_followup';
  }

  if (appointmentType === 'clinic_visit') return 'clinic_appointment';
  if (appointmentType === 'phone_call') return 'phone_followup';
  if (appointmentType === 'consultation') return 'phone_followup';
  if (appointmentType === 'doctor_review' || appointmentType === 'report_followup') return 'document_followup';

  if (type === 'appointment_reminder' || type === 'date_pending_followup' || type === 'follow_up_reminder' || type === 'callback_reminder') {
    return 'reminder';
  }

  if (type === 'callback_scheduled' || type === 'call_patient' || input.lastOutreachAction === 'callback_scheduled') {
    return 'phone_followup';
  }

  if (
    type === 'coordinator_review' &&
    (input.oppIntentType === 'appointment_request' || hasSignal(input.metadata, 'appointment_request') || input.metadata.appointment_context)
  ) {
    return 'clinic_appointment';
  }

  if (type === 'coordinator_review' || type === 'travel_planning' || type === 'payment_follow_up') {
    return 'human_review';
  }

  if (input.convStatus === 'bot' || input.convStatus === 'handoff') return 'reply_followup';

  return 'other';
}

function resolveAppointmentType(lane: CanonicalFollowUpLane, taskType: string, metadata: Record<string, any>): CanonicalAppointmentType {
  const explicit = normalizeAppointmentType(metadata.appointment_type || metadata.appointmentType);
  if (explicit === 'clinic_visit') return 'clinic_visit';
  if (explicit === 'consultation') return 'consultation';
  if (explicit === 'doctor_review') return 'doctor_review';
  if (explicit === 'report_followup') return 'report_followup';
  if (explicit === 'phone_call') return 'phone_call';
  if (lane === 'clinic_appointment') return 'clinic_visit';
  if (taskType === 'doctor_review_pending') return 'doctor_review';
  if (lane === 'document_followup') return 'report_followup';
  return 'phone_call';
}

function resolveState(input: CanonicalFollowUpInput, lane: CanonicalFollowUpLane, metadata: Record<string, any>): {
  state: CanonicalFollowUpState;
  isOverdue: boolean;
  isDueToday: boolean;
  confirmationStatus: CanonicalFollowUp['confirmationStatus'];
} {
  const status = input.status || 'pending';
  const confirmationStatus = (metadata.confirmation_status || metadata.confirmationStatus || 'none') as CanonicalFollowUp['confirmationStatus'];
  const dueDate = parseDue(input.dueAt);
  const now = input.now || new Date();
  const isOverdue = !!dueDate && dueDate.getTime() < now.getTime();
  const isDueToday = !!dueDate && ymdInIstanbul(dueDate) === ymdInIstanbul(now);

  if (status === 'cancelled' || metadata.appointment_result === 'cancelled') {
    return { state: 'cancelled', isOverdue, isDueToday, confirmationStatus };
  }
  if (status === 'completed') {
    if (metadata.appointment_result === 'no_show') {
      return { state: 'unreachable', isOverdue, isDueToday, confirmationStatus };
    }
    return { state: 'completed', isOverdue, isDueToday, confirmationStatus };
  }
  if (status === 'no_show' || metadata.appointment_result === 'no_show' || confirmationStatus === 'no_response') {
    return { state: 'unreachable', isOverdue, isDueToday, confirmationStatus };
  }
  if (input.taskType === 'template_required_task') {
    return { state: 'needs_template', isOverdue, isDueToday, confirmationStatus };
  }
  if (
    confirmationStatus === 'pending' ||
    metadata.bot_suggestion?.status === 'pending' ||
    input.taskType === 'bot_handoff_followup' ||
    (lane === 'reply_followup' && (input.convStatus === 'bot' || input.convStatus === 'handoff'))
  ) {
    return { state: 'waiting_reply', isOverdue, isDueToday, confirmationStatus };
  }
  if (confirmationStatus === 'confirmed') {
    return { state: 'confirmed', isOverdue, isDueToday, confirmationStatus };
  }
  if (isOverdue) return { state: 'overdue', isOverdue, isDueToday, confirmationStatus };
  if (isDueToday) return { state: 'due_today', isOverdue, isDueToday, confirmationStatus };
  if (dueDate) return { state: 'scheduled', isOverdue, isDueToday, confirmationStatus };
  return { state: 'open', isOverdue, isDueToday, confirmationStatus };
}

function resolveLabels(lane: CanonicalFollowUpLane, state: CanonicalFollowUpState, taskType: string): Pick<CanonicalFollowUp, 'categoryLabel' | 'displayLabel' | 'journeyStatus'> {
  if (lane === 'phone_followup') {
    const displayLabel =
      state === 'overdue' ? 'Arama Gecikti' :
      state === 'due_today' ? 'Bugün Aranacak' :
      state === 'waiting_reply' ? 'Arama Teyidi Bekliyor' :
      state === 'completed' ? 'Telefon Görüşmesi Yapıldı' :
      state === 'unreachable' ? 'Ulaşılamadı' :
      'Telefon Randevusu Planlandı';
    return { categoryLabel: 'Arama Takibi', displayLabel, journeyStatus: displayLabel };
  }

  if (lane === 'clinic_appointment') {
    const displayLabel =
      state === 'overdue' ? 'Randevu Gecikti' :
      state === 'due_today' ? 'Bugünkü Randevu' :
      state === 'waiting_reply' ? 'Randevu Teyidi Bekliyor' :
      state === 'open' ? 'Randevu Talebi' :
      state === 'completed' ? 'Randevu Tamamlandı' :
      state === 'unreachable' ? 'Gelmedi / İptal' :
      'Klinik Randevusu Alındı';
    return { categoryLabel: 'Randevu Takibi', displayLabel, journeyStatus: displayLabel === 'Randevu Talebi' ? 'Randevu Planlanıyor' : displayLabel };
  }

  if (lane === 'reply_followup') {
    const displayLabel = state === 'needs_template' ? 'Şablon Gerekli' : state === 'overdue' ? 'Cevap Gecikti' : 'Cevap Bekleniyor';
    return { categoryLabel: 'Cevap Takibi', displayLabel, journeyStatus: displayLabel };
  }

  if (lane === 'document_followup') {
    const isDoctor = taskType === 'doctor_review_pending';
    return {
      categoryLabel: 'Evrak / Rapor Takibi',
      displayLabel: isDoctor ? 'Doktor İncelemesi' : 'Rapor Bekleniyor',
      journeyStatus: isDoctor ? 'Doktor İncelemesi' : 'Rapor Bekleniyor',
    };
  }

  if (lane === 'human_review') {
    return { categoryLabel: 'İnsan İncelemesi', displayLabel: 'Kontrol Gerekli', journeyStatus: 'İnsan Devri Gerekli' };
  }

  if (lane === 'reminder') {
    return { categoryLabel: 'Hatırlatma / Geri Dönüş', displayLabel: 'Hatırlatma', journeyStatus: 'Tekrar Takip Gerekli' };
  }

  return { categoryLabel: 'Takip', displayLabel: 'Takip Gerekli', journeyStatus: 'Tekrar Takip Gerekli' };
}

function resolveNextAction(lane: CanonicalFollowUpLane, state: CanonicalFollowUpState, taskType: string): Pick<CanonicalFollowUp, 'nextBestAction' | 'actionLabel' | 'actionColorClass' | 'priorityBoost'> {
  if (state === 'completed' || state === 'cancelled' || state === 'unreachable') {
    return { nextBestAction: 'no_action', actionLabel: 'İşlem Yok', actionColorClass: 'text-gray-500 bg-gray-50', priorityBoost: -200 };
  }

  if (lane === 'phone_followup') {
    if (state === 'overdue') return { nextBestAction: 'call_now', actionLabel: 'Hemen Ara', actionColorClass: 'text-rose-600 bg-rose-50', priorityBoost: 120 };
    if (state === 'due_today') return { nextBestAction: 'call_today', actionLabel: 'Bugün Ara', actionColorClass: 'text-blue-600 bg-blue-50', priorityBoost: 90 };
    if (state === 'waiting_reply') return { nextBestAction: 'prepare_followup_draft', actionLabel: 'Teyit Taslağı', actionColorClass: 'text-violet-600 bg-violet-50', priorityBoost: 70 };
    return { nextBestAction: 'scheduled_followup', actionLabel: 'Arama Planlandı', actionColorClass: 'text-purple-600 bg-purple-50', priorityBoost: 30 };
  }

  if (lane === 'clinic_appointment') {
    if (state === 'overdue') return { nextBestAction: 'call_now', actionLabel: 'Randevu Kontrol Et', actionColorClass: 'text-rose-600 bg-rose-50', priorityBoost: 120 };
    if (state === 'due_today') return { nextBestAction: 'call_today', actionLabel: 'Bugünkü Randevu', actionColorClass: 'text-blue-600 bg-blue-50', priorityBoost: 90 };
    if (state === 'waiting_reply') return { nextBestAction: 'continue_appointment_planning', actionLabel: 'Randevu Teyidi Al', actionColorClass: 'text-indigo-600 bg-indigo-50', priorityBoost: 85 };
    if (state === 'open') return { nextBestAction: 'continue_appointment_planning', actionLabel: 'Randevu Planla', actionColorClass: 'text-indigo-600 bg-indigo-50', priorityBoost: 100 };
    return { nextBestAction: 'scheduled_followup', actionLabel: 'Randevu Planlandı', actionColorClass: 'text-purple-600 bg-purple-50', priorityBoost: 40 };
  }

  if (lane === 'reply_followup') {
    return { nextBestAction: 'prepare_followup_draft', actionLabel: state === 'needs_template' ? 'Şablon Hazırla' : 'Taslak Hazırla', actionColorClass: 'text-violet-600 bg-violet-50', priorityBoost: state === 'overdue' ? 80 : 60 };
  }

  if (lane === 'document_followup') {
    const isDoctor = taskType === 'doctor_review_pending';
    return {
      nextBestAction: isDoctor ? 'doctor_review_needed' : 'request_report',
      actionLabel: isDoctor ? 'Doktor İncelemesi' : 'Rapor İste',
      actionColorClass: isDoctor ? 'text-rose-600 bg-rose-50' : 'text-orange-600 bg-orange-50',
      priorityBoost: isDoctor ? 70 : 60,
    };
  }

  if (lane === 'human_review') {
    return { nextBestAction: 'review_required', actionLabel: 'İncele', actionColorClass: 'text-amber-700 bg-amber-50', priorityBoost: 100 };
  }

  return { nextBestAction: 'scheduled_followup', actionLabel: 'Takip Planlandı', actionColorClass: 'text-purple-600 bg-purple-50', priorityBoost: 20 };
}

function resolveUiBucket(state: CanonicalFollowUpState): CanonicalFollowUp['uiBucket'] {
  if (state === 'cancelled') return 'cancelled';
  if (state === 'completed') return 'completed';
  if (state === 'unreachable') return 'unreachable';
  if (state === 'overdue') return 'overdue';
  if (state === 'confirmed') return 'confirmed';
  if (state === 'waiting_reply' || state === 'needs_template') return 'bot_suggestion_pending';
  if (state === 'scheduled' || state === 'due_today') return 'scheduled';
  return 'open';
}

export function resolveCanonicalFollowUp(input: CanonicalFollowUpInput): CanonicalFollowUp {
  const metadata = safeMetadata(input.metadata);
  const taskType = input.taskType || '';
  const lane = resolveLane({
    taskType,
    metadata,
    oppIntentType: input.oppIntentType || null,
    convStatus: input.convStatus || null,
    lastOutreachAction: input.lastOutreachAction || null,
  });
  const appointmentType = resolveAppointmentType(lane, taskType, metadata);
  const stateInfo = resolveState(input, lane, metadata);
  const labels = resolveLabels(lane, stateInfo.state, taskType);
  const action = resolveNextAction(lane, stateInfo.state, taskType);

  return {
    lane,
    state: stateInfo.state,
    appointmentType,
    ...labels,
    ...action,
    isPhone: lane === 'phone_followup',
    isClinic: lane === 'clinic_appointment',
    isReplyFollowUp: lane === 'reply_followup',
    isDocumentFollowUp: lane === 'document_followup',
    isHumanReview: lane === 'human_review',
    isReminder: lane === 'reminder',
    isTerminal: ['completed', 'cancelled', 'unreachable'].includes(stateInfo.state),
    isOverdue: stateInfo.isOverdue,
    isDueToday: stateInfo.isDueToday,
    confirmationStatus: stateInfo.confirmationStatus,
    uiBucket: resolveUiBucket(stateInfo.state),
  };
}
