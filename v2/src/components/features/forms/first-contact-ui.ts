export type FirstContactUiBucket =
  | 'needs_greeting'
  | 'needs_reply'
  | 'waiting_patient'
  | 'no_reply_waiting'
  | 'patient_replied'
  | 'blocked_or_invalid'
  | 'control_required';

export const FIRST_CONTACT_UI_LABELS: Record<FirstContactUiBucket | 'all', string> = {
  all: 'Tümü',
  needs_greeting: 'Karşılama Bekliyor',
  needs_reply: 'Yanıt Geldi',
  waiting_patient: 'Cevap Bekleniyor',
  no_reply_waiting: 'Takip Gerekli',
  patient_replied: 'Yanıt Geldi',
  blocked_or_invalid: 'Kontrol Gerekli',
  control_required: 'Kontrol Gerekli',
};

export const FIRST_CONTACT_UI_META: Record<FirstContactUiBucket, {
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  bg: string;
  border: string;
}> = {
  needs_greeting: {
    label: 'Karşılama Bekliyor',
    shortLabel: 'Karşıla',
    description: 'Hasta henüz karşılanmamış; uygun ise onaylı şablon veya taslakla ilk temas kurulabilir.',
    color: '#B45309',
    bg: '#FFFBEB',
    border: '#FDE68A'
  },
  needs_reply: {
    label: 'Yanıt Geldi',
    shortLabel: 'Yanıtla',
    description: 'Hasta dönüş yaptı; inbox üzerinden yanıt bekliyor.',
    color: '#4F46E5',
    bg: '#EEF2FF',
    border: '#C7D2FE'
  },
  waiting_patient: {
    label: 'Cevap Bekleniyor',
    shortLabel: 'Bekliyor',
    description: 'Karşılama veya son mesaj gönderildi; hastadan cevap bekleniyor.',
    color: '#047857',
    bg: '#ECFDF5',
    border: '#A7F3D0'
  },
  no_reply_waiting: {
    label: 'Takip Gerekli',
    shortLabel: 'Takip',
    description: 'Hasta cevap vermedi; takip veya hatırlatma planlanabilir.',
    color: '#C2410C',
    bg: '#FFF7ED',
    border: '#FED7AA'
  },
  patient_replied: {
    label: 'Yanıt Geldi',
    shortLabel: 'Yanıtla',
    description: 'Hasta dönüş yaptı; inbox üzerinden konuşmaya devam edin.',
    color: '#4F46E5',
    bg: '#EEF2FF',
    border: '#C7D2FE'
  },
  blocked_or_invalid: {
    label: 'Kontrol Gerekli',
    shortLabel: 'Kontrol',
    description: 'Telefon, kanal, izin veya uygunluk nedeniyle manuel kontrol gerekir.',
    color: '#DC2626',
    bg: '#FEF2F2',
    border: '#FECACA'
  },
  control_required: {
    label: 'Kontrol Gerekli',
    shortLabel: 'Kontrol',
    description: 'Bu kayıt otomatik ilk temas için uygun değil; manuel inceleme gerekir.',
    color: '#DC2626',
    bg: '#FEF2F2',
    border: '#FECACA'
  },
};

export const FIRST_CONTACT_INTERNAL_LABELS: Record<string, string> = {
  needs_greeting: 'Karşılama Bekliyor',
  waiting_inbox_reply: 'Yanıt Geldi',
  whatsapp_opened: 'Kontrol Gerekli',
  manual_greeting_confirmed: 'Cevap Bekleniyor',
  inbox_greeting_sent: 'Cevap Bekleniyor',
  sent: 'Cevap Bekleniyor',
  waiting_patient: 'Cevap Bekleniyor',
  needs_reply: 'Yanıt Geldi',
  patient_replied: 'Yanıt Geldi',
  blocked_or_invalid: 'Kontrol Gerekli',
  out_of_scope: 'Kapsam Dışı',
  control_required: 'Kontrol Gerekli',
  no_reply_waiting: 'Takip Gerekli',
};

export function getFirstContactUiBucket(formOrStatus: any): FirstContactUiBucket {
  const status = typeof formOrStatus === 'string'
    ? formOrStatus
    : formOrStatus?.firstContactStatus;
  const stage = typeof formOrStatus === 'string' ? undefined : formOrStatus?.stage;
  const noReply = typeof formOrStatus === 'string'
    ? false
    : !!formOrStatus?.noReplyFollowup?.is_no_reply_eligible;

  if (stage === 'quarantine' || status === 'control_required') return 'control_required';
  if (noReply) return 'no_reply_waiting';
  if (status === 'needs_greeting') return 'needs_greeting';
  if (status === 'needs_reply') return 'needs_reply';
  if (status === 'waiting_patient' || status === 'sent') return 'waiting_patient';
  if (status === 'waiting_inbox_reply') return 'needs_reply';
  if (status === 'patient_replied') return 'needs_reply';
  if (status === 'blocked_or_invalid' || status === 'out_of_scope') return 'blocked_or_invalid';
  if (status === 'manual_greeting_confirmed' || status === 'inbox_greeting_sent') return 'waiting_patient';
  if (status === 'whatsapp_opened') return 'control_required';
  return 'blocked_or_invalid';
}

export function getFirstContactUiMeta(formOrStatus: any) {
  const bucket = getFirstContactUiBucket(formOrStatus);
  return {
    bucket,
    ...FIRST_CONTACT_UI_META[bucket],
  };
}

export function getFirstContactFilterLabel(value: string): string {
  return FIRST_CONTACT_UI_LABELS[value as FirstContactUiBucket | 'all']
    || FIRST_CONTACT_INTERNAL_LABELS[value]
    || value;
}
