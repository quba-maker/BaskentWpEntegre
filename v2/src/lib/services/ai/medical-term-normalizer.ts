/**
 * Lightweight medical term normalizer for noisy patient text.
 *
 * It never turns an uncertain typo into a diagnosis. Medium-confidence matches
 * are exposed to the LLM as "ask for confirmation first" guidance.
 */

export interface MedicalTermSuggestion {
  rawText: string;
  canonicalTerm: string;
  confidence: 'high' | 'medium';
  shouldConfirm: boolean;
  reason: string;
}

function normalizeLoose(value: string): string {
  return (value || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TERM_RULES: Array<{
  canonicalTerm: string;
  confidence: 'high' | 'medium';
  shouldConfirm: boolean;
  reason: string;
  patterns: RegExp[];
}> = [
  {
    canonicalTerm: 'Bel fıtığı',
    confidence: 'high',
    shouldConfirm: false,
    reason: 'common_turkish_typo',
    patterns: [
      /\bbel\s+fitig[ıiu]?\b/i,
      /\bbol\s+fitig[ıiu]?\b/i,
      /\bbel\s+fiti[gğ][ıi]m\b/i,
      /\bbol\s+fiti[gğ][ıi]m\b/i,
    ],
  },
  {
    canonicalTerm: 'Psöriyatik artrit',
    confidence: 'medium',
    shouldConfirm: true,
    reason: 'transliterated_or_misspelled_medical_term',
    patterns: [
      /\bpsor(?:y|i|ia|ya)[a-z]*\s+artrit\b/i,
      /\bpsoryaziceskiy\s+artrit\b/i,
      /\bpsoryazicheskiy\s+artrit\b/i,
      /\bpsoriatic\s+arthritis\b/i,
      /\bpsoriatik\s+artrit\b/i,
      /\bpso?riyatik\s+artrit\b/i,
      /\bsedef\s+romatizmas[ıi]\b/i,
    ],
  },
];

export class MedicalTermNormalizer {
  public static suggest(text?: string): MedicalTermSuggestion | null {
    const rawText = (text || '').trim();
    if (!rawText) return null;

    const normalized = normalizeLoose(rawText);
    for (const rule of TERM_RULES) {
      if (rule.patterns.some(pattern => pattern.test(normalized))) {
        return {
          rawText,
          canonicalTerm: rule.canonicalTerm,
          confidence: rule.confidence,
          shouldConfirm: rule.shouldConfirm,
          reason: rule.reason,
        };
      }
    }

    return null;
  }
}
