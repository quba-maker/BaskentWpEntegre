/**
 * Stop Rule Intent Classifier
 * 
 * Distinguishes between:
 * - Communication opt-out (hard stop): patient refuses ALL future contact
 * - Cancellation intent (soft): patient cancels appointment/plan but still wants communication
 * - None: no stop intent detected
 * 
 * Design: Pure function, no DB/network calls, no patient data logging.
 */

export interface StopRuleIntentResult {
  isCommunicationOptOut: boolean;
  isCancellationIntent: boolean;
  reason: 'communication_opt_out' | 'appointment_cancel_intent' | 'none';
  matchedPattern?: string;
}

// ═══════════════════════════════════════════════════════════
// HARD STOP — Communication opt-out patterns
// These indicate the patient wants NO further contact at all.
// ═══════════════════════════════════════════════════════════

const HARD_STOP_EXACT_KEYWORDS = [
  'stop',
  'opt-out',
];

const HARD_STOP_PHRASES: readonly string[] = [
  'beni aramayın',
  'beni bir daha aramayın',
  'beni arama',
  'beni bir daha arama',
  'mesaj atmayın',
  'mesaj atma',
  'bana mesaj atmayın',
  'bana mesaj atma',
  'bana yazmayın',
  'bana yazma',
  'rahatsız etmeyin',
  'rahatsız etme',
  'iletişim istemiyorum',
  'iletişim kurmayın',
  'numaramı silin',
  'numaramı sil',
  'listeden çıkarın',
  'listeden çıkar',
  'abonelikten çık',
  'üye olmak istemiyorum',
  'üyelikten çık',
  'mesaj istemiyorum',
  'aranmak istemiyorum',
  'artık aramayın',
  'artık yazmayın',
  'bir daha yazmayın',
  'bir daha aramayın',
];

// ═══════════════════════════════════════════════════════════
// CANCELLATION CONTEXT — words/phrases that indicate the 
// message is about cancelling a service/appointment, NOT 
// refusing all communication.
// ═══════════════════════════════════════════════════════════

const CANCELLATION_CONTEXT_PHRASES: readonly string[] = [
  'randevu',
  'randevumu',
  'randevuyu',
  'plan',
  'planım',
  'planımı',
  'ameliyat',
  'ameliyatı',
  'ameliyatım',
  'görüşme',
  'görüşmeyi',
  'tedavi',
  'tedaviyi',
  'tedavimi',
  'muayene',
  'muayeneyi',
  'operasyon',
  'operasyonu',
  'kontrol',
  'kontrolü',
  'kontrolümü',
  'tahlil',
  'tahlili',
  'gelemeyeceğim',
  'gelmeyeceğim',
  'gidemeyeceğim',
  'gitmeyeceğim',
  'vazgeçtim',
  'ertelemek istiyorum',
  'erteleyebilir miyiz',
  'değiştirmek istiyorum',
  'tarih değişikliği',
  'bilgi almak istiyorum',
  'bilgi istiyorum',
  'soru sormak istiyorum',
];

/**
 * Normalize Turkish text for matching:
 * - Lowercase with Turkish locale
 * - Trim whitespace
 * - Collapse multiple spaces
 */
function normalizeText(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:'"]+/g, '');
}

/**
 * Classify the stop rule intent of a message.
 * 
 * Logic:
 * 1. Check for hard stop phrases first (explicit communication refusal)
 * 2. If "iptal" or "istemiyorum" is found, check if it's in a cancellation context
 * 3. If cancellation context is present, it's NOT a communication opt-out
 * 4. If no cancellation context, treat as communication opt-out
 */
export function classifyStopRuleIntent(messageText: string): StopRuleIntentResult {
  if (!messageText || messageText.trim().length === 0) {
    return { isCommunicationOptOut: false, isCancellationIntent: false, reason: 'none' };
  }

  const normalized = normalizeText(messageText);

  // Step 1: Check explicit hard-stop phrases (highest priority)
  for (const phrase of HARD_STOP_PHRASES) {
    if (normalized.includes(phrase)) {
      return {
        isCommunicationOptOut: true,
        isCancellationIntent: false,
        reason: 'communication_opt_out',
        matchedPattern: phrase,
      };
    }
  }

  // Step 2: Check exact keywords (only match when the message is JUST the keyword or very short)
  for (const kw of HARD_STOP_EXACT_KEYWORDS) {
    // "stop" or "opt-out" should match when the message is essentially just that word
    // e.g., "stop" or "Stop." but NOT "bu servisi durdurun" 
    const words = normalized.split(' ');
    if (words.length <= 3 && words.includes(kw)) {
      return {
        isCommunicationOptOut: true,
        isCancellationIntent: false,
        reason: 'communication_opt_out',
        matchedPattern: kw,
      };
    }
  }

  // Step 3: Check ambiguous keywords WITH cancellation context
  const ambiguousKeywords = ['iptal', 'istemiyorum', 'vazgeçtim'];
  const hasAmbiguousKeyword = ambiguousKeywords.some(kw => normalized.includes(kw));

  if (hasAmbiguousKeyword) {
    // Check if there's a cancellation context that makes this NOT an opt-out
    const hasCancellationContext = CANCELLATION_CONTEXT_PHRASES.some(phrase => 
      normalized.includes(phrase)
    );

    if (hasCancellationContext) {
      // This is a service/appointment cancellation, NOT a communication opt-out
      const matchedContext = CANCELLATION_CONTEXT_PHRASES.find(phrase => 
        normalized.includes(phrase)
      );
      return {
        isCommunicationOptOut: false,
        isCancellationIntent: true,
        reason: 'appointment_cancel_intent',
        matchedPattern: matchedContext,
      };
    }

    // Ambiguous keyword WITHOUT explicit communication refusal context
    // For "istemiyorum" alone: could be "tedavi istemiyorum" or "mesaj istemiyorum"
    // Default to NOT opt-out to avoid false positives — let the bot handle it
    if (normalized.includes('istemiyorum')) {
      // Only hard stop if the immediate context is about communication
      const commPatterns = ['mesaj', 'arama', 'bildirim', 'iletişim', 'yazma', 'yazmayın'];
      const isCommRelated = commPatterns.some(p => normalized.includes(p));
      if (isCommRelated) {
        return {
          isCommunicationOptOut: true,
          isCancellationIntent: false,
          reason: 'communication_opt_out',
          matchedPattern: 'istemiyorum + communication context',
        };
      }
    }

    // "iptal" alone or "vazgeçtim" alone — NOT a communication opt-out
    return {
      isCommunicationOptOut: false,
      isCancellationIntent: true,
      reason: 'appointment_cancel_intent',
      matchedPattern: ambiguousKeywords.find(kw => normalized.includes(kw)),
    };
  }

  // Step 4: No stop intent detected
  return { isCommunicationOptOut: false, isCancellationIntent: false, reason: 'none' };
}
