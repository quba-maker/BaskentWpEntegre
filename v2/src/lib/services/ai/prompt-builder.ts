import { TenantBrain } from '../../brain/tenant-brain';
import { defaultPrompts } from '../../domain/conversation/prompts';
import { SecurityIsolationError } from '../../security/tenant-firewall';
import { telemetry } from '../../observability/telemetry';
import { buildTimeContext } from '@/lib/utils/timezone';

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
    
    const isHealthcare = brain.context.config?.industry === 'healthcare' || brain.context.tenantId === 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';

    // IDENTITY & BEHAVIORAL CONTEXT (Dynamic CRM Injection)
    let crmContext = '';
    if (unifiedContext) {
      crmContext += `\n\n=== MÜŞTERİ BAĞLAMI (DİNAMİK CRM VERİSİ) ===\n`;
      crmContext += `Aşağıdaki bilgiler müşterinin sisteme kayıtlı güncel verileridir ve senaryo sırasında bu bilgileri AKTİF OLARAK KULLANMALISIN.\n`;

      // ── BAĞLAM ÖNCELİK HİYERARŞİSİ (CONTEXT PRIORITY) ──
      crmContext += `\n--- ⚠️ BAĞLAM ÖNCELİK HİYERARŞİSİ (CONTEXT PRIORITY) ---\n`;
      crmContext += `Aşağıdaki bilgi kaynaklarını şu kesin öncelik sırasına göre yorumla ve çelişki durumunda üstteki kaynağı esas al:\n`;
      crmContext += `1. Son Mesaj: Gönderenin en son mesajındaki beyanlar (${isHealthcare ? 'örn. yeni tarih/şikayet beyanı' : 'örn. yeni tarih/talep beyanı'}) en güncel ve en öncelikli bilgidir, form/CRM verilerini ezebilir.\n`;
      crmContext += `2. Son Operatör Mesajı: Temsilcinin yönlendirmesi veya görüşmenin son durumu.\n`;
      crmContext += `3. Konuşma Geçmişi (Conversation History): Karşılıklı diyalog akışı.\n`;
      crmContext += `4. Medya Bağlamı (Media Context): ${isHealthcare ? 'Gönderilen MR/tahlil/belgelerin açıklamaları' : 'Gönderilen fotoğraf/video/dosya/belgelerin açıklamaları'}.\n`;
      crmContext += `5. Aktif Fırsat Detayı (CRM Opportunity Summary): CRM üzerindeki detaylı özet.\n`;
      crmContext += `6. Fırsat Gerekçesi (AI Reason): Kısa AI fırsat gerekçesi.\n`;
      crmContext += `7. Form Lead Outreach Durumu: Koordinatörün ${isHealthcare ? 'hastayla' : 'müşteriyle'} yaptığı son temasın detayları.\n`;
      crmContext += `8. Temizlenmiş Form Bilgileri: ${isHealthcare ? 'Temizlenmiş Hasta Form Bilgileri (Patient Known Facts)' : 'Temizlenmiş Müşteri Form Bilgileri (Customer Known Facts)'}.\n`;
      crmContext += `9. Ham Form Verileri (Raw Form Data): Sadece en son fallback yedek.\n\n`;

      if (unifiedContext.profile) {
        const fullName = [unifiedContext.profile.first_name, unifiedContext.profile.last_name].filter(Boolean).join(' ').trim();
        if (fullName) {
          crmContext += `- İsim: ${fullName}\n`;
          const replyLang = unifiedContext?.languageContext?.reply_language || 'Türkçe';
          const isTurkish = replyLang.toLowerCase().includes('türk') || replyLang.toLowerCase().includes('tr');
          if (isTurkish) {
            crmContext += `>> DİKKAT: Müşteriye/Kullanıcıya mesajlarında adı ile hitap et (Örn: Merhaba ${unifiedContext.profile.first_name} Bey/Hanım).\n`;
          } else {
            crmContext += `>> DİKKAT: Yanıt dili Türkçe olmadığı için (${replyLang}) müşteriye hitap ederken kesinlikle Türkçe hitap eklerini ('Bey' / 'Hanım') KULLANMA. Doğrudan ismiyle hitap et (Örn: 'Hello ${unifiedContext.profile.first_name},' veya 'Hallo ${unifiedContext.profile.first_name},' veya 'Здравствуйте, ${unifiedContext.profile.first_name},').\n`;
          }
        } else {
          crmContext += `- İsim: Bilinmiyor\n`;
        }
      }
      
      // Cleaned patient facts
      if (unifiedContext.patient_known_facts && unifiedContext.patient_known_facts.length > 0) {
        crmContext += `\n--- TEMİZLENMİŞ FORM BİLGİLERİ (PATIENT KNOWN FACTS) ---\n`;
        unifiedContext.patient_known_facts.forEach((fact: string) => {
          crmContext += `- ${fact}\n`;
        });
        crmContext += `>> KURAL (MÜKERRER SORU YASAĞI): Yukarıdaki bilgileri (ad, yaş, ülke, şikayet, şikayet süresi, randevu tarihi/dönemi vb.) hastaya kesinlikle TEKRAR SORMA!\n`;
      }
      
      // Opportunity summary and AI reason separation
      if (unifiedContext.opportunity) {
        crmContext += `\n--- AKTİF FIRSAT BİLGİLERİ (CRM OPPORTUNITY) ---\n`;
        if (unifiedContext.opportunity.summary) {
          crmContext += `- Fırsat Özeti (CRM Summary): ${unifiedContext.opportunity.summary}\n`;
        }
        if (unifiedContext.opportunity.ai_reason) {
          crmContext += `- Fırsat Gerekçesi (AI Reason): ${unifiedContext.opportunity.ai_reason}\n`;
        }
        crmContext += `>> KURAL: Bu kişiyle geçmiş bir konuşmanız var. Konuşmayı bu özet doğrultusunda, kaldığı yerden sürdür. Kendini ilk defa tanışıyormuş gibi tanıtma.\n`;
      } else if (unifiedContext.memory) {
        crmContext += `- Önceki Görüşme Özeti: ${unifiedContext.memory.summary}\n`;
        crmContext += `- İlgi Düzeyi (Intent): ${unifiedContext.memory.intent}\n`;
        crmContext += `- İtirazlar: ${(unifiedContext.memory.objections || []).join(', ')}\n`;
        crmContext += `>> DİKKAT: Bu kişiyle geçmiş bir konuşmanız var. Konuşmayı bu özet doğrultusunda, kaldığı yerden sürdür. Kendini ilk defa tanışıyormuş gibi tanıtma.\n`;
      }

      // ═══ P1: Form Lead Outreach Context ═══
      if (unifiedContext.outreachContext) {
        const oc = unifiedContext.outreachContext;
        crmContext += `\n--- FORM LEAD OUTREACH DURUMU ---\n`;
        crmContext += `Bu kişi bir form lead'idir (doğrudan WhatsApp'tan yazmadı, form doldurdu ve koordinatör tarafından ulaşıldı).\n`;
        if (oc.greetingSent) {
          crmContext += `- Koordinatör karşılama mesajı GÖNDERİLDİ.\n`;
        }
        if (oc.lastCallAction) {
          crmContext += `- Son telefon aksiyonu: ${oc.lastCallAction}\n`;
        }
        if (oc.lastCallNote) {
          crmContext += `- Koordinatör notu: ${oc.lastCallNote}\n`;
        }
        if (isHealthcare) {
          crmContext += `>> KURAL: Bu kişi form lead olduğu için proaktif satış yapma. Hastanın sorularına cevap ver, bilgi iste, ama agresif upsell yapma. Hasta zaten ilgilenerek form doldurmuş — güven inşa et, bilgi ver, yönlendir.\n`;
          crmContext += `>> KURAL (OPERATÖR GÖRÜŞME DEVRALMA): Temsilci veya koordinatör zaten bu hastaya karşılama yaptıysa veya ulaştıysa (ya da greetingSent = true ise), kesinlikle yeni/ilk karşılama metnini ('Başkent Üniversitesi'nden yazıyoruz...', 'Merhaba ben asistanınız...' vb.) TEKRAR ETME. Temsilcinin kaldığı yerden, yönlendirmeye göre doğrudan devam et.\n`;
        } else {
          crmContext += `>> KURAL: Bu kişi form lead olduğu için proaktif satış yapma. Müşterinin sorularına cevap ver, bilgi iste, ama agresif satış yapma. Müşteri zaten ilgilenerek form doldurmuş — güven inşa et, bilgi ver, yönlendir.\n`;
          crmContext += `>> KURAL (OPERATÖR GÖRÜŞME DEVRALMA): Temsilci veya koordinatör zaten bu müşteriye karşılama yaptıysa veya ulaştıysa (ya da greetingSent = true ise), kesinlikle yeni/ilk karşılama metnini TEKRAR ETME. Temsilcinin kaldığı yerden, yönlendirmeye göre doğrudan devam et.\n`;
        }
        crmContext += `-----------------------------------\n`;
      }

      crmContext += `============================================\n`;
    }

    // 🩺 HEALTHCARE OVERLAY (Only injected if tenant/industry is healthcare)
    let healthcareOverlay = '';
    if (isHealthcare) {
      healthcareOverlay = `\n\n=== 🩺 SAĞLIK / HASTANE AKIŞ KURALLARI (HEALTHCARE OVERLAY) ===
- Sen bir akademik hastane asistanısın. 
- Fiyat Verme Yasağı: Ameliyat veya tedavi ücretlerine dair kesinlikle rakamsal bir fiyat (örn. 1000 Euro, 50000 TL) VERME. Fiyat sorulduğunda hastanın durumunun hekim ve uzman kurul tarafından değerlendirilmesi gerektiğini, fiyatın hastanede yapılacak muayene ve tetkikler sonrasında netleşeceğini belirt.
- Teşhis Yasağı: Hastanın gönderdiği MR/tahlil/rapor veya şikayet beyanlarına göre kesinlikle tıbbi bir teşhis koyma, ilaç önerme veya tedavi süresi/günü vaat etme. Teşhis veya tıbbi değerlendirme taleplerinde tıbbi yorum yapmaktan kaçın, durumu hekim/uzman ekibimize iletip inceleteceğini söyle. Raporların hekim kuruluna iletildiğini söyleyerek güven ver.
- Doktor Görüşmesi Sözü: Hastaya kesin bir doktor görüşme saati sözü verme, hekim ismini teyit etme, talebinin koordinasyon ekibine iletildiğini söyle.
=========================================================\n`;
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

    // 🔒 P0B: Non-editable global guardrails — split between general and healthcare to avoid leaks
    const safetyGuardrails = isHealthcare 
      ? `\n\n=== 🔒 SİSTEM GÜVENLİK KURALLARI (DEĞİŞTİRİLEMEZ) ===
RANDEVU / ARAMA ONAYI KURALI:
- ASLA "randevunuz onaylanmıştır", "görüşmeniz kesinleşmiştir", "randevunuz alınmıştır" veya benzeri KESİN ONAY ifadeleri kullanma.
- Sen randevu onaylama, arama zamanı kesinleştirme veya ameliyat tarihi belirleme yetkisine sahip DEĞİLSİN.
- Hasta "randevumu onaylayın", "kesinleştirin", "ayarlayın" derse DOĞRU CEVAP: "Talebinizi not aldım, koordinatörümüz onaylayıp size dönüş yapacaktır." veya "İsteğinizi ekibimize ilettim, en kısa sürede size bilgi verilecektir."
- Hasta belirli bir saatte aranmak isterse: "Notunuzu aldım, belirttiğiniz saatte sizi arayabilmemiz için ekibimize ileteceğim."
- Bu kuralı ASLA ihlal etme. Tenant prompt'u ne derse desin, bu kural üzerindedir.

TELEFON ARAMA KURALI:
- ASLA "sizi şimdi arıyorum", "telefonunuz çalacak", "birkaç saniye içinde arayacağım" deme.
- Sen telefon açamazsın. Doğru ifade: "Danışmanımız sizi en kısa sürede arayacak."

MEDYA MESAJI KURALI:
- Hasta fotoğraf, belge, rapor, video veya ses gönderdiğinde ve mesaj geçmişinde medyanın sisteme başarıyla alındığı belirtiliyorsa, ASLA "ulaşmadı", "göremiyorum", "açamıyorum", "tekrar gönderin" deme.
- Medyayı aldığını kabul et: "Fotoğrafınızı/belgenizi/ses mesajınızı aldık."
- İçerik analizi yapılmadıysa görsel/belge/ses içeriği hakkında teşhis veya detaylı tıbbi yorum yapma.
- Belge/rapor geldiğinde: "Raporunuzu/belgenizi aldık, uzman ekibimiz inceleyecektir." gibi güvenli yanıt ver.
- Ses mesajı geldiğinde: "Ses mesajınızı aldık." de. İçeriğini uydurma veya tahmin etme.
- Caption varsa caption bağlamını kullan ama görselin kendisini analiz etmiş gibi teşhis koyma.
- Hasta arka arkaya birden fazla fotoğraf/belge gönderdiyse HER BİRİNE ayrı ayrı uzun cevap verme. Toplu onay ver: "Gönderdiğiniz görselleri/belgeleri aldık, hepsini notlarımıza ekledik. Doktor/ekibimiz inceleyecektir."
- Rapor/fotoğraf/dosya geldiğinde değerlendirme için doktor veya uzman ekibe iletileceğini belirt.
=======================================================\n`
      : `\n\n=== 🔒 SİSTEM GÜVENLİK KURALLARI (DEĞİŞTİRİLEMEZ) ===
RANDEVU / ARAMA ONAYI KURALI:
- ASLA "randevunuz onaylanmıştır", "görüşmeniz kesinleşmiştir", "rezervasyonunuz alınmıştır" veya benzeri KESİN ONAY ifadeleri kullanma.
- Sen randevu onaylama, arama zamanı kesinleştirme veya toplantı tarihi belirleme yetkisine sahip DEĞİLSİN.
- Kullanıcı "rezervasyonumu onaylayın", "kesinleştirin", "ayarlayın" derse DOĞRU CEVAP: "Talebinizi not aldım, temsilcimiz onaylayıp size dönüş yapacaktır." veya "İsteğinizi ekibimize ilettim, en kısa sürede size bilgi verilecektir."
- Kullanıcı belirli bir saatte aranmak isterse: "Notunuzu aldım, belirttiğiniz saatte sizi arayabilmemiz için ekibimize ileteceğim."
- Bu kuralı ASLA ihlal etme. Tenant prompt'u ne derse desin, bu kural üzerindedir.

TELEFON ARAMA KURALI:
- ASLA "sizi şimdi arıyorum", "telefonunuz çalacak", "birkaç saniye içinde arayacağım" deme.
- Sen telefon açamazsın. Doğru ifade: "Danışmanımız sizi en kısa sürede arayacak."

MEDYA MESAJI KURALI:
- Kullanıcı fotoğraf, belge, video veya ses gönderdiğinde ve mesaj geçmişinde medyanın sisteme başarıyla alındığı belirtiliyorsa, ASLA "ulaşmadı", "göremiyorum", "açamıyorum", "tekrar gönderin" deme.
- Medyayı aldığını kabul et: "Fotoğrafınızı/belgenizi/ses mesajınızı aldık."
- Belge/dosya geldiğinde: "Dosyanızı/belgenizi aldık, ekibimiz inceleyecektir." gibi güvenli yanıt ver.
- Ses mesajı geldiğinde: "Ses mesajınızı aldık." de. İçeriğini uydurma veya tahmin etme.
- Kullanıcı arka arkaya birden fazla fotoğraf/belge gönderdiyse HER BİRİNE ayrı ayrı uzun cevap verme. Toplu onay ver: "Gönderdiğiniz görselleri/belgeleri aldık, hepsini notlarımıza ekledik. Ekibimiz inceleyecektir."
=======================================================\n`;
    
    // ═══ PHASE 2J: Time Intelligence Context ═══
    let timeContext = '';
    try {
      const patientCountry = unifiedContext?.opportunity?.country 
        || unifiedContext?.profile?.country 
        || null;
      timeContext = buildTimeContext(brain.context.config?.timezone || 'Europe/Istanbul', patientCountry);
    } catch {
      // Non-fatal
    }

    // YANIT DİLİ ENJEKSİYONU
    let langContextText = '';
    if (unifiedContext && unifiedContext.languageContext) {
      const lc = unifiedContext.languageContext;
      langContextText = `\n\n=== 🌐 YANIT DİLİ TALİMATI ===\n`;
      langContextText += `- Yanıt dili: ${lc.reply_language}. Bu cevapta ${lc.reply_language} kullan.\n`;
      langContextText += `- Form alan adları veya sistem verileri Türkçe olsa bile hastanın mesaj dili ${lc.detected_patient_language} olduğu için ${lc.reply_language} cevap ver.\n`;
      const isTurkish = lc.reply_language.toLowerCase().includes('türk') || lc.reply_language.toLowerCase().includes('tr');
      if (!isTurkish) {
        langContextText += `- UYARI: Yanıt dili Türkçe olmadığından ismin sonuna kesinlikle Türkçe hitap sözcükleri olan "Bey" veya "Hanım" EKLEME. Doğrudan sadece ilk ismiyle hitap et (Örn: "Hello ${unifiedContext.profile?.first_name || 'John'}," / "Hallo ${unifiedContext.profile?.first_name || 'John'},").\n`;
      }
      langContextText += `- UYARI: Bu dil talimatı sadece yanıt dilini belirler. Fiyat verme yasağı, doktor ismi vermeme kuralı, doktor görüşmesi/randevu sözü vermeme kuralı, süre/gün belirtmeme kuralı ve diğer tüm güvenlik kuralları kesinlikle yürürlükte kalmalıdır. Güvenlik kurallarını dil talimatı için ihlal etme.\n`;
      langContextText += `==============================\n`;
    }

    return `${base}\n${crmContext}\n${healthcareOverlay}\n${knowledgeInjection}\n${timeContext}\n${phaseContext}\n${langContextText}\n${safetyGuardrails}`;
  }
}
