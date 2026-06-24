import { TenantBrain } from '../../brain/tenant-brain';
import { ConversationIntentRouter, ConversationIntent } from './conversation-intent-router';
import { resolveActivePromptIdentityContext, isNameBypassAllowed } from './active-prompt-context';
import { MedicalTermNormalizer } from './medical-term-normalizer';

export interface DeterministicFallbackParams {
  inboundText: string;
  brain: TenantBrain;
  identityConfig: {
    personaName?: string;
    organizationName?: string;
    organizationShortName?: string;
  };
  unifiedContext: any;
  channelId?: string;
  systemPromptText?: string;
  promptVersion?: string | number;
  /** P0.16-H: Authoritative resolved department from orchestrator's 4-step priority chain */
  resolvedActiveDepartment?: string | null;
  replyLanguage?: string;
  turkeyVisitIntent?: string;
  formAlreadyAddressed?: boolean;
}

export interface DeterministicFallbackResult {
  text: string;
  sector: string;
  hasFormContext: boolean;
  hasComplaint: boolean;
  finalPath: string;
  detectedIntent?: ConversationIntent;
}

export class ContextAwareSafeFallbackResolver {
  private static normalizeLooseText(text?: string): string {
    return (text || '')
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .toLowerCase()
      .replace(/[’`´]/g, "'")
      .trim();
  }

  private static latestAssistantText(history: any[] = []): string {
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg?.role === 'assistant' && msg?.content) {
        return this.normalizeLooseText(String(msg.content));
      }
    }
    return '';
  }

  private static detectCountryOnlyAnswer(inboundText?: string): string | null {
    const clean = this.normalizeLooseText(inboundText)
      .replace(/[^\p{L}\s']/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean || clean.length > 40) return null;
    try {
      const { normalizeCountry } = require('../../utils/country-normalizer');
      const normalized = normalizeCountry(clean, null, 'patient_statement');
      if (normalized?.country && normalized.countryConfidence !== 'low') {
        return normalized.country;
      }
    } catch {
      // Fall back to a tiny safety list if the shared normalizer is unavailable.
    }

    const countryAliases: Array<[RegExp, string]> = [
      [/\b(?:o'?zbekiston|ozbekiston|uzbekiston|uzbekistan|özbekistan|ozbekistan)\b/i, 'Özbekistan'],
      [/\b(?:fransa|france|hransa)\b/i, 'Fransa'],
      [/\b(?:almanya|deutschland|germany)\b/i, 'Almanya'],
      [/\b(?:hollanda|netherlands)\b/i, 'Hollanda'],
      [/\b(?:belçika|belcika|belgium)\b/i, 'Belçika'],
      [/\b(?:kanada|canada)\b/i, 'Kanada'],
      [/\b(?:türkiye|turkiye|turkey)\b/i, 'Türkiye'],
    ];
    const match = countryAliases.find(([pattern]) => pattern.test(clean));
    return match?.[1] || null;
  }

  private static languagePreferenceOffer(country: string): string | null {
    const optionsByCountry: Record<string, string> = {
      'Özbekistan': 'Özbekçe, Rusça veya İngilizce',
      'Kazakistan': 'Kazakça, Rusça veya İngilizce',
      'Kırgızistan': 'Kırgızca, Rusça veya İngilizce',
      'Fransa': 'Fransızca veya İngilizce',
    };
    const options = optionsByCountry[country];
    return options
      ? `Benimle istediğiniz dilde konuşabilirsiniz. Türkçe dışında ${options} sizin için daha rahatsa o dilde de yardımcı olayım. Hangi dil daha rahat olur?`
      : null;
  }

  private static weakLanguageSignalScore(inboundText: string, history: any[] = []): number {
    const recent = [
      ...history.filter(m => m?.role === 'user' && m?.content).slice(-4).map(m => String(m.content)),
      inboundText || ''
    ].join(' ');
    const clean = this.normalizeLooseText(recent);
    if (!clean) return 0;

    const explicitSignals = [
      /o'?zbekiston|ozbekiston|uzbekiston|uzbekistan|özbekistan|ozbekistan/i,
      /psor(?:y|i)azi|psoriaz|psoryaz|psoriatik|psoriatic/i,
      /\bhaman\b/i,
      /\bhransa\b/i,
    ];
    let score = explicitSignals.reduce((acc, pattern) => acc + (pattern.test(clean) ? 1 : 0), 0);

    const tokens = clean
      .replace(/[^\p{L}'\s]/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 5);
    const suspicious = tokens.filter(t =>
      /[qwxy]/i.test(t) ||
      /'{1}/.test(t) ||
      /(skiy|skij|ovich|ovna|bek|stan)$/i.test(t)
    );
    if (suspicious.length >= 2) score += 1;
    return score;
  }

  private static shouldOfferLanguagePreference(country: string, inboundText: string, history: any[] = []): boolean {
    if (!this.languagePreferenceOffer(country)) return false;
    const alreadyAsked = history.slice(-8).some(msg => {
      if (msg?.role !== 'assistant') return false;
      const clean = this.normalizeLooseText(String(msg.content || ''));
      return /hangi\s+dil|dilde\s+devam|dil\s+daha\s+rahat|özbekçe|ozbekçe|rusça|rusca|fransızca|fransizca/i.test(clean);
    });
    return !alreadyAsked && this.weakLanguageSignalScore(inboundText, history) >= 2;
  }

  private static resolveArabic(params: DeterministicFallbackParams): DeterministicFallbackResult {
    const { inboundText, brain, identityConfig, unifiedContext } = params;
    const orchestratorDept = params.resolvedActiveDepartment || null;
    const lowerInbound = (inboundText || '').toLowerCase().trim();

    const configIndustry = brain.context.config?.industry;
    const metadataIndustry = (brain.prompts.metadata as any)?.industry;
    const resolvedIndustry = (configIndustry || metadataIndustry || '').toLowerCase();
    
    const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'health';
    const hasFormContext = !!unifiedContext?.latestForm || 
      (Array.isArray(unifiedContext?.patient_known_facts) && unifiedContext.patient_known_facts.length > 0);

    const history = unifiedContext?.history || [];
    const { PendingQuestionResolver } = require('./pending-question-resolver');
    const { ShortAnswerInterpreter } = require('./short-answer-interpreter');
    const { ConversationStateArbitrator } = require('./conversation-state-arbitrator');
    
    const rawIntent = ConversationIntentRouter.route(inboundText);
    const rawPendingSlot = PendingQuestionResolver.resolve(history);
    const interpretedIntent = ShortAnswerInterpreter.interpret(inboundText, rawPendingSlot);

    const arbitration = ConversationStateArbitrator.arbitrate({
      lastUserMessage: inboundText,
      rawPendingSlot,
      rawInterpretedIntent: interpretedIntent || '',
      routerIntent: rawIntent,
      history,
      unifiedContext
    });

    const detectedIntent = arbitration.effectiveIntent;
    const pendingSlot = arbitration.effectivePendingSlot;

    const pName = identityConfig.personaName || '';
    const orgName = identityConfig.organizationName || 'مستشفانا';
    const agentName = pName || 'مستشارينا';

    if (detectedIntent === 'address_full_request') {
      return {
        text: "العنوان الكامل: Hocacihan Mahallesi, Saray Caddesi No:1, Selçuklu / Konya, Türkiye.",
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'address_full_request_arabic',
        detectedIntent
      };
    }

    if (detectedIntent === 'location_direction') {
      const isIraqQuery = [
        'عراق', 'iraq', 'irak', 'فرع في عراق', 'فرع في العراق'
      ].some(kw => lowerInbound.includes(kw));

      if (isIraqQuery) {
        return {
          text: "لا يوجد لدينا فرع في العراق. مستشفانا في مدينة قونيا، تركيا. إذا كنت تفكر في القدوم إلى تركيا للعلاج، يمكنني شرح الخطوات ومساعدتك في التخطيط.",
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint: false,
          finalPath: 'location_direction_iraq_arabic',
          detectedIntent
        };
      }

      return {
        text: "نحن في مدينة قونيا، تركيا.",
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'location_direction_basic_arabic',
        detectedIntent
      };
    }

    if (detectedIntent === 'capability_question') {
      return {
        text: "أنا المساعد الرقمي للمستشفى. يمكنني مساعدتك في فهم الشكاوى، وتقديم معلومات عن الأطباء والأقسام، والتخطيط للاتصالات الهاتفية أو المواعيد. كيف يمكنني مساعدتك اليوم؟ 🙏",
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'capability_question_arabic',
        detectedIntent
      };
    }

    if (detectedIntent === 'identity_question') {
      const text = pName 
        ? `أنا *${pName}*، أتابعكم من ${orgName}. كيف يمكنني مساعدتكم؟ 🌿`
        : "مرحباً، أنا هنا لمساعدتك. ما هو الموضوع الذي ترغب في الحصول على معلومات عنه؟";
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'identity_question_arabic',
        detectedIntent
      };
    }

    if (detectedIntent === 'human_transfer_request' || detectedIntent === 'transfer_request') {
      return {
        text: `على حق، من الأفضل أن يهتم ${pName ? pName : "مستشارونا"} بهذا الأمر. سأقوم بتدوين طلبك ليتم تحويله.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'human_transfer_arabic',
        detectedIntent
      };
    }

    if (detectedIntent === 'callback_confirmation') {
      return {
        text: "تم تسجيل تأكيدك. سيتصل بك مستشار المرضى لدينا في الوقت المحدد بتوقيت تركيا. 🙏",
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'callback_confirmation_arabic',
        detectedIntent
      };
    }

    if (detectedIntent === 'callback_time_answer' || detectedIntent === 'arrival_date_answer') {
      const turkeyVisitIntent = params.turkeyVisitIntent || 'turkey_visit_intent_unknown';
      if (turkeyVisitIntent === 'turkey_visit_intent_unknown') {
        return {
          text: "لقد سجلت الوقت الذي شاركته. قبل المتابعة في التخطيط للاتصال، هل تفكر في القدوم إلى تركيا للعلاج، أم ترغب فقط في الحصول على معلومات في هذه المرحلة؟",
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint: false,
          finalPath: 'callback_time_answer_unknown_arabic',
          detectedIntent
        };
      } else if (turkeyVisitIntent === 'turkey_visit_intent_negative' || turkeyVisitIntent === 'turkey_visit_intent_uncertain') {
        return {
          text: "لقد سجلت الوقت الذي شاركته. في هذه الحالة، لن أقوم بتوجيهك لحجز موعد. إذا كانت لديك أي أسئلة، يمكنني الاستمرار في تقديم المعلومات لك من هنا.",
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint: false,
          finalPath: 'callback_time_answer_negative_arabic',
          detectedIntent
        };
      } else {
        return {
          text: "تم تسجيل تفضيلاتك للاتصال بك. سيتصل بك مستشار المرضى لدينا في الوقت المحدد بتوقيت تركيا. 🙏",
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint: false,
          finalPath: 'callback_time_answer_positive_arabic',
          detectedIntent
        };
      }
    }

    if (detectedIntent === 'price_question') {
      return {
        text: "تتحدد تكاليف الخدمات والعلاج لدينا بعد المعاينة والتقييم الشخصي في مستشفانا. للحصول على معلومات تفصيلية، يمكننا التخطيط لاتصال هاتفي قصير.",
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'price_question_arabic',
        detectedIntent
      };
    }

    if (detectedIntent === 'distance_objection') {
      return {
        text: "أتفهم تماماً قلقك بشأن المسافة. بالنسبة لزوارنا القادمين من خارج البلاد، يقوم فريقنا بتنسيق النقل والسكن والتخطيط للعملية. يمكننا مناقشة التفاصيل عبر الهاتف.",
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'distance_objection_arabic',
        detectedIntent
      };
    }

    if (detectedIntent === 'doctor_lookup') {
      return {
        text: "يمكنني تقديم قائمة بأطبائنا المتخصصين. لمساعدتك بشكل أفضل، هل يمكنك مشاركة القسم أو التخصص الذي تبحث عنه؟",
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'doctor_lookup_arabic',
        detectedIntent
      };
    }

    return {
      text: "مرحباً، أنا هنا لمساعدتك. كيف يمكنني تقديم المساعدة لك اليوم؟",
      sector: resolvedIndustry,
      hasFormContext,
      hasComplaint: false,
      finalPath: 'default_fallback_arabic',
      detectedIntent
    };
  }

