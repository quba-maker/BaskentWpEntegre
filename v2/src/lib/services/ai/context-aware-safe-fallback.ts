import { TenantBrain } from '../../brain/tenant-brain';

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

    // Detect complaint context (only for healthcare/form)
    let complaint = '';
    let hasComplaint = false;
    if (isHealthcareOrForm) {
      const optSummary = unifiedContext?.opportunity?.summary || '';
      const facts = unifiedContext?.patient_known_facts || [];
      const rawFactsComplaint = facts.find((f: string) => f.toLowerCase().includes('şikayet') || f.toLowerCase().includes('sikayet'));
      
      if (optSummary && optSummary.trim().length > 0) {
        complaint = optSummary.trim();
        hasComplaint = true;
      } else if (rawFactsComplaint) {
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

    // 2. Intent Detection
    
    // Time/Date Intent detection (Turkish days, time indicators)
    const daysRegex = /\b(pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar|yarın|yarin|bugün|bugun)\b/i;
    const timeKeywordsRegex = /\b(saat|gün|gun|ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)\b/i;
    const numericTimeRegex = /\b\d{1,2}[:.]\d{2}\b/;
    const numericDayTimeRegex = /\b\d{1,2}\s*(günü|gunu|saat|:)/i;
    const hasTimeIntent = daysRegex.test(lowerInbound) || 
                           timeKeywordsRegex.test(lowerInbound) || 
                           numericTimeRegex.test(lowerInbound) || 
                           numericDayTimeRegex.test(lowerInbound);

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

    const isGreeting = /^(merhaba|selam|iyi günler|iyi gunler|iyi akşamlar|iyi aksamlar|günaydın|gunaydin|hey|hi|hello)\b/i.test(lowerInbound);

    // 3. Fallback Generation Routing

    // Intent: Time/Date
    if (hasTimeIntent) {
      // Use clean neutral time intent text (do not assume appointment is booked)
      const timeText = inboundText.trim();
      return {
        text: `${timeText} bilgisini not aldım. Uygunluk için ilgili ekibe aktarabiliriz.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'time_intent_fallback'
      };
    }

    // Intent: Name
    if (detectedName) {
      if (isHealthcareOrForm && hasComplaint) {
        return {
          text: `Teşekkür ederim ${detectedName}. ${complaint} konusuyla ilgili uygun zamanı netleştirebiliriz.`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'name_healthcare_complaint_fallback'
        };
      } else {
        return {
          text: `Teşekkür ederim ${detectedName}. Bilgilerinizi not aldım.`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'name_generic_fallback'
        };
      }
    }

    // Intent: Greeting
    if (isGreeting) {
      if (hasFormContext) {
        return {
          text: `Merhaba, ${personaName} ben. Formunuzla ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_form_fallback'
        };
      } else if (isHealthcare && hasComplaint) {
        return {
          text: `Merhaba, ${personaName} ben. ${complaint} konusuyla ilgili yardımcı olayım. Bu durum ne zamandır devam ediyor?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_healthcare_complaint_fallback'
        };
      } else if (isHealthcare) {
        return {
          text: `Merhaba, ${personaName} ben. Sağlık talebinizle ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_healthcare_generic_fallback'
        };
      } else {
        // Parametric SaaS/tenant fallback (never use "nasıl yardımcı olabilirim")
        return {
          text: `Merhaba, ${personaName} ben. Hangi konuda bilgi almak istediğinizi yazabilirsiniz.`,
          sector: resolvedIndustry,
          hasFormContext,
          hasComplaint,
          finalPath: 'greeting_neutral_fallback'
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
        finalPath: 'default_healthcare_complaint_fallback'
      };
    } else if (isHealthcare) {
      return {
        text: `Merhaba, ${personaName} ben. Sağlık talebinizle ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_healthcare_generic_fallback'
      };
    } else {
      return {
        text: `Merhaba, ${personaName} ben. Hangi konuda bilgi almak istediğinizi yazabilirsiniz.`,
        sector: resolvedIndustry,
        hasFormContext,
        hasComplaint,
        finalPath: 'default_neutral_fallback'
      };
    }
  }
}
