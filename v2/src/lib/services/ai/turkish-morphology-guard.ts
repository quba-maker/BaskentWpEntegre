/**
 * P0.11: TurkishMorphologyGuard
 * Detects and optionally corrects Turkish suffix/possessive deduplication errors
 * in AI-generated responses.
 * 
 * CRITICAL SAFETY RULES:
 * - Only runs on AI-generated final bot responses (qualityGateLocale === 'tr')
 * - NEVER runs on: approved templates, message_templates, user input, system prompts,
 *   tenant/channel prompts, DB-stored messages
 * - If correction is uncertain, returns error without modifying text
 */

export interface MorphologyGuardResult {
  hasMorphologyError: boolean;
  errors: MorphologyError[];
  correctedText?: string;
  correctionApplied: boolean;
  correctionConfidence: 'high' | 'low' | 'none';
}

export interface MorphologyError {
  pattern: string;
  match: string;
  position: number;
  suggestedFix?: string;
}

// Known Turkish suffix deduplication patterns with safe corrections
const KNOWN_DEDUP_PATTERNS: { regex: RegExp; description: string; fix?: (match: string) => string }[] = [
  // nızınız → nız (doubled possessive)
  { regex: /(\w+)(nızınız|niziniz|nüzünüz|nuzunuz)/gi, description: 'doubled_possessive_niz', fix: (m) => m.replace(/(nızınız|niziniz|nüzünüz|nuzunuz)/gi, (sub) => sub.startsWith('nız') ? 'nız' : sub.startsWith('niz') ? 'niz' : sub.startsWith('nüz') ? 'nüz' : 'nuz') },
  // ınızınız → ınız
  { regex: /(\w+)(ınızınız|inızınız)/gi, description: 'doubled_possessive_iniz', fix: (m) => m.replace(/(ınızınız|inızınız)/gi, 'ınız') },
  // imizimiz → imiz
  { regex: /(\w+)(imizimiz|ımızımız)/gi, description: 'doubled_possessive_imiz', fix: (m) => m.replace(/(imizimiz)/gi, 'imiz').replace(/(ımızımız)/gi, 'ımız') },
  // ülkeniziniz → ülkeniz
  { regex: /ülkeniziniz/gi, description: 'ulkeniziniz', fix: (m) => 'ülkeniz' },
  // şehriniziniz → şehriniz
  { regex: /şehriniziniz/gi, description: 'sehriniziniz', fix: (m) => 'şehriniz' },
  // saatlerimiziniz → saatlerimiz
  { regex: /saatlerimiziniz/gi, description: 'saatlerimiziniz', fix: (m) => 'saatlerimiz' },
  // çalışma saatlerimiziniz → çalışma saatlerimiz
  { regex: /çalışma\s+saatlerimiziniz/gi, description: 'calisma_saatlerimiziniz', fix: (m) => 'çalışma saatlerimiz' },
];

// Known bad phrase patterns (no auto-fix, Quality Gate fail)
const BAD_PHRASE_PATTERNS: { regex: RegExp; description: string }[] = [
  // "hangi ülkeniz veya şehriniz saatine" — possessive on ülke/şehir is wrong in this construction
  { regex: /hangi\s+ülkeniz\s+veya\s+şehriniz\s+saatine/gi, description: 'ulkeniz_sehriniz_saatine' },
  // "görüşme saatiniz hangi ülkeniz" — possessive on ülke is wrong 
  { regex: /görüşme\s+saatiniz\s+hangi\s+ülkeniz/gi, description: 'gorusme_saatiniz_hangi_ulkeniz' },
];

export class TurkishMorphologyGuard {
  /**
   * Checks AI-generated text for Turkish morphology errors.
   * Returns detection results and optional corrections.
   * 
   * @param text - The AI-generated response text to check
   * @param applyCorrection - If true, attempts to auto-correct known patterns
   */
  public static check(text: string, applyCorrection: boolean = true): MorphologyGuardResult {
    if (!text || text.trim().length === 0) {
      return { hasMorphologyError: false, errors: [], correctionApplied: false, correctionConfidence: 'none' };
    }

    const errors: MorphologyError[] = [];
    let workingText = text;
    let anyFixed = false;

    // 1. Check known deduplication patterns (safe auto-fix available)
    for (const pattern of KNOWN_DEDUP_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern.regex.source, 'gi'));
      for (const match of matches) {
        errors.push({
          pattern: pattern.description,
          match: match[0],
          position: match.index || 0,
          suggestedFix: pattern.fix ? pattern.fix(match[0]) : undefined
        });

        if (applyCorrection && pattern.fix) {
          workingText = workingText.replace(new RegExp(this.escapeRegex(match[0]), 'gi'), pattern.fix(match[0]));
          anyFixed = true;
        }
      }
    }

    // 2. Check bad phrase patterns (no auto-fix, triggers QG fail)
    for (const pattern of BAD_PHRASE_PATTERNS) {
      const matches = text.matchAll(new RegExp(pattern.regex.source, 'gi'));
      for (const match of matches) {
        errors.push({
          pattern: pattern.description,
          match: match[0],
          position: match.index || 0
          // No suggestedFix — these need LLM regeneration
        });
      }
    }

    // 3. Generic suffix dedup detector: catch unknown doubled suffixes
    // Pattern: word ending in repeated possessive-like suffixes
    const genericDedup = /(\w{3,})(nız|niz|nüz|nuz|mız|miz|müz|müz)\2/gi;
    const genericMatches = text.matchAll(genericDedup);
    for (const match of genericMatches) {
      // Check it wasn't already caught by known patterns
      const alreadyCaught = errors.some(e => e.position === (match.index || 0));
      if (!alreadyCaught) {
        errors.push({
          pattern: 'generic_suffix_dedup',
          match: match[0],
          position: match.index || 0
        });
      }
    }

    const hasMorphologyError = errors.length > 0;
    const allHaveFixes = errors.every(e => e.suggestedFix !== undefined);
    const correctionConfidence = !hasMorphologyError ? 'none' : (anyFixed && allHaveFixes ? 'high' : 'low');

    return {
      hasMorphologyError,
      errors,
      correctedText: anyFixed ? workingText : undefined,
      correctionApplied: anyFixed,
      correctionConfidence
    };
  }

  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
