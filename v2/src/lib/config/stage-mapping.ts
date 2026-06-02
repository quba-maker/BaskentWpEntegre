/**
 * 🎯 Unified Stage Mapping — Single Source of Truth
 * 
 * Pure constants file — no DB, no env, no server-only dependencies.
 * Safe for import in both client components and server actions.
 * 
 * Two stage systems coexist:
 * - Opportunity stages: 10 granular stages (master system)
 * - Lead/Conversation stages: 7 simplified stages (mirror system)
 */

// ══════════════════════════════════════════════
// OPPORTUNITY STAGE SYSTEM (Master)
// ══════════════════════════════════════════════

export const OPP_STAGES = [
  { value: 'new_lead', label: 'Yeni', color: '#007AFF', icon: '🆕' },
  { value: 'first_contact', label: 'İlk İletişim', color: '#FF9500', icon: '📞' },
  { value: 'engaged', label: 'Cevap Alındı', color: '#34C759', icon: '💬' },
  { value: 'discovery', label: 'Keşif/Analiz', color: '#5856D6', icon: '🔍' },
  { value: 'qualified', label: 'Nitelikli', color: '#30B0C7', icon: '⭐' },
  { value: 'phone_call_planning', label: 'Telefon Görüşmesi Planlanıyor', color: '#AF52DE', icon: '📞' },
  { value: 'appointment_planning', label: 'Randevu Planlanıyor', color: '#FFD60A', icon: '📅' },
  { value: 'appointment_booked', label: 'Randevu Alındı', color: '#0F9D58', icon: '✅' },
  { value: 'arrived', label: 'Geldi', color: '#0F9D58', icon: '🏥' },
  { value: 'not_qualified', label: 'Uygun Değil', color: '#8E8E93', icon: '🚫' },
] as const;

/** Ordered list of opportunity stage values (index = progression order) */
export const OPP_STAGE_ORDER: string[] = OPP_STAGES.map(s => s.value);

/** Get opportunity stage info by value */
export function getOppStageInfo(stage: string) {
  return OPP_STAGES.find(s => s.value === stage) || { value: stage, label: stage, color: '#86868B', icon: '❓' };
}

// ══════════════════════════════════════════════
// LEAD/CONVERSATION STAGE SYSTEM (Mirror)
// ══════════════════════════════════════════════

export const LEAD_STAGES = [
  { value: 'new', label: 'Yeni Lead', color: '#007AFF', icon: '🆕' },
  { value: 'contacted', label: 'İlk İletişim', color: '#FF9500', icon: '📞' },
  { value: 'responded', label: 'Cevap Alındı', color: '#34C759', icon: '💬' },
  { value: 'discovery', label: 'Keşif / Analiz', color: '#5856D6', icon: '🔍' },
  { value: 'qualified', label: 'Nitelikli', color: '#30B0C7', icon: '⭐' },
  { value: 'appointed', label: 'Randevu Aldı', color: '#0F9D58', icon: '✅' },
  { value: 'lost', label: 'Uygun Değil', color: '#8E8E93', icon: '🚫' },
] as const;

export const LEAD_STAGE_ORDER: string[] = LEAD_STAGES.map(s => s.value);

// ══════════════════════════════════════════════
// STAGE MAPPING: Opportunity ↔ Lead/Conversation
// ══════════════════════════════════════════════

/** Lead stage → Opportunity stage (forward mapping) */
export const LEAD_TO_OPP_MAP: Record<string, string> = {
  'new': 'new_lead',
  'contacted': 'first_contact',
  'responded': 'engaged',
  'discovery': 'discovery',
  'qualified': 'qualified',
  'appointed': 'appointment_booked',
  'lost': 'not_qualified',
};

/** Opportunity stage → Lead/Conv mirror stage (reverse mapping) */
export const OPP_TO_LEAD_MAP: Record<string, string> = {
  'new_lead': 'new',
  'first_contact': 'contacted',
  'engaged': 'responded',
  'discovery': 'discovery',
  'qualified': 'qualified',
  'phone_call_planning': 'qualified',
  'appointment_planning': 'qualified',
  'appointment_booked': 'appointed',
  'arrived': 'appointed',
  'not_qualified': 'lost',
};

// ══════════════════════════════════════════════
// AI RESTRICTIONS
// ══════════════════════════════════════════════

/** Stages that AI can NEVER set — require human decision */
export const AI_FORBIDDEN_STAGES: ReadonlySet<string> = new Set([
  'appointment_booked',
  'arrived',
  'not_qualified',
]);

/** Maximum stage AI can advance to (index in OPP_STAGE_ORDER) */
export const AI_MAX_STAGE = 'appointment_planning';

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════

/** Convert a lead/conversation stage to opportunity stage */
export function leadStageToOppStage(leadStage: string): string {
  return LEAD_TO_OPP_MAP[leadStage] || 'new_lead';
}

/** Convert an opportunity stage to lead/conversation mirror stage */
export function oppStageToLeadStage(oppStage: string): string {
  return OPP_TO_LEAD_MAP[oppStage] || 'new';
}

/** Check if stageA is ahead of stageB in opportunity progression */
export function isOppStageAhead(stageA: string, stageB: string): boolean {
  const idxA = OPP_STAGE_ORDER.indexOf(stageA);
  const idxB = OPP_STAGE_ORDER.indexOf(stageB);
  if (idxA < 0 || idxB < 0) return false;
  return idxA > idxB;
}

/** Check if a stage is a terminal/closed state */
export function isTerminalStage(stage: string): boolean {
  return ['not_qualified', 'arrived'].includes(stage);
}

/** Check if AI is allowed to set this stage */
export function isAIAllowedStage(stage: string): boolean {
  return !AI_FORBIDDEN_STAGES.has(stage);
}

// ══════════════════════════════════════════════
// DISPLAY LABELS (for Google Sheets sync etc.)
// ══════════════════════════════════════════════

export const OPP_STAGE_LABELS: Record<string, string> = Object.fromEntries(
  OPP_STAGES.map(s => [s.value, s.label])
);

export const LEAD_STAGE_LABELS: Record<string, string> = Object.fromEntries(
  LEAD_STAGES.map(s => [s.value, s.label])
);