  /**
   * Resolves a safe, deterministic fallback text based on tenant config,
   * industry (sector), and inbound message intents.
   * Gated securely to avoid hardcoding client-specific names/terms globally.
   */
  public static resolve(params: DeterministicFallbackParams): DeterministicFallbackResult {
    const { inboundText, brain, identityConfig, unifiedContext } = params;
    const lang = params.replyLanguage || 'tr';
    const turkeyVisitIntent = params.turkeyVisitIntent || 'turkey_visit_intent_unknown';
    const formAlreadyAddressed = params.formAlreadyAddressed ?? false;

    const orchestratorDept = params.resolvedActiveDepartment || null;
    const lowerInbound = (inboundText || '').toLowerCase().trim();

    // 1. Sector & Context Resolution
    const configIndustry = brain.context.config?.industry;
    const metadataIndustry = (brain.prompts?.metadata as any)?.industry;
    const resolvedIndustry = (configIndustry || metadataIndustry || '').toLowerCase();
    
    const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'health';
    const hasFormContext = !!unifiedContext?.latestForm || 
      (Array.isArray(unifiedContext?.patient_known_facts) && unifiedContext.patient_known_facts.length > 0);

    const history = unifiedContext?.history || [];
    const { PendingQuestionResolver } = require('./pending-question-resolver');
    const { ShortAnswerInterpreter } = require('./short-answer-interpreter');
    const { ConversationStateArbitrator } = require('./conversation-state-arbitrator');
    
    // Route message to find raw intent
    const rawIntent = ConversationIntentRouter.route(inboundText);
    const rawPendingSlot = PendingQuestionResolver.resolve(history);
    const interpretedIntent = ShortAnswerInterpreter.interpret(inboundText, rawPendingSlot);

    const arbitration = ConversationStateArbitrator.arbitrate({
      lastUserMessage: inboundText,
      rawPendingSlot,
      rawInterpretedIntent: interpretedIntent || '',
      routerIntent: rawIntent,
      history,
      unifiedContext
    });

    const detectedIntent = arbitration.effectiveIntent;
    const pendingSlot = arbitration.effectivePendingSlot;
    const lastAssistantText = ContextAwareSafeFallbackResolver.latestAssistantText(history);

    const immediateCallRequest = /\b(?:hemen|haman|hamaan|şimdi|simdi)\b/i.test(lowerInbound);
    const lastAskedCallSlot = /(telefon\s+görüşmesi|arama|aranma|uygun\s+gün\s+ve\s+saat|gün\s+ve\s+saat\s+aralığı|saat\s+aralığı|hangi\s+gün\s+ve\s+saat)/i.test(lastAssistantText);
    if (isHealthcare && immediateCallRequest && lastAskedCallSlot) {
      return {
        text: "Hemen görüşmek istediğinizi anladım. Arama planlaması için bugün mü uygun, yoksa başka bir gün/saat mi? Yurt dışındaysanız saat diliminizi de yazabilir misiniz?",
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'immediate_call_request_needs_slot_fallback',
        detectedIntent
      };
    }

    const countryOnlyAnswer = ContextAwareSafeFallbackResolver.detectCountryOnlyAnswer(inboundText);
    const lastAskedCountryOrTimezone = /(hangi\s+ülkede|hangi\s+ulkede|nerede\s+yaşıyorsunuz|nerede\s+yasiyorsunuz|ülkede\s+yaşıyorsunuz|ulkede\s+yasiyorsunuz|saat\s+dilimi|hangi\s+ülke|hangi\s+ulke)/i.test(lastAssistantText);
    const lastAskedTimezone = /(saat\s+dilimi|hangi\s+ülke\s+veya\s+şehir|hangi\s+ulke\s+veya\s+sehir|saatine\s+göre|saatine\s+gore)/i.test(lastAssistantText);
    if (isHealthcare && countryOnlyAnswer && lastAskedCountryOrTimezone) {
      let text = lastAskedTimezone
        ? `${countryOnlyAnswer}’da olduğunuzu not ediyorum. Arama için ${countryOnlyAnswer} saati mi, Türkiye saati mi esas alınsın?`
        : `${countryOnlyAnswer}’da olduğunuzu not ediyorum. Sağlık talebinizle ilgili hangi bilgiyi netleştirelim?`;
      const languageOffer = ContextAwareSafeFallbackResolver.shouldOfferLanguagePreference(countryOnlyAnswer, inboundText, history)
        ? ContextAwareSafeFallbackResolver.languagePreferenceOffer(countryOnlyAnswer)
        : null;
      if (languageOffer) {
        text += `\n\n${languageOffer}`;
      }
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: false,
        finalPath: 'country_answer_continuation_fallback',
        detectedIntent
      };
    }

