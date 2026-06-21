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
  convMeta?: any;
  unifiedContext?: any;
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
  'call_scheduling_request',
  'name_intent',
  'continuation_short_reply',
  'process_question',
  'callback_confirmation',
  'schedule_confirmation',
  'arrival_date_answer',
  'callback_time_answer',
  'call_time_answer'
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
    const { lastUserMessage, rawPendingSlot, rawInterpretedIntent, routerIntent, history, convMeta } = input;

    // Check if the last bot message was a call offer and user confirmed it
    const assistantHistory = history.filter((m: any) => m.role === 'assistant');
    const lastAssistantMsg = assistantHistory.length > 0 ? assistantHistory[assistantHistory.length - 1].content : '';
    
    const lastOffer = convMeta?.last_callback_offer;
    const hasOfferInMeta = !!(lastOffer && lastOffer.proposed_due_at);

    const isCallOffer = (text: string) => {
      if (hasOfferInMeta) return true;
      const lowerText = text.toLowerCase();
      return [
        'görüşmek', 'gorusmek', 'görüşme', 'gorusme',
        'arayalım', 'arayalim', 'arayabiliriz', 'arayabilir',
        'arama planlama', 'telefon görüşmesi', 'telefon gorusmesi',
        'danışmanımızla', 'danismanimizla', 'danışmanımız', 'danismanimiz', 'danışmanımızın', 'danismanimizin',
        'arama teklif', 'telefonla gorusalim', 'telefonla görüşelim',
        'araması', 'aramasi', 'aranması', 'aranmasi', 'ulaşılması', 'ulasilmasi', 'ulaşalım', 'ulasalim'
      ].some(kw => lowerText.includes(kw));
    };

    const isSpecificCallTimeOffer = (text: string) => {
      if (hasOfferInMeta) return true;
      const lowerText = text.toLowerCase();
      
      const hasCallKw = isCallOffer(text);
      if (!hasCallKw) return false;

      const hasTimeOrDate = [
        'saat', 'saatiyle', 'saatinde', 'pazartesi', 'salı', 'sali', 'çarşamba', 'carsamba', 'perşembe', 'persembe', 'cuma', 'cumartesi', 'pazar',
        'yarın', 'yarin', 'bugün', 'bugun', 'haziran', 'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik'
      ].some(kw => lowerText.includes(kw)) || /\d{1,2}[:.]\d{2}/.test(lowerText);

      return hasTimeOrDate;
    };

    const lowerUser = (lastUserMessage || '').toLowerCase().trim();
    const affirmatives = ['evet', 'olur', 'tamam', 'ok', 'okay', 'yes', 'uygun', 'uygundur', 'evet uygun', 'kabul', 'tamamdir', 'hay hay', 'tabii', 'onaylıyorum', 'arayabilirsiniz', 'arayın', 'arayin', 'ararlar'];
    const isAffirmative = affirmatives.some(kw => lowerUser === kw || lowerUser.startsWith(kw + ' ') || lowerUser.endsWith(' ' + kw) || lowerUser.includes(' ' + kw + ' '));

    // P0.28: arrival_date_answer check
    const dateIndicators = [
      'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
      'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik',
      'ay sonu', 'ay başı', 'ay basi', 'ayın sonu', 'ayın başı'
    ];
    const isDateMessage = dateIndicators.some(kw => lowerUser.includes(kw)) || /\d{1,2}[./]\d{1,2}/.test(lowerUser);

    const isArrivalDateQuestion = (text: string) => {
      const lowerText = text.toLowerCase();
      return [
        'gelmeyi düşündüğünüz', 'gelmeyi dusundugunuz', 'ne zaman gelmeyi', 'ziyaret tarihi',
        'tarih aralığı', 'tarih araligi', 'tahmini tarih', 'tahmini ziyaret', 'gelmeyi planlıyorsunuz',
        'gelmeyi planliyorsunuz', 'geliş tarih'
      ].some(kw => lowerText.includes(kw));
    };

    const formAwaitsArrivalDate = () => {
      const uCtx = input.unifiedContext;
      const hasForm = !!(uCtx?.latestForm || (Array.isArray(uCtx?.patient_known_facts) && uCtx.patient_known_facts.length > 0) || uCtx?.opportunity);
      if (!hasForm) return false;

      const hasFactsTravelDate = Array.isArray(uCtx?.patient_known_facts) && 
        uCtx.patient_known_facts.some((f: string) => f.includes('Geliş zamanı') || f.includes('Ziyaret tarihi'));
      
      const hasOppTravelDate = !!(uCtx?.opportunity?.travel_date || uCtx?.opportunity?.metadata?.travel_date_raw);
      const hasMetaTravelDate = !!(convMeta?.arrival_date || convMeta?.travel_date_raw);
      
      return !hasFactsTravelDate && !hasOppTravelDate && !hasMetaTravelDate;
    };

    const hasArrivalContext = 
      isArrivalDateQuestion(lastAssistantMsg) ||
      rawPendingSlot === 'arrival_date' ||
      formAwaitsArrivalDate();

    if (isDateMessage && hasArrivalContext) {
      return {
        effectivePendingSlot: 'arrival_date',
        effectiveIntent: 'arrival_date_answer',
        staleSlotSuppressed: false
      };
    }

    // P0.28.2: callback_time_answer check
    const hasCallbackTimeKw = [
      'saat', 'pazartesi', 'salı', 'sali', 'çarşamba', 'carsamba', 'perşembe', 'persembe', 'cuma', 'cumartesi', 'pazar',
      'yarın', 'yarin', 'bugün', 'bugun', 'sabah', 'öğlen', 'oglen', 'öğleden sonra', 'ogleden sonra', 'akşam', 'aksam', 'gece',
      'hafta içi', 'haftaici', 'hafta sonu', 'haftasonu'
    ].some(kw => lowerUser.includes(kw)) || /(?:\b\d{1,2}[:. ]\d{2}\b|\b\d{1,2}\s*(?:de|da|te|ta|e|a|ye|ya|gibi|civari|civarinda|sularinda|sularında|olur|uygun|musait|müsait)\b)/.test(lowerUser);

    const hasMonthKw = [
      'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
      'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik'
    ].some(kw => lowerUser.includes(kw)) || /\d{1,2}[./]\d{1,2}/.test(lowerUser);

    const isCallSchedulingContext = 
      rawPendingSlot === 'call_time' || 
      rawPendingSlot === 'call_date' || 
      rawPendingSlot === 'timezone_clarification' ||
      isCallOffer(lastAssistantMsg);

    // Rule 4: If message has explicit hours/hour-ranges, bypass must NOT run. Route it to callback_time_answer.
    const hasExplicitHourOrRange = /(?:\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*[-–]\s*\d{1,2}\b)/.test(lowerUser);

    if (hasExplicitHourOrRange && lowerUser !== '..') {
      return {
        effectivePendingSlot: 'generic_none',
        effectiveIntent: 'callback_time_answer',
        staleSlotSuppressed: true,
        suppressionReason: 'callback_time_preference_provided'
      };
    }

    if (hasCallbackTimeKw && !hasMonthKw && isCallSchedulingContext && lowerUser !== '..') {
      return {
        effectivePendingSlot: 'generic_none',
        effectiveIntent: 'callback_time_answer',
        staleSlotSuppressed: true,
        suppressionReason: 'callback_time_preference_provided'
      };
    }

    if (isSpecificCallTimeOffer(lastAssistantMsg) && isAffirmative && !hasExplicitHourOrRange) {
      return {
        effectivePendingSlot: 'generic_none',
        effectiveIntent: 'callback_confirmation',
        staleSlotSuppressed: true,
        suppressionReason: 'callback_confirmed'
      };
    } else if (isCallOffer(lastAssistantMsg) && isAffirmative && !hasExplicitHourOrRange) {
      return {
        effectivePendingSlot: 'generic_none',
        effectiveIntent: 'call_scheduling_request',
        staleSlotSuppressed: true,
        suppressionReason: 'callback_general_confirmed'
      };
    }

    const isContinuationShortReply = routerIntent === 'continuation_short_reply';
    if (isContinuationShortReply) {
      const callSchedulingKeywords = [
        'telefon gorusmesi', 'telefonla gorus', 'telefonla arayin',
        'telefonla ulasin', 'arama planlayalim', 'arama yapin',
        'beni arayin', 'sizi arayayim', 'arar misiniz', 'ararmisiniz',
        'beni arayabilir misiniz', 'arama yapar misiniz', 'telefonla gorusebilir miyiz',
        'beni ararlar mi', 'hasta danismani arasin', 'sizinle gorusmek istiyorum',
        'telefonla bilgi almak istiyorum', 'arar mi', 'ararlar mi', 'arama planı', 'randevu almak'
      ];
      
      const botAskedForDetails = (text: string) => {
        const lowerText = text.toLowerCase();
        const hasAd = ['adınız', 'isminiz', 'adınızı', 'isminizi', 'adiniz', 'isminiz', 'adinizi', 'isminizi'].some(kw => lowerText.includes(kw));
        const hasSaat = ['saat', 'zaman', 'uygun', 'saati', 'saatleri', 'zamanı', 'zamani'].some(kw => lowerText.includes(kw));
        const hasTelefon = ['telefon', 'numara', 'numaranız', 'numaraniz', 'görüşme', 'gorusme', 'ulas'.replace(/ı/g, 'i')].some(kw => lowerText.includes(kw));
        return (hasAd || hasSaat || hasTelefon) && [
          'görüşmek', 'gorusmek', 'arayalım', 'arayalim', 'arayabiliriz',
          'arama planlama', 'telefon görüşmesi', 'telefon gorusmesi',
          'danışmanımızla', 'danismanimizla', 'arama teklif', 'telefonla gorusalim', 'telefonla görüşelim',
          'ulaşabiliriz', 'ulasabiliriz', 'ulaşalım', 'ulasalim', 'belirtebilir'
        ].some(kw => lowerText.includes(kw));
      };

      const hasActivePendingSlot = rawPendingSlot && rawPendingSlot !== 'generic_none';
      const last4Messages = history.slice(-4);
      const hasCallSchedulingInHistory = last4Messages.some(m => {
        const lowerContent = m.content.toLowerCase();
        return callSchedulingKeywords.some(kw => lowerContent.includes(kw)) || isCallOffer(m.content);
      });
      const lastBotMessageAskedDetails = botAskedForDetails(lastAssistantMsg);

      const isContinuationValid = hasActivePendingSlot || hasCallSchedulingInHistory || lastBotMessageAskedDetails;

      if (isContinuationValid) {
        return {
          effectivePendingSlot: (rawPendingSlot && rawPendingSlot !== 'generic_none') ? rawPendingSlot : 'call_time',
          effectiveIntent: 'continuation_short_reply',
          staleSlotSuppressed: false
        };
      } else {
        return {
          effectivePendingSlot: 'generic_none',
          effectiveIntent: 'continuation_short_reply',
          staleSlotSuppressed: true,
          suppressionReason: 'continuation_invalid_no_context'
        };
      }
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
        const affirmatives = ['evet', 'olur', 'tamam', 'ok', 'okay', 'yes', 'uygun', 'uygundur', 'evet uygun', 'kabul', 'tamamdir', 'hay hay', 'tabii', 'onaylıyorum', 'arayabilirsiniz', 'simdi degil', 'şimdi değil'];
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

      case 'arrival_date': {
        const dateKeywords = [
          'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
          'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik',
          'ay sonu', 'ay başı', 'ay basi', 'ayın sonu', 'ayın başı'
        ];
        return dateKeywords.some(kw => lower.includes(kw)) || /\d{1,2}[./]\d{1,2}/.test(lower);
      }

      default:
        // Unknown slot — keep by default (conservative)
        return true;
    }
  }
}
