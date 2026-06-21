/**
 * P0.11: MultilingualTimeIntentResolver
 * Shared SaaS helper to normalize and classify relative time keywords, dayparts,
 * and explicit call scheduling requests in Turkish, English, German, Arabic, and Dutch.
 */

export interface MultilingualTimeIntentResult {
  hasExplicitCallRequest: boolean;
  hasRelativeDate: boolean;
  relativeDateType: 'today' | 'tomorrow' | 'weekday' | 'unknown';
  hasDaypart: boolean;
  daypart: 'morning' | 'afternoon' | 'evening' | 'night' | 'unknown';
  detectedLanguageHint: 'tr' | 'en' | 'de' | 'ar' | 'nl' | 'unknown';
}

export class MultilingualTimeIntentResolver {
  /**
   * Normalizes text by removing diacritics, punctuation, converting to lowercase,
   * and applying language-specific letter mapping.
   */
  public static normalize(text: string): string {
    if (!text) return '';
    let normalized = text.toLowerCase().trim();

    // Strip common punctuation/formatting
    normalized = normalized.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?’"“*]/g, ' ');

    // 1. Turkish Normalization
    normalized = normalized
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c');

    // 2. German Normalization
    normalized = normalized
      .replace(/ä/g, 'a')
      .replace(/ß/g, 'ss');

    // 3. Arabic Normalization (Harakat, Alef variants, Tah Marbuta, Yeh/Alif Maksura)
    normalized = normalized
      .replace(/[\u064B-\u065F\u0670]/g, '') // Strip diacritics/harakat
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/[ىي]/g, 'ي')
      .replace(/ـ/g, ''); // Strip tatweel

    // Collapse whitespace
    normalized = normalized.replace(/\s+/g, ' ');

