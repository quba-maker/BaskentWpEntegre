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

  public static detectWithContext(text: string, lastAssistantText?: string | null): TurkeyVisitIntent | null {
    const direct = this.detect(text);
    if (direct) return direct;

    const clean = (text || '').toLowerCase().trim();
    const last = (lastAssistantText || '').toLowerCase();
    if (!clean || !last) return null;

    const askedVisitIntent = [
      'türkiye’ye gelme',
      "türkiye'ye gelme",
      'turkiye’ye gelme',
      "turkiye'ye gelme",
      'türkiye’ye gelmeyi',
      "türkiye'ye gelmeyi",
      'konya’ya gelme',
      "konya'ya gelme",
      'gelme ihtimaliniz',
      'gelmeyi düşünüyor musunuz',
      'gelmeyi dusunuyor musunuz',
      'gelme planınız',
      'gelme planiniz'
    ].some(kw => last.includes(kw));

    if (!askedVisitIntent) return null;

    const negatives = ['olmaz', 'hayır', 'hayir', 'yok', 'gelmem', 'gelemem', 'istemiyorum', 'istemem', 'mümkün değil', 'mumkun degil'];
    if (negatives.some(kw => clean === kw || clean.startsWith(`${kw} `) || clean.endsWith(` ${kw}`) || clean.includes(` ${kw} `))) {
      return 'turkey_visit_intent_negative';
    }

    const positives = ['olur', 'evet', 'tamam', 'gelirim', 'gelebilirim', 'düşünürüm', 'dusunurum', 'mümkün', 'mumkun'];
    if (positives.some(kw => clean === kw || clean.startsWith(`${kw} `) || clean.endsWith(` ${kw}`) || clean.includes(` ${kw} `))) {
      return 'turkey_visit_intent_positive';
    }

    return null;
  }

  public static hasExplicitCallRequest(text: string): boolean {
    const { MultilingualTimeIntentResolver } = require('./multilingual-time-intent-resolver');
    return MultilingualTimeIntentResolver.resolve(text).hasExplicitCallRequest;
  }
}
