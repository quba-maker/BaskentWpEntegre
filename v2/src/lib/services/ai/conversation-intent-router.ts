export type ConversationIntent =
  | 'greeting'
  | 'identity_question'
  | 'clarification_question'
  | 'language_switch'
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
   * 
   * P0.11 Priority Order:
   *   language_switch > identity_question > name_intent > transfer_request >
   *   call_scheduling > time_availability > price > distance > topic_switch >
   *   complaint > clarification_question > greeting > generic_other
   */
  public static route(text: string): ConversationIntent {
    if (!text) return 'generic_other';
    const clean = this.cleanText(text);
    const originalLower = text.toLowerCase().trim();

    // P0.11: 0. Language Switch (highest priority — trumps all pending slots)
    const languageSwitchPhrases = [
      // Turkish
      'ingilizce konusabilir misin', 'ingilizce devam edelim', 'ingilizce yaz',
      'turkce devam edelim', 'turkce yaz', 'turkce konusalim',
      'almanca konusabilir misin', 'almanca yaz', 'arapca yaz', 'rusca yaz',
      // English
      'can you speak english', 'speak english', 'in english please', 'switch to english',
      'can you write in english', 'continue in english', 'let\'s speak english',
      'switch to turkish', 'continue in turkish',
      // German
      'auf deutsch bitte', 'kannst du deutsch', 'sprechen sie deutsch', 'auf deutsch schreiben',
      // Arabic
      'هل تتحدث العربية', 'بالعربي', 'اكتب بالعربي',
      // Russian
      'на русском', 'по русски', 'говорите по русски'
    ];
    if (languageSwitchPhrases.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'language_switch';
    }

    // P0.11: 1. Identity Question (trumps pending slots)
    const identityKeywords = [
      'kimsin', 'kimsiniz', 'kim bu', 'bu kim', 'sen kimsin', 'siz kimsiniz',
      'kim yaziyor', 'kimle konusuyorum', 'kimle gorusuyorum',
      'who are you', 'who is this', 'who am i talking to', 'what is your name'
    ];
    if (identityKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'identity_question';
    }

    // 2. Name Intent
    const nameKeywords = ['adım', 'ismim', 'benim adım', 'benim ismim', 'adım ', 'ismim '];
    if (nameKeywords.some(kw => clean.includes(kw)) || /^(?:ben|adım|ismim)\s+[a-z]+/i.test(clean)) {
      return 'name_intent';
    }

    // 3. Transfer Request
    const transferKeywords = [
      'aktar', 'bagla', 'temsilci', 'musteri hizmetleri', 'canli destek',
      'arayabilirsiniz', 'arayabilirsin', 'operator', 'insanla', 'gercek kisi',
      'yetkili', 'uzmana bagla', 'baglayin'
    ];
    if (transferKeywords.some(kw => clean.includes(kw))) {
      return 'transfer_request';
    }

    // 4. Call Scheduling Request (Asking for a call)
    const callSchedulingKeywords = [
      'telefon gorusmesi', 'telefonla gorus', 'telefonla arayin',
      'telefonla ulasin', 'arama planlayalim', 'arama yapin',
      'beni arayin', 'sizi arayayim', 'arar misiniz', 'ararmisiniz'
    ];
    if (callSchedulingKeywords.some(kw => clean.includes(kw)) || /\barayın\b/i.test(clean) || /\barayin\b/i.test(clean)) {
      return 'call_scheduling_request';
    }

    // 5. Time Availability (Stating a time suitability)
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

    // 6. Price Question
    const priceKeywords = [
      'fiyat', 'ucret', 'tutar', 'kac para', 'ne kadar', 'fiyatı ne', 'fiyatı kac', 'fiyatiniz'
    ];
    if (priceKeywords.some(kw => clean.includes(kw))) {
      return 'price_question';
    }

    // 7. Distance Objection
    const distanceKeywords = [
      'uzak', 'mesafe', 'gelemiyorum', 'gelmem zor', 'konya cok uzak', 'konya uzak', 'amerika uzak', 'amerika cok uzak'
    ];
    if (distanceKeywords.some(kw => clean.includes(kw))) {
      return 'distance_objection';
    }

    // 8. Topic Switch
    const departments = [
      'dahiliye', 'kardiyoloji', 'göz', 'goz', 'cildiye', 'ortopedi', 'fizik tedavi',
      'noroloji', 'nöroloji', 'üroloji', 'uroloji', 'kbb', 'kulak burun bogaz', 'plastik cerrahi',
      'tup bebek', 'tüp bebek', 'pediatri', 'cocuk hastaliklari', 'kadin dogum', 'jinekoloji',
      'genel cerrahi', 'onkoloji', 'beyin cerrahi', 'gogus hastaliklari'
    ];
    if (departments.some(dep => clean.includes(dep))) {
      return 'topic_switch';
    }

    // 9. Complaint Detail
    const complaintKeywords = [
      'agri', 'sanci', 'fitik', 'rapor', 'tahlil', 'mr', 'rontgen', 'sonuc', 'belge',
      'ameliyat', 'tedavi', 'sikayet', 'hastalik', 'mide', 'basim', 'belim', 'dizim',
      'agriyor', 'aci', 'sislik', 'kanama', 'ates', 'oksuruk', 'nefes darligi'
    ];
    if (complaintKeywords.some(kw => clean.includes(kw))) {
      return 'complaint_detail';
    }

    // P0.11: 10. Clarification Question (lower priority than complaint/topic but above greeting)
    const clarificationKeywords = [
      'hangi saat', 'ne demek', 'nasil yani', 'anlamadim', 'ne diyorsun',
      'aciklar misin', 'aciklayabilir misin', 'ne kastediyorsun', 'neden',
      'what do you mean', 'can you explain', 'i don\'t understand', 'pardon'
    ];
    if (clarificationKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'clarification_question';
    }

    // 11. Greeting (expanded with Turkish attention/acknowledgment words)
    const greetingKeywords = [
      'merhaba', 'selam', 'merhabalar', 'iyi gunler', 'iyi aksamlar', 'iyi sabahlar',
      'gunaydin', 'kolay gelsin', 'iyi calismalar', 'hi', 'hello', 'hey',
      'efendim', 'buyrun', 'buyurun', 'alo'
    ];
    // Short standalone greetings (exact or near-exact match for very short messages)
    const shortGreetings = ['hi', 'hı', 'alo', 'hey', 'efendim', 'buyrun', 'buyurun', 'selam', 'merhaba', 'merhabalar', 'hello'];
    if (shortGreetings.includes(clean)) {
      return 'greeting';
    }
    if (greetingKeywords.some(kw => clean.includes(kw))) {
      return 'greeting';
    }

    return 'generic_other';
  }
}