    const medicalTermSuggestion = isHealthcare
      ? MedicalTermNormalizer.suggest(inboundText)
      : null;
    if (medicalTermSuggestion?.shouldConfirm) {
      return {
        text: `${medicalTermSuggestion.canonicalTerm} demek istediniz, doğru mu? Kısaca teyit ederseniz ona göre yardımcı olayım.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: true,
        finalPath: 'medical_term_confirmation_fallback',
        detectedIntent: 'complaint_detail' as any
      };
    }

    const isHealthcareOrForm = isHealthcare || hasFormContext;
    let complaint = '';
    let hasComplaint = false;
    if (isHealthcareOrForm) {
      const facts = unifiedContext?.patient_known_facts || [];
      const rawFactsComplaint = facts.find((f: string) => f.toLowerCase().includes('şikayet') || f.toLowerCase().includes('sikayet'));
      if (rawFactsComplaint) {
        const match = rawFactsComplaint.match(/(?:şikayeti|sikayeti|şikayet|sikayet):\s*(.+)/i);
        if (match && match[1]) {
          complaint = match[1].replace(/[.]+$/, '').replace(/_/g, ' ').trim();
          hasComplaint = true;
        }
      }
      if (complaint.length > 50) {
        complaint = complaint.substring(0, 50) + '...';
      }
    }

    const isEmergency = [
      'göğüs ağrısı', 'gogus agrisi', 'nefes darlığı', 'nefes darligi', 'nefes alamıyorum', 'nefes alamiyorum',
      'bayılma', 'bayilma', 'felç', 'felc', 'ani güç kaybı', 'ani guc kaybi', 'şiddetli kanama', 'siddetli kanama',
      'bilinç kaybı', 'bilinc kaybi'
    ].some(kw => lowerInbound.includes(kw));

    if (isEmergency) {
      return {
        text: "Bu belirti acil değerlendirme gerektirebilir. Lütfen bulunduğunuz yerde en yakın acil sağlık kuruluşuna başvurun veya acil yardım hattını arayın.",
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint: true,
        finalPath: 'emergency_fallback',
        detectedIntent
      };
    }

    const cleanInboundPunct = lowerInbound.replace(/[?.!,;:]/g, '').trim();
    if (cleanInboundPunct === 'what' && lang === 'tr') {
      return {
        text: "Anlaşılmayan kısmı kısaca açıklayayım.",
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'what_turkish_bypass',
        detectedIntent
      };
    }

    if (detectedIntent === 'arrival_date_answer') {
      let dateStr = '';
      const cleanInbound = inboundText.trim().replace(/[?.!,;:]+$/, '');
      if (cleanInbound.split(/\s+/).length <= 5) {
        dateStr = cleanInbound;
      } else {
        const words = cleanInbound.split(/\s+/);
        const dateKws = [
          'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
          'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik',
          'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
          'januari', 'februari', 'maart', 'juni', 'juli', 'augustus', 'oktober', 'november', 'december',
          'januar', 'februar', 'märz', 'mai', 'juni', 'juli', 'oktober', 'dezember'
        ];
        const foundIdx = words.findIndex(w => dateKws.some(kw => w.toLowerCase().includes(kw)));
        if (foundIdx !== -1) {
          const start = Math.max(0, foundIdx - 1);
          const end = Math.min(words.length, foundIdx + 2);
          dateStr = words.slice(start, end).join(' ');
        } else {
          dateStr = unifiedContext?.opportunity?.metadata?.travel_date_raw || 
                    unifiedContext?.opportunity?.travel_date || 
                    unifiedContext?.conversation?.metadata?.arrival_date || 
                    cleanInbound;
        }
      }
      dateStr = dateStr.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      let text = '';
      if (lang === 'ar') {
        text = `لقد سجلت تاريخ وصولك المخطط له في ${dateStr}. هل لديك أي أسئلة أخرى، أم ترغب في جدولة مكالمة هاتفية مع مستشار المرضى لدينا لتوضيح التفاصيل؟`;
      } else if (lang === 'de') {
        text = `Ich habe Ihre geplante Ankunft am ${dateStr} notiert. Haben Sie weitere Fragen oder möchten Sie ein Telefonat mit unserem Patientenberater vereinbaren, um die Details zu besprechen?`;
      } else if (lang === 'nl') {
        text = `Ik heb uw geplande aankomst op ${dateStr} genoteerd. Heeft u nog andere vragen, of wilt u een telefoongesprek plannen met onze patiëntenadviseur om de details te bespreken?`;
      } else if (lang === 'en') {
        text = `I have noted your planned arrival date as ${dateStr}. Do you have any other questions, or would you like to schedule a phone call with our patient advisor to finalize the details?`;
      } else {
        text = `Anladım, ${dateStr} gelme düşüncenizi not aldım. Başka bir sorunuz var mı, ya da detayları netleştirmek için hasta danışmanımızla bir telefon görüşmesi planlamak ister misiniz?`;
      }

      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: `arrival_date_answer_fallback_${lang}`,
        detectedIntent
      };
    }

    // Form Re-introduction Greeting Bypass
    const isGreeting = detectedIntent === 'greeting';
    if (formAlreadyAddressed && (isGreeting || detectedIntent === 'form_followup')) {
      const deptName = orchestratorDept || unifiedContext?.opportunity?.department || unifiedContext?.latestForm?.data?.onerilen_bolum || unifiedContext?.latestForm?.name || 'tedavi';
      
      if (lang === 'ar') {
        let deptPhraseAr = 'علاجكم';
        const cleanDept = deptName.toLowerCase();
        if (cleanDept.includes('check-up') || cleanDept.includes('checkup') || cleanDept.includes('check up')) {
          deptPhraseAr = 'الفحص الطبي الشامل (Check-up)';
        } else if (cleanDept.includes('kardiyoloji') || cleanDept.includes('kalp')) {
          deptPhraseAr = 'قسم أمراض القلب';
        } else if (cleanDept.includes('ortopedi')) {
          deptPhraseAr = 'قسم جراحة العظام';
        } else if (cleanDept.includes('tüp bebek') || cleanDept.includes('tup bebek')) {
          deptPhraseAr = 'قسم أطفال الأنابيب';
        } else if (cleanDept.includes('estetik')) {
          deptPhraseAr = 'قسم التجميل';
        } else if (cleanDept.includes('diş') || cleanDept.includes('dis')) {
          deptPhraseAr = 'قسم طب الأسنان';
        } else if (cleanDept.includes('organ nakli')) {
          deptPhraseAr = 'قسم زراعة الأعضاء';
        } else if (cleanDept.includes('beyin') || cleanDept.includes('omurga')) {
          deptPhraseAr = 'قسم جراحة المخ والأعصاب';
        }

        let text = '';
        if (turkeyVisitIntent === 'turkey_visit_intent_positive') {
          text = `مرحباً، أهلاً بك مجدداً. يمكننا المتابعة من هنا بخصوص التخطيط لـ ${deptPhraseAr}. يرجى مشاركة اليوم والوقت المناسبين للاتصال بك. 🙏`;
        } else if (turkeyVisitIntent === 'turkey_visit_intent_negative' || turkeyVisitIntent === 'turkey_visit_intent_uncertain') {
          text = `مرحباً، أهلاً بك مجدداً. في هذه الحالة، لن أقوم بتوجيهك لحجز موعد. إذا كانت لديك أي أسئلة، يمكنني الاستمرار في تقديم المعلومات لك من هنا.`;
        } else {
          text = `مرحباً، أهلاً بك مجدداً. يمكننا المتابعة من هنا بخصوص التخطيط لـ ${deptPhraseAr}. هل تفكر في القدوم إلى تركيا، أم ترغب فقط في الحصول على معلومات في هذه المرحلة؟ 🙏`;
        }

        return {
          text,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint: false,
          finalPath: 'form_reintroduction_greeting_arabic',
          detectedIntent
        };
      } else {
        let deptPhraseTr = 'tedavi';
        const cleanDept = deptName.toLowerCase();
        if (cleanDept.includes('check-up') || cleanDept.includes('checkup') || cleanDept.includes('check up')) {
          deptPhraseTr = 'Check-up';
        } else if (cleanDept.includes('kardiyoloji') || cleanDept.includes('kalp')) {
          deptPhraseTr = 'Kardiyoloji';
        } else if (cleanDept.includes('ortopedi')) {
          deptPhraseTr = 'Ortopedi';
        } else if (cleanDept.includes('tüp bebek') || cleanDept.includes('tup bebek')) {
          deptPhraseTr = 'Tüp Bebek';
        } else if (cleanDept.includes('estetik')) {
          deptPhraseTr = 'Estetik';
        } else if (cleanDept.includes('diş') || cleanDept.includes('dis')) {
          deptPhraseTr = 'Diş';
        } else if (cleanDept.includes('organ nakli')) {
          deptPhraseTr = 'Organ Nakli';
        } else if (cleanDept.includes('beyin') || cleanDept.includes('omurga')) {
          deptPhraseTr = 'Beyin Cerrahi';
        }

        let text = '';
        if (turkeyVisitIntent === 'turkey_visit_intent_positive') {
          text = `Merhaba, tekrar hoş geldiniz. ${deptPhraseTr} planlamanızla ilgili buradan devam edebiliriz. Hangi bilgiyi netleştirmek istersiniz?`;
        } else if (turkeyVisitIntent === 'turkey_visit_intent_negative' || turkeyVisitIntent === 'turkey_visit_intent_uncertain') {
          text = `Merhaba, tekrar hoş geldiniz. Bu durumda sizi randevuya yönlendirmeyeyim. Merak ettiğiniz konular olursa buradan bilgi vermeye devam edebilirim.`;
        } else {
          text = `Merhaba, tekrar hoş geldiniz. ${deptPhraseTr} planlamanızla ilgili buradan devam edebiliriz. Bu konuda hangi bilgiyi netleştirmek istersiniz?`;
        }

        return {
          text,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint: false,
          finalPath: 'form_reintroduction_greeting_turkish',
          detectedIntent
        };
      }
    }

    if (lang === 'ar') {
      return ContextAwareSafeFallbackResolver.resolveArabic(params);
    }

    // isHealthcareOrForm, complaint, and hasComplaint are already calculated at the top.

    // Dynamic multi-intent international/remote patient check
    const locations = [
      { key: 'Almanya', keywords: ['almanya', 'almanyada', 'almanyadayım', 'almanyadayim', 'germany'] },
      { key: 'Kaliforniya', keywords: ['amerika', 'usa', 'us', 'california', 'kaliforniya'] },
      { key: 'Libya', keywords: ['libya'] },
      { key: 'Irak', keywords: ['irak', 'iraq'] },
      { key: 'İngiltere', keywords: ['ingiltere', 'london', 'londra', 'uk', 'england'] },
      { key: 'Hollanda', keywords: ['hollanda', 'netherlands'] },
      { key: 'Fransa', keywords: ['fransa', 'france'] },
      { key: 'Avrupa', keywords: ['avrupa', 'europe'] },
      { key: 'Yurt dışı', keywords: ['yurt dışı', 'yurt disi', 'yurt dışından', 'yurt disindan', 'yurtdısı', 'yurtdisi', 'international'] },
      { key: 'Şehir dışı', keywords: ['şehir dışı', 'sehir disi', 'sehir dışı', 'şehir disi', 'sehir dışından', 'sehirlerarasi', 'şehirlerarası'] },
      { key: 'Uzak', keywords: ['uzak', 'mesafe', 'cok uzak'] }
      // P0.18: 'konya uzak' kaldırıldı — generic 'uzak'/'mesafe' zaten yakalar
    ];

    const departmentsList = [
      { key: 'Kardiyoloji', keywords: ['kardiyoloji', 'kalp', 'damar', 'cardio', 'heart'] },
      { key: 'Ortopedi', keywords: ['ortopedi', 'kemik', 'eklem', 'diz', 'kalça', 'kalca', 'menisküs', 'kırık', 'protez', 'omuz', 'bağ yaralanması'] },
      { key: 'Tüp Bebek', keywords: ['tüp bebek', 'tup bebek', 'tüpbebek', 'ivf'] },
      { key: 'Estetik', keywords: ['estetik', 'burun estetiği', 'burun estetigi', 'rinoplasti', 'plastik cerrahi'] },
      { key: 'Diş', keywords: ['diş', 'dental', 'implant', 'dis', 'diş hekimliği', 'dis hekimligi'] },
      { key: 'Organ Nakli', keywords: ['organ nakli', 'organ', 'nakil', 'nakli'] },
      { key: 'Beyin Cerrahi', keywords: ['bel fıtığı', 'bel fitigi', 'bel fıtıgı', 'boyun fıtığı', 'boyun fitigi', 'fıtık', 'fitik', 'omurga', 'omurilik', 'sinir sıkışması', 'beyin cerrahisi', 'nöroşirürji'] }
    ];

    const matchedLocation = locations.find(l => l.keywords.some(kw => lowerInbound.includes(kw)));
    const matchedDept = departmentsList.find(d => d.keywords.some(kw => lowerInbound.includes(kw)));
    
    const hasLogistics = ['ulasım', 'ulasim', 'ulaşım', 'surec', 'süreç', 'transfer', 'konaklama', 'otel', 'yol', 'bilet', 'gelem', 'konaklamak', 'logistics'].some(kw => lowerInbound.includes(kw));
    const hasPrice = ['fiyat', 'ucret', 'ücret', 'maliyet', 'ne kadar', 'tutar', 'para', 'fiyatlar', 'fiyati', 'ucreti', 'pricing'].some(kw => lowerInbound.includes(kw));

    if (matchedLocation && hasLogistics && hasPrice) {
      const location = matchedLocation.key;
      const dept = matchedDept?.key ||
        orchestratorDept ||
        unifiedContext?.opportunity?.department ||
        unifiedContext?.conversation?.department ||
        'Tedavi';

      // P0.16-H Telemetry: process answer department selected
      console.log(JSON.stringify({
        tag: 'PROCESS_ANSWER_DEPARTMENT_SELECTED',
        source: orchestratorDept ? 'orchestrator_resolved' : matchedDept ? 'burst_keyword' : 'stale_crm',
        resolvedActiveDepartment: dept,
        orchestratorDept,
        staleDept: unifiedContext?.opportunity?.department || null,
        finalPath: 'multi_intent_healthcare_tourism_fallback'
      }));

      const text = `${location}'dan bizimle iletişime geçtiğiniz için teşekkür ederiz. ${dept} süreci, ulaşım ve fiyatlandırma ile ilgili bilgiler aşağıdadır:\n\n` +
        `• **Ulaşım ve Konaklama**: Şehir dışı ve yurt dışından gelen hastalar için hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller konusunda danışmanlık yapılabilir. Konaklama garantisi veya rezervasyon sözü veremem.\n` +
        `• **${dept} Süreci**: İlgili branşımız bünyesinde değerlendirme ve hizmet süreçleri uzman ekibimiz kontrolünde planlanmaktadır.\n` +
        `• **Fiyatlandırma**: Hizmet ücretleri, yapılacak değerlendirme ve oluşturulacak kişiye özel plana göre belirlenmektedir.\n` +
        `• **Sonraki Adım**: Önce sorduğunuz başlık üzerinden ilerleyelim; konaklama, ödeme veya geliş sürecinde hangi detayı netleştirmek istersiniz?`;

      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'multi_intent_healthcare_tourism_fallback',
        detectedIntent: 'price_question'
      };
    }

