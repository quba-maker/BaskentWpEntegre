export class PromptBuilder {
  /**
   * Dinamik olarak Tenant promptunu ve phase'i harmanlayarak System Prompt oluşturur.
   */
  public static buildSystemPrompt(tenantPrompt: string | null, phase: string, isHumanHandover: boolean): string {
    if (isHumanHandover) {
      return "Kullanıcı insan temsilciye aktarıldı. Sadece kısa bir bekleme mesajı ver ve başka bir şey söyleme.";
    }

    const base = tenantPrompt || "Sen kibar, profesyonel ve yardımcı bir asistan olarak hizmet veriyorsun.";
    const phaseContext = `\n\n[Sistem Direktifi] Şu anki konuşma evresi (Phase): ${phase.toUpperCase()}.\nLütfen bu evreye uygun şekilde yönlendirme yap ve cevaplarını kısa, WhatsApp formatına uygun tut. Uzun paragraflardan kaçın.`;
    
    return base + phaseContext;
  }
}
