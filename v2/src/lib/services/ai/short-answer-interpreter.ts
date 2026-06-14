import { PendingSlot } from './pending-question-resolver';

export type InterpretedIntent =
  | 'duration_answer'
  | 'affirmative_answer'
  | 'negative_answer'
  | 'timezone_answer'
  | 'time_answer'
  | 'transfer_request'
  | 'user_correction'
  | 'generic_short'
  | 'none';

export class ShortAnswerInterpreter {
  private static cleanText(str: string): string {
    return str
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .toLowerCase()
      .trim();
  }

  /**
   * Interprets the user's message, especially when it is short, by leveraging the active pending slot.
   */
  public static interpret(userText: string, pendingSlot: PendingSlot): InterpretedIntent {
    if (!userText) return 'none';
    const clean = this.cleanText(userText);
    const words = clean.split(/\s+/);
    const isShort = clean.length <= 40 || words.length <= 6;

    // 1. Frustration / User Correction (Priority: applies even if not extremely short, but up to 60 chars)
    const correctionKeywords = [
      'soru sordun',
      'cevap verdim',
      'yazdim ya',
      'az once',
      'anlamadin mi',
      'dedim ya',
      'zaten yazdim',
      'tekrar sor',
      'cevapladim',
      'okumuyor musun',
      'okumuyorsun'
    ];
    if (correctionKeywords.some(kw => clean.includes(kw)) || (clean.includes('cevap') && clean.includes('verdim')) || (clean.includes('dedim') && clean.includes('ya'))) {
      return 'user_correction';
    }

    if (!isShort) {
      return 'none';
    }

    // 2. Transfer Request
    if (clean === 'aktar' || clean === 'bagla' || clean === 'temsilci' || clean === 'baglayin' || clean === 'aktarin') {
      return 'transfer_request';
    }

    // 3. Timezone Answer
    const timezoneKeywords = ['bize gore', 'yerel', 'bizim saat', 'buranin', 'turkiye saat', 'ts'];
    if (timezoneKeywords.some(kw => clean.includes(kw)) && pendingSlot === 'timezone_clarification') {
      return 'timezone_answer';
    }

    // 4. Duration Answer
    const durationRegex = /\b\d+\s*(?:ay|yil|gun|hafta|sene|saat|dakika|aydir|yildir|gundur|haftadir|senedir)\b/i;
    const wordDurationKeywords = ['bir kac ay', 'bir kac gun', 'bir kac yil', 'bir kac hafta', 'aydir', 'yildir', 'haftadir'];
    if (durationRegex.test(clean) || wordDurationKeywords.some(kw => clean.includes(kw))) {
      return 'duration_answer';
    }

    // 5. Time Answer
    const timeRegex = /(?:\b\d{1,2}[:.]\d{2}\b|\bsaat\s*\d{1,2}\b|\b\d{1,2}\s*(?:olur|uygun|gibi|civari)\b)/i;
    if (timeRegex.test(clean) && (pendingSlot === 'call_time' || pendingSlot === 'call_date' || pendingSlot === 'timezone_clarification')) {
      return 'time_answer';
    }

    // 6. Affirmative (Yes)
    const affirmativeKeywords = ['olur', 'tamam', 'evet', 'tabi', 'tabiki', 'uygun', 'ok', 'peki', 'kabul', 'onayliyorum', 'dogrudur', 'himm olur', 'he olur'];
    if (affirmativeKeywords.includes(clean) || (words.length <= 2 && affirmativeKeywords.some(kw => clean.includes(kw)))) {
      return 'affirmative_answer';
    }

    // 7. Negative (No)
    const negativeKeywords = ['hayir', 'olmaz', 'kalsin', 'istemiyorum', 'hayır', 'istemem'];
    if (negativeKeywords.includes(clean) || (words.length <= 2 && negativeKeywords.some(kw => clean.includes(kw)))) {
      return 'negative_answer';
    }

    return 'generic_short';
  }
}
