import { whatsappPrompt, turkcePrompt, foreignPrompt } from "@/lib/domain/conversation/prompts";
import { logger } from "@/lib/core/logger";

/**
 * Tenant Prompt Registry (Fallback & Code-First Strategy)
 * 
 * Saas architecture dictates that prompts should ideally live in the DB.
 * However, for code-first deployment and local testing without a DB prompt,
 * we map tenant slugs to their hardcoded prompts here.
 */

interface TenantPromptMap {
  [slug: string]: {
    [channel: string]: string;
  };
}

const registry: TenantPromptMap = {
  // Başkent Hospital - Legacy Prompts mapped to new architecture
  "baskent": {
    "whatsapp": whatsappPrompt,
    "instagram": turkcePrompt,
    "messenger": turkcePrompt,
    "foreign": foreignPrompt // Placeholder for future routing
  },
  
  // Future SaaS Tenants can be added here
  "demo-clinic": {
    "whatsapp": "Sen Demo Klinik'in dijital asistanısın. Müşterilere randevu ve fiyat konusunda yardımcı oluyorsun.",
    "instagram": "Sen Demo Klinik Instagram temsilcisisin."
  }
};

export class PromptRegistry {
  private static log = logger.withContext({ module: 'PromptRegistry' });

  public static getFallbackPrompt(tenantSlug: string, channel: string): string | null {
    if (!registry[tenantSlug]) {
      this.log.warn(`No fallback prompts found for tenant slug: ${tenantSlug}`);
      return null;
    }

    // Default to whatsapp if channel is missing or unmapped
    const prompt = registry[tenantSlug][channel] || registry[tenantSlug]["whatsapp"];
    
    if (prompt) {
      this.log.info(`Resolved code-first fallback prompt for ${tenantSlug} on ${channel}`);
      return prompt;
    }

    return null;
  }
}