    const isPromptChallenge = (detectedIntent as string) === 'prompt_challenge' || interpretedIntent === 'prompt_challenge';
    const isAbuseOrInsult = (detectedIntent as string) === 'abuse_or_insult' || interpretedIntent === 'abuse_or_insult';
    const isIdentityQuestion = (detectedIntent as string) === 'identity_question' || interpretedIntent === 'identity_question';
    
    const isAngryPatientText = [
      'şikayet', 'sikayet', 'rezalet', 'berbat', 'kötü', 'kotu', 'memnun değil', 'memnun degil',
      'memnun kalmadım', 'memnun kalmadim', 'ilgisiz', 'zaman kaybı', 'zaman kaybi', 'robot',
      'otomatik', 'dalga mı', 'dalga mi', 'düzgün', 'duzgun', 'sinir', 'bıktım', 'biktim',
      'yeter', 'insanla', 'temsilci', 'canlı destek', 'canli destek', 'muhatap', 'kızgın', 'kizgin'
    ].some(kw => lowerInbound.includes(kw));

    const isAngryOrChallenge = 
      isPromptChallenge || 
      isAbuseOrInsult || 
      isIdentityQuestion ||
      isAngryPatientText ||
      interpretedIntent === 'user_correction' ||
      (unifiedContext?.settings?.angryPatientMode === true) ||
      (lowerInbound.includes('bot') || lowerInbound.includes('yapay zeka') || lowerInbound.includes('robot'));

    const assistantHistory = (history || []).filter((m: any) => m.role === 'assistant' || m.direction === 'out');
    const isOngoingConversation = assistantHistory.length > 0;

    const intro = isAngryOrChallenge
      ? '' // No hello/intro for angry/challenge path
      : (isOngoingConversation
          ? 'Merhaba,'
          : (identityConfig.personaName 
              ? `Merhaba, ${identityConfig.personaName} ben.` 
              : `Merhaba, ben ${isHealthcare ? 'hastane ' : ''}iletişim asistanıyım.`));

    // P0.11: Pre-process mother & complaint info for challenge/angry path
    const factsText = Array.isArray(unifiedContext?.patient_known_facts) ? unifiedContext.patient_known_facts.join(' ').toLowerCase() : '';
    const historyText = (history || []).map((m: any) => m.content).join(' ').toLowerCase();
    const hasMother = lowerInbound.includes('anne') || factsText.includes('anne') || historyText.includes('anne') || lowerInbound.includes('valide') || factsText.includes('valide') || historyText.includes('valide');

    if (!complaint) {
      if (lowerInbound.includes('bel fıt') || lowerInbound.includes('bel fit') || historyText.includes('bel fıt') || historyText.includes('bel fit')) {
        complaint = 'bel fıtığı';
        hasComplaint = true;
      }
    }

    // P0.17: Short confirmation no-slot handler
    // When user says "olur/tamam/evet" (short confirmation) with:
    //   - NO active pending slot (pendingSlot is generic_none or empty)
    //   - NO active task time context (no real scheduled time to confirm)
    // → Produce safe acknowledgment WITHOUT fabricating dates/times
    // This prevents LLM from inventing "22 Haziran Pazartesi 15:00" etc.
    const SHORT_CONFIRM_TOKENS = ['olur', 'tamam', 'evet', 'tabi', 'tabii', 'harika', 'süper', 'peki', 'ok', 'okay', 'tamamdır', 'iyi'];
    const wordCount = lowerInbound.split(/\s+/).filter(Boolean).length;
    const isShortConfirmation = wordCount <= 3 && SHORT_CONFIRM_TOKENS.some(kw => lowerInbound === kw || lowerInbound.startsWith(kw + ' ') || lowerInbound.endsWith(' ' + kw));
    const hasPendingSlotActive = pendingSlot && pendingSlot !== 'generic_none' && pendingSlot !== 'none';
    const hasActiveTaskTimeContext = !!(
      unifiedContext?.active_task?.metadata?.scheduled_for_utc ||
      unifiedContext?.active_task?.metadata?.callback_time_tr
    );

    if (isShortConfirmation && !hasPendingSlotActive && !hasActiveTaskTimeContext) {
      console.log(JSON.stringify({
        tag: 'SHORT_CONFIRMATION_NO_SLOT_BYPASS',
        inbound: lowerInbound,
        wordCount,
        hasPendingSlotActive,
        hasActiveTaskTimeContext,
        finalPath: 'short_confirmation_no_slot_safe'
      }));
      return {
        text: `Anladım. Size hangi konuda yardımcı olayım?`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'short_confirmation_no_slot_safe',
        detectedIntent: 'confirmation_yes_no' as any
      };
    }

    const isFactsRecallQuery = ['hastalıklar neydi', 'hastaliklar neydi', 'şikayetim neydi', 'sikayetim neydi', 'geçmiş şikayetler', 'gecmis sikayetler', 'ne yazmıştım', 'ne yazmistim', 'hangi hastalık', 'hangi hastalik', 'hastaliklarim neydi', 'hastalıklarım neydi'].some(kw => lowerInbound.includes(kw));

