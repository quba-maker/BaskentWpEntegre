import { logger } from "@/lib/core/logger";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  fallbackMessage?: string;
}

/**
 * AI Response Policy Validator
 * Yanıtın uygunluğunu denetler, zararlı / istenmeyen metinleri engeller.
 */
export class ResponsePolicy {
  private log = logger.withContext({ module: 'ResponsePolicy' });

  public validate(response: string): ValidationResult {
    if (!response || response.trim().length === 0) {
      this.log.warn("Policy Fail: Empty response");
      return { 
        valid: false, 
        reason: "empty_response",
        fallbackMessage: "Şu an yoğunluk nedeniyle yanıt veremiyorum. Lütfen biraz bekleyiniz."
      };
    }
    
    // Hallucination ve AI ifşası yasaklı kelimeler
    const bannedPhrases = [
      "i am an ai", "as an ai", "yapay zekayım", "ben bir yapay zekayım",
      "yapay zeka modeliyim", "dil modeliyim", "ben bir asistanım"
    ];
    
    const lowerResponse = response.toLowerCase();
    for (const phrase of bannedPhrases) {
      if (lowerResponse.includes(phrase)) {
         this.log.warn(`Policy Fail: Banned Phrase detected: ${phrase}`);
         return { 
           valid: false, 
           reason: "banned_phrase_escalation",
           fallbackMessage: "Size daha detaylı yardımcı olabilmemiz için sorunuzu müşteri temsilcimize aktarıyorum. Lütfen bekleyiniz."
         };
      }
    }

    return { valid: true };
  }
}
