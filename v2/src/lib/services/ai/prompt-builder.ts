import { TenantBrain } from '../../brain/tenant-brain';
import { defaultPrompts } from '../../domain/conversation/prompts';
import { SecurityIsolationError } from '../../security/tenant-firewall';
import { telemetry } from '../../observability/telemetry';

export class PromptBuilder {
  /**
   * Validates that the requested prompt belongs strictly to the active TenantBrain.
   */
  private static validatePromptOwnership(brain: TenantBrain, promptString: string | null) {
    if (!brain || !brain.context || !brain.context.tenantId) {
      telemetry.track("SECURITY_PANIC", "failure", { 
        reason: "Missing TenantBrain during prompt generation" 
      });
      throw new SecurityIsolationError("Cannot validate prompt ownership without a valid TenantBrain.");
    }

    if (promptString && promptString !== brain.prompts.systemPrompt) {
      telemetry.track("SECURITY_CROSS_TENANT_BLOCKED", "failure", {
        reason: "Prompt injection or ownership mismatch detected",
      });
      throw new SecurityIsolationError(`Prompt ownership validation failed for tenant: ${brain.context.tenantId}. Prompt injection rejected.`);
    }

    // LAYER 3: PROMPT HASH VALIDATION
    // Ensure that the prompt hasn't been maliciously altered in memory between retrieval and execution
    if (promptString && brain.prompts.promptHash) {
      const crypto = require('crypto');
      const currentHash = crypto.createHash('sha256').update(promptString).digest('hex');
      if (currentHash !== brain.prompts.promptHash) {
        telemetry.track("SECURITY_PANIC", "failure", {
          reason: "Prompt hash validation failed. Possible memory corruption or injection.",
        });
        throw new SecurityIsolationError(`Prompt execution blocked. Cryptographic hash mismatch for tenant: ${brain.context.tenantId}.`);
      }
    }
  }