    return normalized.trim();
  }

  /**
   * Resolves canonical call scheduling and time intent parameters from any given message.
   */
  public static resolve(text: string): MultilingualTimeIntentResult {
    const clean = this.normalize(text);

    // Language Detection Hints
    const trIndicator = /\b(bugun|yarin|aksam|sabah|oglen|haftaici|haftasonu|arama|gorusme|temsilci|telefonla|arayin)\b/;
    const enIndicator = /\b(today|tomorrow|morning|afternoon|evening|night|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|call)\b/;
    const deIndicator = /\b(heute|morgen|abend|nachmittag|anrufen|sprech|anruf|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|fruh)\b/;
    const deIndicatorNoMorgen = /\b(heute|abend|nachmittag|anrufen|sprech|anruf|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|fruh)\b/;
    const arIndicator = /[\u0600-\u06FF]/; // Any Arabic character
    const nlIndicator = /\b(vandaag|morgen|vanavond|bellen|bel|gesprek|ochtend|middag|avond|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/;
    const nlIndicatorNoMorgen = /\b(vandaag|vanavond|bellen|bel|gesprek|ochtend|middag|avond|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/;

    let detectedLanguageHint: 'tr' | 'en' | 'de' | 'ar' | 'nl' | 'unknown' = 'unknown';

    if (arIndicator.test(clean)) {
      detectedLanguageHint = 'ar';
    } else if (trIndicator.test(clean)) {
      detectedLanguageHint = 'tr';
    } else if (deIndicatorNoMorgen.test(clean)) {
      detectedLanguageHint = 'de';
    } else if (nlIndicatorNoMorgen.test(clean)) {
      detectedLanguageHint = 'nl';
    } else if (deIndicator.test(clean)) {
      detectedLanguageHint = 'de';
    } else if (nlIndicator.test(clean)) {
      detectedLanguageHint = 'nl';
    } else if (enIndicator.test(clean)) {
      detectedLanguageHint = 'en';
    }

    // 1. Explicit Call Request check with false-positive prevention
    let hasExplicitCallRequest = false;

    // Positive call scheduling request keywords across 5 languages
    const callPhrases = [
      // Turkish
      'beni arayin', 'beni arayin', 'arar misiniz', 'ararmisiniz', 'telefon ile gorusme', 'telefonla gorusme',
      'telefon gorusmesi', 'arama plani', 'temsilci arasin', 'telefonla arayin', 'arama planlayalim',
      'arama yapin', 'arama olabilir', 'gorusme talebi', 'arama planlayabiliriz', 'arama yapabiliriz',
      // English
      'call me', 'phone call', 'have a call', 'schedule a call', 'please call', 'call me back', 'want a call', 'have a phone call',
      // German
      'anrufen', 'rufen sie mich an', 'telefonisch sprechen', 'telefonisch kontaktieren', 'anruf planen', 'telefonat',
      // Arabic (Normalized versions)
      'اتصل بي', 'مكالمه هاتفيه', 'اريد اتصال', 'تواصل معي', 'اتصلوا بي', 'اتصال',
      // Dutch
      'bellen', 'telefonisch gesprek', 'bel mij', 'telefonisch contact', 'opbellen'
    ];

    // Blocklist to avoid false-positives
    const blocklist = [
      'call center', 'callcentre', 'i will call', 'i can call', 'ich rufe an', 
      'ich werde anrufen', 'telefon numaram', 'phone number', 'my number', 
      'telefonnummer', 'numaram', 'numarami', 'numaramı'
    ];

    const hasPositiveCallPhrase = callPhrases.some(phrase => clean.includes(phrase));
    const hasBlocklistPhrase = blocklist.some(phrase => clean.includes(phrase));

    if (hasPositiveCallPhrase) {
      if (hasBlocklistPhrase) {
        // If it matches blocklist, only allow if there is an explicit call indicator that is NOT part of the blocklisted text.
        // For example: "call me. my phone number is..." has "call me" which is outside "phone number".
        // A simple way is to check if the clean string minus blocklisted phrase still contains any positive phrase.
        let stripped = clean;
        for (const bl of blocklist) {
          stripped = stripped.replace(bl, '');
        }
        hasExplicitCallRequest = callPhrases.some(phrase => stripped.includes(phrase));
      } else {
        hasExplicitCallRequest = true;
      }
    }

    // 2. Relative Date Resolution
    let hasRelativeDate = false;
    let relativeDateType: 'today' | 'tomorrow' | 'weekday' | 'unknown' = 'unknown';

    // Today keywords
    const todayKeywords = [
      // TR
      'bugun', 'bu gun',
      // EN
      'today', 'tonight',
      // DE
      'heute',
      // AR
      'اليوم',
      // NL
      'vandaag', 'vanavond'
    ];

    // Tomorrow keywords
    const tomorrowKeywords = [
      // TR
      'yarin', 'ertesi gun',
      // EN
      'tomorrow',
      // DE
      'morgen',
      // AR
      'غدا', 'بكره',
      // NL
      'morgen'
    ];

    // Weekdays
    const weekdayKeywords = [
      // TR
      'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar',
      // EN
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      // DE
      'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
      // AR
      'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس', 'الجمعة', 'السبت', 'الاحد',
      // NL
      'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'
    ];

    if (todayKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(clean) || clean.includes(kw))) {
      hasRelativeDate = true;
      relativeDateType = 'today';
    } else if (tomorrowKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(clean) || clean.includes(kw))) {
      hasRelativeDate = true;
      relativeDateType = 'tomorrow';
    } else if (weekdayKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(clean) || clean.includes(kw))) {
      hasRelativeDate = true;
      relativeDateType = 'weekday';
    }

    // 3. Daypart Resolution
    let hasDaypart = false;
    let daypart: 'morning' | 'afternoon' | 'evening' | 'night' | 'unknown' = 'unknown';

    const morningKeywords = [
      'sabah', 'morning', 'ochtend', 'fruh', 'صباح'
    ];
    const afternoonKeywords = [
      'oglen', 'ogle', 'afternoon', 'noon', 'nachmittag', 'mittag', 'middag', 'ظهر', 'بعد الظهر'
    ];
    const eveningKeywords = [
      'aksam', 'evening', 'abend', 'avond', 'vanavond', 'مساء', 'عصر'
    ];
    const nightKeywords = [
      'gece', 'night', 'tonight', 'nacht', 'ليل'
    ];

    if (morningKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(clean) || clean.includes(kw))) {
      hasDaypart = true;
      daypart = 'morning';
    } else if (afternoonKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(clean) || clean.includes(kw))) {
      hasDaypart = true;
      daypart = 'afternoon';
    } else if (eveningKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(clean) || clean.includes(kw))) {
      hasDaypart = true;
      daypart = 'evening';
    } else if (nightKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(clean) || clean.includes(kw))) {
      hasDaypart = true;
      daypart = 'night';
    }

    return {
      hasExplicitCallRequest,
      hasRelativeDate,
      relativeDateType,
      hasDaypart,
      daypart,
      detectedLanguageHint
    };
  }
}
