import { sql } from '@/lib/db';
import { logger } from '@/lib/core/logger';
import { AIOrchestrator, ChatMessage } from '../orchestrator';

const log = logger.withContext({ module: 'MemoryEngine' });

export class MemoryEngine {
  /**
   * Generates or updates a rolling summary of the conversation.
   * Compresses older messages into a structured memory object.
   */
  static async summarizeConversation(tenantId: string, conversationId: string): Promise<void> {
    try {
      // 1. Fetch raw messages to summarize
      const messages = await sql`
        SELECT content, direction, created_at
        FROM messages
        WHERE tenant_id = ${tenantId} 
          AND conversation_id = ${conversationId}
        ORDER BY created_at ASC
        LIMIT 50; -- Only get latest or chunked
      `;

      if (messages.length === 0) return;

      const conversationText = messages.map(m => 
        `[${m.direction === 'in' ? 'Müşteri' : 'Asistan'}]: ${m.content}`
      ).join('\n');

      // 2. Generate Summary using LLM
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is missing');

      const orchestrator = new AIOrchestrator();

      const prompt = `
        Aşağıdaki müşteri-asistan WhatsApp görüşmesini analiz et.
        Müşterinin satın alma niyetini, duygusunu, itirazlarını ve genel özetini çıkar.
        SADECE AŞAĞIDAKİ JSON FORMATINDA CEVAP VER. BAŞKA METİN YAZMA.
        
        Format:
        {
          "summary_text": "Kısa ve profesyonel görüşme özeti.",
          "buying_intent": "HOT" | "WARM" | "COLD",
          "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
          "objections": ["fiyat yüksek", "doktor tecrübesi", vb.]
        }

        Görüşme:
        ${conversationText}
      `;

      const aiMessages: ChatMessage[] = [
        { role: 'user', content: prompt }
      ];

      const aiResult = await orchestrator.generateResponse(aiMessages, {
        provider: 'gemini',
        modelId: 'gemini-2.5-flash',
        apiKey: apiKey,
        temperature: 0.2,
        maxTokens: 500
      });

      const rawText = aiResult.text.trim();
      const cleanedJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      
      const parsed = JSON.parse(cleanedJson);

      // 3. Save to conversation_memory
      await sql`
        INSERT INTO conversation_memory (
          tenant_id, conversation_id, summary_text, buying_intent, sentiment, objections, last_message_count
        ) VALUES (
          ${tenantId}, ${conversationId}, ${parsed.summary_text}, ${parsed.buying_intent}, ${parsed.sentiment}, ${parsed.objections}, ${messages.length}
        )
        ON CONFLICT (conversation_id) DO UPDATE SET
          summary_text = EXCLUDED.summary_text,
          buying_intent = EXCLUDED.buying_intent,
          sentiment = EXCLUDED.sentiment,
          objections = EXCLUDED.objections,
          last_message_count = EXCLUDED.last_message_count,
          updated_at = NOW();
      `;

      log.info(`[MEMORY_UPDATED] Rolling memory compressed for conv: ${conversationId}`);
    } catch (e) {
      log.error('[MEMORY_ENGINE] Error generating summary', e instanceof Error ? e : new Error(String(e)));
    }
  }
}
