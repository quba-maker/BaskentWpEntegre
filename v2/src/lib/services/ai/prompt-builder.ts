import { TenantBrain } from '../../brain/tenant-brain';
import { defaultPrompts } from '../../domain/conversation/prompts';
import { SecurityIsolationError } from '../../security/tenant-firewall';
import { SecurityTelemetry } from '../../security/telemetry';

export class PromptBuilder {
  /**
   * Validates that the requested prompt belongs strictly to the active TenantBrain.
   */
  private static validatePromptOwnership(brain: TenantBrain, promptString: string | null) {
    if (!brain || !brain.context || !brain.context.tenantId) {
      SecurityTelemetry.log("SECURITY_PANIC", "UNKNOWN", "UNKNOWN", null, {
        reason: "Missing TenantBrain during prompt generation"
      });
      throw new SecurityIsolationError("Cannot validate prompt ownership without a valid TenantBrain.");
    }

    // In a real DB scenario, we would verify the prompt's `tenant_id` DB column.
    // Here we enforce that the string actually came from the Brain's pre-loaded prompts
    // and was NOT passed as a raw external string bypassing the brain.
    if (promptString && promptString !== brain.prompts.systemPrompt) {
      SecurityTelemetry.log("CROSS_TENANT_ATTEMPT", brain.context.tenantId, brain.context.webhookPayloadId, null, {
        reason: "Prompt injection or ownership mismatch detected",
      });
      throw new SecurityIsolationError(`Prompt ownership validation failed for tenant: ${brain.context.tenantId}. Prompt injection rejected.`);
    }
  }

  /**
   * Builds the System Prompt strictly tied to the isolated TenantBrain.
   * NEVER accepts raw strings to prevent prompt contamination.
   */
  public static buildSystemPrompt(brain: TenantBrain, phase: string, isHumanHandover: boolean): string {
    this.validatePromptOwnership(brain, brain.prompts.systemPrompt);

    if (isHumanHandover) {
      return "Kullanıcı insan temsilciye aktarıldı. Sadece kısa bir bekleme mesajı ver ve başka bir şey söyleme.";
    }

    // Use DB prompt or fallback to strictly hardcoded defaults for the specific channel
    let base = brain.prompts.systemPrompt;
    if (!base) {
      // Fallback safely based on channel
      if (brain.context.channel === 'whatsapp') {
        base = defaultPrompts.whatsapp;
      } else if (brain.context.channel === 'instagram') {
        base = defaultPrompts.instagram;
      } else {
        base = "Sen kibar, profesyonel ve yardımcı bir asistan olarak hizmet veriyorsun.";
      }
    }

    const phaseContext = `\n\n[Sistem Direktifi] Şu anki konuşma evresi (Phase): ${phase.toUpperCase()}.\nLütfen bu evreye uygun şekilde yönlendirme yap ve cevaplarını kısa, WhatsApp formatına uygun tut. Uzun paragraflardan kaçın.`;
    
    return base + phaseContext;
  }
}
