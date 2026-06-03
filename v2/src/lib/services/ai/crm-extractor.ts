import { z } from "zod";
import { logger } from "@/lib/core/logger";
import { AIOrchestrator, ChatMessage } from "./orchestrator";

// 1. Output Contract
export const CrmExtractionSchema = z.object({
  patient_name: z.string().optional(),
  language: z.string().optional(),
  country: z.string().optional(),
  country_confidence: z.number().min(0).max(1).optional(),
  department: z.string().optional(),
  pipeline_stage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  needs_country_question: z.boolean().optional(),
  needs_name_question: z.boolean().optional(),
  suggested_questions: z.array(z.string()).optional(),
  // Opportunity Detection Fields
  should_create_opportunity: z.boolean().optional(),
  should_update_existing_opportunity: z.boolean().optional(),
  opportunity_priority: z.enum(['cold', 'warm', 'hot']).optional(),
  intent_type: z.string().optional(),
  next_best_action: z.string().optional(),
  follow_up_hours: z.number().optional(),
  opportunity_reason: z.string().optional(),
  // P0B: Semantic Quality Fields
  requested_callback_datetime: z.string().optional(),
  travel_date: z.string().optional(),
  report_status: z.enum(['none', 'waiting', 'sent', 'received', 'reviewed']).optional(),
  requires_human_confirmation: z.boolean().optional(),
  appointment_confirmed: z.boolean().optional(),
  // P1A-FIX: Explicit Cancellation / Opt-Out Detection
  explicit_cancellation: z.boolean().optional(),
  opt_out_requested: z.boolean().optional(),
  cancellation_reason: z.string().optional(),
  should_stop_follow_up: z.boolean().optional(),
  // P1B: Identity & Boundary Detection
  requester_name: z.string().optional(),
  patient_relation: z.string().optional(),
  new_identity_detected: z.boolean().optional(),
  reset_conversation_requested: z.boolean().optional(),
  data_deletion_request: z.boolean().optional(),
  different_department_detected: z.boolean().optional(),
  raw_department: z.string().optional(),
  // Timezone and callback scheduling intelligence
  patient_city: z.string().optional(),
  patient_timezone: z.string().optional(),
  timezone_source: z.enum(['patient_city', 'country', 'manual_confirmed', 'unknown']).optional(),
  time_confirmed_by_patient: z.boolean().optional(),
  needs_timezone_clarification: z.boolean().optional(),
});

export type CrmExtractionType = z.infer<typeof CrmExtractionSchema>;

/**
 * 🧠 CRM Intelligence Extraction Layer
 * Runs asynchronously to extract identity and intent information from conversations
 * without blocking message delivery.
 */
export class CRMExtractorService {
  private log = logger.withContext({ module: 'CRMExtractor' });
  private orchestrator = new AIOrchestrator();

