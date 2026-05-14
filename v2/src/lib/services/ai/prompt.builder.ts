import { logger } from "@/lib/core/logger";

export interface PromptTemplateContext {
  tenantName: string;
  brandVoice: string; // 'professional', 'empathetic', 'energetic'
  complianceRules: string[];
  bannedWords: string[];
  patientProfile: {
    name: string;
    city: string;
    department: string;
    hasFiles: boolean;
    appointmentStatus: string;
    formResponses: Record<string, string>;
  };
  workflowPhase: string;
  aggressionLevel: 'low' | 'medium' | 'high';
  language: string;
}

export interface BuiltPrompt {
  version: string;
  systemInstruction: string;
  estimatedTokens: number;
  explainabilityTrace: string[];
}

/**
 * 🏗️ Modular Prompt Engine
 * Hardcoded string birleştirmelerini kaldırır.
 * Template tabanlı, versiyonlanmış ve multi-tenant uyumlu prompt üretir.
 */
export class PromptBuilder {
  private log = logger.withContext({ module: 'PromptBuilder' });
  private currentVersion = 'v2.1.0';

  /**
   * Modüler parçaları birleştirerek finale ulaşır.
   */
  public build(context: PromptTemplateContext): BuiltPrompt {
    const trace: string[] = [];
    let promptParts: string[] = [];

    // 1. Identity & Voice Layer
    promptParts.push(this.buildIdentity(context));
    trace.push('identity_layer_injected');

    // 2. Localization Layer
    promptParts.push(this.buildLocalization(context.language));
    trace.push('localization_layer_injected');

    // 3. Patient Context (Anayasa) Layer
    promptParts.push(this.buildPatientContext(context.patientProfile));
    trace.push('patient_context_injected');

    // 4. Aggression & Sales Strategy Layer
    promptParts.push(this.buildSalesStrategy(context.aggressionLevel));
    trace.push('sales_strategy_injected');

    // 5. Compliance & Safety Layer
    promptParts.push(this.buildCompliance(context.complianceRules, context.bannedWords));
    trace.push('compliance_layer_injected');

    const finalPrompt = promptParts.join('\n\n---\n\n');
    
    // Basit token tahmini (Karakter / 4)
    const estimatedTokens = Math.ceil(finalPrompt.length / 4);

    if (estimatedTokens > 3000) {
      this.log.warn(`⚠️ High Token Usage in Prompt: ${estimatedTokens} tokens.`);
    }

    return {
      version: this.currentVersion,
      systemInstruction: finalPrompt,
      estimatedTokens,
      explainabilityTrace: trace
    };
  }

  private buildIdentity(ctx: PromptTemplateContext): string {
    const voiceMap: Record<string, string> = {
      professional: "You are a professional, authoritative, and reliable medical consultant.",
      empathetic: "You are a highly empathetic, caring, and warm health assistant.",
      energetic: "You are an energetic, motivating, and dynamic lifestyle coach."
    };
    const voice = voiceMap[ctx.brandVoice] || voiceMap['professional'];
    return `[SYSTEM IDENTITY]\nYou represent ${ctx.tenantName}. ${voice}\nYour primary goal is to assist the user while adhering strictly to the institution's guidelines.`;
  }

  private buildLocalization(language: string): string {
    return `[LANGUAGE MANDATE]\nCRITICAL: The user speaks ${language || 'Turkish'}. You MUST respond ENTIRELY in ${language || 'Turkish'}. Do not mix languages.`;
  }

  private buildPatientContext(profile: any): string {
    let ctx = `[USER PROFILE (IMMUTABLE FACTS)]\nDO NOT ask the user for information already provided below:\n`;
    ctx += `- Name: ${profile.name || 'Unknown'}\n`;
    ctx += `- Location: ${profile.city || 'Unknown'}\n`;
    ctx += `- Department of Interest: ${profile.department || 'General'}\n`;
    ctx += `- Has Shared Medical Files: ${profile.hasFiles ? 'YES' : 'NO'}\n`;
    ctx += `- Appointment Status: ${profile.appointmentStatus}\n`;

    if (Object.keys(profile.formResponses).length > 0) {
      ctx += `\n[KNOWN FORM RESPONSES]\n`;
      for (const [key, value] of Object.entries(profile.formResponses)) {
        ctx += `- ${key}: ${value}\n`;
      }
    }
    return ctx;
  }

  private buildSalesStrategy(level: string): string {
    if (level === 'low') return `[STRATEGY]\nBe passive and informative. Do not push for an appointment. Focus only on answering questions.`;
    if (level === 'high') return `[STRATEGY]\nBe proactive. Guide every conversation towards booking an appointment. Handle objections confidently. Use FOMO safely if applicable.`;
    return `[STRATEGY]\nMaintain a balanced approach. Build trust first, then naturally suggest an appointment or consultation when appropriate.`;
  }

  private buildCompliance(rules: string[], banned: string[]): string {
    let comp = `[COMPLIANCE & SAFETY BOUNDARIES]\n`;
    comp += `- NEVER give definitive medical diagnoses.\n`;
    comp += `- ALWAYS remind the patient that online consultations do not replace physical examinations.\n`;
    
    if (rules && rules.length > 0) {
      rules.forEach(r => comp += `- ${r}\n`);
    }

    if (banned && banned.length > 0) {
      comp += `\n[BANNED WORDS]\nDo not use the following words: ${banned.join(', ')}.`;
    }
    
    return comp;
  }
}
