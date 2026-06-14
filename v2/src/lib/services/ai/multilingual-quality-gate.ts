/**
 * P0.11: MultilingualQualityGate
 * Locale-aware quality gate that wraps TurkishReplyQualityGate
 * and adds language-generic safety checks.
 * 
 * FAIL-SAFE: If language detection or gate throws, falls back to generic safety.
 * Does NOT crash or auto-lock conversation to human on internal errors.
 */

import { TurkishMorphologyGuard } from './turkish-morphology-guard';

export interface MultilingualQGInput {
  responseText: string;
  replyLanguage: string;
  qualityGateLocale: string;
  qgOptions: any; // QualityGateOptions from turkish-quality-gate
}

export interface MultilingualQGResult {
  valid: boolean;
  reason?: string;
  locale: string;
  morphologyChecked: boolean;
  morphologyCorrectedText?: string;
}

export class MultilingualQualityGate {
  /**
   * Validates AI response with locale-aware quality checks.
   * 
   * Flow:
   * 1. Run generic safety checks (all languages)
   * 2. If qualityGateLocale === 'tr': run TurkishReplyQualityGate + TurkishMorphologyGuard
   * 3. If qualityGateLocale === 'generic': skip Turkish-specific checks
   */
  public static validate(input: MultilingualQGInput): MultilingualQGResult {
    const { responseText, replyLanguage, qualityGateLocale, qgOptions } = input;

    try {
      // 1. Generic safety checks (all languages)
      const genericResult = this.runGenericSafetyChecks(responseText);
      if (!genericResult.valid) {
        return {
          valid: false,
          reason: genericResult.reason,
          locale: qualityGateLocale,
          morphologyChecked: false
        };
      }

      // 2. Language-specific checks
      if (qualityGateLocale === 'tr') {
        return this.runTurkishChecks(responseText, qgOptions);
      }

      // 3. For non-Turkish locales, check wrong-language reply
      const wrongLanguage = this.checkWrongLanguageReply(responseText, replyLanguage);
      if (wrongLanguage) {
        return {
          valid: false,
          reason: `wrong_language_reply:expected_${replyLanguage}`,
          locale: qualityGateLocale,
          morphologyChecked: false
        };
      }

      return {
        valid: true,
        locale: qualityGateLocale,
        morphologyChecked: false
      };
    } catch (err) {
      // FAIL-SAFE: Log and return valid to avoid crashing
      console.error('[MULTILINGUAL_QG_ERROR] Quality gate internal error, falling back to valid', err);
      return {
        valid: true,
        reason: 'qg_internal_error_failsafe',
        locale: qualityGateLocale,
        morphologyChecked: false
      };
    }
  }

  /**
   * Generic safety checks that apply to ALL languages.
   */
  private static runGenericSafetyChecks(text: string): { valid: boolean; reason?: string } {
    // Empty response
    if (!text || text.trim().length === 0) {
      return { valid: false, reason: 'empty_response' };
    }

    // System/prompt leak patterns (language-independent)
    const leakPatterns = [
      /\bsystem\s*prompt\b/i,
      /\byou are an ai\b/i,
      /\bi am an ai\b/i,
      /\blarge language model\b/i,
      /\bben bir yapay zeka\b/i,
      /\bben bir dil modeli\b/i,
      /\bprompt injection\b/i,
      /\btenant[_\s]?id\b/i,
      /\bapi[_\s]?key\b/i,
      /\bsecret[_\s]?key\b/i
    ];

    for (const pattern of leakPatterns) {
      if (pattern.test(text)) {
        return { valid: false, reason: 'system_leak_detected' };
      }
    }

    // KVKK / privacy patterns
    const privacyPatterns = [
      /T\.?C\.?\s*(?:kimlik)?\s*(?:no|numar)/i,
      /\b\d{11}\b/, // TC number pattern
      /\bpassword\b/i,
      /\bşifre\b/i
    ];

    for (const pattern of privacyPatterns) {
      if (pattern.test(text)) {
        return { valid: false, reason: 'privacy_violation' };
      }
    }

    return { valid: true };
  }

  /**
   * Turkish-specific quality checks.
   * Runs existing TurkishReplyQualityGate + TurkishMorphologyGuard.
   */
  private static runTurkishChecks(
    text: string,
    qgOptions: any
  ): MultilingualQGResult {
    // 1. Run existing TurkishReplyQualityGate
    try {
      const { TurkishReplyQualityGate } = require('./turkish-quality-gate');
      const trResult = TurkishReplyQualityGate.validate(text, qgOptions);

      if (!trResult.valid) {
        return {
          valid: false,
          reason: trResult.reason,
          locale: 'tr',
          morphologyChecked: false
        };
      }
    } catch (err) {
      // Fail-safe: if TurkishReplyQualityGate fails, continue
      console.error('[MULTILINGUAL_QG_ERROR] TurkishReplyQualityGate error, skipping', err);
    }

    // 2. Run TurkishMorphologyGuard
    const morphResult = TurkishMorphologyGuard.check(text, true);
    if (morphResult.hasMorphologyError) {
      if (morphResult.correctionApplied && morphResult.correctionConfidence === 'high') {
        // Auto-corrected with high confidence
        return {
          valid: true,
          locale: 'tr',
          morphologyChecked: true,
          morphologyCorrectedText: morphResult.correctedText
        };
      } else {
        // Errors found but not safely correctable
        const errorDescs = morphResult.errors.map(e => e.pattern).join(',');
        return {
          valid: false,
          reason: `turkish_morphology_error:${errorDescs}`,
          locale: 'tr',
          morphologyChecked: true
        };
      }
    }

    return {
      valid: true,
      locale: 'tr',
      morphologyChecked: true
    };
  }

  /**
   * Basic check if bot response language matches expected reply language.
   * Uses simple heuristics — not a full language detector.
   */
  private static checkWrongLanguageReply(text: string, expectedLang: string): boolean {
    if (!expectedLang || expectedLang === 'tr') return false;
    const lower = text.toLowerCase();

    // If expected English but response is heavily Turkish
    if (expectedLang === 'en') {
      const turkishChars = (lower.match(/[ışğçöüİŞĞÇÖÜ]/g) || []).length;
      const turkishWords = ['merhaba', 'nasıl', 'yardımcı', 'olabiliriz', 'randevu', 'görüşme'].filter(w => lower.includes(w)).length;
      if (turkishChars > 5 || turkishWords >= 2) {
        return true;
      }
    }

    // If expected Turkish but response is heavily English
    if (expectedLang === 'tr') {
      const englishWords = ['hello', 'how can', 'appointment', 'would you', 'please', 'thank you'].filter(w => lower.includes(w)).length;
      if (englishWords >= 3) {
        return true;
      }
    }

    return false;
  }
}
