import { hasRealDatePattern } from '../../utils/date-parser';

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
  | 'cannot_travel_objection'
  | 'thanks_but_continue'
  | 'open_continuation'
  | 'polite_close'
  | 'complaint_detail'
  | 'name_intent'
  | 'topic_switch'
  | 'doctor_lookup'
  | 'department_lookup'
  | 'location_direction'
  | 'address_full_request'
  | 'form_summary_request'
  | 'capability_question'
  | 'abuse_or_insult'
  | 'prompt_challenge'
  | 'complaint_repeat_correction'
  | 'continuation_short_reply'
  | 'next_step_request'
  | 'process_question'
  | 'callback_confirmation'
  | 'schedule_confirmation'
  | 'arrival_date_answer'
  | 'callback_time_answer'
  | 'call_time_answer'
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

  // P0.19: DEFAULT_DEPARTMENTS — can be overridden per-tenant via brain.context.config.intentDepartments
  // Healthcare-specific defaults, used when no tenant override is provided
  private static DEFAULT_DEPARTMENTS = [
    'dahiliye', 'kardiyoloji', 'goz', 'cildiye', 'ortopedi', 'fizik tedavi',
    'noroloji', 'uroloji', 'kbb', 'kulak burun bogaz', 'plastik cerrahi',
    'tup bebek', 'pediatri', 'cocuk hastaliklari', 'kadin dogum', 'jinekoloji',
    'genel cerrahi', 'onkoloji', 'beyin cerrahi', 'gogus hastaliklari'
  ];

  /**
   * Routes the incoming message text to the most appropriate intent.
   * LLM-independent, lightweight regex and keyword-based.
   *
   * P0.19: tenantDepartments allows per-tenant topic_switch department override.
   * Pass TenantConfigResolver.getTopicDepartments(brain)?.flatMap(d=>d.keywords.map(k=>k.toLowerCase()))
   */
  public static route(text: string, tenantDepartments?: string[]): ConversationIntent {
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
    const hasAbuse = abuseKeywords.some(kw => {
      if (kw === 'mal') {
        return /\bmal\b/i.test(clean);
      }
      return clean.includes(kw) || originalLower.includes(kw);
    });
    if (hasAbuse) {
      return 'abuse_or_insult';
    }

    // 7. Form Followup
    const formKeywords = [
      'form doldurdum', 'basvuru yaptim', 'form gonderdim', 'formu doldurdum',
      'form gondermistim', 'basvuru yapmistim', 'form doldurmustum', 'basvuru yapmıstım',
      'kontrol et', 'formumu kontrol et', 'basvurum vardi', 'basvurumu kontrol'
    ];
    const formRegexes = [
      /form.*doldur/i,
      /form.*gond/i,
      /basvuru.*yap/i,
      /basvurum.*var/i,
      /form.*kontrol/i,
      /basvuru.*kontrol/i
    ];
    if (formKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw)) ||
        formRegexes.some(rx => rx.test(clean) || rx.test(originalLower))) {
      return 'form_followup';
    }

    // 7.5. Process Question (High Priority, overrides complaint_detail and others)
    const processKeywords = [
      'surec', 'süreç', 'nasil isliyor', 'nasıl işliyor', 'nasil calisir', 'nasıl çalışır',
      'asamalar', 'aşamalar', 'nasil ilerler', 'nasil ilerliyor', 'nasıl ilerliyor',
      'sonra ne olacak', 'check-up sureci', 'checkup sureci', 'check-up süreci',
      'tedavi sureci', 'tedavi süreci', 'surec nasil', 'süreç nasıl'
    ];
    if (processKeywords.some(kw => clean.includes(kw))) {
      return 'process_question';
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

    // P0.28.2: callback_time_answer
    const hasCallbackTimeKw = [
      'saat', 'pazartesi', 'salı', 'sali', 'çarşamba', 'carsamba', 'perşembe', 'persembe', 'cuma', 'cumartesi', 'pazar',
      'yarın', 'yarin', 'bugün', 'bugun', 'sabah', 'öğlen', 'oglen', 'öğleden sonra', 'ogleden sonra', 'akşam', 'aksam', 'gece',
      'hafta içi', 'haftaici', 'hafta sonu', 'haftasonu'
    ].some(kw => clean.includes(kw)) || /(?:\b\d{1,2}[:. ]\d{2}\b|\b\d{1,2}\s*(?:de|da|te|ta|e|a|ye|ya|gibi|civari|civarinda|sularinda|sularında|olur|uygun|musait|müsait)\b)/.test(clean);

    const hasMonthKw = [
      'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
      'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik'
    ].some(kw => clean.includes(kw)) || hasRealDatePattern(clean);

    if (hasCallbackTimeKw && !hasMonthKw) {
      return 'callback_time_answer';
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
    // P0.18: City-specific keywords removed (konya uzak, amerika uzak etc.) — use generic terms only.
    // Tenants needing city-specific keywords should configure via brain.context.config.locationDistanceKeywords
    const distanceKeywords = [
      'uzak', 'mesafe', 'gelemiyorum', 'gelmem zor', 'cok uzak', 'uzakta', 'uzakligi'
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

    // 15. Address / Location Direction
    const fullAddressKeywords = [
      'عنوان الكامل', 'العنوان الكامل',
      'أرسل العنوان', 'ارسل العنوان',
      'وين بالضبط',
      'الموقع',
      'لوكيشن',
      'google maps', 'google map', 'maps',
      'tam adres',
      'açık adres', 'acik adres',
      'konum gönder', 'konum gonder',
      'konum', 'harita', 'adres'
    ];
    if (fullAddressKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'address_full_request';
    }

    const iraqBranchKeywords = [
      'هل لديكم فرع في عراق', 'هل عندكم فرع في عراق', 'فرع في عراق',
      'do you have branch in iraq', 'have branch in iraq', 'branch in iraq',
      'ırak\'ta şubeniz var mı', 'irakta subeniz var mi', 'ırakta şube var mı', 'irak sube'
    ];
    const basicLocationKeywords = [
      'nerede', 'neredesiniz', 'hangi sehir', 'hangi şehir',
      'turkiyede mi', 'türkiyede mi', 'turkiye\'de mi', 'türkiye\'de mi',
      'وين', 'وين عنوان', 'يعني بلتركيا', 'بلتركيا', 'بالتركيا', 'في تركيا',
      'nasil gelirim', 'nasıl gelirim', 'yol tarifi'
    ];
    if (iraqBranchKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw)) ||
        basicLocationKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
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
      'neler yapabilirsiniz', 'nasil yardimci olabilirsiniz', 'sen ne yaparsin',
      'كيف تساعدني', 'كيف يمكنك مساعدتي', 'ماذا تفعل', 'كيف بتساعدني'
    ];
    if (capabilityKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      return 'capability_question';
    }

    // 18. Topic Switch (Departments)
    // P0.19: Use tenant override if provided, otherwise fall back to DEFAULT_DEPARTMENTS
    const departments = tenantDepartments && tenantDepartments.length > 0
      ? tenantDepartments.map(d => this.cleanText(d))
      : this.DEFAULT_DEPARTMENTS;
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

    // P0.16-J: Next Step / Consultant Ownership Intent
    // Catches: "şimdi nasıl olacak", "ee yani", "belirleyelim",
    //          "yardımcı olmuyorsunuz", "beni kim arayacak", "ne yapmam gerekiyor"
    // NOTE: 'ne zaman' intentionally excluded — matches arrival/business-hours questions
    //       and was causing misrouting to next_step_request bypass (Gate Diet P0.30)
    const nextStepKeywords = [
      'simdi nasil olacak', 'simdi ne olacak', 'nasil olacak', 'ne olacak simdi',
      'ee yani', 'e yani', 'yani ne',
      'belirleyelim', 'netlestirelim', 'kararlaştiralim', 'kararlaştiralim',
      'yardimci olmuyorsunuz', 'yardim etmiyorsunuz',
      'beni kim arayacak', 'kim arayacak', 'siz mi arayacaksiniz',
      'ne yapmam gerekiyor', 'ne yapmaliyim', 'nasil ilerliyoruz', 'nasil ilerleyecegiz',
      'tamam nasil', 'peki nasil', 'o zaman nasil'
    ];
    if (nextStepKeywords.some(kw => clean.includes(kw))) {
      return 'next_step_request';
    }


    return 'generic_other';
  }

  /**
   * P0.16-L: Returns ALL matching intents for a message (multi-intent routing).
   * Used by orchestrator to detect open_continuation, thanks_but_continue, etc.
   *
   * P0.19: tenantDepartments allows per-tenant topic_switch department override (same as route())
   */
  public static routeAll(text: string, tenantDepartments?: string[]): ConversationIntent[] {
    if (!text) return ['generic_other'];
    const clean = this.cleanText(text);
    const originalLower = text.toLowerCase().trim();
    const intents: ConversationIntent[] = [];

    // P0.16-L: Polite close — genuine conversation end (no more questions)
    const politeCloseKeywords = [
      'yok sagolun', 'yok sağolun', 'gerek yok tesekkur', 'gerek yok teşekkür',
      'ihtiyacim yok', 'ihtiyacım yok', 'gerek kalmadi', 'gerek kalmadı',
      'anladim tamam', 'anladım tamam', 'tamam oldu', 'tamam olmuş',
      'kolay gelsin', 'iyi calismalar', 'iyi çalışmalar',
      'iyi gunler', 'iyi günler', 'gorusmek uzere', 'görüşmek üzere'
    ];
    // Polite close only if NO continuation signal follows
    const hasContinuationAfterThanks = ['ama', 'fakat', 'lakin', 'bir soru', 'bir sey', 'bir şey', 'peki', 'ya fiyat', 'doktor', 'surec', 'süreç'].some(kw => clean.includes(kw));
    if (!hasContinuationAfterThanks && politeCloseKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      intents.push('polite_close');
    }

    // P0.16-L: Thanks but continue — teşekkür + ama/fakat/bir soru/bir şey
    const thanksContinuePatterns = [
      // "teşekkür ederim ama ..."
      /te[sşsS]ekk[uüuU]r.{0,20}(?:ama|fakat|lakin|bir\s+soru|bir\s+[sşsS]ey|peki)/i,
      // "sağ olun bir şey daha"
      /sa[gğgG]\s+olun.{0,20}bir/i,
      // "teşekkürler bir soru daha"
      /te[sşsS]ekk[uüuU]r(?:ler|ederim)?.{0,30}(?:bir\s+soru|bir\s+[sşsS]ey|sorum|sormak)/i,
      // ASCII variants: "tesekkur bir soru daha"
      /tesekkur(?:ler|ederim)?.{0,30}(?:bir\s+soru|sorum|sormak|bilgi)/i,
      // "bir sorum daha var" after teşekkür
      /te[sşsS]ekk[uüuU]r.{0,40}bir\s+sorum/i,
    ];
    if (thanksContinuePatterns.some(p => p.test(text) || p.test(clean))) {
      intents.push('thanks_but_continue');
    }

    // P0.16-L: Open continuation — "başka bilgi", "bir şey daha", "peki ...", "bir soru daha"
    const openContKeywords = [
      'baska bir bilgi', 'başka bir bilgi',
      'baska bir soru', 'başka bir soru',
      'baska bir sey', 'başka bir şey',
      'bir sey daha', 'bir şey daha',
      'bir soru daha', 'sorum var',
      'daha fazla bilgi', 'daha detay',
      'peki ya', 'peki fiyat', 'peki surec', 'peki süreç',
      'peki doktor', 'peki adres', 'peki nerede',
    ];
    const openContPatterns = [
      /ba[sş]ka\s+(?:bir\s+)?(?:bilgi|soru|[sş]ey)/i,
      /(?:bir|baska|daha)\s+(?:soru|[sş]ey)\s+(?:daha|sormak|sorabilir)/i,
      // P0.16-M: ASCII-insensitive variants (real WhatsApp may use S for ş, u for ü, i for ı)
      /ba[sS]ka\s+(?:bir\s+)?(?:bilgi|soru|[sS]ey)/i,
      /te[sS]ekk[uU]r.{0,30}(?:bir\s+soru|sorum|sormak|bilgi)/i,
    ];
    if (openContKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw)) ||
        openContPatterns.some(p => p.test(text) || p.test(clean))) {
      intents.push('open_continuation');
    }

    // P0.16-L: Cannot travel objection — "yani ben gelemem", "gelemiyorum", "gidemem"
    const cannotTravelKeywords = [
      'gelemem', 'gidemem', 'gelemiyorum', 'gidemiyorum',
      'gelmem mumkun degil', 'gelmem mümkün değil',
      'gelmem zor', 'gitmem zor',
      'yani ben gelemem', 'ben gelemem',
      'gelmeyecegim', 'gelmeyeceğim',
      'gelemeyecegim', 'gelemeyeceğim',
    ];
    if (cannotTravelKeywords.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      intents.push('cannot_travel_objection');
    }

    // Distance objection
    // P0.18: City-specific keywords removed — generic only
    const distanceKeywords = [
      'uzak', 'mesafe', 'cok uzak',
      'uzakta', 'uzakligi', 'uzaklığı',
    ];
    if (distanceKeywords.some(kw => clean.includes(kw))) {
      intents.push('distance_objection');
    }

    // Doctor lookup
    const doctorKeywords = [
      'doktor kim', 'doktorlar', 'hekim', 'cerrah', 'uzman', 'hangi doktor', 'doktoru',
      'doktor isim', 'kimler var', 'doktor listesi',
    ];
    if (doctorKeywords.some(kw => clean.includes(kw))) {
      intents.push('doctor_lookup');
    }

    // Form Followup
    const formKeywordsAll = [
      'form doldurdum', 'basvuru yaptim', 'form gonderdim', 'formu doldurdum',
      'form gondermistim', 'basvuru yapmistim', 'form doldurmustum', 'basvuru yapmıstım',
      'kontrol et', 'formumu kontrol et', 'basvurum vardi', 'basvurumu kontrol'
    ];
    const formRegexesAll = [
      /form.*doldur/i,
      /form.*gond/i,
      /basvuru.*yap/i,
      /basvurum.*var/i,
      /form.*kontrol/i,
      /basvuru.*kontrol/i
    ];
    if (formKeywordsAll.some(kw => clean.includes(kw) || originalLower.includes(kw)) ||
        formRegexesAll.some(rx => rx.test(clean) || rx.test(originalLower))) {
      intents.push('form_followup');
    }

    // Price
    const priceKeywords = ['fiyat', 'ucret', 'tutar', 'kac para', 'ne kadar', 'fiyatiniz', 'ucreti'];
    if (priceKeywords.some(kw => clean.includes(kw))) {
      intents.push('price_question');
    }

    // Location / Address
    const fullAddressKeywordsAll = [
      'عنوان الكامل', 'العنوان الكامل',
      'أرسل العنوان', 'ارسل العنوان',
      'وين بالضبط',
      'الموقع',
      'لوكيشن',
      'google maps', 'google map', 'maps',
      'tam adres',
      'açık adres', 'acik adres',
      'konum gönder', 'konum gonder',
      'konum', 'harita', 'adres'
    ];
    if (fullAddressKeywordsAll.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      intents.push('address_full_request');
    }

    const iraqBranchKeywordsAll = [
      'هل لديكم فرع في عراق', 'هل عندكم فرع في عراق', 'فرع في عراق',
      'do you have branch in iraq', 'have branch in iraq', 'branch in iraq',
      'ırak\'ta şubeniz var mı', 'irakta subeniz var mi', 'ırakta şube var mı', 'irak sube'
    ];
    const basicLocationKeywordsAll = [
      'nerede', 'neredesiniz', 'hangi sehir', 'hangi şehir',
      'turkiyede mi', 'türkiyede mi', 'turkiye\'de mi', 'türkiye\'de mi',
      'وين', 'وين عنوان', 'يعني بلتركيا', 'بلتركيا', 'بالتركيا', 'في تركيا',
      'nasil gelirim', 'nasıl gelirim', 'yol tarifi'
    ];
    if (iraqBranchKeywordsAll.some(kw => clean.includes(kw) || originalLower.includes(kw)) ||
        basicLocationKeywordsAll.some(kw => clean.includes(kw) || originalLower.includes(kw))) {
      intents.push('location_direction');
    }

    // Process question
    const processKeywords = [
      'surec', 'süreç', 'nasil isliyor', 'nasıl işliyor', 'nasil calisir', 'nasıl çalışır',
      'asamalar', 'aşamalar', 'nasil ilerler', 'nasil ilerliyor', 'nasıl ilerliyor',
      'sonra ne olacak', 'check-up sureci', 'checkup sureci', 'check-up süreci',
      'tedavi sureci', 'tedavi süreci', 'surec nasil', 'süreç nasıl'
    ];
    if (processKeywords.some(kw => clean.includes(kw))) {
      intents.push('process_question');
    }

    // Time / callback
    const timeIndicators = ['saat', 'uygun', 'musait', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'pazar', 'yarin', 'bugun'];
    const numericTimePattern = / \d{1,2}[:. ]\d{2} | \d{1,2}\s*(?:de|da|te|ta|gibi|sular)/;
    if (timeIndicators.some(kw => clean.includes(kw)) && (numericTimePattern.test(clean) || clean.includes('uygun'))) {
      intents.push('time_availability');
    }

    // P0.28.2: callback_time_answer
    const hasCallbackTimeKwAll = [
      'saat', 'pazartesi', 'salı', 'sali', 'çarşamba', 'carsamba', 'perşembe', 'persembe', 'cuma', 'cumartesi', 'pazar',
      'yarın', 'yarin', 'bugün', 'bugun', 'sabah', 'öğlen', 'oglen', 'öğleden sonra', 'ogleden sonra', 'akşam', 'aksam', 'gece',
      'hafta içi', 'haftaici', 'hafta sonu', 'haftasonu'
    ].some(kw => clean.includes(kw)) || /(?:\b\d{1,2}[:. ]\d{2}\b|\b\d{1,2}\s*(?:de|da|te|ta|e|a|ye|ya|gibi|civari|civarinda|sularinda|sularında|olur|uygun|musait|müsait)\b)/.test(clean);

    const hasMonthKwAll = [
      'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
      'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik'
    ].some(kw => clean.includes(kw)) || hasRealDatePattern(clean);

    if (hasCallbackTimeKwAll && !hasMonthKwAll) {
      intents.push('callback_time_answer');
    }

    // Next step
    const nextStepKeywords = [
      'belirleyelim', 'netlestirelim', 'simdi ne olacak', 'nasil olacak',
      'ne yapmam gerekiyor', 'nasil ilerleyecegiz', 'peki nasil', 'tamam nasil',
    ];
    if (nextStepKeywords.some(kw => clean.includes(kw))) {
      intents.push('next_step_request');
    }

    // Multi-patient
    const multiPatientKeywords = ['annem', 'babam', 'esim', 'eşim', 'yakınim', 'yakinim'];
    if (multiPatientKeywords.some(kw => clean.includes(kw))) {
      intents.push('multi_patient_reference' as any);
    }

    if (intents.length === 0) {
      // Fall back to single route — pass tenantDepartments for consistency
      intents.push(this.route(text, tenantDepartments));
    }

    return [...new Set(intents)]; // dedupe
  }
}
