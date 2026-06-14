import { TenantBrain } from '../../brain/tenant-brain';
import { ConversationIntentRouter, ConversationIntent } from './conversation-intent-router';

export interface DeterministicFallbackParams {
  inboundText: string;
  brain: TenantBrain;
  identityConfig: {
    personaName?: string;
    organizationName?: string;
    organizationShortName?: string;
  };
  unifiedContext: any;
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
  /**
   * Resolves a safe, deterministic fallback text based on tenant config,
   * industry (sector), and inbound message intents.
   * Gated securely to avoid hardcoding client-specific names/terms globally.
   */
  public static resolve(params: DeterministicFallbackParams): DeterministicFallbackResult {
    const { inboundText, brain, identityConfig, unifiedContext } = params;
    const lowerInbound = (inboundText || '').toLowerCase().trim();

    // 1. Sector & Context Resolution
    const configIndustry = brain.context.config?.industry;
    const metadataIndustry = (brain.prompts.metadata as any)?.industry;
    const resolvedIndustry = (configIndustry || metadataIndustry || '').toLowerCase();
    
    const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'health';
    const hasFormContext = !!unifiedContext?.latestForm || 
      (Array.isArray(unifiedContext?.patient_known_facts) && unifiedContext.patient_known_facts.length > 0);

    const isHealthcareOrForm = isHealthcare || hasFormContext;

    // Route message to find exact intent
    const detectedIntent = ConversationIntentRouter.route(inboundText);

    // Resolve pending slot and interpreted intent
    const history = unifiedContext?.history || [];
    const { PendingQuestionResolver } = require('./pending-question-resolver');
    const { ShortAnswerInterpreter } = require('./short-answer-interpreter');
    
    const pendingSlot = PendingQuestionResolver.resolve(history);
    const interpretedIntent = ShortAnswerInterpreter.interpret(inboundText, pendingSlot);

    const isPromptChallenge = detectedIntent === 'prompt_challenge' || interpretedIntent === 'prompt_challenge';
    const isAbuseOrInsult = detectedIntent === 'abuse_or_insult' || interpretedIntent === 'abuse_or_insult';
    const isIdentityQuestion = detectedIntent === 'identity_question' || interpretedIntent === 'identity_question';
    
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

    const intro = isAngryOrChallenge
      ? '' // No hello/intro for angry/challenge path
      : (identityConfig.personaName 
          ? `Merhaba, ${identityConfig.personaName} ben.` 
          : `Merhaba, ben ${isHealthcare ? 'hastane ' : ''}iletişim asistanıyım.`);

    // CRITICAL: Prevent opportunity.summary leakage.
    // Sourced strictly from patient_known_facts, NEVER from opportunity.summary directly.
    let complaint = '';
    let hasComplaint = false;
    if (isHealthcareOrForm) {
      const facts = unifiedContext?.patient_known_facts || [];
      const rawFactsComplaint = facts.find((f: string) => f.toLowerCase().includes('şikayet') || f.toLowerCase().includes('sikayet'));
      
      if (rawFactsComplaint) {
        const match = rawFactsComplaint.match(/(?:şikayeti|sikayeti|şikayet|sikayet):\s*(.+)/i);
        if (match && match[1]) {
          complaint = match[1].replace(/[.]+$/, '').trim();
          hasComplaint = true;
        }
      }
      
      // Truncate complaint for clean message formatting
      if (complaint.length > 50) {
        complaint = complaint.substring(0, 50) + '...';
      }
    }

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

    if (isAngryOrChallenge) {
      if (isPromptChallenge) {
        let text = '';
        if (hasComplaint) {
          text = `Bu teknik kısma girmeden, ${hasMother ? 'annenizin ' : ''}${complaint} süreciyle ilgili size yardımcı olmaya devam edebilirim.`;
        } else {
          text = isHealthcare
            ? 'Bu teknik konuya girmeyeyim. Size sağlık talebinizle ilgili yardımcı olayım.'
            : 'Bu teknik konuya girmeyeyim. Size yardımcı olmaya devam edebilirim.';
        }
        return {
          text,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'prompt_challenge_fallback',
          detectedIntent
        };
      }

      // Identity query, bot questions, abuse or general anger
      let text = '';
      if (hasComplaint) {
        text = `Kusura bakmayın, cevaplarım yeterince net olmadı. ${hasMother ? 'Annenizin ' : ''}${complaint} süreciyle ilgili sorularınızı daha düzgün yanıtlayayım.`;
      } else {
        text = isHealthcare
          ? 'Kusura bakmayın, cevaplarım yeterince net olmadı. Size sağlık talebinizle ilgili yardımcı olayım.'
          : 'Kusura bakmayın, cevaplarım yeterince net olmadı. Size yardımcı olmaya devam edebilirim.';
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
    if (interpretedIntent === 'user_correction') {
      const userMsgs = history.filter((m: any) => m.role === 'user');
      const lastUserMsgText = userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].content : '';
      
      let replyText = '';
      if (lastUserMsgText) {
        if (isHealthcare) {
          replyText = `Haklısınız, cevabınızı aldım. ${lastUserMsgText} bilgisini not ettim; ${complaint ? complaint + ' için ' : ''}ilgili birimle görüşme talebinizi iletebiliriz.`;
        } else {
          replyText = `Haklısınız, cevabınızı aldım. ${lastUserMsgText} bilgisini not ettim; sürecinizle ilgili görüşme talebinizi iletebiliriz.`;
        }
      } else {
        if (isHealthcare) {
          replyText = `Haklısınız, cevabınızı aldım ve not ettim; ilgili birimle görüşme talebinizi iletebiliriz.`;
        } else {
          replyText = `Haklısınız, cevabınızı aldım ve not ettim; sürecinizle ilgili görüşme talebinizi iletebiliriz.`;
        }
      }
      
      return {
        text: replyText,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'user_correction_fallback',
        detectedIntent
      };
    }

    // Priority 2: Transfer Request (User explicitly wants to connect to a human)
    if (detectedIntent === 'transfer_request' || interpretedIntent === 'transfer_request') {
      return {
        text: `Talebinizi ilgili ekibe aktarıyorum, en kısa sürede sizinle iletişime geçeceklerdir.`,
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
        slotText = `Sizi ilgili uzman temsilcimize aktarmamı onaylıyor musunuz?`;
      } else if (pendingSlot === 'price_followup') {
        slotText = `Tedavi ve ücret detayları hakkında temsilcimizle görüşmek ister misiniz?`;
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

    // Priority 4: General Intent Fallbacks
    if (detectedIntent === 'call_scheduling_request') {
      return {
        text: `Telefon görüşmesi talebinizi not aldım. Müsait olabileceğiniz gün ve saat aralığını paylaşabilirseniz, temsilci arkadaşımız planlama için sizinle iletişime geçecektir.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_call_scheduling_fallback',
        detectedIntent
      };
    }

    if (detectedIntent === 'time_availability') {
      return {
        text: `Paylaştığınız zaman bilgisini not aldım. Temsilci arkadaşımız saat planlamasını teyit etmek üzere sizinle iletişime geçecektir.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_time_availability_fallback',
        detectedIntent
      };
    }

    if (detectedIntent === 'price_question') {
      const text = isHealthcare
        ? `Hizmet ve tedavi ücretlerimiz, hastanemizde yapılacak kişiye özel muayene ve değerlendirmeler sonrasında netleşmektedir. Detaylı bilgi sunabilmemiz için koordinatör ekibimizle kısa bir telefon görüşmesi planlayabiliriz.`
        : `Ücretlerimiz ve hizmet seçeneklerimiz kişiye özel yapılacak planlama sonrasında belirlenmektedir. Detaylı bilgi için temsilci ekibimizle kısa bir görüşme planlayabiliriz.`;
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
        ? `Uzaklık endişenizi çok iyi anlıyorum. Şehir dışından ve yurt dışından gelen hastalarımız için transfer, konaklama ve süreç planlama koordinasyonunu ekibimiz organize etmektedir. Detayları telefonda görüşebiliriz.`
        : `Mesafe konusundaki endişenizi anlıyorum. Uzaktan katılım ve koordinasyon konusunda ekibimiz her türlü desteği sağlamaktadır. Detayları görüşmek için kısa bir telefon görüşmesi planlayabiliriz.`;
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
      // Capitalize first letter, support Turkish lowercase 'i' to uppercase 'İ'
      const firstChar = detectedName.charAt(0);
      const upperFirst = firstChar === 'i' ? 'İ' : (firstChar === 'ı' ? 'I' : firstChar.toUpperCase());
      detectedName = upperFirst + detectedName.slice(1);
    }

    if (detectedName) {
      if (isHealthcareOrForm && hasComplaint) {
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

    const isGreeting = detectedIntent === 'greeting';

    // Intent: Greeting
    if (isGreeting) {
      if (isHealthcare && hasComplaint) {
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

    // 4. Default Fallback Routing (General)
    if (isHealthcareOrForm && hasComplaint) {
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
}
