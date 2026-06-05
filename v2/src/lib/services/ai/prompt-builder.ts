import { TenantBrain } from '../../brain/tenant-brain';
import { defaultPrompts } from '../../domain/conversation/prompts';
import { SecurityIsolationError } from '../../security/tenant-firewall';
import { telemetry } from '../../observability/telemetry';
import { buildTimeContext } from '@/lib/utils/timezone';
import { resolvePatientNameDetailed } from '@/lib/utils/patient-name-resolver';
import { resolvePatientCountryDetailed } from '@/lib/utils/country-normalizer';

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
      if (unifiedContext.quotedContext) {
        crmContext += `\n--- ⚠️ BAĞLAM ÖNCELİK HİYERARŞİSİ (CONTEXT PRIORITY - QUOTED REPLY AKTİF) ---\n`;
        crmContext += `Hasta önceki bir mesaja doğrudan yanıt verdi (quoted reply). Bu durumda bilgi kaynaklarını şu kesin öncelik sırasına göre yorumla ve çelişki durumunda üstteki kaynağı esas al:\n`;
        crmContext += `1. Alıntılanan Mesaj (Quoted Snapshot): Yanıt verilen önceki mesajın içeriği ve bağlamı en yüksek önceliğe sahiptir.\n`;
        crmContext += `2. Son Mesaj: Hastanın bu alıntıya yazdığı yeni mesaj (kısa, belirsiz, nokta veya emoji olsa dahi alıntıyla birleştirilmelidir).\n`;
        crmContext += `3. Kısa Hasta/CRM Özeti (CRM Summary / AI Reason).\n`;
        crmContext += `4. Eski Task/Randevu/Opportunity Detayları.\n`;
        crmContext += `⚠️ KRİTİK KURAL: Eski randevu, overdue arama veya CRM özeti gibi bağlamlar alıntılanan mesajın önüne geçemez ve onun açıklanmasını engelleyemez.\n\n`;
      } else {
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
      }

      if (unifiedContext.profile) {
        const fullName = [unifiedContext.profile.first_name, unifiedContext.profile.last_name].filter(Boolean).join(' ').trim();
        if (fullName) {
          crmContext += `- İsim: ${fullName}\n`;
        } else {
          crmContext += `- İsim: Bilinmiyor\n`;
        }
      }
      crmContext += `>> UYARI (KRİTİK): Hastaya/kullanıcıya ismiyle hitap etme, cinsiyetli veya resmi hitap sözcükleri (Bey, Hanım, Bay, Bayan, Sayın, M.r., M.s., M.r.s., D.e.a.r. vb.) KULLANMA. Mesajlarına isimsiz ve nötr bir selamlama ile başla (Örn. Türkçe için sadece "Merhaba,", İngilizce için sadece "Hello,").\n`;
      crmContext += `>> UYARI: Türkçe yanıt verirken kesinlikle samimi/senli dil kullanma. Her zaman kurumsal, nazik ve formal "sizli" tonu kullan (Örn. "yardımcı olabiliriz", "paylaşabilir misiniz", "düşünür müsünüz").\n`;
      
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
        if (unifiedContext.isGreetingOnly) {
           crmContext += `- Özet: Müşteri/hasta bilgisi sistemde kayıtlı.\n`;
        } else {
          if (unifiedContext.opportunity.summary) {
            crmContext += `- Fırsat Özeti (CRM Summary): ${unifiedContext.opportunity.summary}\n`;
          }
          if (unifiedContext.opportunity.ai_reason) {
            crmContext += `- Fırsat Gerekçesi (AI Reason): ${unifiedContext.opportunity.ai_reason}\n`;
          }
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
    
    // 🔒 P0B: Non-editable global guardrails — split between general and healthcare to avoid leaks
    const safetyGuardrails = isHealthcare 
      ? `\n\n=== 🔒 SİSTEM GÜVENLİK KURALLARI (DEĞİŞTİRİLEMEZ) ===
RANDEVU / ARAMA ONAYI KURALI:
- ASLA "randevunuz onaylanmıştır", "görüşmeniz kesinleşmiştir", "randevunuz alınmıştır", "randevunuz kesinleşti" veya benzeri KESİN ONAY ifadeleri kullanma. Doktor görüşmeniz veya ameliyatınız için kurum adına kesin taahhüt ("Sizi şu tarihte arayacağız" vb.) verme.
- Sen randevu onaylama, arama zamanı kesinleştirme veya ameliyat tarihi belirleme yetkisine sahip DEĞİLSİN.
- Ancak, eğer === ⏰ RANDEVU/ARAMA ONAY VE ZAMAN BAĞLAMI === içindeki bilgiler doğrultusunda planlanan tarih/saat teyit edildiyse, bu net tarih/saati hastaya belirtip teyidini aldığını yazabilirsin (Örn: "Teyidinizi aldım. Telefon görüşmesi için belirttiğiniz zamanı ilgili koordinatör arkadaşımıza iletiyorum.").
- Hasta "randevumu onaylayın", "kesinleştirin", "ayarlayın" derse ve belirlenmiş bir zaman yoksa DOĞRU CEVAP: "Talebinizi not aldım, koordinatörümüz onaylayıp size dönüş yapacaktır." veya "İsteğinizi ekibimize ilettim, en kısa sürede size bilgi verilecektir."
- Hasta belirli bir saatte aranmak isterse: Eğer hastanın saat dilimi net değilse (örn. ABD/Amerika gibi çoklu timezone ülkesindeyse ve şehir/eyalet belli değilse), saati not almadan önce mutlaka hastanın şehir veya eyalet bilgisini sor. Eğer saat dilimi net ise, "Notunuzu aldım, belirttiğiniz saatte sizi arayabilmemiz için ekibimize ileteceğim." de.
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
======================================================\n`
      : `\n\n=== 🔒 SİSTEM GÜVENLİK KURALLARI (DEĞİŞTİRİLEMEZ) ===
RANDEVU / ARAMA ONAYI KURALI:
- ASLA "randevunuz onaylanmıştır", "görüşmeniz kesinleşmiştir", "rezervasyonunuz alınmıştır", "randevunuz kesinleşti" veya benzeri KESİN ONAY ifadeleri kullanma. Görüşmeniz veya randevunuz için kurum adına kesin taahhüt ("Sizi şu tarihte arayacağız" vb.) verme.
- Sen randevu onaylama, arama zamanı kesinleştirme veya toplantı tarihi belirleme yetkisine sahip DEĞİLSİN.
- Ancak, eğer === ⏰ RANDEVU/ARAMA ONAY VE ZAMAN BAĞLAMI === içindeki bilgiler doğrultusunda planlanan tarih/saat teyit edildiyse, bu net tarih/saati kullanıcaya belirtip teyidini aldığını yazabilirsin (Örn: "Teyidinizi aldım. Telefon görüşmesi için belirttiğiniz zamanı ilgili koordinatör arkadaşımıza iletiyorum.").
- Kullanıcı "rezervasyonumu onaylayın", "kesinleştirin", "ayarlayın" derse ve belirlenmiş bir zaman yoksa DOĞRU CEVAP: "Talebinizi not aldım, temsilcimiz onaylayıp size dönüş yapacaktır." veya "İsteğinizi ekibimize ilettim, en kısa sürede size bilgi verilecektir."
- Kullanıcı belirli bir saatte aranmak isterse: Eğer kullanıcının saat dilimi net değilse (örn. ABD/Amerika gibi çoklu timezone ülkesindeyse ve şehir/eyalet belli değilse), saati not almadan önce mutlaka kullanıcının şehir veya eyalet bilgisini sor. Eğer saat dilimi net ise, "Notunuzu aldım, belirttiğiniz saatte sizi arayabilmemiz için ekibimize ileteceğim." de.
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
======================================================\n`;

    const phaseContext = `\n\n=== SİSTEM DİREKTİFİ ===\nŞu anki konuşma evresi (Phase): ${phase.toUpperCase()}.\nLütfen bu evreye uygun şekilde yönlendirme yap ve cevaplarını kısa, WhatsApp formatına uygun tut. Uzun paragraflardan kaçın.\n========================`;
    
    // ═══ PHASE 2J: Time Intelligence Context ═══
    let timeContext = '';
    try {
      const patientCountry = unifiedContext?.opportunity?.country 
        || unifiedContext?.profile?.country 
        || null;
      const wh = brain.context.settings?.workingHours;
      const operatingHours = (wh && wh.enabled && wh.start && wh.end)
        ? { start: wh.start, end: wh.end }
        : null;
      timeContext = buildTimeContext(
        brain.context.config?.timezone || 'Europe/Istanbul',
        patientCountry,
        isHealthcare,
        operatingHours
      );
    } catch {
      // Non-fatal
    }

    // ═══ RANDEVU/ARAMA ONAY VE ZAMAN BAĞLAMI (Dinamik Enjeksiyon) ═══
    let confirmationContext = '';
    try {
      const activeTask = unifiedContext?.active_task;
      const taskMeta = activeTask?.metadata || {};
      
      const scheduled_for_utc = taskMeta.scheduled_for_utc || taskMeta.bot_suggestion?.proposed_date || null;
      const callback_time_tr = taskMeta.callback_time_tr || null;
      const patient_local_time = taskMeta.patient_local_time || null;
      const patient_timezone = taskMeta.patient_timezone || null;
      const needs_timezone_clarification = taskMeta.needs_timezone_clarification ?? false;
      const operation_window_valid = taskMeta.operation_window_valid ?? true;
      
      let task_type: 'phone_callback' | 'clinic_appointment' | null = null;
      if (activeTask?.task_type) {
        if (['callback_scheduled', 'call_patient'].includes(activeTask.task_type)) {
          task_type = 'phone_callback';
        } else if (['appointment_reminder', 'coordinator_review'].includes(activeTask.task_type)) {
          const titleLower = (activeTask.title || '').toLowerCase();
          if (titleLower.includes('randevu') || titleLower.includes('appointment') || titleLower.includes('hastane') || titleLower.includes('ziyaret') || activeTask.task_type === 'appointment_reminder') {
            task_type = 'clinic_appointment';
          }
        }
      }

      if (scheduled_for_utc || callback_time_tr) {
        const isCallback = task_type === 'phone_callback' || (!task_type && callback_time_tr);
        const resolvedTaskType = isCallback ? 'phone_callback' : 'clinic_appointment';
        const isConfirmed = taskMeta.time_confirmed_by_patient === true || taskMeta.confirmation_status === 'confirmed';
        const confirmationState = isConfirmed ? 'patient_confirmed_time' : 'patient_confirmed_time';

        if (unifiedContext?.isGreetingOnly) {
          confirmationContext = `\n\n=== ⏰ RANDEVU/ARAMA BAĞLAMI ===\n` + 
            `- Sistemde hastaya dair bekleyen bir ${resolvedTaskType} (tarih: ${callback_time_tr || scheduled_for_utc}) var.\n` + 
            `⚠️ DİKKAT: Hasta sadece selam verdi (greeting_only mode). Eski arama zamanını çok agresif veya uzun uzun detaylandırma. Sadece hastanın selamına karşılık ver ve "Daha önce planladığımız görüşmeyle ilgili yeni bir zaman belirlemek ister misiniz?" şeklinde yumuşakça sorarak son mesajına odaklan. Uzun bağlamla hastayı yorma.\n==================================================\n`;
        } else {
          confirmationContext = `\n\n=== ⏰ RANDEVU/ARAMA ONAY VE ZAMAN BAĞLAMI ===
Aşağıdaki saat/tarih bilgileri hasta ile bot/koordinatör arasında planlanan görüşme için netleşmiş zaman detaylarıdır:
- task_type: ${resolvedTaskType}
- confirmation_state: ${confirmationState}
- scheduled_for_utc: ${scheduled_for_utc || 'Bilinmiyor'}
- callback_time_tr: ${callback_time_tr || 'Bilinmiyor'}
- patient_local_time: ${patient_local_time || 'Bilinmiyor'}
- patient_timezone: ${patient_timezone || 'Bilinmiyor'}
- needs_timezone_clarification: ${needs_timezone_clarification}
- operation_window_valid: ${operation_window_valid}

⚠️ KRİTİK YANIT KURALLARI (ZAMAN NETLEŞTİĞİNDE):
1. Tarih/saat bilgisi yukarıdaki gibi netleştiğinde/teyit alındığında (hasta "uygunum", "tamam", "olur", "evet uygundur" gibi ifadelerle teyit ettiğinde veya teyit alınmış durumdaysa), ASLA aşağıdaki yasaklı belirsiz ifadeleri kullanma:
   - "kısa süre içinde"
   - "en kısa sürede"
   - "kısa zamanda"
   - "sizinle iletişime geçecektir"
   - "müsait olduğunda arayacaktır"
   - "ekibimiz size dönecektir"
   
2. Eğer net tarih/saat varsa mesajda mutlaka o tarih/saati de göster. Örnek format:
    “Harika, teyidinizi aldım.
   \${resolvedTaskType === 'phone_callback' ? 'Telefon görüşmesi' : 'Klinik randevusu/planlaması'} için belirttiğiniz zamanı ilgili koordinatör arkadaşımıza iletiyorum.
   
   Planlanan görüşme:
   Türkiye saatiyle: [Türkiye saati ve tarihi]` + (patient_local_time && patient_timezone && !needs_timezone_clarification ? `\nHasta saati: [Hasta yerel saati ve tarihi]` : '') + `
   
   Görüşme saatinde telefonunuzun ulaşılabilir olması yeterlidir. 🙏”

3. Telefon görüşmeleri / aramalar için sadece şu ifadeleri kullan: "Telefon görüşmesi", "arama", "ön görüşme".
4. Klinik randevuları / ziyaretleri için sadece şu ifadeleri kullan: "klinik randevu", "hastane ziyareti", "muayene planlaması".
5. Telefon görüşmesi (phone_callback) için asla "tedavi seçenekleri hakkında sizinle görüşmek üzere" gibi geniş/iddialı ifadeler kullanma. Güvenli ifade olarak şunu kullan:
   "Ön görüşme ve planlama için koordinatör arkadaşımıza iletiyorum."
==================================================\n`;
        }
      }
    } catch (e) {
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
        langContextText += `- UYARI: Hastaya ismiyle hitap etme, cinsiyetli veya resmi hitap sözcükleri (Bey, Hanım, Bay, Bayan, Sayın, M.r., M.s., M.r.s., D.e.a.r. vb.) KULLANMA. Mesajlarına isimsiz ve nötr bir selamlama ile başla (Örn: "Hello,", "Hallo,").\n`;
      }
      langContextText += `- UYARI: Bu dil talimatı sadece yanıt dilini belirler. Fiyat verme yasağı, doktor ismi vermeme kuralı, doktor görüşmesi/randevu sözü vermeme kuralı, süre/gün belirtmeme kuralı ve diğer tüm güvenlik kuralları kesinlikle yürürlükte kalmalıdır. Güvenlik kurallarını dil talimatı için ihlal etme.\n`;
      langContextText += `==============================\n`;
    }

    let directiveContext = '';
    if (unifiedContext?.active_task?.active_bot_directive) {
      directiveContext = `\n\n=== 🚨 DİREKT KOORDİNATÖR TALİMATI (İŞARETLİ BOTA DEVRET AKSİYONU) ===\n`;
      directiveContext += `Koordinatör bu görüşmeyi sana devretti ve özellikle şu talimatı verdi:\n`;
      directiveContext += `👉 "${unifiedContext.active_task.active_bot_directive}"\n`;
      directiveContext += `Bu talimatı kesinlikle uygula ve hastaya yanıtı bu doğrultuda yaz. Jenerik başlangıç yapma, doğrudan talimatın konusuna gir.\n`;
      directiveContext += `====================================================================\n`;
    }

    // ═══ IDENTITY & COUNTRY CONFIRMATION GATES (A1.8-3) ═══
    let confirmationDirective = '';
    try {
      if (unifiedContext) {
        const r = unifiedContext;
        
        // 1. Prepare PatientNameContext
        const nameCtx = {
          oppRequesterName: r.opportunity?.requester_name || null,
          oppPatientName: r.opportunity?.patient_name || null,
          formRawDataName: r.latestForm?.data ? (() => {
            try {
              const parsed = typeof r.latestForm.data === 'string' ? JSON.parse(r.latestForm.data) : r.latestForm.data;
              return parsed.full_name || parsed['full name'] || parsed['Full Name'] || null;
            } catch { return null; }
          })() : null,
          formPatientName: r.latestForm?.data?.full_name || null,
          convPatientName: r.conversation?.patient_name || r.conversation?.name || null,
          customerDisplayName: r.profile ? [r.profile.first_name, r.profile.last_name].filter(Boolean).join(' ') : null,
          whatsappProfileName: r.conversation?.wa_profile_name || null,
          phoneFallback: r.profile?.primary_phone || null,
          metadata: r.opportunity?.metadata || {}
        };

        const detailedName = resolvePatientNameDetailed(nameCtx);

        // 2. Prepare PatientCountryContext
        const formCountryVal = r.latestForm?.data ? (() => {
          try {
            const parsed = typeof r.latestForm.data === 'string' ? JSON.parse(r.latestForm.data) : r.latestForm.data;
            const countryKey = ['ulke', 'ülke', 'country', 'nerede_yaşıyorsunuz'].find(k => k in parsed);
            return countryKey ? parsed[countryKey] : null;
          } catch { return null; }
        })() : null;

        const detailedCountry = resolvePatientCountryDetailed({
          manualCountry: r.opportunity?.country || r.conversation?.country || null,
          formCountry: formCountryVal,
          phoneFallback: r.profile?.primary_phone || null,
          metadata: r.opportunity?.metadata || {}
        });

        // 3. Evaluate Guardrails
        const isHumanMode = r.conversation?.status === 'human';
        const nameLocked = r.opportunity?.metadata?.name_locked === true;
        const countryLocked = r.opportunity?.metadata?.country_locked === true;
        
        const userMessages = (r.history || [])
          .filter((m: any) => m.role === 'user')
          .slice(-3);

        const mentionsName = (text: string) => {
          const lower = text.toLowerCase();
          return ['adım', 'ismim', 'adımın', 'ismimin', 'benim adım', 'benim ismim', 'ben ...', 'adım ', 'ismim '].some(kw => lower.includes(kw));
        };

        const mentionsCountry = (text: string) => {
          const lower = text.toLowerCase();
          const countryKeywords = [
            'türkiye', 'turkiye', 'turkıye', 'almanya', 'germany', 'deutschland', 'fransa', 'france',
            'ingiltere', 'england', 'united kingdom', 'uk', 'hollanda', 'netherlands', 'belçika', 'belgium',
            'isviçre', 'switzerland', 'avusturya', 'austria', 'yaşıyorum', 'yasiyorum', 'yaşarım', 'yasarim',
            'ülkem', 'ulkem', 'ülke', 'ulke'
          ];
          return countryKeywords.some(kw => lower.includes(kw));
        };

        const patientGaveNameInLast3 = userMessages.some((m: any) => mentionsName(m.content));
        const patientGaveCountryInLast3 = userMessages.some((m: any) => mentionsCountry(m.content));

        const assistantMessages = (r.history || [])
          .filter((m: any) => m.role === 'assistant');

        const askedNameRecently = assistantMessages.some((m: any) => {
          const lower = m.content.toLowerCase();
          return ['adınız', 'isminiz', 'adınızı', 'isminizi', 'adını öğrenebilir'].some(kw => lower.includes(kw));
        });

        const askedCountryRecently = assistantMessages.some((m: any) => {
          const lower = m.content.toLowerCase();
          return ['yaşadığınız ülke', 'hangi ülkede', 'ülkenizi öğrenebilir', 'nerede yaşıyorsunuz'].some(kw => lower.includes(kw));
        });

        const isTerminalStage = ['lost', 'not_interested', 'arrived', 'terminal', 'not_qualified'].includes(r.opportunity?.stage || '');

        const hasOptOutKeyword = (r.history || []).some((m: any) => {
          if (m.role !== 'user') return false;
          const lower = m.content.toLowerCase();
          return ["opt-out", "istemiyorum", "rahatsız etmeyin", "listeden çıkar", "iptal", "stop", "mesaj atmayın", "üye olmak istemiyorum"].some(kw => lower.includes(kw));
        });

        // Resolve decision flags
        const shouldAskName = detailedName.nameConfirmationNeeded && !nameLocked && !patientGaveNameInLast3 && !askedNameRecently && !isTerminalStage && !hasOptOutKeyword && !isHumanMode;
        const shouldAskCountry = detailedCountry.countryConfirmationNeeded && !countryLocked && !patientGaveCountryInLast3 && !askedCountryRecently && !isTerminalStage && !hasOptOutKeyword && !isHumanMode;

        if (shouldAskName || shouldAskCountry) {
          confirmationDirective += `\n\n=== ⚠️ HASTA KİMLİK / ÜLKE BİLGİSİ DOĞRULAMA TALİMATI ===\n`;
          confirmationDirective += `Hastanın kayıtlarında eksik veya teyit edilmesi gereken bilgiler bulunmaktadır. Doğal konuşma akışında bu bilgileri hastadan talep etmelisin.\n`;

          if (shouldAskName && shouldAskCountry) {
            confirmationDirective += `- TALEP: Hem HASTA ADI hem de YAŞADIĞI ÜLKE eksik veya teyit gerekli. Doğal bir şekilde adını ve hangi ülkede yaşadığını sor.\n`;
            confirmationDirective += `- Örnek Doğal Cümle: "Size daha doğru yardımcı olabilmem için adınızı ve hangi ülkede yaşadığınızı öğrenebilir miyim?"\n`;
          } else if (shouldAskName) {
            confirmationDirective += `- TALEP: HASTA ADI eksik veya teyit gerekli. Doğal bir şekilde adını sor.\n`;
            confirmationDirective += `- Örnek Doğal Cümle: "Size daha doğru yardımcı olabilmem için adınızı öğrenebilir miyim?"\n`;
          } else if (shouldAskCountry) {
            confirmationDirective += `- TALEP: YAŞADIĞI ÜLKE eksik veya teyit gerekli. Doğal bir şekilde hangi ülkede yaşadığını sor.\n`;
            confirmationDirective += `- Örnek Doğal Cümle: "Size daha doğru yardımcı olabilmem için hangi ülkede yaşadığınızı öğrenebilir miyim?"\n`;
          }

          confirmationDirective += `⚠️ KRİTİK KURALLAR:\n`;
          confirmationDirective += `1. Eğer hasta tıbbi veya medikal bir soru sorduysa, kesinlikle doğrudan isim/ülke sorma. ÖNCE hastanın sorusuna kısa ve güven verici bir tıbbi yönlendirme cevabı ver, ARDINDAN isim/ülke bilgisini sor. (Örn: "Bu konuda sizi ilgili birime yönlendirebiliriz. Size doğru yardımcı olabilmemiz için adınızı ve hangi ülkede yaşadığınızı öğrenebilir miyim?")\n`;
          confirmationDirective += `2. Asla proaktif outbound/spam şeklinde sorma, sadece hasta zaten yazdıysa doğal bir yanıtın parçası olarak sor.\n`;
          confirmationDirective += `3. Robotik veya kalıp şeklinde ("Adınız nedir?", "Ülkenizi söyleyin") sorma. Cümlelerin kibar, kurumsal ve akıcı olsun.\n`;
          confirmationDirective += `=======================================================\n`;
        }
      }
    } catch (err) {
      // Non-fatal, prevent crashing during prompt build
    }

    return `${base}\n${crmContext}\n${healthcareOverlay}\n${knowledgeInjection}\n${timeContext}\n${confirmationContext}\n${phaseContext}\n${langContextText}\n${directiveContext}\n${confirmationDirective}\n${safetyGuardrails}`;
  }
}
