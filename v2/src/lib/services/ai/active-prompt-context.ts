export type ActivePromptIdentityContext = {
  personaName?: string;
  organizationName?: string;
  organizationShortName?: string;
  industry?: string;
  promptId?: string;
  promptVersion?: number | string;
  promptHash?: string;
  hasTenantPrompt: boolean;
  source: 'identity_config' | 'prompt_metadata' | 'brain_context' | 'generic';
};

/**
 * Resolves active tenant/channel persona and organization identity context dynamically.
 * Prioritizes custom configuration, then prompt metadata, then brain context config,
 * and finally falls back to industry-based generic defaults.
 */
export function resolveActivePromptIdentityContext(params: {
  brain?: any;
  identityConfig?: any;
  systemPromptText?: string;
}): ActivePromptIdentityContext {
  const { brain, identityConfig } = params;
  
  // Helper to check and return non-empty trimmed string
  const clean = (val: any): string | null => {
    if (typeof val === 'number') {
      return String(val);
    }
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
    return null;
  };

  // 1. Check identityConfig
  if (identityConfig && (clean(identityConfig.personaName) || clean(identityConfig.organizationName))) {
    const metadata = brain?.prompts?.metadata || {};
    return {
      personaName: clean(identityConfig.personaName) || undefined,
      organizationName: clean(identityConfig.organizationName) || undefined,
      organizationShortName: clean(identityConfig.organizationShortName) || undefined,
      industry: clean(identityConfig.industry) || clean(metadata.industry) || undefined,
      promptId: clean(identityConfig.promptId) || clean(brain?.prompts?.id) || undefined,
      promptVersion: clean(identityConfig.promptVersion) || clean(metadata.version) || clean(brain?.prompts?.version) || undefined,
      promptHash: clean(identityConfig.promptHash) || clean(brain?.prompts?.promptHash) || undefined,
      hasTenantPrompt: true,
      source: 'identity_config'
    };
  }

  // 2. Check brain.prompts.metadata
  const metadata = brain?.prompts?.metadata || {};
  const metadataIdentity = metadata.identity || {};
  if (clean(metadataIdentity.personaName) || clean(metadataIdentity.organizationName)) {
    return {
      personaName: clean(metadataIdentity.personaName) || undefined,
      organizationName: clean(metadataIdentity.organizationName) || undefined,
      organizationShortName: clean(metadataIdentity.organizationShortName) || undefined,
      industry: clean(metadata.industry) || clean(metadataIdentity.industry) || undefined,
      promptId: clean(brain?.prompts?.id) || undefined,
      promptVersion: clean(metadata.version) || clean(brain?.prompts?.version) || undefined,
      promptHash: clean(brain?.prompts?.promptHash) || undefined,
      hasTenantPrompt: true,
      source: 'prompt_metadata'
    };
  }

  if (clean(metadata.personaName) || clean(metadata.organizationName)) {
    return {
      personaName: clean(metadata.personaName) || undefined,
      organizationName: clean(metadata.organizationName) || undefined,
      organizationShortName: clean(metadata.organizationShortName) || undefined,
      industry: clean(metadata.industry) || undefined,
      promptId: clean(brain?.prompts?.id) || undefined,
      promptVersion: clean(metadata.version) || clean(brain?.prompts?.version) || undefined,
      promptHash: clean(brain?.prompts?.promptHash) || undefined,
      hasTenantPrompt: true,
      source: 'prompt_metadata'
    };
  }

  // 3. Check brain.context.config
  const config = brain?.context?.config || {};
  const configIdentity = config.identity || {};
  if (clean(configIdentity.personaName) || clean(configIdentity.organizationName)) {
    return {
      personaName: clean(configIdentity.personaName) || undefined,
      organizationName: clean(configIdentity.organizationName) || undefined,
      organizationShortName: clean(configIdentity.organizationShortName) || undefined,
      industry: clean(config.industry) || clean(configIdentity.industry) || undefined,
      promptId: clean(brain?.prompts?.id) || undefined,
      promptVersion: clean(brain?.prompts?.version) || undefined,
      promptHash: clean(brain?.prompts?.promptHash) || undefined,
      hasTenantPrompt: true,
      source: 'brain_context'
    };
  }

  if (clean(config.personaName) || clean(config.organizationName)) {
    return {
      personaName: clean(config.personaName) || undefined,
      organizationName: clean(config.organizationName) || undefined,
      organizationShortName: clean(config.organizationShortName) || undefined,
      industry: clean(config.industry) || undefined,
      promptId: clean(brain?.prompts?.id) || undefined,
      promptVersion: clean(brain?.prompts?.version) || undefined,
      promptHash: clean(brain?.prompts?.promptHash) || undefined,
      hasTenantPrompt: true,
      source: 'brain_context'
    };
  }

  // 4. Industry fallback / Generic
  const configIndustry = config.industry;
  const metadataIndustry = metadata.industry;
  const resolvedIndustry = clean(configIndustry) || clean(metadataIndustry) || '';
  
  return {
    personaName: undefined,
    organizationName: undefined,
    organizationShortName: undefined,
    industry: resolvedIndustry || undefined,
    promptId: clean(brain?.prompts?.id) || undefined,
    promptVersion: clean(metadata.version) || clean(brain?.prompts?.version) || undefined,
    promptHash: clean(brain?.prompts?.promptHash) || undefined,
    hasTenantPrompt: false,
    source: 'generic'
  };
}

