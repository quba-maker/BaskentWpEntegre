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
      // 1. Fetch conversation to get phone number
      const conv = await sql`
        SELECT phone_number FROM conversations 
        WHERE id::text = ${conversationId}::text AND tenant_id = ${tenantId}
        LIMIT 1;
      `;

      if (conv.length === 0) {
        log.warn(`[MEMORY_SKIPPED] Conversation ${conversationId} not found for tenant ${tenantId}`);
        return;
      }

      const phone = conv[0].phone_number;

      // 2. Fetch raw messages to summarize (linked by phone_number)
      const messages = await sql`
        SELECT * FROM (
          SELECT content, direction, created_at
          FROM messages
          WHERE tenant_id = ${tenantId} 
            AND phone_number = ${phone}
          ORDER BY created_at DESC
          LIMIT 50
        ) sub
        ORDER BY created_at ASC;
      `;

      if (messages.length === 0) return;

      const conversationText = messages.map(m => 
        `[${m.direction === 'in' ? 'Müşteri' : 'Asistan'}]: ${m.content}`
      ).join('\n');

      // 3. Generate Summary using LLM
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is missing');

      const orchestrator = new AIOrchestrator();

      const prompt = `
        Aşağıdaki müşteri-asistan WhatsApp görüşmesini analiz et.
        Müşterinin satın alma niyetini, duygusunu, itirazlarını ve genel özetini çıkar.
        
        DİKKAT (ÇOK ÖNEMLİ): Konuşmanın SONUNDAKİ en güncel bilgileri (yeni istenen tarihler, saat değişiklikleri, son kararlar vb.) ÖZELLİKLE özete yansıt. Eğer müşteri önceki bir fikrini veya saatini değiştirdiyse, ESKİ planı değil, her zaman EN GÜNCEL durumu özetle. Özetin kısa, net ve sonuca odaklı olmalı.

        SADECE AŞAĞIDAKİ JSON FORMATINDA CEVAP VER. BAŞKA METİN YAZMA.
        
        Format:
        {
          "summary_text": "Kısa ve profesyonel görüşme özeti (Son kararları içermeli).",
          "buying_intent": "HOT",
          "sentiment": "POSITIVE",
          "objections": ["fiyat yüksek", "zaman uymuyor"]
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
        maxTokens: 2000
      });

      const rawText = aiResult.text.trim();
      
      // Robust JSON extraction to ignore any conversational prefix/suffix
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const cleanedJson = jsonMatch ? jsonMatch[0] : rawText;
      
      const parsed = JSON.parse(cleanedJson);
      
      const summaryText = parsed.summary_text || parsed.summary || parsed.text || "Özet oluşturulamadı.";
      const buyingIntent = parsed.buying_intent || parsed.intent || parsed.buyingIntent || "WARM";
      const sentiment = parsed.sentiment || "NEUTRAL";
      const objections = parsed.objections ? JSON.stringify(parsed.objections) : "[]";

      // 4. Save to conversation_memory
      await sql`
        INSERT INTO conversation_memory (
          tenant_id, conversation_id, summary_text, buying_intent, sentiment, objections, last_message_count
        ) VALUES (
          ${tenantId}, ${conversationId}, ${summaryText}, ${buyingIntent}, ${sentiment}, ${objections}, ${messages.length}
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

      // [NEW] Publish Realtime Memory Update event
      try {
        const { RealtimePublisher } = await import('@/lib/realtime/publisher');
        await RealtimePublisher.publishMemoryUpdated(tenantId, phone, {
          aiSummary: summaryText,
          aiBuyingIntent: buyingIntent,
          aiSentiment: sentiment,
          objections: parsed.objections || []
        });
        log.info(`[MEMORY_REALTIME_PUBLISH] Realtime event published for memory update of conv: ${conversationId}`);
      } catch (realtimeErr) {
        log.error(`[MEMORY_REALTIME_FAILED] Failed to publish realtime memory update`, realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)));
      }

      // 5. Sync rolling AI summary back to matching lead notes & Google Sheets
      try {
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        if (cleanPhone.length >= 10) {
          const suffix = cleanPhone.substring(cleanPhone.length - 10);
          
          const matchingLeads = await sql`
            SELECT id, notes FROM leads
            WHERE phone_number LIKE ${'%' + suffix}
              AND tenant_id = ${tenantId}
            LIMIT 5;
          `;
          
          for (const lead of matchingLeads) {
            if (!lead.notes || lead.notes.trim() === '') {
              await sql`
                UPDATE leads
                SET notes = ${parsed.summary_text}
                WHERE id = ${lead.id} AND tenant_id = ${tenantId};
              `;
              
              log.info(`[MEMORY_SYNC] Lead ${lead.id} notes automatically updated with AI summary.`);
              
              const SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
              if (SHEET_URL) {
                try {
                  const sheetResponse = await fetch(SHEET_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: 'updateNoteByPhone',
                      phone: phone,
                      note: parsed.summary_text
                    })
                  });
                  if (!sheetResponse.ok) {
                    log.warn(`[MEMORY_SYNC] Google Sheets note sync returned status ${sheetResponse.status}`);
                  } else {
                    log.info(`[MEMORY_SYNC] Lead ${lead.id} AI summary successfully synced to Google Sheets.`);
                  }
                } catch (sheetErr) {
                  log.warn(`[MEMORY_SYNC] Google Sheets note sync failed for phone: ${phone}`, { error: String(sheetErr) });
                }
              }
            }
          }
        }
      } catch (syncErr) {
        log.error('[MEMORY_SYNC_ERROR] Failed during CRM/Sheets sync', syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
      }
    } catch (e) {
      log.error('[MEMORY_ENGINE] Error generating summary', e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }
}
