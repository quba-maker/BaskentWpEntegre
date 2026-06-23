import type { TenantDB } from '@/lib/core/tenant-db';
import { CredentialsService } from '@/lib/services/credentials.service';
import { ThreeSixtyDialogService } from '@/lib/services/providers/three-sixty-dialog.service';
import { logger } from '@/lib/core/logger';
import { RealtimePublisher } from '@/lib/realtime/publisher';

const log = logger.withContext({ module: 'BotInterventionService' });

export type BotInterventionType =
  | "confirm_callback_time"
  | "ask_new_callback_time"
  | "remind_callback"
  | "confirm_clinic_appointment"
  | "ask_new_clinic_appointment_time"
  | "request_documents"
  | "send_custom_instruction";

export class BotInterventionError extends Error {
  public code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BotInterventionError';
    this.code = code;
  }
}

export class BotInterventionService {
  constructor(private db: TenantDB) {}

  /**
   * Translates Intervention Type to a natural prompt instruction
   */
  private getInstructionForType(type: BotInterventionType, customInstruction?: string): string {
    switch (type) {
      case 'confirm_callback_time':
        return 'Hastanın planlanan telefon görüşmesi saati için teyit iste. Görüşme saati uygun mu diye sor.';
      case 'ask_new_callback_time':
        return 'Hastaya ulaşamadığımızı belirterek telefon görüşmesi için yeni bir saat talep et.';
      case 'remind_callback':
        return 'Hastaya kısa süre sonra yapacağımız telefon görüşmesini hatırlat.';
      case 'confirm_clinic_appointment':
        return 'Hastanın planlanan yüz yüze klinik randevusu için katılım teyidi iste.';
      case 'ask_new_clinic_appointment_time':
        return 'Hastanın yüz yüze klinik randevusu için yeni bir tarih/saat talep et.';
      case 'request_documents':
        return 'Hastaya nazikçe belge paylaşma fırsatı sun. Aktif şekilde rapor isteme. "Elinizde paylaşmak istediğiniz belgeler varsa buradan iletebilirsiniz" gibi yumuşak bir ifade kullan. Raporun tek başına kesin değerlendirme için yeterli olmadığını, hastanede ilgili uzman ekip tarafından fiziksel muayene gerektiğini ekle.';
      case 'send_custom_instruction':
        return customInstruction || 'Sıradaki işlemi hastaya ilet.';
      default:
        return 'Sıradaki işlemi hastaya ilet.';
    }
  }