/**
 * Checks if a call scheduling flow is active in the last 2 turns (4 messages).
 */
export function isCallFlowActiveInHistory(history: { role: string; content: string }[]): boolean {
  if (!history || history.length === 0) return false;
  
  const callSchedulingKeywords = [
    'telefon gorusmesi', 'telefonla gorus', 'telefonla arayin',
    'telefonla ulasin', 'arama planlayalim', 'arama yapin',
    'beni arayin', 'sizi arayayim', 'arar misiniz', 'ararmisiniz',
    'beni arayabilir misiniz', 'arama yapar misiniz', 'telefonla gorusebilir miyiz',
    'beni ararlar mi', 'hasta danismani arasin', 'sizinle gorusmek istiyorum',
    'telefonla bilgi almak istiyorum', 'arar mi', 'ararlar mi', 'arama planı', 'randevu almak'
  ];

  const isCallOffer = (text: string) => {
    const lowerText = text.toLowerCase();
    return [
      'görüşmek', 'gorusmek', 'arayalım', 'arayalim', 'arayabiliriz',
      'arama planlama', 'telefon görüşmesi', 'telefon gorusmesi',
      'danışmanımızla', 'danismanimizla', 'arama teklif', 'telefonla gorusalim', 'telefonla görüşelim'
    ].some(kw => lowerText.includes(kw));
  };

  const last4Messages = history.slice(-4);
  return last4Messages.some((m: any) => {
    const lowerContent = (m.content || '').toLowerCase();
    return callSchedulingKeywords.some(kw => lowerContent.includes(kw)) || isCallOffer(m.content || '');
  });
}

/**
 * Validates if name_intent bypass is allowed based on safety criteria and active call flow.
 */
export function isNameBypassAllowed(params: {
  inboundText: string;
  history: { role: string; content: string }[];
  detectedIntent?: string;
  interpretedIntent?: string;
}): boolean {
  const lowerText = (params.inboundText || '').toLowerCase().trim();

  // 1. identity_question check
  const isIdentityQuestion = 
    params.detectedIntent === 'identity_question' || 
    params.interpretedIntent === 'identity_question';
    
  if (isIdentityQuestion) {
    return false;
  }

  // 2. Phrase blacklist (do not match name questions)
  const blacklistedPhrases = [
    'ben kiminle görüşüyorum',
    'kiminle konuşuyorum',
    'kiminle konusuyorum',
    'adın ne',
    'adin ne',
    'isminiz ne',
    'sen kimsin',
    'siz kimsiniz'
  ];
  if (blacklistedPhrases.some(phrase => lowerText.includes(phrase))) {
    return false;
  }

  // 3. Extract name candidate
  const nameIntroductions = [
    /\bismim\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
    /\badım\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
    /\badim\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
    /\bben\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i
  ];
  let detectedName = '';
  for (const regex of nameIntroductions) {
    const match = params.inboundText.match(regex);
    if (match && match[1]) {
      detectedName = match[1].split(/[.,!?\s]+/)[0].trim();
      break;
    }
  }

  if (!detectedName) {
    return false;
  }

  const { isValidPatientName } = require('../../utils/patient-name-resolver');
  if (!isValidPatientName(detectedName)) {
    return false;
  }

  // 4. Check active call flow: active call_scheduling_request or recent call flow in history
  const isCallActive = isCallFlowActiveInHistory(params.history) || params.detectedIntent === 'call_scheduling_request';
  return isCallActive;
}
