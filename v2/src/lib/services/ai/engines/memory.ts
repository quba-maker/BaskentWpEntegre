import { withTenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { AIOrchestrator, ChatMessage } from '../orchestrator';
import { buildMediaContext } from '../media-context';

const log = logger.withContext({ module: 'MemoryEngine' });

export class MemoryEngine {
  /**
   * Generates or updates a rolling summary of the conversation.
   * P1B: Produces CRM-quality summary scoped to active opportunity.
   * This is the SOLE owner of opportunity.summary.
   */
  static async summarizeConversation(tenantId: string, conversationId: string): Promise<void> {
    try {
      const db = withTenantDB(tenantId);

      // 1. Fetch conversation to get phone number + active opportunity
      const conv = await db.executeSafe({
        text: `
          SELECT c.phone_number, c.active_opportunity_id, c.notes as current_notes,
                 o.summary as current_opp_summary,
                 o.requester_name, o.patient_name, o.country, o.department,
                 o.patient_relation, o.metadata as opp_metadata
          FROM conversations c
          LEFT JOIN opportunities o ON o.id = c.active_opportunity_id AND o.tenant_id = c.tenant_id
          WHERE c.id::text = $1::text AND c.tenant_id = $2
          LIMIT 1;
        `,
        values: [conversationId, tenantId]
      }) as any[];

      if (!conv || conv.length === 0) {
        log.warn(`[MEMORY_SKIPPED] Conversation ${conversationId} not found for tenant ${tenantId}`);
        return;
      }

      const phone = conv[0].phone_number;
      const activeOppId = conv[0].active_opportunity_id;
      const currentNotes = conv[0].current_notes || '';
      const currentOppSummary = conv[0].current_opp_summary || '';
      const oppContext = {
        name: conv[0].requester_name || conv[0].patient_name || '',
        country: conv[0].country || '',
        department: conv[0].department || '',
        relation: conv[0].patient_relation || ''
      };
      const oppMetadata = conv[0].opp_metadata || {};

      // Determine canonical timezone details to enforce safety restrictions in AI summarization
      let timezoneDisplayContext = '';
      try {
        const { resolvePatientTimeDisplay } = await import('@/lib/utils/timezone');
        const timeDisplayRes = resolvePatientTimeDisplay({
          country: conv[0].country,
          metadata: oppMetadata
        });
        
        if (timeDisplayRes.needsTimezoneClarification) {
          timezoneDisplayContext = `\n⚠️ KRİTİK ZAMAN VE SAAT DİLİMİ SINIRLAMASI:
Hastanın bulunduğu ülke için saat dilimi doğrulanmamıştır (şehir/eyalet bilgisi eksik veya belirsiz).
- Kesinlikle "New York saati", "Almanya saati" veya herhangi bir yerel saat (örn: 10:00, 15:00 local saat vb.) yazma!
- Sadece Türkiye saati (TR) yazabilirsin ve hasta yerel saati için "şehir/eyalet netleşmediği için yerel saat hesaplanamamıştır" şeklinde belirtmelisin.
- Kesin olmayan, doğrulanmamış yerel saatlerin özete sızmasını 100% engelle.`;
        } else if (timeDisplayRes.patientTimezone && timeDisplayRes.patientLocalTime) {
          timezoneDisplayContext = `\nZAMAN BİLGİSİ: Hastanın yerel saat dilimi ${timeDisplayRes.residenceCountryLabel} (${timeDisplayRes.patientTimezone}) olarak teyit edilmiştir. Zaman belirtirken hem Türkiye saati (TR) hem de hastanın kendi yerel saatini (${timeDisplayRes.patientLocalTime}) gösterebilirsin.`;
        } else {
          timezoneDisplayContext = `\n⚠️ KRİTİK ZAMAN SINIRLAMASI: Hastanın yerel saat dilimi belirsizdir. Özet içerisinde hasta yerel saati yazma, sadece Türkiye saati (TR) yaz ve yerel saat için "net değil" olarak belirt.`;
        }
      } catch (err) {
        // Non-fatal
      }

      // Query active task to get canonical times
      let activeTaskCanonicalTime = '';
      if (activeOppId) {
        try {
          const activeTasks = await db.executeSafe({
            text: `SELECT due_at, metadata FROM follow_up_tasks
                   WHERE opportunity_id = $1 AND tenant_id = $2 AND status IN ('pending', 'in_progress')
                   ORDER BY created_at DESC LIMIT 1`,
            values: [activeOppId, tenantId]
          }) as any[];
          
          if (activeTasks.length > 0) {
            const task = activeTasks[0];
            const tMeta = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
            
            const scheduledFor = tMeta.scheduled_for_utc;
            const trTime = tMeta.callback_time_tr;
            const timeConfirmed = tMeta.time_confirmed_by_patient === true;
            const botSugg = tMeta.bot_suggestion;
            
            if (scheduledFor) {
              if (timeConfirmed) {
                activeTaskCanonicalTime = `[KANONİK ZAMAN (ONAYLANMIŞ/TEYİTLİ)]: Arama/görüşme tarihi teyit edilmiştir. Türkiye saati (TR): ${trTime || 'Belirtilmemiş'}, UTC Zamanı: ${scheduledFor}.`;
              } else if (botSugg && botSugg.status === 'pending') {
                activeTaskCanonicalTime = `[KANONİK ZAMAN (TEYİTSİZ ÖNERİ)]: Bot tarafından önerilen zaman (Henüz teyit edilmedi/Onay bekliyor): Tarih: ${botSugg.suggested_date || 'Eksik'}, Saat: ${botSugg.suggested_time || 'Eksik'}.`;
                if (botSugg.needs_date_clarification || botSugg.needs_timezone_clarification) {
                  activeTaskCanonicalTime += ` (Önemli Not: Saat dilimi veya tarih eksik/net değil!).`;
                }
              }
            }
          }
        } catch (taskErr) {
          // Non-fatal
        }
      }

      // 2. Fetch raw messages to summarize (linked by phone_number)
      const messages = await db.executeSafe({
        text: `
          SELECT * FROM (
            SELECT content, direction, created_at, media_type, media_metadata
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

      // P2I-P0: Media-aware conversation text using shared helper
      const conversationText = messages.map(m => {
        const label = m.direction === 'in' ? 'Müşteri' : 'Asistan';
        if (m.media_type) {
          const mediaCtx = buildMediaContext({
            direction: m.direction,
            mediaType: m.media_type,
            content: m.content || '',
            metadata: m.media_metadata || undefined,
          });
          return `[${label}]: ${mediaCtx}`;
        }
        return `[${label}]: ${m.content}`;
      }).join('\n');

      // 3. Generate CRM-quality Summary using LLM
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is missing');

      const orchestrator = new AIOrchestrator();

      // P1B: CRM-quality prompt — coordinator-oriented, action-focused
      const contextHint = oppContext.name 
        ? `\nBilinen hasta/başvuran bilgisi: ${oppContext.name}${oppContext.country ? `, ${oppContext.country}` : ''}${oppContext.department ? `, ${oppContext.department} bölümü` : ''}${oppContext.relation ? `, ${oppContext.relation} için başvuruyor` : ''}`
        : '';

      const prompt = `
        Sen bir hastane CRM koordinatörüsün. Aşağıdaki WhatsApp görüşmesini analiz et ve koordinatör/satış ekibinin hızlıca okuyacağı profesyonel bir CRM notu oluştur.
        ${contextHint}
        ${timezoneDisplayContext}

        Zaman Kaynağı Yönergesi:
        Özet içinde herhangi bir görüşme/arama saati yazarken yalnızca şu canonical zaman bilgisini referans al:
        ${activeTaskCanonicalTime ? activeTaskCanonicalTime : 'Görüşmede teyit edilmiş veya bot tarafından önerilmiş aktif bir randevu saati bulunmuyor. Özete kesinlikle uydurma randevu/arama zamanı yazma.'}

        SADECE AŞAĞIDAKİ JSON FORMATINDA CEVAP VER. BAŞKA METİN YAZMA.
        
        Format:
        {
          "crm_summary": "Koordinatör odaklı detaylı CRM özeti (500-900 karakter). Şunları içermeli: Kim başvuruyor? Nereden? Kimin için? Hangi tedavi/bölüm? Şu ana kadar hangi bilgiler alındı/verildi? Eksik bilgi/rapor var mı? Sonraki aksiyon nedir? Arama/randevu beklentisi var mı? Bot mesajlarını birebir kopyalama, durumu özetle.",
          "summary_text": "Kısa 1-2 cümle anlık durum özeti.",
          "buying_intent": "HOT | WARM | COLD",
          "sentiment": "POSITIVE | NEUTRAL | NEGATIVE",
          "objections": ["varsa itirazlar"]
        }

        KURALLAR:
        - crm_summary 500-900 karakter arasında olmalı.
        - Konuşmanın SONUNDAKİ en güncel bilgileri (yeni istenen tarihler, saat değişiklikleri, son kararlar) ÖZELLİKLE yansıt.
        - Müşteri önceki fikrini değiştirdiyse ESKİ planı değil EN GÜNCEL durumu özetle.
        - Asistan cevaplarını birebir kopyalama, sadece önemli verileri çıkar.
        - Profesyonel, net, sonuca odaklı CRM satış notu gibi yaz.
        - Eksik aksiyonları açıkça belirt ("Sonraki aksiyon: ...", "Beklenen: ...").
        - Zamanları özete eklerken yukarıdaki "Zaman Kaynağı Yönergesi"ne 100% sadık kal. Kanonik zaman kaynağında bulunmayan uydurma saat/tarih yazma.
        - Eğer yukarıda "⚠️ KRİTİK ZAMAN VE SAAT DİLİMİ SINIRLAMASI" uyarısı aktif ise, özette kesinlikle New York yerel saati gibi doğrulanmamış yerel saatler yazma! Sadece TR saati yazabilir ve "yerel saat dilimi belirsiz" uyarısı ekleyebilirsin.

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
        maxTokens: 8000
      });

      const rawText = aiResult.text || "".trim();
      
      // Bulletproof JSON extraction: find outermost curly braces
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      
      if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        throw new Error(`Invalid JSON format returned by LLM. No matching braces found in response: ${rawText}`);
      }
      
      const cleanedJson = rawText.substring(firstBrace, lastBrace + 1).trim();
      
      let parsed;
      try {
        parsed = JSON.parse(cleanedJson);
      } catch (jsonErr: any) {
        log.error('[MEMORY_JSON_PARSE_ERROR] Cleaned JSON parsing failed:', jsonErr, { cleanedJson });
        throw new Error(`JSON parsing failed: ${jsonErr.message}. Raw text: ${rawText}`);
      }
      
      // P1B: Two-tier summary extraction
      const crmSummary = parsed.crm_summary || parsed.summary_text || parsed.summary || parsed.text || "Özet oluşturulamadı.";
      const shortSummary = parsed.summary_text || parsed.summary || crmSummary;
      const buyingIntent = parsed.buying_intent || parsed.intent || parsed.buyingIntent || "WARM";
      const sentiment = parsed.sentiment || "NEUTRAL";
      const objections = parsed.objections ? JSON.stringify(parsed.objections) : "[]";

      // 4. Save to conversation_memory (short summary for quick reference)
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
        values: [tenantId, conversationId, shortSummary, buyingIntent, sentiment, objections, messages.length]
      });

      log.info(`[MEMORY_UPDATED] Rolling memory compressed for conv: ${conversationId}`);

      // [NEW] Publish Realtime Memory Update event
      try {
        const { RealtimePublisher } = await import('@/lib/realtime/publisher');
        await RealtimePublisher.publishMemoryUpdated(tenantId, phone, {
          aiSummary: crmSummary,
          aiBuyingIntent: buyingIntent,
          aiSentiment: sentiment,
          objections: parsed.objections || []
        });
        log.info(`[MEMORY_REALTIME_PUBLISH] Realtime event published for memory update of conv: ${conversationId}`);
      } catch (realtimeErr) {
        log.error(`[MEMORY_REALTIME_FAILED] Failed to publish realtime memory update`, realtimeErr instanceof Error ? realtimeErr : new Error(String(realtimeErr)));
      }

      // 5. P1B: Write CRM summary to active opportunity (SOLE OWNER)
      if (activeOppId) {
        await db.executeSafe({
          text: `UPDATE opportunities SET summary = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
          values: [crmSummary, activeOppId, tenantId]
        });
        log.info(`[MEMORY_OPP_SYNC] Active opportunity ${activeOppId} CRM summary updated (${crmSummary.length} chars)`);
      }

      // 6. P1B: Conditional conversations.notes write
      // Only update if: notes is empty OR notes matches previous AI summary (not manually edited)
      const isNotesEmpty = !currentNotes || currentNotes.trim() === '';
      const isNotesSameAsOldSummary = currentNotes.trim() === currentOppSummary.trim();
      const shouldUpdateNotes = isNotesEmpty || isNotesSameAsOldSummary;
      
      if (shouldUpdateNotes) {
        await db.executeSafe({
          text: `UPDATE conversations SET notes = $1 WHERE id::text = $2::text AND tenant_id = $3;`,
          values: [crmSummary, conversationId, tenantId]
        });
        log.info(`[MEMORY_NOTES_SYNC] conversations.notes updated (was ${isNotesEmpty ? 'empty' : 'AI-managed'})`);
      } else {
        log.info(`[MEMORY_NOTES_SKIP] conversations.notes preserved (manual notes detected, ${currentNotes.length} chars)`);
      }

      // 7. Sync to matching leads + Google Sheets
      try {
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
            // Update lead notes with CRM summary
            await db.executeSafe({
              text: `UPDATE leads SET notes = $1 WHERE id = $2 AND tenant_id = $3;`,
              values: [crmSummary, lead.id, tenantId]
            });
            
            log.info(`[MEMORY_SYNC] Lead ${lead.id} notes updated with CRM summary.`);
              
              const SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
              if (SHEET_URL) {
                try {
                  const sheetResponse = await fetch(SHEET_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: 'updateNoteByPhone',
                      phone: phone,
                      note: crmSummary
                    })
                  });
                  if (!sheetResponse.ok) {
                    log.warn(`[MEMORY_SYNC] Google Sheets note sync returned status ${sheetResponse.status}`);
                  } else {
                    log.info(`[MEMORY_SYNC] Lead ${lead.id} CRM summary synced to Google Sheets.`);
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
