export type ConversationIntent =
  | 'greeting'
  | 'identity_question'
  | 'clarification_question'
  | 'language_switch'
  | 'transfer_request'
  | 'human_transfer_request'
  | 'user_correction'
  | 'form_followup'
  | 'call_scheduling_request'
  | 'time_availability'
  | 'price_question'
  | 'distance_objection'
  | 'complaint_detail'
  | 'name_intent'
  | 'topic_switch'
  | 'doctor_lookup'
  | 'department_lookup'
  | 'location_direction'
  | 'form_summary_request'
  | 'capability_question'
  | 'abuse_or_insult'
  | 'prompt_challenge'
  | 'complaint_repeat_correction'
  | 'continuation_short_reply'
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
    const originalLower = text.toLowerCase().trim();

    // 1. Language Switch (highest priority)
    const languageSwitchPhrases = [
      'ingilizce konusabilir misin', 'ingilizce devam edelim', 'ingilizce yaz',
      'turkce devam edelim', 'turkce yaz', 'turkce konusalim',
      'almanca konusabilir misin', 'almanca yaz', 'arapca yaz', 'rusca yaz',
      'can you speak english', 'speak english', 'in english please', 'switch to english',
      'can you write in english', 'continue in english', 'let\'s speak english',
      'switch to turkish', 'continue in turkish',
      'auf deutsch bitte', 'kannst du deutsch', 'sprechen sie deutsch', 'auf deutsch schreiben',
      'هل تتحدث العربية', 'بالعربي', 'اكتب بالعربي',
      'на русском', 'по русски', 'говорите по русски'
    ];
    if (languageSwitchPhrases.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'language_switch';
    }

    // 2. User Correction / Frustration
    const userCorrectionKeywords = [
      'once soruma cevap ver', 'soruma cevap ver', 'yanlis anladin', 'yanlış anladın',
      'bunu sormadim', 'bunu sormadım', 'hata var', 'yanlis', 'yanlış',
      'dedim ya', 'soyledim ya', 'tekrar ediyorsun', 'ayni seyi soyluyorsun',
      'i already told you', 'already said', 'you keep repeating',
      'soyledin ya', 'söyledin ya', 'sen dedin ya',
      'daha once soyledim', 'daha önce söyledim',
      'daha once belirttim', 'daha önce belirttim',
      'belirtmistim', 'belirtmiştim', 'belirttim',
      'yazdim ya', 'yazdım ya',
      'ayni seyi soyleme', 'aynı şeyi söyleme'
    ];
    if (userCorrectionKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'user_correction';
    }

    // 3. Human Transfer Request
    const transferKeywords = [
      'aktar', 'bagla', 'temsilci', 'musteri hizmetleri', 'canli destek',
      'arayabilirsiniz', 'arayabilirsin', 'operator', 'insanla', 'gercek kisi',
      'yetkili', 'uzmana bagla', 'baglayin', 'görüştür', 'gorustur'
    ];
    if (transferKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'human_transfer_request';
    }

    // 4. Identity Question
    const identityKeywords = [
      'kimsin', 'kimsiniz', 'kim bu', 'bu kim', 'sen kimsin', 'siz kimsiniz',
      'kim yaziyor', 'kimle konusuyorum', 'kimle gorusuyorum', 'kiminle konusuyorum', 'kiminle gorusuyorum',
      'who are you', 'who is this', 'who am i talking to', 'what is your name'
    ];
    if (identityKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'identity_question';
    }

    // 5. Prompt Challenge / Bot Accusation / AI Accusation
    const challengeKeywords = [
      'sistem prompt', 'sen bot musun', 'uydurma', 'yapay zeka', 'talimatların ne',
      'sistem talimati', 'hangi model', 'system prompt', 'are you a bot', 'your instructions',
      'prompt', 'promt', 'bot musun', 'botsun', 'robot musun', 'yapay zeka mısın', 'yapay zeka misin',
      'insan mısın', 'insan misin', 'yapayzeka', 'gpt', 'gemini', 'openai', 'claude', 'dil modeli'
    ];
    if (challengeKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'prompt_challenge';
    }

    // 6. Abuse or Insult
    const abuseKeywords = [
      'geri zekalı', 'salak', 'aptal', 'mal', 'gerizekalı', 'siktir', 'seni şikayet',
      'idiot', 'stupid', 'asshole', 'fuck', 'shit'
    ];
    if (abuseKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'abuse_or_insult';
    }

    // 7. Form Followup
    const formKeywords = [
      'form doldurdum', 'basvuru yaptim', 'form gonderdim', 'formu doldurdum',
      'form gondermistim', 'basvuru yapmistim', 'form doldurmustum', 'basvuru yapmıstım',
      'kontrol et', 'formumu kontrol et', 'basvurum vardi', 'basvurumu kontrol'
    ];
    if (formKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'form_followup';
    }

    // 8. Name Intent
    const nameKeywords = ['adım', 'ismim', 'benim adım', 'benim ismim', 'adım ', 'ismim '];
    const blocklistedWords = ['kiminle', 'kimle', 'kim', 'ne', 'neden', 'niye', 'nasil', 'hangi', 'kac', 'nerede', 'suan', 'simdi'];
    const blocklistedNamePhrases = [
      'ben kiminle gorusuyorum',
      'ben kiminle konusuyorum',
      'kiminle gorusuyorum',
      'kiminle konusuyorum',
      'adin ne',
      'isminiz ne',
      'sen kimsin',
      'siz kimsiniz'
    ];
    const words = clean.split(/\s+/);
    const hasBlocklistedWord = words.some(w => blocklistedWords.includes(w));
    const hasBlocklistedPhrase = blocklistedNamePhrases.some(phrase => clean.includes(phrase));

    if (!hasBlocklistedWord && !hasBlocklistedPhrase) {
      if (nameKeywords.some(kw => clean.includes(kw)) || /^(?:ben|adım|ismim)\s+[a-z]+/i.test(clean)) {
        return 'name_intent';
      }
    }

    const callSchedulingKeywords = [
      'telefon gorusmesi', 'telefonla gorus', 'telefonla arayin',
      'telefonla ulasin', 'arama planlayalim', 'arama yapin',
      'beni arayin', 'sizi arayayim', 'arar misiniz', 'ararmisiniz',
      'beni arayabilir misiniz', 'arama yapar misiniz', 'telefonla gorusebilir miyiz',
      'beni ararlar mi', 'hasta danismani arasin', 'sizinle gorusmek istiyorum',
      'telefonla bilgi almak istiyorum', 'arar mi', 'ararlar mi'
    ];
    const hasCallRequestCombined = (clean.includes('telefon') || clean.includes('tel')) && (
      clean.includes('randevu') || clean.includes('gorus') || clean.includes('ulas') || clean.includes('ara') || clean.includes('arar')
    );
    if (callSchedulingKeywords.some(kw => clean.includes(kw)) || /\barayın\b/i.test(clean) || /\barayin\b/i.test(clean) || hasCallRequestCombined) {
      return 'call_scheduling_request';
    }

    // 10. Time Availability
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

    // 11. Price Question
    const priceKeywords = [
      'fiyat', 'ucret', 'tutar', 'kac para', 'ne kadar', 'fiyatı ne', 'fiyatı kac', 'fiyatiniz'
    ];
    if (priceKeywords.some(kw => clean.includes(kw))) {
      return 'price_question';
    }

    // 12. Distance Objection
    const distanceKeywords = [
      'uzak', 'mesafe', 'gelemiyorum', 'gelmem zor', 'konya cok uzak', 'konya uzak', 'amerika uzak', 'amerika cok uzak'
    ];
    if (distanceKeywords.some(kw => clean.includes(kw))) {
      return 'distance_objection';
    }

    // 13. Doctor Lookup
    const doctorKeywords = [
      'doktor kim', 'doktorlar', 'hekim', 'cerrah', 'uzman', 'hangi doktor', 'beyin cerrahi kim', 'doktoru'
    ];
    if (doctorKeywords.some(kw => clean.includes(kw))) {
      return 'doctor_lookup';
    }

    // 14. Department Lookup
    const departmentKeywords = [
      'hangi bolum', 'hangi brans', 'bolum bilgisi'
    ];
    if (departmentKeywords.some(kw => clean.includes(kw))) {
      return 'department_lookup';
    }

    // 15. Location Direction
    const locationKeywords = [
      'neredesiniz', 'adres', 'nasil gelirim', 'konum', 'yol tarifi', 'harita'
    ];
    if (locationKeywords.some(kw => clean.includes(kw))) {
      return 'location_direction';
    }

    // 16. Form Summary Request
    const formSummaryKeywords = [
      'formumda ne', 'form bilgim', 'formda ne yazdim'
    ];
    if (formSummaryKeywords.some(kw => clean.includes(kw))) {
      return 'form_summary_request';
    }

    // 17. Capability Question
    const capabilityKeywords = [
      'neler yapabilirsiniz', 'nasil yardimci olabilirsiniz', 'sen ne yaparsin'
    ];
    if (capabilityKeywords.some(kw => clean.includes(kw))) {
      return 'capability_question';
    }

    // 18. Topic Switch (Departments)
    const departments = [
      'dahiliye', 'kardiyoloji', 'göz', 'goz', 'cildiye', 'ortopedi', 'fizik tedavi',
      'noroloji', 'nöroloji', 'üroloji', 'uroloji', 'kbb', 'kulak burun bogaz', 'plastik cerrahi',
      'tup bebek', 'tüp bebek', 'pediatri', 'cocuk hastaliklari', 'kadin dogum', 'jinekoloji',
      'genel cerrahi', 'onkoloji', 'beyin cerrahi', 'gogus hastaliklari'
    ];
    if (departments.some(dep => clean.includes(dep))) {
      return 'topic_switch';
    }

    // 19. Complaint Detail
    const complaintKeywords = [
      'agri', 'sanci', 'fitik', 'rapor', 'tahlil', 'mr', 'rontgen', 'sonuc', 'belge',
      'ameliyat', 'tedavi', 'sikayet', 'hastalik', 'mide', 'basim', 'belim', 'dizim',
      'agriyor', 'aci', 'sislik', 'kanama', 'ates', 'oksuruk', 'nefes darligi'
    ];
    if (complaintKeywords.some(kw => clean.includes(kw))) {
      return 'complaint_detail';
    }

    // 20. Clarification Question
    const clarificationKeywords = [
      'hangi saat', 'ne demek', 'nasil yani', 'anlamadim', 'ne diyorsun',
      'aciklar misin', 'aciklayabilir misin', 'ne kastediyorsun', 'neden',
      'what do you mean', 'can you explain', 'i don\'t understand', 'pardon'
    ];
    if (clarificationKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'clarification_question';
    }

    // 20.5. Continuation Short Reply
    const continuationShortReplies = ['eee', 'ee', 'e', 'devam', 'sonra', 'tamam sonra', '?'];
    if (continuationShortReplies.includes(clean)) {
      return 'continuation_short_reply';
    }

    // 21. Greeting
    const greetingKeywords = [
      'merhaba', 'selam', 'merhabalar', 'iyi gunler', 'iyi aksamlar', 'iyi sabahlar',
      'gunaydin', 'kolay gelsin', 'iyi calismalar', 'hi', 'hello', 'hey',
      'efendim', 'buyrun', 'buyurun', 'alo'
    ];
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