  /**
   * Executes a one-shot bot intervention.
   * Resolves provider correctly and ensures 24h window compliance.
   * NEVER enables full autopilot automatically.
   */
  async executeOneShot(
    userId: string,
    opportunityId: string,
    interventionType: BotInterventionType,
    customInstruction?: string
  ): Promise<{ success: boolean; messageId?: string; draftMsg?: string }> {
    
    // 1. Resolve Opportunity & Phone
    const opps = await this.db.executeSafe({
      text: `SELECT patient_name, phone_number FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      values: [opportunityId, this.db.tenantId]
    }) as any[];

    if (opps.length === 0) {
      throw new BotInterventionError('OPPORTUNITY_NOT_FOUND', 'Fırsat bulunamadı.');
    }
    
    const opp = opps[0];
    const phone = opp.phone_number;
    if (!phone) {
      throw new BotInterventionError('MISSING_PHONE', 'Bu fırsata ait telefon numarası bulunamadı.');
    }

    // 2. Resolve Conversation and Channel
    const convs = await this.db.executeSafe({
      text: `SELECT id, channel, channel_id FROM conversations WHERE active_opportunity_id = $1 AND tenant_id = $2 LIMIT 1`,
      values: [opportunityId, this.db.tenantId]
    }) as any[];

    if (convs.length === 0) {
      throw new BotInterventionError('CONVERSATION_NOT_FOUND', 'Aktif konuşma bulunamadı.');
    }

    const conv = convs[0];
    const conversationId = conv.id;
    const channel = conv.channel || 'whatsapp';
    const channelId = conv.channel_id;

    if (!channelId && channel === 'whatsapp') {
      throw new BotInterventionError('MISSING_CHANNEL_ID', 'WhatsApp kanal bilgisi eksik. Kanal yapılandırması kontrol edilmeli.');
    }

    const ctxLog = log.withContext({
      tenantId: this.db.tenantId,
      conversationId,
      opportunityId,
      channelId,
      interventionType
    });

    // 3. Verify 24-Hour WhatsApp Session Window
    if (channel === 'whatsapp') {
      const inboundCheck = await this.db.executeSafe({
        text: `SELECT created_at FROM messages 
               WHERE conversation_id = $1 AND tenant_id = $2 
                 AND (channel_id = $3 OR channel_id IS NULL)
                 AND direction = 'in' 
               ORDER BY created_at DESC LIMIT 1`,
        values: [conversationId, this.db.tenantId, channelId]
      }) as any[];

      if (inboundCheck.length === 0) {
        throw new BotInterventionError('WHATSAPP_24H_WINDOW_CLOSED', '24 saatlik WhatsApp mesajlaşma penceresi kapalı. Şablon mesaj gerekli.');
      }

      const lastInboundAt = new Date(inboundCheck[0].created_at);
      const hoursSinceInbound = (Date.now() - lastInboundAt.getTime()) / (1000 * 60 * 60);

      if (hoursSinceInbound > 24) {
        throw new BotInterventionError('WHATSAPP_24H_WINDOW_CLOSED', '24 saatlik WhatsApp mesajlaşma penceresi kapalı. Şablon mesaj gerekli.');
      }
    }

    // 4. Generate AI Draft Message
    const { draftMsg, isFallback } = await this.generateBotMessage(opp.patient_name, phone, interventionType, customInstruction, ctxLog);
    if (!draftMsg) {
      throw new BotInterventionError('DRAFT_GENERATION_FAILED', 'Bot mesaj taslağı oluşturulamadı. Lütfen manuel mesaj gönderin.');
    }

    // 5. Resolve Credentials and Provider
    const providerKey = (channel === 'messenger' || channel === 'instagram' ? channel : 'whatsapp') as 'whatsapp' | 'messenger' | 'instagram';
    const credentials = await CredentialsService.resolveCredentials(this.db.tenantId, providerKey);
    
    let providerMessageId: string | null = null;
    let messageStatus = 'pending';
    const isThreeSixty = channel === 'whatsapp' && (credentials.provider === '360dialog' || credentials.provider === '360dialog_whatsapp');
    let usedProviderName = isThreeSixty ? '360dialog' : 'meta_graph';

    let guardedMsg = draftMsg;

    // 6. Dispatch Message (Provider Aware & Guarded)
    try {
      const { MessageService } = await import('@/lib/services/message.service');
      const msgService = new MessageService(this.db);
      
      const phoneId = credentials.whatsappPhoneNumberId || '';
      const accessToken = credentials.accessToken || '';
      
      const res = await msgService.sendWhatsAppMessage(
        phoneId,
        accessToken,
        phone,
        draftMsg,
        credentials.provider
      );
      
      providerMessageId = res.providerMessageId || null;
      messageStatus = res.success ? 'sent' : 'failed';
      if (res.guardedContent) {
        guardedMsg = res.guardedContent;
      }
      
      if (!res.success) {
        throw new BotInterventionError('SEND_FAILED', 'WhatsApp üzerinden mesaj gönderilemedi.');
      }
    } catch (e: any) {
      if (e instanceof BotInterventionError) throw e;
      throw new BotInterventionError('SEND_FAILED', e.message || 'WhatsApp gönderme hatası.');
    }

    // 7. Save DB Metadata
    const dbMetadata: any = {
      source: "bot_intervention",
      initiated_from: "patient_tracking",
      intervention_type: interventionType,
      one_shot: true,
      requires_autopilot: false,
      opportunity_id: opportunityId,
      conversation_id: conversationId,
      operator_user_id: userId,
      channel_id: channelId,
      provider: usedProviderName
    };

    if (isFallback) {
      dbMetadata.draft_source = "fallback_template";
      dbMetadata.draft_generation_failed = true;
      dbMetadata.draft_error_code = "TENANT_ISOLATION_FAULT"; // Re-used generic code indicating generation failed
    }

    const botModelUsed = isFallback ? 'fallback' : 'gemini-2.5-flash';

    const msgInsert = await this.db.executeSafe({
      text: `INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, status, provider_message_id, model_used, media_metadata)
             VALUES ($1, $2, $3, 'out', $4, $5, $6, $7, $8, $9)
             RETURNING id`,
      values: [
        this.db.tenantId, 
        conversationId, 
        phone, 
        guardedMsg, 
        channel, 
        messageStatus, 
        providerMessageId,
        botModelUsed,
        JSON.stringify(dbMetadata)
      ]
    }) as any[];
    
    const messageId = msgInsert[0]?.id;

    // 8. Update Conversation (WITHOUT enabling full autopilot)
    await this.db.executeSafe({
      text: `UPDATE conversations 
             SET last_message_at = NOW(), 
                 last_message_content = $1,
                 last_channel = $2,
                 last_message_status = $3,
                 last_message_direction = 'out',
                 last_message_model = $4,
                 message_count = COALESCE(message_count, 0) + 1
                 -- Not changing status to 'bot' or 'autopilot_enabled' here for one-shot.
             WHERE id = $5 AND tenant_id = $6`,
      values: [guardedMsg, channel, messageStatus, botModelUsed, conversationId, this.db.tenantId]
    });

    // 9. Write Outreach Log
    await this.db.executeSafe({
      text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, conversation_id, action, channel, actor_id, metadata)
             VALUES ($1, $2, $3, 'bot_intervention_sent', $4, $5, $6::jsonb)`,
      values: [
        this.db.tenantId,
        opportunityId,
        conversationId,
        channel,
        userId,
        JSON.stringify(dbMetadata)
      ]
    });

