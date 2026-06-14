export type ConversationIntent =
  | 'greeting'
  | 'transfer_request'
  | 'call_scheduling_request'
  | 'time_availability'
  | 'price_question'
  | 'distance_objection'
  | 'complaint_detail'
  | 'name_intent'
  | 'topic_switch'
  | 'generic_other';

export class ConversationIntentRouter {
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
   * Routes the incoming message text to the most appropriate intent.
   * LLM-independent, lightweight regex and keyword-based.
   */
  public static route(text: string): ConversationIntent {
    if (!text) return 'generic_other';
    const clean = this.cleanText(text);

    // 1. Name Intent
    const nameKeywords = ['adım', 'ismim', 'benim adım', 'benim ismim', 'adım ', 'ismim '];
    if (nameKeywords.some(kw => clean.includes(kw)) || /^(?:ben|adım|ismim)\s+[a-z]+/i.test(clean)) {
      return 'name_intent';
    }

    // 2. Transfer Request
    const transferKeywords = [
      'aktar', 'bagla', 'temsilci', 'musteri hizmetleri', 'canli destek',
      'arayabilirsiniz', 'arayabilirsin', 'operator', 'insanla', 'gercek kisi',
      'yetkili', 'uzmana bagla', 'baglayin'
    ];
    if (transferKeywords.some(kw => clean.includes(kw))) {
      return 'transfer_request';
    }

    // 3. Call Scheduling Request (Asking for a call)
    const callSchedulingKeywords = [
      'telefon gorusmesi', 'telefonla gorus', 'telefonla arayin',
      'telefonla ulasin', 'arama planlayalim', 'arama yapin',
      'beni arayin', 'sizi arayayim', 'arar misiniz', 'ararmisiniz'
    ];
    if (callSchedulingKeywords.some(kw => clean.includes(kw)) || /\barayın\b/i.test(clean) || /\barayin\b/i.test(clean)) {
      return 'call_scheduling_request';
    }

    // 4. Time Availability (Stating a time suitability)
    // Matches expressions like "saat 17 olur", "saat 5 gibi", "yarın öğleden sonra", "bize göre olsun", timezone basis
    const timeIndicators = [
      'saat', 'uygun', 'musait', 'olabilir', 'gibi', 'civari', 'yarin', 'bugun',
      'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar',
      'bize gore', 'turkiye saat', 'amerika saat', 'sizin saat', 'ogleden sonra', 'haftaici', 'haftasonu'
    ];
    const numericTimePattern = /(?:\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(?:de|da|te|ta|e|a|ye|ya|sularında|sularinda|gibi|civari|civarinda|civarı|civarında)\b)/;
    const hasTimeWords = timeIndicators.some(kw => clean.includes(kw));
    const hasNumericTime = numericTimePattern.test(clean);

    const isExplicitTimePhrase = [
      'bize gore', 'turkiye saat', 'amerika saat', 'sizin saat', 'yarin ogleden sonra',
      'yarin sabah', 'yarin aksam', 'ogleden sonra'
    ].some(kw => clean.includes(kw));

    if (isExplicitTimePhrase || (hasTimeWords && (hasNumericTime || clean.includes('olur') || clean.includes('uygun') || clean.includes('musait') || clean.includes('saat')))) {
      return 'time_availability';
    }

    // 5. Price Question
    const priceKeywords = [
      'fiyat', 'ucret', 'tutar', 'kac para', 'ne kadar', 'fiyatı ne', 'fiyatı kac', 'fiyatiniz'
    ];
    if (priceKeywords.some(kw => clean.includes(kw))) {
      return 'price_question';
    }

    // 6. Distance Objection
    const distanceKeywords = [
      'uzak', 'mesafe', 'gelemiyorum', 'gelmem zor', 'konya cok uzak', 'konya uzak', 'amerika uzak', 'amerika cok uzak'
    ];
    if (distanceKeywords.some(kw => clean.includes(kw))) {
      return 'distance_objection';
    }

    // 7. Topic Switch
    // Checks if patient mentions a new medical department or wants to switch topics
    const departments = [
      'dahiliye', 'kardiyoloji', 'göz', 'goz', 'cildiye', 'ortopedi', 'fizik tedavi',
      'noroloji', 'nöroloji', 'üroloji', 'uroloji', 'kbb', 'kulak burun bogaz', 'plastik cerrahi',
      'tup bebek', 'tüp bebek', 'pediatri', 'cocuk hastaliklari', 'kadin dogum', 'jinekoloji',
      'genel cerrahi', 'onkoloji', 'beyin cerrahi', 'gogus hastaliklari'
    ];
    if (departments.some(dep => clean.includes(dep))) {
      return 'topic_switch';
    }

    // 8. Complaint Detail
    // Medical symptoms or reports
    const complaintKeywords = [
      'agri', 'sanci', 'fitik', 'rapor', 'tahlil', 'mr', 'rontgen', 'sonuc', 'belge',
      'ameliyat', 'tedavi', 'sikayet', 'hastalik', 'mide', 'basim', 'belim', 'dizim',
      'agriyor', 'aci', 'sislik', 'kanama', 'ates', 'oksuruk', 'nefes darligi'
    ];
    if (complaintKeywords.some(kw => clean.includes(kw))) {
      return 'complaint_detail';
    }

    // 9. Greeting
    const greetingKeywords = [
      'merhaba', 'selam', 'merhabalar', 'iyi gunler', 'iyi aksamlar', 'iyi sabahlar',
      'gunaydin', 'kolay gelsin', 'iyi calismalar', 'hi', 'hello', 'hey'
    ];
    if (greetingKeywords.some(kw => clean.includes(kw))) {
      return 'greeting';
    }

    return 'generic_other';
  }
}
