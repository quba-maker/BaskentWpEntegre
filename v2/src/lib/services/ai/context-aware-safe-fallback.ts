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
    const personaName = identityConfig.personaName || 'Asistan';
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

    // 2. Deterministic Fallback Daraltma (Intent-Aware Safe Response Priority)
    if (detectedIntent === 'transfer_request') {
      return {
        text: `Talebinizi ilgili ekibe aktarıyorum, en kısa sürede sizinle iletişime geçeceklerdir.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'intent_transfer_fallback',
        detectedIntent
      };
    }

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
          text: `Merhaba, ${personaName} ben. ${complaint} konusuyla ilgili yardımcı olayım. Bu durum ne zamandır devam ediyor?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_healthcare_complaint_fallback',
          detectedIntent
        };
      } else if (hasFormContext) {
        return {
          text: `Merhaba, ${personaName} ben. Formunuzla ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_form_fallback',
          detectedIntent
        };
      } else if (isHealthcare) {
        return {
          text: `Merhaba, ${personaName} ben. Sağlık talebinizle ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_healthcare_generic_fallback',
          detectedIntent
        };
      } else {
        // Parametric SaaS/tenant fallback (never use "nasıl yardımcı olabilirim")
        return {
          text: `Merhaba, ${personaName} ben. Hangi konuda bilgi almak istediğinizi yazabilirsiniz.`,
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
        text: `Merhaba, ${personaName} ben. ${complaint} konusuyla ilgili yardımcı olayım. Bu durum ne zamandır devam ediyor?`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_healthcare_complaint_fallback',
        detectedIntent
      };
    } else if (isHealthcare) {
      return {
        text: `Merhaba, ${personaName} ben. Sağlık talebinizle ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_healthcare_generic_fallback',
        detectedIntent
      };
    } else {
      return {
        text: `Merhaba, ${personaName} ben. Hangi konuda bilgi almak istediğinizi yazabilirsiniz.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_neutral_fallback',
        detectedIntent
      };
    }
  }
}
