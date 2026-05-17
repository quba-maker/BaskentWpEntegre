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
 * Prevents cross-tenant brand leakage, competitor mentions, and AI hallucinations.
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

    // 2. Tenant-Specific Egress DLP (Cross-Tenant Leakage Prevention)
    const tenantConfig = brain.context.config?.raw || {};
    
    // Tenants can define a list of banned/competitor keywords in their config
    // We strictly enforce that these strings NEVER exit the AI boundary
    let bannedKeywords: string[] = [];
    if (tenantConfig.banned_keywords && Array.isArray(tenantConfig.banned_keywords)) {
      bannedKeywords = tenantConfig.banned_keywords.map((k: string) => k.toLowerCase());
    }

    // Hardcoded global safety list for Healthcare (Başkent Hospital etc) 
    // to prevent mixing names with other hospitals (e.g. Acıbadem, Memorial, vs)
    // In a real system, this should be purely driven by DB configuration, 
    // but for demo/safety we add common competitor checks.
    if (tenantConfig.slug === "baskent") {
      const competitors = ["acıbadem", "acibadem", "memorial", "medical park", "medipol", "florence nightingale", "liv hospital"];
      bannedKeywords = [...new Set([...bannedKeywords, ...competitors])];
    }

    for (const keyword of bannedKeywords) {
      if (keyword.trim().length > 2 && lowerResponse.includes(keyword.trim())) {
         this.log.error(`[POLICY_VIOLATION] Egress Leakage Prevented. Blocked Keyword: ${keyword}`, undefined, { tenantId: brain.context.tenantId });
         return { 
           valid: false, 
           reason: "egress_dlp_violation",
           fallbackMessage: "Mesajınız alındı, ilgili uzmanımız en kısa sürede size dönüş yapacaktır. Teşekkürler."
         };
      }
    }

    return { valid: true };
  }
}