    if (isFactsRecallQuery) {
      const { ConversationKnownFactsResolver } = require('./conversation-known-facts-resolver');
      const factsObj = ConversationKnownFactsResolver.resolve({
        history,
        opportunity: unifiedContext?.opportunity,
        profile: unifiedContext?.profile,
        latestForm: unifiedContext?.latestForm,
        conversation: unifiedContext?.conversation,
        patient_known_facts: unifiedContext?.patient_known_facts
      });
      const factsList = ConversationKnownFactsResolver.formatFacts(factsObj);
      
      let text = '';
      if (factsList.length > 0) {
        text = `Kayıtlarımızdaki bilgileriniz şu şekildedir:\n\n` + factsList.map((f: string) => `• ${f}`).join('\n');
      } else {
        text = `Kayıtlarımızda henüz kayıtlı bir şikayet veya hastalık bilgisi bulunmamaktadır. Yardımcı olabilmem için şikayetinizi veya gitmek istediğiniz bölümü paylaşabilir misiniz?`;
      }
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'facts_recall_bypass',
        detectedIntent: 'complaint_detail' as any
      };
    }

    // Name Intent detection ("ismim/adım [X]", "ben [X]" or profile name match)
    const nameIntroductions = [
      /\bismim\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
      /\badım\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
      /\badim\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
      /\bben\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i
    ];
    let detectedName = '';
    for (const regex of nameIntroductions) {
      const match = inboundText.match(regex);
      if (match && match[1]) {
        detectedName = match[1].split(/[.,!?\s]+/)[0].trim();
        break;
      }
    }

    const profileName = unifiedContext?.profile?.first_name || unifiedContext?.conversation?.patient_name || '';
    if (!detectedName && profileName && profileName.trim().length > 1) {
      const cleanProfile = profileName.toLowerCase().trim();
      if (lowerInbound.includes(cleanProfile)) {
        detectedName = profileName.trim();
      }
    }

    if (detectedName) {
      const { isValidPatientName } = require('../../utils/patient-name-resolver');
      if (!isValidPatientName(detectedName)) {
        detectedName = '';
      } else {
        // Capitalize first letter, support Turkish lowercase 'i' to uppercase 'İ'
        const firstChar = detectedName.charAt(0);
        const upperFirst = firstChar === 'i' ? 'İ' : (firstChar === 'ı' ? 'I' : firstChar.toUpperCase());
        detectedName = upperFirst + detectedName.slice(1);
      }
    }

    const systemPromptContent = params.systemPromptText || brain.prompts?.systemPrompt || '';

    const identityCtx = resolveActivePromptIdentityContext({
      brain,
      identityConfig,
      systemPromptText: systemPromptContent
    });

    const hasPersona = !!identityCtx.personaName && identityCtx.personaName !== 'Asistan';
    const pName = identityCtx.personaName || 'Asistan';
    // P0.18: agentName önce identityCtx'den, yoksa TenantConfigResolver'dan okunuyor
    // Bu sayede farklı tenant'larda 'hasta danışmanımız' yerinde custom label kullanılabilir
    const { TenantConfigResolver } = require('./tenant-config-resolver');
    const orgName = identityCtx.organizationName || TenantConfigResolver.getOrgNameFallback(brain);
    const agentName = (identityCtx as any).agentName || TenantConfigResolver.getAgentName(brain);

    // 1. identity_question
    if (detectedIntent === 'identity_question') {
      if (hasPersona) {
        return {
          text: `Ben *${pName}*, ${orgName}’nden sizinle ilgileniyorum. Size nasıl yardımcı olabilirim? 🌿`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'identity_tenant_bypass',
          detectedIntent
        };
      } else {
        return {
          text: `Merhaba, size yardımcı olmak üzere buradayım. Hangi konuda bilgi almak istersiniz?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'identity_generic_bypass',
          detectedIntent
        };
      }
    }

    // 2. call_scheduling_request (only if tenant has custom active prompt/config)
    if (detectedIntent === 'call_scheduling_request' && identityCtx.hasTenantPrompt) {
      const { isValidPatientName } = require('../../utils/patient-name-resolver');
      const patientNameVal = unifiedContext?.conversation?.patient_name || unifiedContext?.opportunity?.patient_name || '';
      const hasValidName = patientNameVal && isValidPatientName(patientNameVal) && !patientNameVal.includes('İsimsiz') && !patientNameVal.match(/^\+?\d+/);

      if (!hasValidName) {
        return {
          text: `Telefon görüşmesi planlaması için ${agentName} size yardımcı olabilir. Size uygun olduğunuz bir zaman aralığını belirtebilir misiniz? Ayrıca, size daha doğru yardımcı olabilmem için adınızı öğrenebilir miyim? 🙏`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'call_scheduling_tenant_unknown_name_bypass',
          detectedIntent
        };
      } else {
        return {
          text: `Telefon görüşmesi planlaması için ${agentName} size yardımcı olabilir. Size uygun olduğunuz bir zaman aralığını belirtebilir misiniz? 🙏`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'call_scheduling_tenant_known_name_bypass',
          detectedIntent
        };
      }
    }

    // 3. name_intent + aktif call flow (only if tenant has custom active prompt/config)
    const isNameAllowed = isNameBypassAllowed({
      inboundText,
      history,
      detectedIntent: (detectedIntent as string) || undefined,
      interpretedIntent: interpretedIntent || undefined
    });
    
    if (isNameAllowed && identityCtx.hasTenantPrompt) {
      const nameToUse = detectedName;
      return {
        text: `Teşekkür ederim ${nameToUse}. Bilgilerinizi not aldım. Görüşme için size hangi saat aralığında ulaşılması uygun olur? 🙏`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'name_intent_call_flow_tenant_bypass',
        detectedIntent
      };
    }

    // 4. continuation_short_reply + aktif pending slot (only if tenant has custom active prompt/config)
    if (detectedIntent === 'continuation_short_reply' && identityCtx.hasTenantPrompt) {
      if (pendingSlot === 'call_time' || pendingSlot === 'call_date' || pendingSlot === 'timezone_clarification') {
        return {
          text: "Arama planlaması için size hangi saat aralığında ulaşılması uygun olur? 🙏",
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'continuation_call_time_tenant_bypass',
          detectedIntent
        };
      } else if (pendingSlot === 'confirmation_yes_no') {
        return {
          text: "Belirttiğimiz görüşme planlamasını onaylıyor musunuz?",
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'continuation_confirmation_tenant_bypass',
          detectedIntent
        };
      }
    }

    // Doctor Lookup Resolver
    const isDoctorLookup = detectedIntent === 'doctor_lookup' || interpretedIntent === 'doctor_lookup';
    if (isDoctorLookup) {
      let text = '';
      const doctorDirectory = brain.context.config?.doctors || brain.context.config?.doctorDirectory || brain.context.config?.doctor_directory;
      let verifiedDoctorsText = '';
      if (Array.isArray(doctorDirectory) && doctorDirectory.length > 0) {
        verifiedDoctorsText = doctorDirectory.join('\n');
      } else if (typeof doctorDirectory === 'string' && doctorDirectory.trim().length > 0) {
        verifiedDoctorsText = doctorDirectory.trim();
      }

      const { ConversationKnownFactsResolver } = require('./conversation-known-facts-resolver');
      const facts = ConversationKnownFactsResolver.resolve({
        history,
        opportunity: unifiedContext?.opportunity,
        profile: unifiedContext?.profile,
        latestForm: unifiedContext?.latestForm,
        conversation: unifiedContext?.conversation,
        patient_known_facts: unifiedContext?.patient_known_facts
      });

      if (isHealthcare) {
        // P0.16-H: use orchestratorDept first, then previousDepartments from facts, then complaint
        let deptPhrase = '';
        const effectiveDept = orchestratorDept || (facts.previousDepartments?.[0] || null);
        if (effectiveDept) {
          deptPhrase = `${effectiveDept} bölümü`;
        } else if (facts.complaint) {
          deptPhrase = `${facts.complaint} şikayetinizle ilgili bölüm`;
        }

        // P0.16-H Telemetry: doctor lookup department selected
        console.log(JSON.stringify({
          tag: 'DOCTOR_LOOKUP_DEPARTMENT_SELECTED',
          path: 'fallback_bypass',
          source: orchestratorDept ? 'orchestrator_resolved' : (facts.previousDepartments?.[0] ? 'history_facts' : 'complaint'),
          resolvedActiveDepartment: effectiveDept || null,
          staleDept: unifiedContext?.opportunity?.department || null,
        }));

        // P0.16-M: DoctorNamesPolicy replaces legacy "şu an bu ekrandan" text
        if (verifiedDoctorsText) {
          const targetPhrase = deptPhrase ? `${deptPhrase} için doğrulanmış uzman ekibimizin` : 'doğrulanmış uzman ekibimizin';
          text = `Sizlere hizmet veren ${targetPhrase} listesini aşağıda paylaşıyorum:\n${verifiedDoctorsText}`;
        } else {
          // P0.16-M: Never use legacy "bu ekrandan net doğrulayamıyorum" — use DoctorNamesPolicy instead
          const deptKey = effectiveDept ? [effectiveDept] : [];
          try {
            const { DoctorNamesPolicy } = require('./doctor-names-policy');
            const policy = DoctorNamesPolicy.resolve(brain, deptKey, false);
            text = policy.text;
          } catch {
            // Safe fallback if DoctorNamesPolicy not available
            const dept = deptPhrase || 'ilgili bölümümüz';
            text = `${dept} için güncel uzman listesini burada güvenle paylaşamıyorum. Hangi bölüm veya uzmanlık hakkında bilgi almak istediğinizi netleştirir misiniz?`;
          }
        }
      } else {
        if (verifiedDoctorsText) {
          text = `Doğrulanmış uzman kadromuz:\n${verifiedDoctorsText}`;
        } else {
          text = `Bu ekrandan güncel uzman listesini doğrulayamıyorum. Talebinizle ilgili uzman ekibimiz değerlendirme yapabilir. İsterseniz temsilci ekibimize yönlendirilmesi için not alabilirim.`;
        }
      }

      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'doctor_lookup_bypass',
        detectedIntent
      };
    }

    // Human Transfer Resolver
    const isHumanTransfer = detectedIntent === 'human_transfer_request' || interpretedIntent === 'human_transfer_request';
      if (isHumanTransfer) {
      const text = isHealthcare
        ? `Haklısınız, bu konuda ${agentName} yardımcı olabilir. Hangi konuda destek istediğinizi kısaca netleştirir misiniz?`
        : `Haklısınız, bu konuda temsilci ekibimiz yardımcı olabilir. Hangi konuda destek istediğinizi kısaca netleştirir misiniz?`;
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'human_transfer_bypass',
        detectedIntent
      };
    }

    // Form Followup Resolver
    const isFormFollowup = detectedIntent === 'form_followup' || interpretedIntent === 'form_followup';
    if (isFormFollowup) {
      const formFacts = unifiedContext?.patient_known_facts || [];
      const hasRealFormContext = !!unifiedContext?.latestForm || (Array.isArray(formFacts) && formFacts.length > 0);
      // Try to extract known complaint for personalized acknowledgment
      const _formData = unifiedContext?.latestForm?.data;
      const _parsedFormData = typeof _formData === 'string' ? (() => { try { return JSON.parse(_formData); } catch { return {}; } })() : (_formData || {});
      const knownComplaint = _parsedFormData?.complaint || _parsedFormData?.subject || unifiedContext?.opportunity?.complaint || '';
      const complaintPhrase = knownComplaint && typeof knownComplaint === 'string' && knownComplaint.trim() ? ` (${knownComplaint.trim()})` : '';
      let text = '';
      if (hasRealFormContext) {
        // Form linked — acknowledge and ask a neutral continuation question.
        text = `Form kaydınızı görüyorum${complaintPhrase}. Size doğru yardımcı olabilmem için hangi konuda bilgi almak istediğinizi kısaca yazar mısınız?`;
      } else {
        // Form not yet linked to this conversation — never imply a form/application exists.
        text = `Size yardımcı olayım. Hangi konuda bilgi almak istediğinizi veya şikayetinizi kısaca yazar mısınız?`;
      }
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext: hasRealFormContext,
        hasComplaint,
        finalPath: 'form_followup_bypass',
        detectedIntent
      };
    }

    const isBotAccusation = ['bot musun', 'sen bot musun', 'are you a bot', 'botsun', 'robot musun', 'yapay zeka mısın', 'yapay zeka misin', 'insan mısın', 'insan misin'].some(kw => lowerInbound.includes(kw));
    const isAiAccusation = ['yapay zeka', 'yapayzeka', 'gpt', 'gemini', 'openai', 'claude', 'dil modeli', 'hangi model'].some(kw => lowerInbound.includes(kw));
    const isPromptChallengeOnly = detectedIntent === 'prompt_challenge' || interpretedIntent === 'prompt_challenge' || ['prompt', 'promt', 'sistem prompt', 'system prompt', 'talimatların', 'sistem talimati', 'kuralın ne', 'direktifin ne', 'uydurma'].some(kw => lowerInbound.includes(kw));
    const isAngryPromptChallenge = isPromptChallengeOnly && ['şikayet', 'sikayet', 'rezalet', 'berbat', 'kötü', 'sinir', 'bıktım', 'yeter', 'dalga'].some(kw => lowerInbound.includes(kw));

    const isLlmBypassChallenge = isPromptChallengeOnly || isBotAccusation || isAiAccusation || isAngryPromptChallenge;

    if (isLlmBypassChallenge) {
      const { PromptChallengeSafetyPolicy } = require('./prompt-challenge-safety-policy');
      const { ConversationKnownFactsResolver } = require('./conversation-known-facts-resolver');
      
      const facts = ConversationKnownFactsResolver.resolve({
        history,
        opportunity: unifiedContext?.opportunity,
        profile: unifiedContext?.profile,
        latestForm: unifiedContext?.latestForm,
        conversation: unifiedContext?.conversation,
        patient_known_facts: unifiedContext?.patient_known_facts
      });

      const text = PromptChallengeSafetyPolicy.getChallengeFallbackResponse(
        inboundText,
        facts,
        hasPersona ? pName : undefined,
        identityCtx.organizationName
      );

      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'prompt_challenge_bypass',
        detectedIntent
      };
    }

    if (isAngryOrChallenge) {
      // Identity query, bot questions, abuse or general anger
      let text = '';

      const isAiOrBotOrPromptQuestion = 
        lowerInbound.includes('bot') || 
        lowerInbound.includes('yapay zeka') || 
        lowerInbound.includes('robot') || 
        lowerInbound.includes('prompt') || 
        lowerInbound.includes('promt') || 
        lowerInbound.includes('sistem') || 
        (detectedIntent as string) === 'prompt_challenge' || 
        interpretedIntent === 'prompt_challenge' || 
        (detectedIntent as string) === 'identity_question' || 
        interpretedIntent === 'identity_question';

      if (hasPersona && isAiOrBotOrPromptQuestion) {
        text = `Ben ${pName}, ${orgName ? orgName + "’nden " : ""}size yardımcı olmaya çalışıyorum. Çalışma sistemimizle ilgili iç detayları pek paylaşamıyorum; ama şikayetinizi anlamak, sizi doğru bölüme yönlendirmek ve randevu sürecinizi netleştirmek için buradayım.`;
      } else {
        if (hasComplaint) {
          text = `Kusura bakmayın, cevaplarım yeterince net olmadı. ${hasMother ? 'Annenizin ' : ''}${complaint} süreciyle ilgili sorularınızı daha düzgün yanıtlayayım.`;
        } else {
          text = isHealthcare
            ? 'Kusura bakmayın, cevaplarım yeterince net olmadı. Size sağlık talebinizle ilgili yardımcı olayım.'
            : 'Kusura bakmayın, cevaplarım yeterince net olmadı. Size yardımcı olmaya devam edebilirim.';
        }
      }
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'angry_challenge_fallback',
        detectedIntent
      };
    }

    // Priority 1: User Correction / Frustration
    if (detectedIntent === 'user_correction' || interpretedIntent === 'user_correction') {
      const isRecallFrustration = ['söyledim', 'soyledim', 'belirttim', 'belirtmiştim', 'belirtmistim', 'yazdım ya', 'yazdim ya', 'aynı şeyi söyleme', 'ayni seyi soyleme'].some(kw => lowerInbound.includes(kw));

      let replyText = '';
      if (isRecallFrustration) {
        const recallSummary = buildRecallFactsSummary(history);
        if (recallSummary) {
          replyText = `Haklısınız, ${recallSummary} yazmıştınız. Buradan hangi noktayı netleştirmemi istersiniz?`;
        } else {
          replyText = `Haklısınız, önceki mesajlarınızı kontrol ettim. Size daha iyi yardımcı olabilmem için hangi konuyu netleştirelim?`;
        }
      } else {
        const { ConversationKnownFactsResolver } = require('./conversation-known-facts-resolver');
        const facts = ConversationKnownFactsResolver.resolve({
          history,
          opportunity: unifiedContext?.opportunity,
          profile: unifiedContext?.profile,
          latestForm: unifiedContext?.latestForm,
          conversation: unifiedContext?.conversation
        });

        let deptPhrase = '';
        if (facts.previousDepartments && facts.previousDepartments.length > 0) {
          deptPhrase = facts.previousDepartments[0];
        } else if (facts.complaint) {
          deptPhrase = `${facts.complaint} ile ilgili bölüm`;
        }

        const isContinuityMention = ['söyledin', 'soyledin', 'dedin', 'söylemiştin', 'soylemistin', 'belirttin'].some(kw => lowerInbound.includes(kw));

        if (isContinuityMention && deptPhrase && isHealthcare) {
          replyText = `Haklısınız, kusura bakmayın. Önceki mesajlarımızda ${deptPhrase} ile ilgili görüşmüştük. Bu konuyla ilgili hangi bilgiyi netleştireyim?`;
        } else {
          const userMsgs = history.filter((m: any) => m.role === 'user');
          const lastUserMsgText = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : '';
          if (lastUserMsgText) {
            if (isHealthcare) {
              replyText = `Haklısınız, cevabınızı aldım. ${lastUserMsgText} bilgisini dikkate alarak devam ediyorum. Hangi konuda yardımcı olayım?`;
            } else {
              replyText = `Haklısınız, cevabınızı aldım. ${lastUserMsgText} bilgisini dikkate alarak devam ediyorum. Hangi konuda yardımcı olayım?`;
            }
          } else {
            if (isHealthcare) {
              replyText = `Haklısınız, cevabınızı aldım. Hangi konuda yardımcı olayım?`;
            } else {
              replyText = `Haklısınız, cevabınızı aldım. Hangi konuda yardımcı olayım?`;
            }
          }
        }
      }

      return {
        text: replyText,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: isRecallFrustration ? 'user_correction_recall_fallback' : 'user_correction_fallback',
        detectedIntent
      };
    }

    // P0.16-J: Next Step / Consultant Ownership — fires before transfer/generic
    const isNextStepRequest = (detectedIntent as string) === 'next_step_request' || interpretedIntent === 'next_step_request';
    if (isNextStepRequest) {
      // Scan history for multi-patient context (primary + secondary patient mentions)
      const histText = (history || []).map((m: any) => (m.content || '').toLowerCase()).join(' ');

      // Primary complaint (the user themselves)
      const selfComplaint = (() => {
        if (histText.includes('bel fıt') || histText.includes('bel fit')) return 'bel fıtığı değerlendirme süreci';
        if (histText.includes('boyun fıt') || histText.includes('boyun fit')) return 'boyun fıtığı değerlendirme süreci';
        if (histText.includes('diz') && histText.includes('ağrı')) return 'diz ağrısı değerlendirme süreci';
        if (histText.includes('ameliyat')) return 'ameliyat değerlendirme süreci';
        if (histText.includes('omurga')) return 'omurga değerlendirme süreci';
        return null;
      })();

      // Secondary patient (e.g. annem, babam, eşim, yakınım)
      const hasMother = histText.includes('annem');
      const hasFather = histText.includes('babam');
      const hasSpouse = histText.includes('eşim') || histText.includes('esim');
      const hasSecondary = hasMother || hasFather || hasSpouse;
      const secondaryLabel = hasMother ? 'anneniz' : hasFather ? 'babanız' : hasSpouse ? 'eşiniz' : null;

      // Secondary department from history
      const secondaryDept = (() => {
        if (histText.includes('kardiyoloji')) return 'Kardiyoloji';
        if (histText.includes('göz') || histText.includes('goz')) return 'Göz';
        if (histText.includes('ortopedi')) return 'Ortopedi';
        if (histText.includes('beyin') || histText.includes('sinir') || histText.includes('fıtık') || histText.includes('fitik')) return 'Beyin Cerrahi';
        return null;
      })();

      // Location context
      const isAbroad = histText.includes('almanya') || histText.includes('yurt dışı') || histText.includes('yurt disi')
        || histText.includes('avusturya') || histText.includes('hollanda') || histText.includes('ingiltere')
        || histText.includes('fransa') || histText.includes('isviçre');
      const countryName = histText.includes('almanya') ? 'Almanya'
        : histText.includes('avusturya') ? 'Avusturya'
        : histText.includes('hollanda') ? 'Hollanda'
        : histText.includes('ingiltere') ? 'İngiltere'
        : histText.includes('fransa') ? 'Fransa'
        : isAbroad ? 'Yurt dışı' : null;

      // Build topic list
      const topics: string[] = [];
      if (selfComplaint) topics.push(`Sizin için: ${selfComplaint}`);
      if (hasSecondary && secondaryDept) topics.push(`${secondaryLabel ? secondaryLabel.charAt(0).toUpperCase() + secondaryLabel.slice(1) : 'Yakınınız'} için: ${secondaryDept} bilgi talebi`);
      else if (hasSecondary && !secondaryDept) topics.push(`${secondaryLabel ? secondaryLabel.charAt(0).toUpperCase() + secondaryLabel.slice(1) : 'Yakınınız'} için: bilgi talebi`);

      // Compose response
      let text = '';
      if (isHealthcare) {
        if (topics.length >= 2) {
          const topicLines = topics.map((t, i) => `${i + 1}. ${t}`).join('\n');
          text = `Elbette, hemen netleştirelim.\n\nŞu konuları anlıyorum:\n${topicLines}\n\nÖnce hangi konu hakkında bilgi almak istersiniz?`;
          if (countryName) {
            text += `\n${countryName}'da olduğunuzu görüyorum; geliş, konaklama veya süreçle ilgili hangi noktayı netleştirelim?`;
          }
        } else if (selfComplaint) {
          text = `Elbette, belirleyelim.\n\n${selfComplaint} için hangi bilgiyi netleştirmek istersiniz?`;
          if (countryName) {
            text += `\n${countryName}'da olduğunuzu görüyorum; geliş, konaklama veya süreçle ilgili sorularınızı da yanıtlayabilirim.`;
          }
        } else {
          text = `Elbette, belirleyelim. Hangi konuda bilgi almak istersiniz?`;
          if (countryName) {
            text += `\n${countryName}'da olduğunuzu görüyorum; geliş, konaklama veya süreçle ilgili hangi noktayı netleştirelim?`;
          }
        }
      } else {
        text = `Elbette, belirleyelim. Hangi konuda bilgi almak istersiniz?`;
      }

      // Telemetry
      console.log(JSON.stringify({
        tag: 'CONSULTANT_NEXT_STEP_TRIGGERED',
        resolvedIndustry,
        hasMultiPatientContext: hasSecondary,
        hasSelfComplaint: !!selfComplaint,
        secondaryLabel: secondaryLabel || null,
        topicCount: topics.length,
        isAbroad,
        countryName: countryName || null
      }));
      console.log(JSON.stringify({
        tag: 'NEUTRAL_CONTINUATION_REQUESTED',
        resolvedIndustry,
        topicCount: topics.length,
        isAbroad
      }));

      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'next_step_consultant_ownership',
        detectedIntent
      };
    }


    if (detectedIntent === 'transfer_request' || interpretedIntent === 'transfer_request') {
      return {
        text: `Size yardımcı olabilmem için hangi konuda destek istediğinizi kısaca netleştirir misiniz?`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_transfer_fallback',
        detectedIntent: 'transfer_request'
      };
    }

    // Priority 3: Pending Slot-Aware Fallback (guided recovery)
    if (pendingSlot && pendingSlot !== 'generic_none') {
      let slotText = '';
      if (pendingSlot === 'complaint_duration') {
        slotText = `Şikayetinizin ne kadardır devam ettiğini (örneğin kaç gündür veya kaç aydır olduğunu) paylaşabilir misiniz?`;
      } else if (pendingSlot === 'call_date') {
        slotText = `Telefon görüşmesi için size uygun günü paylaşabilir misiniz?`;
      } else if (pendingSlot === 'call_time') {
        slotText = `Telefon görüşmesi için size uygun saat aralığını paylaşabilir misiniz?`;
      } else if (pendingSlot === 'timezone_clarification') {
        slotText = `Belirttiğiniz saat hangi ülke veya şehir saatine göre olsun?`;
      } else if (pendingSlot === 'confirmation_yes_no') {
        slotText = `Belirttiğimiz görüşme planlamasını onaylıyor musunuz?`;
      } else if (pendingSlot === 'transfer_confirmation') {
        slotText = isHealthcare
          ? `Sizi ilgili ${agentName}ımıza aktarmamı onayliyor musunuz?`
          : `Sizi ilgili uzman temsilcimize aktarmamı onaylıyor musunuz?`;
      } else if (pendingSlot === 'price_followup') {
        slotText = isHealthcare
          ? `Hangi hizmet veya bölüm için ücret bilgisi almak istediğinizi netleştirir misiniz?`
          : `Hangi hizmet için ücret bilgisi almak istediğinizi netleştirir misiniz?`;
      } else if (pendingSlot === 'complaint_detail') {
        slotText = `Durumunuzu daha iyi anlayabilmemiz için şikayetinizi biraz daha detaylandırabilir misiniz?`;
      }

      if (slotText) {
        return {
          text: slotText,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: `pending_slot_${pendingSlot}_fallback`,
          detectedIntent
        };
      }
    }

    if (detectedIntent === 'callback_confirmation' || detectedIntent === 'schedule_confirmation') {
      let text = '';
      if (lang === 'tr') {
        text = "Anladım. Hangi gün ve saat için konuşmuştuk?";
      } else if (lang === 'de') {
        text = "Verstanden. Für welchen Tag und welche Uhrzeit hatten wir gesprochen?";
      } else if (lang === 'nl') {
        text = "Begrepen. Over welke dag en welk tijdstip hadden we het?";
      } else if (lang === 'ar') {
        text = "فهمت. عن أي يوم ووقت كنا نتحدث؟";
      } else {
        text = "Understood. Which day and time were we discussing?";
      }
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: `intent_callback_confirmation_fallback_${lang}`,
        detectedIntent
      };
    }

    // Priority 4: General Intent Fallbacks
    if (detectedIntent === 'call_scheduling_request') {
      const factsText = Array.isArray(unifiedContext?.patient_known_facts) ? unifiedContext.patient_known_facts.join(' ').toLowerCase() : '';
      const historyText = (history || []).map((m: any) => m.content).join(' ').toLowerCase();
      const hasTime = factsText.includes('saat') || historyText.includes('saat') || /\d{1,2}[:.]\d{2}/.test(lowerInbound) || /\b\d{1,2}\s*(de|da|te|ta|e|a|gibi|sularında)\b/.test(lowerInbound);
      
      let text = '';
      if (isHealthcare) {
        if (hasTime) {
          text = `Paylaştığınız zamanı aldım. Hangi gün için uygun olduğunu da yazar mısınız?`;
        } else {
          text = `Size hangi saat aralığında ulaşılması uygun olur? 🙏`;
        }
      } else {
        if (hasTime) {
          text = `Paylaştığınız zamanı aldım. Hangi gün için uygun olduğunu da yazar mısınız?`;
        } else {
          text = `Size hangi saat aralığında ulaşılması uygun olur? 🙏`;
        }
      }
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_call_scheduling_fallback',
        detectedIntent
      };
    }

    if (detectedIntent === 'callback_time_answer' || detectedIntent === 'time_availability') {
      if (turkeyVisitIntent === 'turkey_visit_intent_unknown') {
        return {
          text: "Paylaştığınız saati not aldım. Arama planlamasına geçmeden önce bu görüşmeyi hangi konu için istediğinizi kısaca netleştirir misiniz?",
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'callback_time_answer_unknown_turkish',
          detectedIntent
        };
      } else if (turkeyVisitIntent === 'turkey_visit_intent_negative' || turkeyVisitIntent === 'turkey_visit_intent_uncertain') {
        return {
          text: "Paylaştığınız saati not aldım. Bu durumda sizi randevuya yönlendirmeyeyim. Merak ettiğiniz konular olursa buradan bilgi vermeye devam edebilirim.",
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'callback_time_answer_negative_turkish',
          detectedIntent
        };
      }

      const text = `Paylaştığınız zaman bilgisini aldım. Hangi gün için uygun olduğunu da netleştirir misiniz?`;
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_time_availability_fallback',
        detectedIntent
      };
    }

    if (detectedIntent === 'price_question') {
      const institutionLabel = TenantConfigResolver.getInstitutionLabel(brain);
      const text = isHealthcare
        ? `Ücret bilgisi, ${institutionLabel} yapılacak kişiye özel değerlendirme ve planlanacak hizmete göre netleşebilir. Hangi hizmet veya bölüm için fiyat bilgisi almak istiyorsunuz?`
        : `Ücret bilgisi, seçilecek hizmete ve kişiye özel planlamaya göre netleşebilir. Hangi hizmet için fiyat bilgisi almak istiyorsunuz?`;
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_price_question_fallback',
        detectedIntent
      };
    }

    if (detectedIntent === 'distance_objection') {
      const text = isHealthcare
        ? `Uzaklık ve konaklama endişenizi anlıyorum. Hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller konusunda danışmanlık yapılabilir; garanti veya rezervasyon sözü veremem. Bu konuda özellikle hangi bilgiyi netleştirmek istersiniz?`
        : `Mesafe konusundaki endişenizi anlıyorum. Ulaşım veya süreçle ilgili hangi noktayı önce netleştirmek istersiniz?`;
      return {
        text,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_distance_objection_fallback',
        detectedIntent
      };
    }

    // 3. Fallback Generation Routing for non-intent or default intents

    // Name Intent detection already performed at initialization

    if (detectedName) {
      if (isHealthcareOrForm && hasComplaint) {
        const isCheckup = ContextAwareSafeFallbackResolver.isCheckupRequest(complaint);
        if (isCheckup) {
          return {
            text: `Teşekkür ederim ${detectedName}. Check-up planlamanızla ilgili buradan yardımcı olabiliriz. Türkiye'ye/Konya'ya geliş döneminiz yaklaşık belli mi?`,
            sector: resolvedIndustry,
            hasFormContext,
            hasComplaint,
            finalPath: 'name_healthcare_checkup_fallback',
            detectedIntent
          };
        }
        return {
          text: `Teşekkür ederim ${detectedName}. ${complaint} konusuyla ilgili uygun zamanı netleştirebiliriz.`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'name_healthcare_complaint_fallback',
          detectedIntent
        };
      } else {
        return {
          text: `Teşekkür ederim ${detectedName}. Bilgilerinizi not aldım.`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'name_generic_fallback',
          detectedIntent
        };
      }
    }

    // Intent: Greeting
    if (isGreeting) {
      if (isHealthcare && hasComplaint) {
        const isCheckup = ContextAwareSafeFallbackResolver.isCheckupRequest(complaint);
        if (isCheckup) {
          return {
            text: `${intro} Check-up talebinizle ilgili buradan yardımcı olayım. Planlamayı doğru yapabilmemiz için Türkiye'ye/Konya'ya geliş döneminiz yaklaşık belli mi?`,
            sector: resolvedIndustry,
            hasFormContext,
            hasComplaint,
            finalPath: 'greeting_healthcare_checkup_fallback',
            detectedIntent
          };
        }
        return {
          text: `${intro} ${complaint} konusuyla ilgili yardımcı olayım. Bu durum ne zamandır devam ediyor?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_healthcare_complaint_fallback',
          detectedIntent
        };
      } else if (hasFormContext) {
        return {
          text: `${intro} Formunuzla ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_form_fallback',
          detectedIntent
        };
      } else if (isHealthcare) {
        return {
          text: `${intro} Sağlık talebinizle ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_healthcare_generic_fallback',
          detectedIntent
        };
      } else {
        // Parametric SaaS/tenant fallback (never use "nasıl yardımcı olabilirim")
        return {
          text: `${intro} Hangi konuda bilgi almak istediğinizi yazabilirsiniz.`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_neutral_fallback',
          detectedIntent
        };
      }
    }

    // 3.5. Tenant Default History Fallback (only if no specific intent/bypass returned early)
    if (identityCtx.hasTenantPrompt && history.length > 0) {
      return {
        text: buildHistoryAwareRecoveryFallback(history, isHealthcare, resolvedIndustry, identityCtx, agentName),
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'tenant_neutral_history_fallback',
        detectedIntent
      };
    }

    // 4. Default Fallback Routing (General)
    if (history.length > 0) {
      return {
        text: buildHistoryAwareRecoveryFallback(history, isHealthcare, resolvedIndustry, identityCtx, agentName),
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_history_fallback',
        detectedIntent
      };
    }

    if (isHealthcareOrForm && hasComplaint) {
      const isCheckup = ContextAwareSafeFallbackResolver.isCheckupRequest(complaint);
      if (isCheckup) {
        return {
          text: `${intro} Check-up talebinizle ilgili buradan yardımcı olayım. Planlamayı doğru yapabilmemiz için Türkiye'ye/Konya'ya geliş döneminiz yaklaşık belli mi?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'default_healthcare_checkup_fallback',
          detectedIntent
        };
      }
      return {
        text: `${intro} ${complaint} konusuyla ilgili yardımcı olayım. Bu durum ne zamandır devam ediyor?`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_healthcare_complaint_fallback',
        detectedIntent
      };
    } else if (isHealthcare) {
      return {
        text: `${intro} Sağlık talebinizle ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_healthcare_generic_fallback',
        detectedIntent
      };
    } else {
      return {
        text: `${intro} Hangi konuda bilgi almak istediğinizi yazabilirsiniz.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_neutral_fallback',
        detectedIntent
      };
    }
  }

  private static isCheckupRequest(complaint: string): boolean {
    const lower = complaint.toLowerCase();
    const keywords = [
      'check-up',
      'checkup',
      'check up',
      'şikayetim yok',
      'sikayetim yok',
      'şkayet yok',
      'sikayet yok',
      'no complaint',
      'no complaints',
      'жалоб нет',
      'чекап',
      'чек-ап',
      'shikoyat yo'
    ];
    return keywords.some(kw => lower.includes(kw));
  }

}

