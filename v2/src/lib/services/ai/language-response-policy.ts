/**
 * P0.11: LanguageResponsePolicy
 * Centralizes multilingual reply language decisions for SaaS bot.
 * Wraps the existing language-detector and adds SaaS-level logic:
 * - language switch detection
 * - conversation primary language tracking
 * - tenant default language fallback
 * - quality gate locale routing
 */

import { LanguageContext, detectLanguage } from '../../utils/language-detector';

export interface LanguagePolicyResult {
  /** ISO code of detected user language */
  detectedUserLanguage: string;
  /** Language of the last user message specifically */
  lastUserMessageLanguage: string;
  /** Primary language of the conversation overall */
  conversationPrimaryLanguage: string;
  /** Language the bot should reply in (ISO code) */
  replyLanguage: string;
  /** Display name of reply language for prompt injection */
  replyLanguageName: string;
  /** Whether a language switch was detected in this turn */
  languageSwitchDetected: boolean;
  /** Locale for quality gate routing: 'tr' or 'generic' */
  qualityGateLocale: string;
  /** Confidence level of language detection */
  languageConfidence: 'high' | 'low' | 'unknown';
  /** Whether tenant default language was applied as fallback */
  tenantDefaultLanguageApplied: boolean;
}

const ISO_TO_NAME: Record<string, string> = {
  tr: 'Türkçe',
  en: 'English',
  de: 'Deutsch',
  ar: 'العربية',
  ru: 'Русский',
  kk: 'Қазақша',
  fr: 'Français',
  es: 'Español',
  nl: 'Nederlands'
};

const NAME_TO_ISO: Record<string, string> = {
  'türkçe': 'tr', 'turkce': 'tr',
  'ingilizce': 'en', 'İngilizce': 'en', 'english': 'en',
  'almanca': 'de', 'deutsch': 'de', 'german': 'de',
  'arapça': 'ar', 'arapca': 'ar', 'العربية': 'ar', 'arabic': 'ar',
  'rusça': 'ru', 'rusca': 'ru', 'Русский': 'ru', 'russian': 'ru',
  'kazakça': 'kk', 'kazakca': 'kk', 'Қазақша': 'kk', 'kazakh': 'kk',
  'fransızca': 'fr', 'french': 'fr', 'français': 'fr',
  'ispanyolca': 'es', 'spanish': 'es', 'español': 'es',
  'hollandaca': 'nl', 'dutch': 'nl', 'nederlands': 'nl'
};

export class LanguageResponsePolicy {
  /**
   * Resolves the complete language policy for the current turn.
   * 
   * @param currentMessage - The latest user message text
   * @param history - Conversation history
   * @param tenantDefaultLanguage - Optional tenant-level default language (ISO code)
   * @param channelFixedLanguage - Optional channel-level fixed language override (ISO code)
   */
  public static resolve(
    currentMessage: string,
    history: { role: string; content: string }[] = [],
    tenantDefaultLanguage?: string,
    channelFixedLanguage?: string
  ): LanguagePolicyResult {
    // 1. Detect language from current message using existing detector
    let detectionResult: LanguageContext;
    try {
      detectionResult = detectLanguage(currentMessage, history as any);
    } catch {
      // Fail-safe: default to Turkish
      detectionResult = {
        detected_patient_language: 'Türkçe',
        reply_language: 'Türkçe',
        language_confidence: 'unknown',
        language_detection_source: 'unknown'
      };
    }

    // 2. Convert detected language name to ISO code
    const detectedISO = this.nameToISO(detectionResult.detected_patient_language);

    // 3. Check for explicit language switch in current message
    const switchTarget = this.detectLanguageSwitch(currentMessage);
    const languageSwitchDetected = switchTarget !== null;

    // 4. Determine conversation primary language from history
    const conversationPrimaryLang = this.resolveConversationPrimaryLanguage(history);

    // 5. Resolve final reply language
    let replyLanguage: string;
    let tenantDefaultApplied = false;

    if (languageSwitchDetected && switchTarget) {
      // Explicit language switch request takes highest priority
      replyLanguage = switchTarget;
    } else if (channelFixedLanguage) {
      // Channel-level fixed language override (admin setting)
      replyLanguage = channelFixedLanguage;
    } else if (detectionResult.language_confidence !== 'unknown') {
      // Detected language with at least low confidence
      replyLanguage = detectedISO;
    } else if (conversationPrimaryLang !== 'unknown') {
      // Fallback to conversation primary language
      replyLanguage = conversationPrimaryLang;
    } else if (tenantDefaultLanguage) {
      // Fallback to tenant default
      replyLanguage = tenantDefaultLanguage;
      tenantDefaultApplied = true;
    } else {
      // Ultimate fallback
      replyLanguage = 'tr';
      tenantDefaultApplied = true;
    }

    // Arabic Locale Continuity Guard
    const currentIsArabic = /[\u0600-\u06FF]/.test(currentMessage);
    const userMsgsFromHistory = history.filter(m => m.role === 'user' && m.content);
    const last3UserMsgs = [...userMsgsFromHistory.slice(-2).map(m => m.content), currentMessage];
    const arabicMsgCount = last3UserMsgs.filter(text => /[\u0600-\u06FF]/.test(text)).length;
    const isArabicMajority = last3UserMsgs.length >= 2 ? (arabicMsgCount >= 2) : currentIsArabic;

    if (currentIsArabic || isArabicMajority) {
      replyLanguage = 'ar';
    }

    // 6. Determine quality gate locale
    const qualityGateLocale = replyLanguage === 'tr' ? 'tr' : 'generic';

    return {
      detectedUserLanguage: replyLanguage,
      lastUserMessageLanguage: detectedISO,
      conversationPrimaryLanguage: conversationPrimaryLang,
      replyLanguage,
      replyLanguageName: ISO_TO_NAME[replyLanguage] || replyLanguage,
      languageSwitchDetected,
      qualityGateLocale,
      languageConfidence: languageSwitchDetected ? 'high' : (currentIsArabic ? 'high' : detectionResult.language_confidence),
      tenantDefaultLanguageApplied: tenantDefaultApplied
    };
  }

