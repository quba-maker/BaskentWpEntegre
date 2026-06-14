/**
 * P0.11: ConversationStateArbitrator
 * Determines whether a pending slot is still valid or should be suppressed
 * based on the user's current message intent.
 * 
 * Priority order (highest to lowest):
 * 1. language_switch_request
 * 2. user_correction / frustration
 * 3. identity_question
 * 4. greeting
 * 5. clarification_question
 * 6. topic_switch / complaint_detail
 * 7. transfer_request
 * 8. scheduling/time_availability
 * 9. pending_slot_answer (only if activation gate passes)
 * 10. old memory / CRM / task context
 */

import { ConversationIntent, ConversationIntentRouter } from './conversation-intent-router';

export type PendingSlot = string; // e.g. 'timezone_clarification', 'call_time', 'generic_none', etc.

export interface ArbitrationInput {
  lastUserMessage: string;
  rawPendingSlot: PendingSlot;
  rawInterpretedIntent: string;
  routerIntent: ConversationIntent;
  history: { role: string; content: string }[];
}

export interface ArbitrationResult {
  effectivePendingSlot: PendingSlot;
  effectiveIntent: ConversationIntent;
  staleSlotSuppressed: boolean;
  suppressionReason?: string;
}

// Intent types that always override any pending slot
const SLOT_OVERRIDE_INTENTS: ConversationIntent[] = [
  'language_switch',
  'identity_question',
  'greeting',
  'clarification_question',
  'topic_switch',
  'transfer_request',
  'human_transfer_request',
  'user_correction',
  'doctor_lookup',
  'department_lookup',
  'location_direction',
  'prompt_challenge',
  'abuse_or_insult',
  'form_followup',
  'price_question',
  'call_scheduling_request'
];

export class ConversationStateArbitrator {
  /**
   * Arbitrates between the pending slot (from PendingQuestionResolver)
   * and the user's current intent (from ConversationIntentRouter).
   * 
   * If the user's message is clearly NOT answering the pending slot,
   * the slot is suppressed and the router intent takes priority.
   */
  public static arbitrate(input: ArbitrationInput): ArbitrationResult {
    const { lastUserMessage, rawPendingSlot, rawInterpretedIntent, routerIntent, history } = input;

    // Check if the last bot message was a call offer and user confirmed it
    const assistantHistory = history.filter((m: any) => m.role === 'assistant');
    const lastAssistantMsg = assistantHistory.length > 0 ? assistantHistory[assistantHistory.length - 1].content : '';
    
    const isCallOffer = (text: string) => {
      const lowerText = text.toLowerCase();
      return [
        'görüşmek', 'gorusmek', 'arayalım', 'arayalim', 'arayabiliriz',
        'arama planlama', 'telefon görüşmesi', 'telefon gorusmesi',
        'danışmanımızla', 'danismanimizla', 'arama teklif', 'telefonla gorusalim', 'telefonla görüşelim'
      ].some(kw => lowerText.includes(kw));
    };

    const lowerUser = (lastUserMessage || '').toLowerCase().trim();
    const affirmatives = ['evet', 'olur', 'tamam', 'ok', 'okay', 'yes', 'uygun', 'kabul', 'tamamdir', 'hay hay', 'tabii', 'onaylıyorum', 'arayabilirsiniz', 'arayın', 'arayin', 'ararlar'];
    const isAffirmative = affirmatives.some(kw => lowerUser === kw || lowerUser.startsWith(kw + ' ') || lowerUser.endsWith(' ' + kw) || lowerUser.includes(' ' + kw + ' '));

    if (isCallOffer(lastAssistantMsg) && isAffirmative) {
      return {
        effectivePendingSlot: 'generic_none',
        effectiveIntent: 'call_scheduling_request',
        staleSlotSuppressed: true,
        suppressionReason: 'callback_confirmed'
      };
    }

    // If no pending slot is active, pass through
    if (!rawPendingSlot || rawPendingSlot === 'generic_none') {
      return {
        effectivePendingSlot: rawPendingSlot || 'generic_none',
        effectiveIntent: routerIntent,
        staleSlotSuppressed: false
      };
    }

    // Check if the router intent is a slot-overriding intent
    if (SLOT_OVERRIDE_INTENTS.includes(routerIntent)) {
      return {
        effectivePendingSlot: 'generic_none',
        effectiveIntent: routerIntent,
        staleSlotSuppressed: true,
        suppressionReason: `${routerIntent}_override`
      };
    }

    // Check if user_correction was detected by ShortAnswerInterpreter
    if (rawInterpretedIntent === 'user_correction' || routerIntent === 'user_correction') {
      return {
        effectivePendingSlot: 'generic_none',
        effectiveIntent: routerIntent !== 'generic_other' ? routerIntent : 'generic_other',
        staleSlotSuppressed: true,
        suppressionReason: 'user_correction_override'
      };
    }

    // Slot-specific activation gate: only keep slot if user's message
    // is actually answering/relevant to the slot
    const isSlotAnswer = this.isMessageRelevantToSlot(lastUserMessage, rawPendingSlot, rawInterpretedIntent || routerIntent);

    if (!isSlotAnswer) {
      return {
        effectivePendingSlot: 'generic_none',
        effectiveIntent: routerIntent,
        staleSlotSuppressed: true,
        suppressionReason: `slot_activation_gate_failed:${rawPendingSlot}`
      };
    }

    // Slot is valid — keep it
    return {
      effectivePendingSlot: rawPendingSlot,
      effectiveIntent: routerIntent,
      staleSlotSuppressed: false
    };
  }

