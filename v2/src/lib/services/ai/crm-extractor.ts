import { z } from "zod";
import { logger } from "@/lib/core/logger";
import { AIOrchestrator, ChatMessage } from "./orchestrator";

// 1. Output Contract
export const CrmExtractionSchema = z.object({
  language: z.string().optional(),
  country: z.string().optional(),
  country_confidence: z.number().min(0).max(1).optional(),
  department: z.string().optional(),
  pipeline_stage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  needs_country_question: z.boolean().optional(),
  needs_name_question: z.boolean().optional(),
  suggested_questions: z.array(z.string()).optional()
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
        maxTokens: 500,
        responseFormat: 'json' as const
      };

      const systemPrompt: ChatMessage = {
        role: 'system',
        content: `Sen bir Enterprise CRM Intelligence Engine'sin.
Görevin, aşağıdaki hasta-temsilci (veya bot) görüşmesini analiz ederek yapılandırılmış JSON çıktısı üretmektir.
KESİNLİKLE markdown veya extra metin KULLANMA. SADECE GEÇERLİ JSON DÖNDÜR.

Format:
{
  "language": "string (örn: German, English, Turkish)",
  "country": "string (Tahmin edilen ülke. Örn: Germany, UK. Emin değilsen boş bırak)",
  "country_confidence": number (0.0 ile 1.0 arası),
  "department": "string (Örn: Ortopedi, Kardiyoloji, Estetik, Diş, Göz, Tüp Bebek, Organ Nakli, Onkoloji, Obezite, Nöroloji, Üroloji, Check-Up. Hastanın niyetine göre seç. Emin değilsen boş bırak)",
  "pipeline_stage": "string (new | contacted | responded | discovery | qualified | appointed | lost)",
  "tags": ["string"] (Örn: yurtdışı_hasta, acil, fiyat_odaklı, ilgili vb. tamamen TÜRKÇE, küçük harflerle ve boşluk yerine alt çizgi kullanarak),
  "needs_country_question": boolean (Eğer hastanın ülkesi belirsizse ve randevu için lazımsa true),
  "needs_name_question": boolean (Eğer isim bilinmiyorsa true)
}

Pipeline Aşama Kuralları (sırayla ilerler, geri gitmez):
- "new": Hasta sadece form doldurmuş, henüz hiçbir iletişim yok.
- "contacted": Bot veya temsilci ilk mesajı göndermiş ama hasta henüz yanıt vermemiş.
- "responded": Hasta en az bir mesaj ile yanıt vermiş.
- "discovery": Hasta soru soruyor, bilgi alıyor, fiyat/tedavi detayı öğreniyor. Aktif görüşme var.
- "qualified": Hasta ciddi ilgi gösteriyor: tedavi istiyor, fiyat teklifi istedi, MR/rapor paylaştı veya gelmek istediğini belirtti.
- "appointed": Hasta randevu aldı, tarih belirlendi veya geliş planı kesinleşti.
- "lost": Hasta ilgilenmediğini belirtti, uzun süre yanıt vermedi veya başka yere gittiğini söyledi.

Önemli Kurallar:
- Eğer mevcut aşama belirlenemiyorsa "new" döndür.
- Pipeline sadece İLERİ gider: appointed veya lost olan bir hasta discovery'ye geri dönemez.
- Departman: Yalnızca kullanıcının sorusuna veya ihtiyacına göre belirle. Kanıt yoksa boş bırak.`
      };

      // Filter out original system prompts to avoid confusing the extraction model
      const userHistory = history.filter(m => m.role !== 'system');
      
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
        stage: validatedData.pipeline_stage 
      });

      return validatedData;

    } catch (e: any) {
      this.log.warn(`[CRM_EXTRACTION_FAILED] Could not extract CRM data. Proceeding without updates. Error: ${e.message}`, { traceId });
      return null;
    }
  }
}

export const crmExtractorService = new CRMExtractorService();
