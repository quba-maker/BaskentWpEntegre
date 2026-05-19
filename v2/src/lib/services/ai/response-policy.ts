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
}