    // 10. Publish Realtime Update
    if (messageId) {
      try {
        await RealtimePublisher.publishMessageCreated(this.db.tenantId, {
          id: messageId,
          conversation_id: conversationId,
          phone_number: phone,
          content: guardedMsg,
          direction: 'out',
          status: messageStatus,
          created_at: new Date().toISOString()
        });
      } catch (err) {
        ctxLog.warn('Failed to publish realtime event for bot intervention', { err: err instanceof Error ? err.message : String(err) });
      }
    }

    return { success: true, messageId, draftMsg };
  }

  /**
   * Generates the message using Gemini, or falls back to a safe template if possible.
   */
  private async generateBotMessage(
    patientName: string, 
    phone: string, 
    interventionType: BotInterventionType, 
    customInstruction: string | undefined,
    ctxLog: any
  ): Promise<{ draftMsg: string | null; isFallback: boolean }> {
    const patientDisplayName = patientName || 'Müşterimiz';
    const directiveInstruction = this.getInstructionForType(interventionType, customInstruction);
    
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (apiKey) {
      try {
        const { defaultPrompts } = await import('@/lib/domain/conversation/prompts');
        const promptsData = await this.db.executeSafe({
          text: `SELECT prompt_text FROM channel_prompts 
                 WHERE tenant_id = $1 AND name = 'WhatsApp System Prompt' AND is_active = true LIMIT 1`,
          values: [this.db.tenantId]
        }) as any[];
        const basePrompt = promptsData[0]?.prompt_text || defaultPrompts.whatsapp;

        const historyRows = await this.db.executeSafe({
          text: `SELECT direction, content FROM messages 
                 WHERE phone_number = $1 AND tenant_id = $2 AND direction IN ('in', 'out')
                 ORDER BY created_at DESC LIMIT 15`,
          values: [phone, this.db.tenantId]
        }) as any[];

        let conversationTranscript = '(Henüz konuşma geçmişi bulunmuyor)';
        if (historyRows && historyRows.length > 0) {
          conversationTranscript = historyRows
            .reverse()
            .map((m: any) => `[${m.direction === 'in' ? 'Hasta' : 'Kurum Asistanı'}]: "${m.content}"`)
            .join('\n');
        }

        const systemInstruction = `Sen Kurum Asistanısın. Görevin, koordinatörün verdiği taktik talimat doğrultusunda hastaya gönderilmek üzere kurum adına samimi, güven veren ve ikna edici bir WhatsApp mesajı yazmaktır.`;

        const prompt = `Aşağıdaki genel kurum kurallarını ve konuşma geçmişini baz alarak, koordinatörün belirttiği taktik talimata uygun olarak hastaya gönderilecek bir sonraki WhatsApp mesajını yaz.

=== GENEL KURUM VE ASİSTAN KURALLARI ===
${basePrompt}

=== HASTA İLE GÖRÜŞME GEÇMİŞİ (WHATSAPP TRANSCRIPT) ===
${conversationTranscript}

=== KOORDİNATÖRÜN TAKTİK TALİMATI ===
Lütfen hastamız ${patientDisplayName} için şu talimat doğrultusunda bir yanıt mesajı oluştur:
👉 "${directiveInstruction}"

=== BOTA ÖZEL YAZIM TALİMATI (ÖNEMLİ) ===
- Yazacağın mesaj, yukarıdaki konuşma geçmişinin tam olarak KALDIĞI YERDEN DEVAM ETMELİDİR.
- Son mesaj hastadan geldiyse, hastanın yazdığına (yukarıdaki son mesaja) doğrudan ve samimi bir şekilde cevap ver.
- Jenerik karşılama, kopuk başlangıçlar (Örn: "Merhaba İsa, nasılsınız?" gibi baştan alma) yapma. Eğer hastaya zaten hal hatır sorulduysa veya konuşmanın ortasındaysanız, doğrudan hastanın son ifadesine cevap vererek konuya gir.
- Sadece ve sadece hastaya gönderilecek mesajı yaz. Başına veya sonuna açıklama, tırnak işareti, "Koordinatör Notu:" gibi ifadeler KESİNLİKLE EKLEME.`;

        const payload = {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
        };

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }
        );

        if (response.ok) {
          const resData = await response.json();
          const text = resData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.trim().length > 0) {
            const { sanitizePatientFacingMessage } = await import('@/lib/utils/patient-message-sanitizer');
            return { draftMsg: sanitizePatientFacingMessage(text.trim()), isFallback: false };
          }
        }
        
        ctxLog.warn('Gemini failed to return text', { responseText: await response.text() });
      } catch (err) {
        ctxLog.error('Gemini Draft Error', err instanceof Error ? err : new Error(String(err)));
      }
    } else {
      ctxLog.warn('Gemini API Key missing');
    }

    // Fallback behavior
    let fallbackMsg: string | null = null;

    switch (interventionType) {
      case 'confirm_callback_time':
        fallbackMsg = `Belirttiğiniz telefon görüşmesi zamanı sizin için uygun mu? Onaylayabilir misiniz?`;
        break;
      case 'ask_new_callback_time':
        fallbackMsg = `Telefon görüşmesi için size uygun gün ve saat aralığını paylaşabilir misiniz?`;
        break;
      case 'remind_callback':
        fallbackMsg = `Telefon görüşmesi planlamanızla ilgili sizi bilgilendirmek istedik. Görüşme saatinde telefonunuzun ulaşılabilir olması yeterlidir.`;
        break;
      case 'request_documents':
        fallbackMsg = `Elinizde paylaşmak istediğiniz belgeler varsa buradan iletebilirsiniz. Belgeler süreci anlamaya yardımcı olabilir; kesin değerlendirme için ilgili uzman hekim muayenesi gerekir.`;
        break;
      case 'confirm_clinic_appointment':
        fallbackMsg = `Planlanan yüz yüze klinik randevunuzu teyit etmek isteriz. Katılım durumunuzu bildirebilir misiniz?`;
        break;
      case 'ask_new_clinic_appointment_time':
        fallbackMsg = `Yüz yüze klinik randevunuz için size uygun yeni bir tarih ve saat aralığı paylaşabilir misiniz?`;
        break;
    }

    if (fallbackMsg) {
      const { sanitizePatientFacingMessage } = await import('@/lib/utils/patient-message-sanitizer');
      fallbackMsg = sanitizePatientFacingMessage(fallbackMsg);
    }

    return { draftMsg: fallbackMsg, isFallback: true };
  }
}