  /**
   * Detects if the user is explicitly requesting a language switch.
   * Returns the target ISO code or null.
   */
  private static detectLanguageSwitch(message: string): string | null {
    const lower = message.toLowerCase().trim();

    // Turkish phrases requesting language switch
    if (/ingilizce\s*(konuş|konus|yaz|devam)/.test(lower) || /english\s*(please|devam)/.test(lower)) return 'en';
    if (/türkçe\s*(devam|yaz|konuş|konus)/i.test(lower) || /turkce\s*(devam|yaz|konus)/.test(lower)) return 'tr';
    if (/almanca\s*(konuş|konus|yaz|devam)/.test(lower) || /deutsch\s*(bitte|schreiben)/.test(lower)) return 'de';
    if (/arapça\s*(yaz|konuş|konus|devam)/.test(lower) || /اكتب بالعربي/.test(lower)) return 'ar';
    if (/rusça\s*(yaz|konuş|konus|devam)/.test(lower) || /на русском/.test(lower) || /по русски/.test(lower)) return 'ru';

    // English phrases
    if (/can you (?:speak|write in) (?:english|turkish|german|arabic|russian)/i.test(lower)) {
      if (lower.includes('english')) return 'en';
      if (lower.includes('turkish')) return 'tr';
      if (lower.includes('german')) return 'de';
      if (lower.includes('arabic')) return 'ar';
      if (lower.includes('russian')) return 'ru';
    }

    if (/switch to (english|turkish|german|arabic|russian)/i.test(lower)) {
      const match = lower.match(/switch to (\w+)/);
      if (match) {
        const lang = match[1];
        if (lang === 'english') return 'en';
        if (lang === 'turkish') return 'tr';
        if (lang === 'german') return 'de';
        if (lang === 'arabic') return 'ar';
        if (lang === 'russian') return 'ru';
      }
    }

    if (/continue in (english|turkish|german|arabic|russian)/i.test(lower)) {
      const match = lower.match(/continue in (\w+)/);
      if (match) {
        const lang = match[1];
        if (lang === 'english') return 'en';
        if (lang === 'turkish') return 'tr';
        if (lang === 'german') return 'de';
        if (lang === 'arabic') return 'ar';
        if (lang === 'russian') return 'ru';
      }
    }

    // German phrases
    if (/auf deutsch bitte/i.test(lower) || /kannst du deutsch/i.test(lower)) return 'de';

    // Arabic phrases
    if (/بالعربي/.test(message) || /هل تتحدث العربية/.test(message)) return 'ar';

    // Russian phrases
    if (/говорите по русски/i.test(message) || /на русском/i.test(message)) return 'ru';

    return null;
  }

  /**
   * Resolves the primary language of the conversation from history.
   * Counts user message languages to find the majority.
   */
  private static resolveConversationPrimaryLanguage(
    history: { role: string; content: string }[]
  ): string {
    const userMessages = history.filter(m => m.role === 'user' && m.content);
    if (userMessages.length === 0) return 'unknown';

    const langCounts: Record<string, number> = {};
    for (const msg of userMessages.slice(-5)) { // Last 5 user messages
      try {
        const detected = detectLanguage(msg.content, []);
        const iso = this.nameToISO(detected.detected_patient_language);
        langCounts[iso] = (langCounts[iso] || 0) + 1;
      } catch {
        // Skip failed detections
      }
    }

    let maxLang = 'unknown';
    let maxCount = 0;
    for (const [lang, count] of Object.entries(langCounts)) {
      if (count > maxCount) {
        maxCount = count;
        maxLang = lang;
      }
    }

    return maxLang;
  }

  /**
   * Converts a language display name (e.g. 'Türkçe', 'İngilizce') to ISO code
   */
  private static nameToISO(name: string): string {
    const lower = name.toLowerCase().trim();
    return NAME_TO_ISO[lower] || NAME_TO_ISO[name] || 'tr';
  }
}
