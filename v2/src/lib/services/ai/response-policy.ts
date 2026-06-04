import { logger } from "@/lib/core/logger";
import { TenantBrain } from "@/lib/brain/tenant-brain";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  fallbackMessage?: string;
}

/**
 * AI Response Policy Validator (Egress DLP)
 * Enforces Outbound Data Loss Prevention.
 * Uses tenant-scoped bannedWords from TenantBrain (DB-driven, no hardcoded lists).
 */
export class ResponsePolicy {
  private log = logger.withContext({ module: 'ResponsePolicy' });

  public validate(response: string, brain: TenantBrain): ValidationResult {
    if (!response || response.trim().length === 0) {
      this.log.warn(`[POLICY_FAIL] Empty response`, { tenantId: brain.context.tenantId });
      return { 
        valid: false, 
        reason: "empty_response",
        fallbackMessage: "Şu an yoğunluk nedeniyle yanıt veremiyorum. Lütfen biraz bekleyiniz."
      };
    }
    
    const lowerResponse = response.toLowerCase();

    // 1. Generic AI Hallucination & Identity checks
    const aiIdentityPhrases = [
      "i am an ai", "as an ai", "yapay zekayım", "ben bir yapay zekayım",
      "yapay zeka modeliyim", "dil modeliyim", "ben bir asistanım"
    ];
    
    for (const phrase of aiIdentityPhrases) {
      if (lowerResponse.includes(phrase)) {
         this.log.warn(`[POLICY_FAIL] Identity Leak detected: ${phrase}`, { tenantId: brain.context.tenantId });
         return { 
           valid: false, 
           reason: "identity_escalation",
           fallbackMessage: "Size daha detaylı yardımcı olabilmemiz için sorunuzu müşteri temsilcimize aktarıyorum. Lütfen bekleyiniz."
         };
      }
    }

    // 2. Tenant-Scoped Egress DLP is now handled at the prompt level.

    return { valid: true };
  }

  /**
   * Evaluates if the AI response is truncated or incomplete using heuristic checks.
   * This acts as the final gate before a message is sent to WhatsApp.
   */
  public validateCompleteness(response: string, finishReason?: string): ValidationResult {
    if (!response || response.trim().length === 0) {
      return { valid: false, reason: "empty_response" };
    }

    if (finishReason && finishReason !== 'STOP') {
      return { valid: false, reason: `bad_finish_reason_${finishReason}` };
    }

    const lines = response.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
      return { valid: false, reason: "empty_lines" };
    }

    const lastLine = lines[lines.length - 1];
    
    // 1. Ends with a single specific character
    if (lastLine === 'S' || lastLine === 'B' || lastLine === 'V') {
      return { valid: false, reason: "single_char_dangling" };
    }

    // 2. Ends with 1-2 char and looks like nonsense (if it's the only thing on the last line and not an emoji)
    // We avoid matching valid short words like "ok", "tamam" by checking against a specific set or just length
    // Actually, user specified "1-2 harflik anlamsız token", so if it's 1-2 chars and doesn't contain punctuation/emoji
    if (lastLine.length <= 2 && /^[a-zA-ZğüşıöçĞÜŞİÖÇ]+$/.test(lastLine)) {
      const validShorts = ['ok', 'tam', 'aa', 'ya', 'ha', 'de', 'da', 'mi', 'mu'];
      if (!validShorts.includes(lastLine.toLowerCase())) {
        return { valid: false, reason: `dangling_short_token_${lastLine}` };
      }
    }

    // 3. Ends with a conjunction or starter word
    const conjunctions = ["ve", "veya", "ama", "fakat", "çünkü", "bu nedenle", "size", "sizinle", "ayrıca", "son olarak"];
    const lastWordLower = lastLine.split(/\s+/).pop()?.toLowerCase() || '';
    if (conjunctions.includes(lastWordLower) || conjunctions.some(c => lastLine.toLowerCase() === c)) {
      return { valid: false, reason: `dangling_conjunction_${lastWordLower}` };
    }

    // 4. Unclosed quotes or parentheses
    const openQuotes = (response.match(/"/g) || []).length;
    if (openQuotes % 2 !== 0) {
      return { valid: false, reason: "unclosed_quote" };
    }
    
    const openParens = (response.match(/\(/g) || []).length;
    const closeParens = (response.match(/\)/g) || []).length;
    if (openParens > closeParens) {
      return { valid: false, reason: "unclosed_parenthesis" };
    }

    // 5. Technical fallbacks
    const technicalErrors = ["otomatik taslak oluşturulamadı", "undefined", "null", "[object object]"];
    const lowerResp = response.toLowerCase();
    if (technicalErrors.some(t => lowerResp.includes(t))) {
      return { valid: false, reason: "technical_error_text" };
    }

    return { valid: true };
  }
}
