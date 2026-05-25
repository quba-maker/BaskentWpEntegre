import { withTenantDB } from '@/lib/core/tenant-db';
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
      const db = withTenantDB(tenantId);

      // 1. Fetch conversation to get phone number
      const conv = await db.executeSafe({
        text: `
          SELECT phone_number FROM conversations 
          WHERE id::text = $1::text AND tenant_id = $2
          LIMIT 1;
        `,
        values: [conversationId, tenantId]
      }) as any[];

      if (!conv || conv.length === 0) {
        log.warn(`[MEMORY_SKIPPED] Conversation ${conversationId} not found for tenant ${tenantId}`);
        return;
      }

      const phone = conv[0].phone_number;

      // 2. Fetch raw messages to summarize (linked by phone_number)
      const messages = await db.executeSafe({
        text: `
          SELECT * FROM (
            SELECT content, direction, created_at
            FROM messages
            WHERE tenant_id = $1 
              AND phone_number = $2
            ORDER BY created_at DESC
            LIMIT 50
          ) sub
          ORDER BY created_at ASC;
        `,
        values: [tenantId, phone]
      }) as any[];

      if (!messages || messages.length === 0) return;

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
      
      // Strip markdown code fences (```json ... ``` or ``` ... ```)
      let strippedText = rawText;
      const fenceMatch = rawText.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (fenceMatch) {
        strippedText = fenceMatch[1].trim();
      }
      
      // Robust JSON extraction to ignore any conversational prefix/suffix
      const jsonMatch = strippedText.match(/\{[\s\S]*\}/);
      const cleanedJson = jsonMatch ? jsonMatch[0] : strippedText;
      
      const parsed = JSON.parse(cleanedJson);
      
      const summaryText = parsed.summary_text || parsed.summary || parsed.text || "Özet oluşturulamadı.";
      const buyingIntent = parsed.buying_intent || parsed.intent || parsed.buyingIntent || "WARM";
      const sentiment = parsed.sentiment || "NEUTRAL";
      const objections = parsed.objections ? JSON.stringify(parsed.objections) : "[]";

      // 4. Save to conversation_memory
      await db.executeSafe({
        text: `
          INSERT INTO conversation_memory (
            tenant_id, conversation_id, summary_text, buying_intent, sentiment, objections, last_message_count
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7
          )
          ON CONFLICT (conversation_id) DO UPDATE SET
            summary_text = EXCLUDED.summary_text,
            buying_intent = EXCLUDED.buying_intent,
            sentiment = EXCLUDED.sentiment,
            objections = EXCLUDED.objections,
            last_message_count = EXCLUDED.last_message_count,
            updated_at = NOW();
        `,
        values: [tenantId, conversationId, summaryText, buyingIntent, sentiment, objections, messages.length]
      });

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
        // P1B: Opportunity-aware notes sync
        // If active_opportunity_id exists, use opportunity summary (prevents stale global summary)
        const convMeta = await db.executeSafe({
          text: `SELECT active_opportunity_id FROM conversations WHERE id::text = $1::text AND tenant_id = $2`,
          values: [conversationId, tenantId]
        }) as any[];
        
        const activeOppId = convMeta?.[0]?.active_opportunity_id;
        
        if (activeOppId) {
          // Update opportunity.summary with the new AI summary
          await db.executeSafe({
            text: `UPDATE opportunities SET summary = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            values: [summaryText, activeOppId, tenantId]
          });
          log.info(`[MEMORY_OPP_SYNC] Active opportunity ${activeOppId} summary updated`);
        }
        
        // ALWAYS update conversations.notes with the latest summary
        await db.executeSafe({
          text: `
            UPDATE conversations
            SET notes = $1
            WHERE id::text = $2::text AND tenant_id = $3;
          `,
          values: [summaryText, conversationId, tenantId]
        });
        
        const cleanPhone = phone.replace(/[^0-9]/g, '');
        if (cleanPhone.length >= 10) {
          const suffix = cleanPhone.substring(cleanPhone.length - 10);
          
          const matchingLeads = await db.executeSafe({
            text: `
              SELECT id, notes FROM leads
              WHERE phone_number LIKE $1
                AND tenant_id = $2
              LIMIT 5;
            `,
            values: ['%' + suffix, tenantId]
          }) as any[];
          
          for (const lead of matchingLeads) {
            // Tam otomatik: Mevcut not boş olsun veya olmasın her zaman AI özetini yaz
            await db.executeSafe({
              text: `
                UPDATE leads
                SET notes = $1
                WHERE id = $2 AND tenant_id = $3;
              `,
              values: [summaryText, lead.id, tenantId]
            });
            
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
      } catch (syncErr) {
        log.error('[MEMORY_SYNC_ERROR] Failed during CRM/Sheets sync', syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
      }
    } catch (e) {
      log.error('[MEMORY_ENGINE] Error generating summary', e instanceof Error ? e : new Error(String(e)));
      throw e;
    }
  }
}