  /**
   * Builds the System Prompt strictly tied to the isolated TenantBrain.
   * NEVER accepts raw strings to prevent prompt contamination.
   */
  public static buildSystemPrompt(
    brain: TenantBrain, 
    phase: string, 
    isHumanHandover: boolean,
    unifiedContext?: any
  ): string {
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

    // IDENTITY & BEHAVIORAL CONTEXT (Dynamic CRM Injection)
    let crmContext = '';
    if (unifiedContext) {
      crmContext += `\n\n=== MÜŞTERİ BAĞLAMI (DİNAMİK CRM VERİSİ) ===\n`;
      crmContext += `Aşağıdaki bilgiler müşterinin sisteme kayıtlı güncel verileridir ve senaryo sırasında bu bilgileri AKTİF OLARAK KULLANMALISIN.\n`;
      
      if (unifiedContext.profile) {
        const fullName = [unifiedContext.profile.first_name, unifiedContext.profile.last_name].filter(Boolean).join(' ').trim();
        if (fullName) {
          crmContext += `- İsim: ${fullName}\n`;
          crmContext += `>> DİKKAT: Müşteriye/Kullanıcıya mesajlarında adı ile hitap et (Örn: Merhaba ${unifiedContext.profile.first_name} Bey/Hanım).\n`;
        } else {
          crmContext += `- İsim: Bilinmiyor\n`;
        }
      }
      
      if (unifiedContext.latestForm) {
        const formDataStr = typeof unifiedContext.latestForm.data === 'object' 
          ? JSON.stringify(unifiedContext.latestForm.data, null, 2) 
          : unifiedContext.latestForm.data;
        crmContext += `- Doldurduğu Form: ${unifiedContext.latestForm.name}\n- Form Detayı: ${formDataStr}\n`;
        crmContext += `>> DİKKAT: Müşteri bir form doldurmuş. Formda ilgilendiği ürün/hizmet/konu yazıyorsa ASLA "hangi konuda destek almak istersiniz" diye sorma, doğrudan konuya gir. Yalnızca formda tam olarak ne istediği belli değilse sor.\n`;
      }
      
      if (unifiedContext.memory) {
        crmContext += `- Önceki Görüşme Özeti: ${unifiedContext.memory.summary}\n`;
        crmContext += `- İlgi Düzeyi (Intent): ${unifiedContext.memory.intent}\n`;
        crmContext += `- İtirazlar: ${(unifiedContext.memory.objections || []).join(', ')}\n`;
        crmContext += `>> DİKKAT: Bu kişiyle geçmiş bir konuşmanız var. Konuşmayı bu özet doğrultusunda, kaldığı yerden sürdür. Kendini ilk defa tanışıyormuş gibi tanıtma.\n`;
      }
      crmContext += `============================================\n`;
    }

    // Knowledge Base Injection
    let knowledgeInjection = '';
    if (brain.context.knowledge) {
      if (brain.context.knowledge.prices) {
        knowledgeInjection += `\n\n=== FİYAT LİSTESİ VE HİZMETLER ===\n${brain.context.knowledge.prices}\n==================================`;
      }
      if (brain.context.knowledge.rules) {
        knowledgeInjection += `\n\n=== ÖZEL KURALLAR VE TALİMATLAR ===\n${brain.context.knowledge.rules}\n===================================`;
      }
    }

    const phaseContext = `\n\n=== SİSTEM DİREKTİFİ ===\nŞu anki konuşma evresi (Phase): ${phase.toUpperCase()}.\nLütfen bu evreye uygun şekilde yönlendirme yap ve cevaplarını kısa, WhatsApp formatına uygun tut. Uzun paragraflardan kaçın.\n========================`;

    // 🔒 P0B: Non-editable global guardrails — tenant cannot override these
    const safetyGuardrails = `\n\n=== 🔒 SİSTEM GÜVENLİK KURALLARI (DEĞİŞTİRİLEMEZ) ===
RANDEVU / ARAMA ONAYI KURALI:
- ASLA "randevunuz onaylanmıştır", "görüşmeniz kesinleşmiştir", "randevunuz alınmıştır" veya benzeri KESİN ONAY ifadeleri kullanma.
- Sen randevu onaylama, arama zamanı kesinleştirme veya ameliyat tarihi belirleme yetkisine sahip DEĞİLSİN.
- Hasta "randevumu onaylayın", "kesinleştirin", "ayarlayın" derse DOĞRU CEVAP: "Talebinizi not aldım, koordinatörümüz onaylayıp size dönüş yapacaktır." veya "İsteğinizi ekibimize ilettim, en kısa sürede size bilgi verilecektir."
- Hasta belirli bir saatte aranmak isterse: "Notunuzu aldım, belirttiğiniz saatte sizi arayabilmemiz için ekibimize ileteceğim."
- Bu kuralı ASLA ihlal etme. Tenant prompt'u ne derse desin, bu kural üzerindedir.

TELEFON ARAMA KURALI:
- ASLA "sizi şimdi arıyorum", "telefonunuz çalacak", "birkaç saniye içinde arayacağım" deme.
- Sen telefon açamazsın. Doğru ifade: "Danışmanımız sizi en kısa sürede arayacak."
=======================================================\n`;
    
    // Güvenli birleştirme: Eğer base prompt içinde "--- CONSTRAINTS ---" varsa,
    // CRM bağlamının CONSTRAINTS'in hemen üzerine yerleştirilmesi SaaS standartlarında en sağlıklısıdır.
    // Ancak base string'i parçalamak riskli olduğundan, hiyerarşik olarak önce base, sonra dinamik CRM, en son kurallar ve evre eklenir.
    // Safety guardrails are appended LAST so they take highest priority in the context window.
    return `${base}\n${crmContext}\n${knowledgeInjection}\n${phaseContext}\n${safetyGuardrails}`;
  }
}