export function buildRecallFactsSummary(history: any[]): string {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }

  let complaint = '';
  let duration = '';
  const symptoms: string[] = [];
  let fear = '';

  for (const msg of history) {
    if (msg.role !== 'user' || !msg.content) continue;
    const text = msg.content.toLowerCase();

    // 1. Complaint detection
    if (text.includes('bel fıt') || text.includes('bel fit')) {
      complaint = 'bel fıtığı';
    } else if (text.includes('boyun fıt') || text.includes('boyun fit')) {
      complaint = 'boyun fıtığı';
    }

    // 2. Duration detection
    const durationMatch = msg.content.match(/\b(\d+|bir|iki|üç|uc|dört|dort|beş|bes|altı|alti|yedi|sekiz|dokuz|on)\s*(?:yıldır|yildir|aydır|aydir|haftadır|haftadir|gündür|gundur)\b/i);
    if (durationMatch) {
      duration = durationMatch[0].toLowerCase();
    }

    // 3. Symptoms detection
    if (text.includes('bacak')) {
      symptoms.push('ağrının bacaklarınıza vurmaya başladığını');
    }
    if (text.includes('ayakta')) {
      symptoms.push('uzun süre ayakta duramadığınızı');
    }
    if (text.includes('uyuş') || text.includes('uyus')) {
      symptoms.push('uyuşmalarınız olduğunu');
    }

    // 4. Fear detection
    if (text.includes('ameliyat') && (text.includes('kork') || text.includes('endişe') || text.includes('endise') || text.includes('çekin') || text.includes('cekin'))) {
      fear = 'ameliyat ihtimalinden çekindiğinizi';
    }
  }

  const pieces: string[] = [];
  if (complaint) {
    if (complaint === 'bel fıtığı') {
      pieces.push(`bel fıtığınızın ${duration ? `${duration} ` : ''}sürdüğünü`);
    } else if (complaint === 'boyun fıtığı') {
      pieces.push(`boyun fıtığınızın ${duration ? `${duration} ` : ''}sürdüğünü`);
    } else {
      pieces.push(`şikayetinizin ${duration ? `${duration} ` : ''}sürdüğünü`);
    }
  } else if (duration) {
    pieces.push(`şikayetinizin ${duration} sürdüğünü`);
  }

  pieces.push(...symptoms);

  if (fear) {
    pieces.push(fear);
  }

  if (pieces.length === 0) {
    return '';
  }

  if (pieces.length === 1) {
    return pieces[0];
  }
  if (pieces.length === 2) {
    return `${pieces[0]} ve ${pieces[1]}`;
  }
  const last = pieces.pop();
  return `${pieces.join(', ')} ve ${last}`;
}

