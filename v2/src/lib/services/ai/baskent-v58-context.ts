/**
 * Centralized helper to check if the current execution context matches
 * the Konya Başkent Hospital WhatsApp TR channel under prompt version 58.
 */
export function isBaskentV58Context(params: {
  tenantId?: string;
  channelId?: string;
  promptVersion?: string | number;
  systemPromptText?: string;
}): boolean {
  const targetTenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const targetChannelId = '2e7352c1-5db7-4414-baf7-de571a66bfa6';

  if (!params.tenantId || params.tenantId !== targetTenantId) {
    return false;
  }
  if (!params.channelId || params.channelId !== targetChannelId) {
    return false;
  }

  // Version check (highest priority if present)
  if (params.promptVersion !== undefined && params.promptVersion !== null && params.promptVersion !== '') {
    const vStr = String(params.promptVersion).toLowerCase().trim();
    return vStr === '58' || vStr === 'v58';
  }

  // Fallback to systemPromptText check only if version is not provided
  if (params.systemPromptText) {
    return params.systemPromptText.includes('Mustafa Kemal İLİK');
  }

  return false;
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
export function isBaskentV58NameBypassAllowed(params: {
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