  /**
   * Checks if the user's message is actually answering/relevant to the pending slot.
   * This is the "activation gate" — if false, the slot is considered stale.
   */
  private static isMessageRelevantToSlot(
    message: string,
    slot: PendingSlot,
    interpretedIntent: string
  ): boolean {
    const lower = (message || '').toLowerCase().trim();

    switch (slot) {
      case 'timezone_clarification': {
        // Only keep if user mentions timezone-related words or gives a location answer
        const tzKeywords = [
          'bize göre', 'bize gore', 'türkiye', 'turkiye', 'sizin saat',
          'amerika', 'avrupa', 'almanya', 'ingiltere', 'fransa', 'hollanda',
          'gmt', 'utc', 'saat dilimi', 'timezone', 'saatine göre', 'saatine gore',
          'tr saati', 'istanbul', 'ankara', 'berlin', 'london', 'new york'
        ];
        return tzKeywords.some(kw => lower.includes(kw));
      }

      case 'call_time': {
        // Keep if user provides a time or time-related phrase
        return interpretedIntent === 'timezone_clarification' ||
          interpretedIntent === 'time_availability' ||
          /\d{1,2}[:.]\d{2}/.test(lower) ||
          /\b\d{1,2}\s*(de|da|te|ta|e|a|gibi|sularında)\b/.test(lower) ||
          ['sabah', 'ogleden sonra', 'aksam', 'gece', 'öğlen'].some(kw => lower.includes(kw));
      }

      case 'call_date': {
        // Keep if user provides a day or date
        const dateKeywords = [
          'pazartesi', 'sali', 'çarşamba', 'carsamba', 'persembe', 'cuma',
          'cumartesi', 'pazar', 'yarin', 'bugun', 'hafta', 'gün', 'gun',
          'ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran',
          'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'
        ];
        return dateKeywords.some(kw => lower.includes(kw)) ||
          /\d{1,2}[./]\d{1,2}/.test(lower);
      }

      case 'confirmation_yes_no': {
        const affirmatives = ['evet', 'olur', 'tamam', 'ok', 'okay', 'yes', 'uygun', 'kabul', 'tamamdir', 'hay hay', 'tabii', 'onaylıyorum', 'arayabilirsiniz', 'simdi degil', 'şimdi değil'];
        const negatives = ['hayır', 'hayir', 'yok', 'olmaz', 'istemem', 'istemiyorum', 'no', 'iptal'];
        const isAffirmative = affirmatives.some(kw => lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw) || lower.includes(' ' + kw + ' '));
        const isNegative = negatives.some(kw => lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw) || lower.includes(' ' + kw + ' '));

        const openIntentKeywords = [
          'doktor', 'hekim', 'hoca', 'kim', 'hang', 'nerede', 'nerde', 'adres', 'konum', 'telefon',
          'insan', 'temsilci', 'gerçek', 'gercek', 'operatör', 'operator', 'bağla', 'bagla',
          'yapay zeka', 'yapayzeka', 'bot', 'robot', 'ai', 'prompt', 'form', 'bilgi', 'fıtık', 'fitik',
          'soru', 'cevap'
        ];
        if (openIntentKeywords.some(kw => lower.includes(kw))) {
          return false;
        }

        return isAffirmative || isNegative;
      }

      case 'transfer_confirmation': {
        const confirmWords = ['evet', 'olur', 'tamam', 'ok', 'lutfen', 'lütfen', 'yes', 'aktar', 'aktarin'];
        return confirmWords.some(kw => lower.includes(kw));
      }

      case 'complaint_detail': {
        // Keep if user describes symptoms or complaint
        return interpretedIntent === 'complaint_detail' || lower.length > 15;
      }

      case 'complaint_duration': {
        // Keep if user mentions time duration
        const durationKeywords = [
          'gün', 'gun', 'hafta', 'ay', 'yıl', 'yil', 'sene', 'aydır', 'aydir',
          'gündür', 'gundur', 'haftadır', 'haftadir', 'yıldır', 'yildir',
          'senedir', 'zamandır', 'zamandir', 'beri', 'once', 'önce'
        ];
        return durationKeywords.some(kw => lower.includes(kw)) || /\d+\s*(gün|gun|hafta|ay|yıl|yil|sene)/.test(lower);
      }

      case 'price_followup': {
        return interpretedIntent === 'price_question' || lower.length > 10;
      }

      default:
        // Unknown slot — keep by default (conservative)
        return true;
    }
  }
}
