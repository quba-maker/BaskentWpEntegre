import { TenantBrain } from '../../brain/tenant-brain';
import { defaultPrompts } from '../../domain/conversation/prompts';

export class PromptBuilder {
  /**
   * Builds the System Prompt strictly tied to the isolated TenantBrain.
   * NEVER accepts raw strings to prevent prompt contamination.
   */
  public static buildSystemPrompt(brain: TenantBrain, phase: string, isHumanHandover: boolean): string {
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