  public async extract(
    history: ChatMessage[],
    tenantConfig: any,
    traceId: string
  ): Promise<CrmExtractionType | null> {
    try {
      this.log.info(`[CRM_EXTRACTION] Starting async intelligence extraction`, { traceId });

      // Fallback to standard provider
      const llmProvider = tenantConfig?.raw?.llm_provider || 'gemini';
      const llmModel = tenantConfig?.raw?.llm_model || 'gemini-2.5-flash';
      const apiKey = tenantConfig?.raw?.gemini_api_key || process.env.GEMINI_API_KEY || '';

      const aiConfig = {
        provider: llmProvider as 'gemini' | 'openai',
        modelId: llmModel,
        apiKey: apiKey,
        temperature: 0.1, // Düşük temperature, deterministik çıktı için
        maxTokens: 8000, // Increased to 8000 to accommodate reasoning/thinking tokens
        responseFormat: 'json' as const
      };

      // Current datetime for AI date parsing context
      const nowIstanbul = new Date().toLocaleString('tr-TR', { 
        timeZone: 'Europe/Istanbul', 
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'long'
      });
      const nowISO = new Date().toISOString();

      const systemPrompt: ChatMessage = {
        role: 'system',
        content: `Sen bir Enterprise CRM Intelligence Engine'sin.
Görevin, aşağıdaki hasta-temsilci (veya bot) görüşmesini analiz ederek yapılandırılmış JSON çıktısı üretmektir.
KESİNLİKLE markdown veya extra metin KULLANMA. SADECE GEÇERLİ JSON DÖNDÜR.

📅 ŞU ANKİ TARİH VE SAAT: ${nowIstanbul} (${nowISO})
Bu bilgiyi "yarın", "bugün", "gelecek hafta", "Haziran 20" gibi ifadeleri ISO tarihine çevirirken kullan.

Format:
{
  "patient_name": "string (Hastanın GERÇEK adı. Konuşmada 'ismim Mustafa' veya 'ben Ali' gibi ifadelerden çıkar. Instagram/Facebook profil adı DEĞİL. ASLA şehir isimlerini (örn: Konya, konyaya, Ankara, İstanbul), yer adlarını, genel hitapları (örn: selam, merhaba, nasılsınız), fiilleri veya edatları isim olarak çıkarma. SADECE gerçek şahıs adlarını çıkar. Emin değilsen boş bırak)",
  "language": "string (örn: German, English, Turkish)",
  "country": "string (Hastanın yaşadığı ülke — Türkçe olarak yaz. Örn: Almanya, Türkiye, İngiltere. Emin değilsen boş bırak)",
  "country_confidence": number (0.0 ile 1.0 arası),
  "department": "string (Örn: Ortopedi, Kardiyoloji, Gastroenteroloji, Estetik, Diş, Göz, Tüp Bebek, Organ Nakli, Onkoloji, Obezite, Nöroloji, Üroloji, Check-Up. Hastanın niyetine göre seç. Emin değilsen boş bırak)",
  "pipeline_stage": "string (new | contacted | responded | discovery | qualified | appointed | lost)",
  "tags": ["string"] (Örn: yurtdışı_hasta, acil, fiyat_odaklı, ilgili vb. tamamen TÜRKÇE, küçük harflerle ve boşluk yerine alt çizgi kullanarak),
  "needs_country_question": boolean (Eğer hastanın ülkesi belirsizse ve randevu için lazımsa true),
  "needs_name_question": boolean (Eğer isim bilinmiyorsa true),

  "should_create_opportunity": boolean,
  "opportunity_priority": "cold" | "warm" | "hot",
  "intent_type": "string (appointment_request | call_request | report_sent | report_waiting | price_inquiry | travel_planning | doctor_review | general_info | follow_up_needed)",
  "next_best_action": "string (call_patient | send_info | request_report | doctor_review | send_offer | plan_appointment | follow_up | coordinator_confirm_call | coordinator_confirm_appointment)",
  "follow_up_hours": number (önerilen takip süresi, saat olarak. Örn: 4, 24, 48, 72, 168),
  "opportunity_reason": "string (neden opportunity açılmalı — kısa açıklama)",

  "requested_callback_datetime": "string ISO 8601 (Hasta 'yarın 14:00'te arayın' derse → '2026-05-26T14:00:00+03:00'. Spesifik zaman belirtilmemişse boş bırak. Timezone Europe/Istanbul (+03:00) varsay)",
  "travel_date": "string ISO date (Hasta 'Haziran 20'de geleceğim' derse → '2026-06-20'. Kesin tarih yoksa boş bırak)",
  "report_status": "none | waiting | sent | received | reviewed (Hastanın rapor/tetkik durumu: henüz yok, göndereceğini söylüyor, gönderdi, alındı, doktor inceledi)",
  "requires_human_confirmation": boolean (Hasta randevu onayı, arama zamanı onayı, doktor randevusu gibi İNSAN ONAYI gerektiren bir talep belirttiyse true),
  "appointment_confirmed": boolean (Hasta randevusunu, telefon görüşmesi gün/saatini onayladığını veya teyit ettiğini belirttiyse true. Örn: 'onaylıyorum', 'uygundur', 'teyit ediyorum', 'telefon randevumu onaylıyorum'. Yoksa false veya boş bırakın),

  "explicit_cancellation": boolean (Hasta AÇIKÇA gelmeyeceğini, vazgeçtiğini, iptal istediğini belirttiyse true. Örn: 'gelmeyeceğim', 'vazgeçtim', 'istemiyorum', 'iptal edin', 'randevuyu iptal edin', 'gelmekten vazgeçtik'. 'Şimdilik düşünmüyorum' gibi belirsiz ifadeler İÇİN FALSE — sadece kesin beyanlar),
  "opt_out_requested": boolean (Hasta aranmamak/mesaj almamak istiyorsa true. Örn: 'aramayın', 'beni bir daha aramayın', 'rahatsız etmeyin', 'mesaj atmayın', 'görüşmek istemiyorum'),
  "cancellation_reason": "string (İptal/vazgeçme sebebi. Hasta söylediyse yazılır. Örn: 'başka hastaneye gitti', 'maddi nedenler', 'gelmekten vazgeçti'. Yoksa boş bırak)",
  "should_stop_follow_up": boolean (true ise tüm otomatik takip durdurulmalı. explicit_cancellation veya opt_out_requested true ise bu da true olmalı),

  "requester_name": "string (Başvuran kişinin gerçek adı. 'ismim Mustafa', 'ben Mehmet' gibi ifadelerden çıkar. ASLA şehir isimlerini, yer adlarını, hitapları veya edatları çıkarma. SADECE gerçek şahıs adlarını çıkar. Emin değilsen boş bırak)",
  "patient_relation": "string (Başvuran kişinin hasta ile ilişkisi. Örn: 'kendisi', 'anne', 'baba', 'eş', 'kardeş', 'çocuk'. 'annem için', 'babam için' gibi ifadelerden çıkar. Yoksa boş bırak)",
  "new_identity_detected": boolean (Konuşmada daha önce farklı bir kişi konuşuyorken ŞİMDİ yeni/farklı bir kişi konuşmaya başladıysa true. Örn: önceki mesajlarda Mustafa konuşuyordu, şimdi 'ben Mehmet' diyen biri geldi. İLK mesaj veya aynı kişi devam ediyorsa FALSE),
  "reset_conversation_requested": boolean (Kullanıcı açıkça 'baştan başlayalım', 'sıfırdan başlayalım', 'yeni talep' gibi ifade kullandıysa true),
  "data_deletion_request": boolean (Kullanıcı açıkça 'bilgilerimi sil', 'beni unut', 'verilerimi sil', 'kaydımı sil' gibi GDPR/KVKK talebi belirttiyse true),
  "different_department_detected": boolean (Mevcut görüşme bağlamından FARKLI bir departman/tedavi talebi tespit edildiyse true. Örn: görüşme Kardiyoloji iken 'saç ekimi için bilgi almak istiyorum' dendi. AYNI departman devam ediyorsa false. İLK mesajda departman belirtiliyorsa false — çünkü henüz 'farklı' olacak bir önceki yok),
  "raw_department": "string (Kullanıcının söylediği ham departman/tedavi ifadesi. Normalizasyon YAPMA. Örn: 'saç ekimi', 'kalp ameliyatı', 'diş beyazlatma'. Boş bırakılabilir)",
  "patient_city": "string (Hastanın YAŞADIĞI veya ŞU AN BULUNDUĞU şehir/eyalet. Örn: 'Miami', 'Berlin', 'Köln'. DİKKAT: Hastanın gelmek istediği şehir, hastanenin bulunduğu şehir veya 'Konya'ya gelebilirim / İstanbul'a geleceğim' gibi HEDEF/SEYAHAT şehirleri patient_city DEĞİLDİR. Yoksa boş bırak)",
  "patient_timezone": "string (Hastanın şehrine/saat dilimine göre geçerli IANA saat dilimi adı. Örn: 'America/New_York', 'Europe/Berlin', 'Europe/London'. Emin değilsen boş bırak)",
  "timezone_source": "string ('patient_city' | 'country' | 'manual_confirmed' | 'unknown' — Saat diliminin kaynağı. Şehir biliniyorsa 'patient_city', sadece ülkeye göre belirlendiyse 'country', hasta onayladıysa 'manual_confirmed', belirsizse 'unknown')",
  "time_confirmed_by_patient": boolean (Hasta randevu saatini açıkça teyit edip onayladıysa true. Örn: 'uygundur', 'teyit ediyorum', 'o saatte arayın'. Teyit etmediyse veya henüz teyit edilmemiş bir öneriyse false),
  "needs_timezone_clarification": boolean (SADECE hasta ile arama/randevu/görüşme zamanı planlanıyorsa VE hasta çoklu saat dilimli bir ülkedeyse true döndür. Hasta sadece bilgi, fiyat, tedavi süreci veya genel soru soruyorsa şehir/eyalet eksik diye true DÖNDÜRME.)
}

Pipeline Aşama Kuralları (sırayla ilerler, geri gitmez):
- "new": Hasta sadece form doldurmuş, henüz hiçbir iletişim yok.
- "contacted": Bot veya temsilci ilk mesajı göndermiş ama hasta henüz yanıt vermemiş.
- "responded": Hasta en az bir mesaj ile yanıt vermiş.
- "discovery": Hasta soru soruyor, bilgi alıyor, fiyat/tedavi detayı öğreniyor. Aktif görüşme var.
- "qualified": Hasta ciddi ilgi gösteriyor: tedavi istiyor, fiyat teklifi istedi, MR/rapor paylaştı veya gelmek istediğini belirtti.
- "appointed": Hasta randevu aldı, tarih belirlendi veya geliş planı kesinleşti.
- "lost": Hasta ilgilenmediğini belirtti, uzun süre yanıt vermedi veya başka yere gittiğini söyledi.

🚫 AÇIK İPTAL / OPT-OUT TESPİTİ (KRİTİK):
- Eğer hasta AÇIKÇA "gelmeyeceğim", "vazgeçtim", "istemiyorum", "iptal edin", "aramayın", "rahatsız etmeyin" gibi ifadeler kullanıyorsa:
  → explicit_cancellation = true
  → pipeline_stage = "lost"
  → should_stop_follow_up = true
  → opportunity_priority = "cold"
- Eğer hasta "aramayın", "beni bir daha aramayın", "mesaj atmayın" diyorsa:
  → opt_out_requested = true (ek olarak)
- DİKKAT: "Şimdilik düşünmüyorum", "Bir düşüneyim", "Sonra bakarız" gibi belirsiz ifadeler İPTAL DEĞİLDİR. Bu durumda explicit_cancellation = false.

🔥 FIRSAT TESPİT KURALLARI (should_create_opportunity):
- should_create_opportunity = TRUE eğer:
  • Hasta randevu istiyorsa (appointment_request)
  • Hasta aranmasını istiyorsa (call_request)
  • Hasta rapor gönderdi veya göndereceğini söylüyorsa (report_sent, report_waiting)
  • Hasta fiyat soruyorsa (price_inquiry)
  • Hasta gelmek istediğini belirtiyorsa (travel_planning)
  • Hasta doktor incelemesi istiyorsa (doctor_review)
  • Hasta departman/tedavi hakkında detaylı soru soruyorsa (general_info)

- should_create_opportunity = FALSE eğer:
  • Hasta sadece "merhaba", "selam", "hi" yazdıysa
  • Sadece emoji, sticker, tepki gönderiyorsa
  • Fan mesajı ("harika", "güzel sayfa", "👏")
  • Spam veya alakasız mesaj
  • Hasta zaten ilgisini kaybettiğini belirttiyse

- priority:
  • HOT: Randevu istedi, rapor gönderdi, gelmek istiyor, tarih soruyor, aranmasını istiyor
  • WARM: Fiyat soruyor, bilgi alıyor, tedavi seçeneklerini araştırıyor
  • COLD: Genel soru, henüz net niyet yok ama potansiyel var

📞 CALLBACK / RANDEVU TARİH VE SAAT DİLİMİ ÇÖZÜMLEME:
- "yarın" = bugün + 1 gün
- "bugün saat 3'te" = bugün 15:00
- "öğlen 2'de" = 14:00
- "pazartesi" = gelecek pazartesi
- "Haziran 20" veya "20 Haziran" = 2026-06-20 (yıl yoksa mevcut yılı kullan, geçmişte kalıyorsa gelecek yılı kullan)
- Timezone Yorumlama Kuralları:
  1. HASTA YEREL SAATİ ("bana/bize göre"): Hasta "bize göre olsun", "bizim saate göre", "buradaki saate göre", "benim saatime göre", "buradaki saatle", "local time" gibi ifadeler kullanırsa bunu HASTANIN YEREL SAATİ olarak yorumla.
     - Eğer hastanın ülkesi/şehri biliniyorsa, requested_callback_datetime değerini hastanın kendi yerel saatine göre hesaplayıp Türkiye saatine (+03:00) dönüştürerek yaz.
     - Eğer hastanın ülkesi belirsizse veya birden fazla saat dilimi olan (ABD, Kanada, Rusya gibi) bir ülkede olup şehir belirtmediyse, requested_callback_datetime değerini boş veya tahmini bırak, "needs_timezone_clarification" = true ve "timezone_source" = "unknown" set et.
  2. TÜRKİYE SAATİ ("sizin saate göre"): Hasta "sizin saate göre", "Türkiye saatiyle", "hastane saatine göre", "Konya saatine göre", "sizin oranın saatine göre" derse bunu TÜRKİYE SAATİ (Europe/Istanbul, +03:00) olarak yorumla.
- Emin değilsen requested_callback_datetime boş bırak.
- patient_city: Konuşmada şehir adı geçtiyse yaz (Örn: "Houston", "Berlin").
- patient_timezone: Şehir/eyalet biliniyorsa IANA formatında yaz (Örn: "America/New_York", "Europe/Berlin"). Yoksa boş bırak.
- timezone_source: Şehir veya timezone LLM tarafından başarıyla çözümlendiyse "patient_city", sadece ülkeye göre belirlendiyse "country", belirsizse "unknown".
- time_confirmed_by_patient: Hasta sunulan saati kesin onayladıysa true.
- needs_timezone_clarification: Hasta timezone-belirsiz bir ülkede (ABD, Kanada, Rusya vb.) olduğunu söyledi ama şehir belirtmediyse veya "benim saatime göre" deyip konumu bilinmiyorsa true.

🚨 İNSAN ONAYI GEREKTİREN DURUMLAR (requires_human_confirmation = true):
- Hasta "randevumu onaylayın" / "randevu kesinleştirin" derse
- Hasta belirli bir saatte aranmak isterse
- Hasta doktor randevusu talep ederse
- Hasta ameliyat/işlem tarihi belirlenmesini isterse
- Bot kendi başına kesinleştiremeyeceği herhangi bir aksiyon talep edilirse

🎯 AÇIK GÜNCELLEME MESAJLARI (KRİTİK):
- Eğer kullanıcı açıkça "ülke X", "bölüm Y", "departman Z" diyorsa, country ve department alanlarını MUTLAKA X/Y/Z olarak doldur.
- Bu bir düzeltme mesajı ise önceki değerleri güncelle.
- Örnek: "Ülke İngiltere, bölüm Onkoloji" → country: "İngiltere", department: "Onkoloji"
- Örnek: "Portekiz'den geliyoruz, Kardiyoloji bölümü" → country: "Portekiz", department: "Kardiyoloji"
- Bu durumda country_confidence = 1.0 olmalı.
- Bu tür açık bildirimler varsa should_create_opportunity = true, should_update_existing_opportunity = true olmalı.

Önemli Kurallar:
- Eğer mevcut aşama belirlenemiyorsa "new" döndür.
- Pipeline sadece İLERİ gider: appointed veya lost olan bir hasta discovery'ye geri dönemez.
- Departman: Yalnızca kullanıcının sorusuna veya ihtiyacına göre belirle. Kanıt yoksa boş bırak.
- should_create_opportunity: Emin değilsen false döndür. Yanlış pozitif, yanlış negatiften daha kötüdür.

🆔 KİMLİK TESPİTİ (P1B — KRİTİK):
- requester_name: Konuşmada 'ismim X', 'ben X', 'adım X' diyorsa → requester_name = X. patient_name ile aynı kişi olabilir.
- patient_relation: 'annem için', 'babam için', 'eşim için' → patient_relation = anne/baba/eş. Kendisi için geliyorsa 'kendisi'.
- new_identity_detected: SADECE önceki mesajlarda farklı biri konuşuyorken şimdi yeni biri geldiyse true. İlk mesaj veya aynı kişi devam ediyorsa FALSE.
- DİKKAT (HALÜSİNASYON ENGELİ): ASLA şehir isimlerini (Konya, konyaya, Ankara, İstanbul, Almanya, Türkiye vb.), yer adlarını, edatları veya hitap ifadelerini isim (patient_name, requester_name) olarak çıkarma! "ben konyaya nasıl gelecem" cümlesinden "Konyaya" ismini çıkarma; burada isim yoktur.
- Örnek: Önceki mesajlarda "Mustafa" konuşuyor, şimdi "ben Mehmet, saç ekimi için bilgi almak istiyorum" → new_identity_detected = true

🔄 OPPORTUNITY BOUNDARY DETECTION (ÇOK ÖNEMLİ):
- different_department_detected: Mevcut görüşme bağlamı Kardiyoloji iken "saç ekimi" talep ediliyorsa true.
  • İLK mesajda departman belirtilmesi = false (önceki bağlam yok)
  • Aynı departman devam ediyorsa = false
  • "ülke Almanya olacak" gibi DÜZELTME mesajları = false (country correction, yeni opportunity DEĞİL)
- reset_conversation_requested: "baştan başlayalım", "sıfırdan başlayalım" → true. "tekrar bilgi alabilir miyim" = false.
- data_deletion_request: "bilgilerimi sil", "beni unut", "verilerimi sil", "kaydımı sil" → true. Sadece KVKK/GDPR açık talepleri.

📋 DEPARTMAN NORMALİZASYON:
- raw_department: Hastanın söylediği HAM ifade. Örn: "saç ekimi", "kalp ameliyatı", "diş beyazlatma"
- department: Normalize edilmiş departman. Örn: "saç ekimi" → "Saç Ekimi", "kalp ameliyatı" → "Kardiyoloji"
- Her iki alan da doldurulmalı. raw_department birebir kullanıcının sözü, department sistem standardı.`
      };

      // Filter out original system prompts to avoid confusing the extraction model
      let userHistory = history.filter(m => m.role !== 'system');
      
      // ═══ SAFEGUARD: Trim to last 8 messages to prevent context window overflow ═══
      if (userHistory.length > 8) {
        this.log.info(`[CRM_EXTRACTION] Trimming history from ${userHistory.length} to 8 messages`, { traceId });
        userHistory = userHistory.slice(-8);
      }
      
      this.log.info(`[CRM_EXTRACTION] Sending ${userHistory.length} messages to extraction model`, { traceId });
      
      const aiPromise = this.orchestrator.generateResponse(
        [systemPrompt, ...userHistory],
        aiConfig
      );

      // Timeout for safety - do not block operations forever
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("EXTRACTION_TIMEOUT")), 15000)
      );

      const aiResponse = await Promise.race([aiPromise, timeoutPromise]);
      let jsonText = aiResponse.text;

      this.log.info(`[CRM_EXTRACTION_RAW] Raw LLM output (first 800 chars)`, { traceId, raw: jsonText.substring(0, 800) });

      // Clean markdown block if model ignored strict json instruction
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```/g, '').trim();
      }
      
      // Trim any trailing whitespace or incomplete content
      jsonText = jsonText.trim();

      let parsedObj: any;
      try {
        parsedObj = JSON.parse(jsonText);
      } catch (parseErr: any) {
        // JSON repair attempt: try to close unclosed braces/brackets
        this.log.warn(`[CRM_JSON_REPAIR] Initial parse failed, attempting repair`, { traceId, error: parseErr.message, rawLength: jsonText.length });
        
        // Remove trailing incomplete key-value pairs and close the object
        let repaired = jsonText;
        // Remove trailing comma and whitespace
        repaired = repaired.replace(/,\s*$/, '');
        // If doesn't end with }, try to close it
        if (!repaired.endsWith('}')) {
          // Find the last complete key-value pair
          const lastCompleteComma = repaired.lastIndexOf(',');
          const lastCompleteBrace = repaired.lastIndexOf('}');
          if (lastCompleteComma > lastCompleteBrace) {
            repaired = repaired.substring(0, lastCompleteComma);
          }
          // Remove any trailing partial values (incomplete strings etc)
          repaired = repaired.replace(/,?\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
          repaired += '}';
        }
        
        try {
          parsedObj = JSON.parse(repaired);
          this.log.info(`[CRM_JSON_REPAIRED] Successfully repaired truncated JSON`, { traceId });
        } catch {
          // Final fallback: capture raw output in error
          throw new Error(`JSON_PARSE_FAILED: ${parseErr.message} | raw_start: ${jsonText.substring(0, 200)}`);
        }
      }
      
      
      // Use safeParse to avoid losing the entire extraction on minor type mismatches
      // (e.g. LLM returns follow_up_hours as string "24" instead of number 24)
      const safeResult = CrmExtractionSchema.safeParse(parsedObj);
      
      let validatedData: CrmExtractionType;
      if (safeResult.success) {
        validatedData = safeResult.data;
      } else {
        // Partial recovery: strip invalid fields, keep valid ones
        this.log.warn(`[CRM_ZOD_PARTIAL] Zod validation partial failure, recovering valid fields`, {
          traceId,
          errors: safeResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
        
        // Manual recovery: coerce known problematic fields
        const coerced = { ...parsedObj };
        if (typeof coerced.follow_up_hours === 'string') {
          coerced.follow_up_hours = parseInt(coerced.follow_up_hours, 10) || undefined;
        }
        if (typeof coerced.country_confidence === 'string') {
          coerced.country_confidence = parseFloat(coerced.country_confidence) || undefined;
        }
        // Nulls → undefined for optional string fields
        for (const key of ['opportunity_reason', 'requested_callback_datetime', 'travel_date', 'cancellation_reason', 'requester_name', 'patient_relation', 'raw_department', 'patient_city', 'patient_timezone', 'timezone_source']) {
          if (coerced[key] === null) coerced[key] = undefined;
        }
        
        // Retry with coerced values
        const retryResult = CrmExtractionSchema.safeParse(coerced);
        if (retryResult.success) {
          validatedData = retryResult.data;
          this.log.info(`[CRM_ZOD_RECOVERED] Coerced types recovered extraction`, { traceId });
        } else {
          // Last resort: pick only known-valid fields manually
          validatedData = {
            patient_name: typeof parsedObj.patient_name === 'string' ? parsedObj.patient_name : undefined,
            country: typeof parsedObj.country === 'string' ? parsedObj.country : undefined,
            department: typeof parsedObj.department === 'string' ? parsedObj.department : undefined,
            pipeline_stage: typeof parsedObj.pipeline_stage === 'string' ? parsedObj.pipeline_stage : undefined,
            tags: Array.isArray(parsedObj.tags) ? parsedObj.tags : undefined,
            explicit_cancellation: typeof parsedObj.explicit_cancellation === 'boolean' ? parsedObj.explicit_cancellation : undefined,
            opt_out_requested: typeof parsedObj.opt_out_requested === 'boolean' ? parsedObj.opt_out_requested : undefined,
            cancellation_reason: typeof parsedObj.cancellation_reason === 'string' ? parsedObj.cancellation_reason : undefined,
            should_stop_follow_up: typeof parsedObj.should_stop_follow_up === 'boolean' ? parsedObj.should_stop_follow_up : undefined,
            opportunity_priority: ['cold', 'warm', 'hot'].includes(parsedObj.opportunity_priority) ? parsedObj.opportunity_priority : undefined,
            intent_type: typeof parsedObj.intent_type === 'string' ? parsedObj.intent_type : undefined,
            should_create_opportunity: typeof parsedObj.should_create_opportunity === 'boolean' ? parsedObj.should_create_opportunity : undefined,
            // P1B: Identity & Boundary fields
            requester_name: typeof parsedObj.requester_name === 'string' ? parsedObj.requester_name : undefined,
            patient_relation: typeof parsedObj.patient_relation === 'string' ? parsedObj.patient_relation : undefined,
            new_identity_detected: typeof parsedObj.new_identity_detected === 'boolean' ? parsedObj.new_identity_detected : undefined,
            reset_conversation_requested: typeof parsedObj.reset_conversation_requested === 'boolean' ? parsedObj.reset_conversation_requested : undefined,
            data_deletion_request: typeof parsedObj.data_deletion_request === 'boolean' ? parsedObj.data_deletion_request : undefined,
            different_department_detected: typeof parsedObj.different_department_detected === 'boolean' ? parsedObj.different_department_detected : undefined,
            raw_department: typeof parsedObj.raw_department === 'string' ? parsedObj.raw_department : undefined,
            // Callback & Timezone
            patient_city: typeof parsedObj.patient_city === 'string' ? parsedObj.patient_city : undefined,
            patient_timezone: typeof parsedObj.patient_timezone === 'string' ? parsedObj.patient_timezone : undefined,
            timezone_source: ['patient_city', 'country', 'manual_confirmed', 'unknown'].includes(parsedObj.timezone_source) ? parsedObj.timezone_source : undefined,
            time_confirmed_by_patient: typeof parsedObj.time_confirmed_by_patient === 'boolean' ? parsedObj.time_confirmed_by_patient : undefined,
            needs_timezone_clarification: typeof parsedObj.needs_timezone_clarification === 'boolean' ? parsedObj.needs_timezone_clarification : undefined,
          } as CrmExtractionType;
          this.log.warn(`[CRM_ZOD_MANUAL_RECOVERY] Manual field extraction as last resort`, { traceId });
        }
      }

      this.log.info(`[CRM_EXTRACTION_SUCCESS] CRM intelligence applied`, { 
        traceId, 
        country: validatedData.country,
        department: validatedData.department,
        stage: validatedData.pipeline_stage,
        explicitCancellation: validatedData.explicit_cancellation,
        callbackTime: validatedData.requested_callback_datetime,
        travelDate: validatedData.travel_date,
        requiresConfirmation: validatedData.requires_human_confirmation,
        // P1B
        requesterName: validatedData.requester_name,
        patientRelation: validatedData.patient_relation,
        newIdentity: validatedData.new_identity_detected,
        resetRequested: validatedData.reset_conversation_requested,
        deletionRequest: validatedData.data_deletion_request,
        differentDept: validatedData.different_department_detected,
        rawDepartment: validatedData.raw_department,
      });

      return validatedData;

    } catch (e: any) {
      const errorInfo = {
        message: e.message?.substring(0, 500) || 'unknown',
        name: e.name || 'Error',
        isTimeout: e.message === 'EXTRACTION_TIMEOUT',
      };
      this.log.error(`[CRM_EXTRACTION_FAILED] Error: ${errorInfo.message} | Name: ${errorInfo.name}`, undefined, { traceId });
      // Store error info on the return so caller can log it
      return { _extractionError: errorInfo } as any;
    }
  }
}

export const crmExtractorService = new CRMExtractorService();
