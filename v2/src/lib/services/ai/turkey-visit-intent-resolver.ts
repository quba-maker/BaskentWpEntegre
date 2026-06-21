export type TurkeyVisitIntent =
  | 'turkey_visit_intent_unknown'
  | 'turkey_visit_intent_positive'
  | 'turkey_visit_intent_uncertain'
  | 'turkey_visit_intent_negative';

export class TurkeyVisitIntentResolver {
  public static detect(text: string): TurkeyVisitIntent | null {
    if (!text) return null;
    const clean = text.toLowerCase().trim();

    // Positive visit intent
    const positiveKeywords = [
      "türkiye'ye gelmeyi düşünüyorum", "turkiyeye gelmeyi dusunuyorum", "türkiye'ye gelmeyi planlıyorum", 
      "turkiyeye gelmeyi planliyorum", "gelmeyi düşünüyorum", "gelmeyi dusunuyorum", "gelmeyi planlıyorum",
      "gelmeyi planliyorsunuz", "gelmek istiyorum", "geleceğim", "gelecegim", "geliyorum", "gelirim", 
      "gelmek", "türkiye'ye geleceğim", "türkiye'ye gelirim", "gelicem", "gelecegım",
      "أفكر في القدوم إلى تركيا", "أفكر بالقدوم", "أريد القدوم", "سآتي إلى تركيا", 
      "سآتي للعلاج", "سأحضر", "سأقادم", "أفكر في القدوم", "نعم سآتي"
    ];
    if (positiveKeywords.some(kw => clean === kw || clean.includes(kw))) {
      return 'turkey_visit_intent_positive';
    }

    // Negative visit intent
    const negativeKeywords = [
      "gelmeyi düşünmüyorum", "gelmeyi dusunmuyorum", "gelmem zor", "gelemem", "türkiye'ye gelemem", 
      "turkiyeye gelemem", "gelmek istemiyorum", "hayır gelmiyorum", "hayir gelmiyorum", "gelmiyorum",
      "لا أفكر في القدوم", "لا أريد القدوم", "لا أستطيع القدوم", "لا أستطيع السفر", 
      "لا أخطط للقدوم", "لا أفكر بالقدوم", "لا افكر في القدوم", "لا افكر بالقدوم"
    ];
    if (negativeKeywords.some(kw => clean === kw || clean.includes(kw))) {
      return 'turkey_visit_intent_negative';
    }

    // Uncertain / info-only intent
    const uncertainKeywords = [
      "bilgi almak istiyorum", "şimdilik bilgi", "simdilik bilgi", "sadece bilgi", "bilgi verin", 
      "emin değilim", "emin degilim", "karar vermedim",
      "أريد معلومات فقط", "في هذه المرحلة أريد معلومات", "لست متأكداً", "لست متاكدا", 
      "لم أقرر بعد", "لم اقرر بعد", "معلومات فقط", "فقط معلومات"
    ];
    if (uncertainKeywords.some(kw => clean === kw || clean.includes(kw))) {
      return 'turkey_visit_intent_uncertain';
    }

    return null;
  }

  public static hasExplicitCallRequest(text: string): boolean {
    if (!text) return false;
    const clean = text.toLowerCase().trim();
    const callPhrases = [
      'beni arayın', 'beni arayin', 'telefonla görüşmek istiyorum', 'telefonla gorusmek istiyorum', 
      'randevu almak istiyorum', 'arama planlayalım', 'arama planlayalim', 'arar mısınız', 'ararmisiniz',
      'اتصلوا بي', 'أريد موعد', 'اريد موعد', 'تواصل معي'
    ];
    return callPhrases.some(phrase => clean.includes(phrase));
  }
}