export function buildHistoryAwareRecoveryFallback(
  history: any[],
  isHealthcare: boolean,
  resolvedIndustry: string,
  identityCtx: any,
  agentName: string
): string {
  const hasHistory = Array.isArray(history) && history.length > 0;
  const pName = identityCtx?.personaName;
  // P0.18: orgName resolves via identityCtx.organizationName, then identityCtx.orgNameFallback (from TenantConfigResolver),
  // then generic sector-based default. No tenant name hardcoded.
  const orgName = identityCtx?.organizationName
    || identityCtx?.orgNameFallback
    || (isHealthcare ? 'Sağlık Merkezi' : 'Hizmet Merkezi');
  const hasPersona = !!pName && pName !== 'Asistan';

  // Check if identity was already introduced in history
  const assistantHistory = (history || []).filter(m => m.role === 'assistant' || m.direction === 'out');
  const identityAlreadyIntroduced = assistantHistory.length > 0;

  if (!hasHistory) {
    if (hasPersona) {
      return `Ben *${pName}*, ${orgName}’nden sizinle ilgileniyorum. Size nasıl yardımcı olabilirim? 🌿`;
    }
    return isHealthcare
      ? 'Merhaba, sağlık talebinizle ilgili yardımcı olayım. Şikayetinizi veya randevu almak istediğiniz bölümü yazabilirsiniz.'
      : 'Merhaba, size yardımcı olmak üzere buradayım. Hangi konuda bilgi almak istersiniz?';
  }

  // We have history! Let's extract details.
  let complaint = '';
  let duration = '';
  const symptoms: string[] = [];
  let fear = '';

  for (const msg of history) {
    if (msg.role !== 'user' || !msg.content) continue;
    const text = msg.content.toLowerCase();

    // 1. Complaint/Topic detection
    if (text.includes('bel fıt') || text.includes('bel fit')) {
      complaint = 'bel fıtığı';
    } else if (text.includes('boyun fıt') || text.includes('boyun fit')) {
      complaint = 'boyun fıtığı';
    } else if (text.includes('check-up') || text.includes('checkup')) {
      complaint = 'check-up';
    } else if (text.includes('burun esteti') || text.includes('estetik')) {
      complaint = 'estetik ve burun cerrahisi';
    }

    // 2. Duration detection
    const durationMatch = msg.content.match(/\b(\d+|bir|iki|üç|uc|dört|dort|beş|bes|altı|alti|yedi|sekiz|dokuz|on)\s*(?:yıldır|yildir|aydır|aydir|haftadır|haftadir|gündür|gundur)\b/i);
    if (durationMatch) {
      duration = durationMatch[0].toLowerCase();
    }

    // 3. Symptoms detection
    if (text.includes('bacak')) {
      symptoms.push('bacaklara vuran ağrı');
    }
    if (text.includes('ayakta')) {
      symptoms.push('uzun süre ayakta duramama');
    }
    if (text.includes('uyuş') || text.includes('uyus')) {
      symptoms.push('uyuşma');
    }

    // 4. Fear/Anxiety detection
    if (text.includes('ameliyat') && (text.includes('kork') || text.includes('endişe') || text.includes('endise') || text.includes('çekin') || text.includes('cekin'))) {
      fear = 'ameliyat';
    }
  }

  // If specific clinical profile is found (like bel fıtığı + bacak/ayakta/ameliyat)
  if (complaint === 'bel fıtığı' && (fear === 'ameliyat' || symptoms.length > 0)) {
    let response = "Ameliyat ihtimali sizi endişelendirmiş olabilir, bu anlaşılır. Bel fıtığında süreç genelde muayene ve mevcut MR/tetkiklerin değerlendirilmesiyle başlar. Her hasta için doğrudan ameliyat kararı verilmez; uygun yaklaşım uzman hekim değerlendirmesiyle netleşir.";
    
    if (symptoms.length > 0) {
      const formattedSymptoms = symptoms.join(' ve ');
      // Capitalize first letter of symptoms for clean starting
      const capitalizedSymptoms = formattedSymptoms.charAt(0).toUpperCase() + formattedSymptoms.slice(1);
      response += ` ${capitalizedSymptoms} şikayetiniz olduğu için sizi ilgili birime yönlendirebiliriz.`;
    } else {
      response += " Bel fıtığı şikayetiniz olduğu için sizi ilgili birime yönlendirebiliriz.";
    }
    return response;
  }

  // General healthcare fallback but with summary of complaint
  if (isHealthcare) {
    if (complaint) {
      const topicWord = (complaint === 'check-up' || complaint.includes('estetik')) ? 'talebinizle' : 'şikayetinizle';
      return `Haklısınız, ${complaint} ${topicWord} ilgili paylaştığınız detayları not ettim. Bu süreçte değerlendirme ve planlama için sizi ilgili birime/${agentName}a yönlendirebiliriz.`;
    }
    if (hasPersona && !identityAlreadyIntroduced) {
      return `Ben *${pName}*, ${orgName}’nden sizinle ilgileniyorum. Size sağlık talebinizle ilgili yardımcı olayım.`;
    }
    return 'Devam edelim; son mesajınızdaki talebi tam yakalayamadım. Hekim bilgisi, randevu planı veya süreçten hangisini netleştirelim?';
  }

  if (hasPersona && !identityAlreadyIntroduced) {
    return `Ben *${pName}*, ${orgName}’nden sizinle ilgileniyorum. Hangi konuda bilgi almak istediğinizi yazabilirsiniz.`;
  }
  return 'Size yardımcı olmak üzere buradayım. Hangi konuda bilgi almak istersiniz?';
}
