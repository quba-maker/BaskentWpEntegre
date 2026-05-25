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
        maxTokens: 600,
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
  "patient_name": "string (Hastanın GERÇEK adı. Konuşmada 'ismim Mustafa' veya 'ben Ali' gibi ifadelerden çıkar. Instagram/Facebook profil adı DEĞİL, hastanın söylediği gerçek isim. Emin değilsen boş bırak)",
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
  "requires_human_confirmation": boolean (Hasta randevu onayı, arama zamanı onayı, doktor randevusu gibi İNSAN ONAYI gerektiren bir talep belirttiyse true)
}

Pipeline Aşama Kuralları (sırayla ilerler, geri gitmez):
- "new": Hasta sadece form doldurmuş, henüz hiçbir iletişim yok.
- "contacted": Bot veya temsilci ilk mesajı göndermiş ama hasta henüz yanıt vermemiş.
- "responded": Hasta en az bir mesaj ile yanıt vermiş.
- "discovery": Hasta soru soruyor, bilgi alıyor, fiyat/tedavi detayı öğreniyor. Aktif görüşme var.
- "qualified": Hasta ciddi ilgi gösteriyor: tedavi istiyor, fiyat teklifi istedi, MR/rapor paylaştı veya gelmek istediğini belirtti.
- "appointed": Hasta randevu aldı, tarih belirlendi veya geliş planı kesinleşti.
- "lost": Hasta ilgilenmediğini belirtti, uzun süre yanıt vermedi veya başka yere gittiğini söyledi.

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

📞 CALLBACK / RANDEVU TARİH ÇÖZÜMLEME:
- "yarın" = bugün + 1 gün
- "bugün saat 3'te" = bugün 15:00
- "öğlen 2'de" = 14:00
- "pazartesi" = gelecek pazartesi
- "Haziran 20" veya "20 Haziran" = 2026-06-20 (yıl yoksa mevcut yılı kullan, geçmişte kalıyorsa gelecek yılı kullan)
- Timezone: Europe/Istanbul (+03:00)
- Emin değilsen requested_callback_datetime boş bırak

🚨 İNSAN ONAYI GEREKTİREN DURUMLAR (requires_human_confirmation = true):
- Hasta "randevumu onaylayın" / "randevu kesinleştirin" derse
- Hasta belirli bir saatte aranmak isterse
- Hasta doktor randevusu talep ederse
- Hasta ameliyat/işlem tarihi belirlenmesini isterse
- Bot kendi başına kesinleştiremeyeceği herhangi bir aksiyon talep edilirse

Önemli Kurallar:
- Eğer mevcut aşama belirlenemiyorsa "new" döndür.
- Pipeline sadece İLERİ gider: appointed veya lost olan bir hasta discovery'ye geri dönemez.
- Departman: Yalnızca kullanıcının sorusuna veya ihtiyacına göre belirle. Kanıt yoksa boş bırak.
- should_create_opportunity: Emin değilsen false döndür. Yanlış pozitif, yanlış negatiften daha kötüdür.`
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

      this.log.info(`[CRM_EXTRACTION_RAW] Raw LLM output (first 500 chars)`, { traceId, raw: jsonText.substring(0, 500) });

      // Clean markdown block if model ignored strict json instruction
      if (jsonText.startsWith('\`\`\`json')) {
        jsonText = jsonText.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
      } else if (jsonText.startsWith('\`\`\`')) {
        jsonText = jsonText.replace(/\`\`\`/g, '').trim();
      }

      const parsedObj = JSON.parse(jsonText);
      const validatedData = CrmExtractionSchema.parse(parsedObj);

      this.log.info(`[CRM_EXTRACTION_SUCCESS] CRM intelligence applied`, { 
        traceId, 
        country: validatedData.country,
        department: validatedData.department,
        stage: validatedData.pipeline_stage,
        callbackTime: validatedData.requested_callback_datetime,
        travelDate: validatedData.travel_date,
        requiresConfirmation: validatedData.requires_human_confirmation
      });

      return validatedData;

    } catch (e: any) {
      this.log.error(`[CRM_EXTRACTION_FAILED] Error: ${e.message} | Name: ${e.name} | Stack: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`, undefined, { traceId });
      return null;
    }
  }
}

export const crmExtractorService = new CRMExtractorService();
