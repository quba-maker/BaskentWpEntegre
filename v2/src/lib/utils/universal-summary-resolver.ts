export interface UniversalSummaryInput {
  oppSummary?: string | null;
  oppAiReason?: string | null;
  legacyAiSummary?: string | null;
  patientName?: string | null;
  priority?: string | null;
  nextBestAction?: string | null;
  missingInfo?: string[] | null;
  updatedAt?: string | Date | null;
}

export type EntityType = 'patient' | 'customer' | 'lead';

export interface UniversalAISummary {
  entityType: EntityType;
  displayName: string;
  summary: string;
  aiReason?: string;
  urgency?: 'low' | 'medium' | 'high' | 'hot';
  source: 'active_opportunity' | 'legacy_fallback' | 'none';
  nextBestAction?: string;
  missingInfo?: string[];
  updatedAt?: string;
}

export interface LabelConfig {
  summaryTitle: string;
  reasonTitle: string;
  nextActionTitle: string;
  missingInfoTitle: string;
}

export const HEALTH_LABELS: LabelConfig = {
  summaryTitle: '🏥 Hasta Özeti',
  reasonTitle: '⚡ Fırsat Gerekçesi',
  nextActionTitle: '🎯 Sonraki Aksiyon',
  missingInfoTitle: '⚠️ Eksik Bilgiler',
};

const DEFAULT_LABELS: LabelConfig = {
  summaryTitle: '👤 Müşteri Özeti',
  reasonTitle: '💡 Neden Önemli',
  nextActionTitle: '🎯 Sonraki Aksiyon',
  missingInfoTitle: '⚠️ Eksik Bilgiler',
};

/**
 * Returns dynamic label config based on entityType.
 */
export function getAISummaryLabels(entityType: EntityType): LabelConfig {
  if (entityType === 'patient') {
    return HEALTH_LABELS;
  }
  return DEFAULT_LABELS;
}

/**
 * Dynamically resolves vertical/industry entityType from tenant slug.
 * Eliminates hardcoded checks like slug === 'baskent'.
 */
export function getTenantEntityType(tenantSlug?: string | null, industry?: string | null): EntityType {
  if (industry) {
    const ind = industry.toLowerCase();
    if (ind === 'healthcare' || ind === 'health' || ind === 'medical') {
      return 'patient';
    }
  }

  if (!tenantSlug) return 'customer';
  const slug = tenantSlug.toLowerCase();
  
  // Health keyword checks for vertical config
  const healthKeywords = ['baskent', 'health', 'saglik', 'dis', 'klinik', 'tip', 'dental', 'medical', 'hospital', 'doktor'];
  if (healthKeywords.some(kw => slug.includes(kw))) {
    return 'patient';
  }
  
  return 'customer';
}

/**
 * Resolves a unified AI summary model.
 * Note: manualNotes/conversationNotes are intentionally excluded from the AI summary card per user request.
 */
export function resolveUniversalAISummary(
  input: UniversalSummaryInput,
  entityType: EntityType,
  displayName: string = 'İsimsiz'
): UniversalAISummary {
  let summary = '';
  let source: UniversalAISummary['source'] = 'none';

  if (input.oppSummary && input.oppSummary.trim()) {
    summary = input.oppSummary.trim();
    source = 'active_opportunity';
  } else if (input.legacyAiSummary && input.legacyAiSummary.trim()) {
    summary = input.legacyAiSummary.trim();
    source = 'legacy_fallback';
  }

  // Resolve Urgency
  let urgency: UniversalAISummary['urgency'] = 'medium';
  const rawPriority = (input.priority || '').toLowerCase();
  if (rawPriority === 'hot' || rawPriority === 'critical' || rawPriority === 'sıcak') {
    urgency = 'hot';
  } else if (rawPriority === 'high' || rawPriority === 'warm') {
    urgency = 'high';
  } else if (rawPriority === 'low' || rawPriority === 'cold') {
    urgency = 'low';
  }

  let formattedDate: string | undefined = undefined;
  if (input.updatedAt) {
    const d = typeof input.updatedAt === 'string' ? new Date(input.updatedAt) : input.updatedAt;
    if (d instanceof Date && !isNaN(d.getTime())) {
      formattedDate = d.toISOString();
    }
  }

  return {
    entityType,
    displayName,
    summary,
    aiReason: input.oppAiReason && input.oppAiReason.trim() ? input.oppAiReason.trim() : undefined,
    urgency,
    source,
    nextBestAction: input.nextBestAction && input.nextBestAction.trim() ? input.nextBestAction.trim() : undefined,
    missingInfo: input.missingInfo || undefined,
    updatedAt: formattedDate
  };
}
