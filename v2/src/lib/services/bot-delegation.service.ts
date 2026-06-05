import type { TenantDB } from '@/lib/core/tenant-db';
import { resolvePatientTimezone, formatDualClock } from '@/lib/utils/timezone';
import { StopRuleEngine } from './stop-rules.service';
import { NotificationService } from './notification.service';
import { logger } from '@/lib/core/logger';

const log = logger.withContext({ module: 'BotDelegationService' });

export type BotDelegationMode = 
  | 'unreachable_followup'
  | 'collect_phone_call_time'
  | 'confirm_phone_call'
  | 'clinic_appointment_reminder'
  | 'no_response_followup'
  | 'report_request'
  | 'appointment_reschedule_request';

export const BOT_MODE_WHITELIST = new Set<BotDelegationMode>([
  'unreachable_followup',
  'collect_phone_call_time',
  'confirm_phone_call',
  'clinic_appointment_reminder',
  'no_response_followup',
  'report_request',
  'appointment_reschedule_request'
]);

export interface BotDelegationOptions {
  mode: BotDelegationMode;
  source: string;
  reason?: string;
  parentTaskId?: string | null;
  appointmentTaskId?: string | null;
  reminderTaskId?: string | null;
}

export class BotDelegationService {
  constructor(private db: TenantDB) {}

  /**
   * Safe helper to mask phone number for Telegram internal notification
   */
  private maskPhone(phone: string): string {
    if (!phone) return 'Bilinmiyor';
    const clean = phone.replace(/\D/g, '');
    if (clean.length >= 10) {
      return `+${clean.slice(0, clean.length - 7)} ${clean.slice(clean.length - 7, clean.length - 4)} ••• •• ${clean.slice(-2)}`;
    }
    return phone;
  }

  /**
   * Whitelist guard check
   */
  public static isValidMode(mode: string): boolean {
    return BOT_MODE_WHITELIST.has(mode as BotDelegationMode);
  }

  /**
   * 1. createBotDelegationTask
   * Standardizes the creation of a 'bot_handoff_followup' task
   */
  async create(
    opportunityId: string, 
    userId: string,
    options: BotDelegationOptions
  ): Promise<{ success: boolean; taskId?: string; error?: string }> {
    // 1. Whitelist validation
    if (!BotDelegationService.isValidMode(options.mode)) {
      return { success: false, error: `Geçersiz bot takip modu: ${options.mode}` };
    }

    // 2. Fetch Opportunity details
    const oppRes = await this.db.executeSafe({
      text: `SELECT phone_number, patient_name FROM opportunities WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      values: [opportunityId, this.db.tenantId]
    }) as any[];
    if (oppRes.length === 0) return { success: false, error: 'Fırsat bulunamadı.' };
    const opp = oppRes[0];

    // 3. Duplicate/Idempotency Guard
    const existing = await this.db.executeSafe({
      text: `SELECT id FROM follow_up_tasks 
             WHERE opportunity_id = $1 AND tenant_id = $2 
               AND task_type = 'bot_handoff_followup'
               AND status IN ('pending', 'in_progress')
               AND metadata->'bot_delegation'->>'mode' = $3
               AND metadata->'bot_delegation'->>'status' NOT IN ('completed', 'cancelled', 'skipped')
             LIMIT 1`,
      values: [opportunityId, this.db.tenantId, options.mode]
    }) as any[];

    if (existing.length > 0) {
      return { success: false, error: `Bu fırsat için zaten aktif bir '${options.mode}' bot takibi bulunuyor.` };
    }

    const titleMap: Record<BotDelegationMode, string> = {
      unreachable_followup: 'Bot Takip: Ulaşılamadı',
      collect_phone_call_time: 'Bot Takip: Uygun Saat İsteme',
      confirm_phone_call: 'Bot Takip: Görüşme Teyidi',
      clinic_appointment_reminder: 'Bot Takip: Randevu Teyidi',
      no_response_followup: 'Bot Takip: Cevapsız Fırsat',
      report_request: 'Bot Takip: Rapor/Belge İsteme',
      appointment_reschedule_request: 'Bot Takip: Randevu Erteleme'
    };

    const metadata = {
      bot_delegation: {
        mode: options.mode,
        source: options.source,
        reason: options.reason || 'manual_trigger',
        parent_task_id: options.parentTaskId || null,
        appointment_task_id: options.appointmentTaskId || null,
        reminder_task_id: options.reminderTaskId || null,
        status: 'pending_draft',
        created_at: new Date().toISOString(),
        last_processed_at: null,
        generated_draft: null,
        generated_draft_at: null,
        notification_sent_at: null,
        context_warnings: []
      },
      zero_outbound_p0: true,
      initiated_from: 'bot_delegation_orchestrator'
    };

    const res = await this.db.executeSafe({
      text: `
        INSERT INTO follow_up_tasks (tenant_id, opportunity_id, phone_number, task_type, title, description, status, due_at, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '5 minutes', $8)
        RETURNING id
      `,
      values: [
        this.db.tenantId,
        opportunityId,
        opp.phone_number,
        'bot_handoff_followup',
        titleMap[options.mode] || 'Bot Takip Görevi',
        `Bot koordinatör taslak hazırlama görevi (${options.mode}).`,
        'pending',
        JSON.stringify(metadata)
      ]
    }) as any[];

    const taskId = res[0].id;

    // Write outreach_log (Action: bot_delegation_created)
    await this.db.executeSafe({
      text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
             VALUES ($1, $2, 'bot_delegation_created', 'system', $3, $4)`,
      values: [
        this.db.tenantId,
        opportunityId,
        userId,
        JSON.stringify({
          mode: options.mode,
          task_id: taskId,
          parent_task_id: options.parentTaskId || null,
          appointment_task_id: options.appointmentTaskId || null,
          initiated_from: 'bot_delegation_orchestrator',
          zero_outbound_p0: true
        })
      ]
    });

    return { success: true, taskId };
  }

  /**
   * 2. process
   * Executed by the Task Engine when a 'bot_handoff_followup' is due
   */
  async process(taskId: string, dryRun: boolean = false): Promise<any> {
    const startTime = Date.now();

    // 1. Fetch Task details
    const taskRows = await this.db.executeSafe({
      text: `SELECT t.*, o.patient_name, o.country, o.department, o.stage, o.priority, o.intent_type, o.summary, o.ai_reason
             FROM follow_up_tasks t
             LEFT JOIN opportunities o ON o.id = t.opportunity_id AND o.tenant_id = t.tenant_id
             WHERE t.id = $1 AND t.tenant_id = $2 LIMIT 1`,
      values: [taskId, this.db.tenantId]
    }) as any[];

    if (taskRows.length === 0) return { success: false, error: 'Görev bulunamadı.' };
    const task = taskRows[0];
    const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
    const botDel = metadata.bot_delegation || {};

    if (task.status !== 'pending' && task.status !== 'in_progress') {
      return { success: false, error: 'Görev zaten işlenmiş.' };
    }

    // Guard: generated_draft_at or notification_sent_at exists -> avoid repeat processing
    if (botDel.generated_draft_at && botDel.notification_sent_at) {
      return { success: true, skipped: true, reason: 'already_processed' };
    }

    // 2. Evaluate Stop Rules
    const stopRules = new StopRuleEngine(this.db);
    const stopResult = await stopRules.evaluate({
      tenantId: this.db.tenantId,
      opportunityId: task.opportunity_id,
      phoneNumber: task.phone_number,
      taskType: task.task_type,
      taskCreatedAt: task.created_at,
      taskId: task.id
    });

    if (stopResult.shouldStop) {
      const stopReason = stopResult.reason || 'coordinator_cancelled';
      if (!dryRun) {
        // Cancel task in DB
        await this.db.executeSafe({
          text: `UPDATE follow_up_tasks SET status = 'cancelled', skipped_reason = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
          values: [`StopRule: ${stopReason}`, taskId, this.db.tenantId]
        });

        // Write outreach log (Action: bot_delegation_skipped / bot_delegation_cancelled)
        const outreachAction = ['opportunity_terminal_stage', 'parent_appointment_cancelled', 'parent_reminder_cancelled', 'patient_responded_after_delegation'].includes(stopReason) 
          ? 'bot_delegation_skipped' 
          : 'bot_delegation_cancelled';

        await this.db.executeSafe({
          text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
                 VALUES ($1, $2, $3, 'system', 'cron_v2', $4)`,
          values: [
            this.db.tenantId,
            task.opportunity_id,
            outreachAction,
            JSON.stringify({
              mode: botDel.mode,
              task_id: taskId,
              reason: stopReason,
              zero_outbound_p0: true
            })
          ]
        });
      }
      return { success: true, stopped: true, reason: stopReason };
    }

    // 3. Context Builder
    const warnings: string[] = [];
    const pName = task.patient_name;
    const country = task.country;
    const summary = task.summary;
    
    if (!pName) warnings.push('missing_patient_name');
    if (!country) warnings.push('missing_timezone');
    if (!summary) warnings.push('missing_summary');

    // Get parent appointment context if any
    let apptDueAt = null;
    let apptType = null;
    const apptId = botDel.appointment_task_id || botDel.parent_task_id;
    if (apptId) {
      const apptRes = await this.db.executeSafe({
        text: `SELECT due_at, metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [apptId, this.db.tenantId]
      }) as any[];
      if (apptRes.length > 0) {
        apptDueAt = apptRes[0].due_at;
        const apptMeta = typeof apptRes[0].metadata === 'string' ? JSON.parse(apptRes[0].metadata) : apptRes[0].metadata;
        apptType = apptMeta?.appointment_type;
      }
    }
    
    if (['confirm_phone_call', 'clinic_appointment_reminder', 'appointment_reschedule_request'].includes(botDel.mode) && !apptDueAt) {
      warnings.push('missing_appointment_time');
    }

    // Dual Clock formatting
    const tzRes = resolvePatientTimezone(country);
    const dualClock = apptDueAt ? formatDualClock(apptDueAt, country) : { tenantTime: undefined, patientTime: undefined };

    // Turkey time now
    let turkeyTimeNow = '';
    try {
      turkeyTimeNow = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    } catch (_) {}

    // Patient time now
    let patientTimeNow = '';
    if (tzRes.timezone) {
      try {
        patientTimeNow = new Date().toLocaleString('tr-TR', { timeZone: tzRes.timezone });
      } catch (_) {}
    }

    // Form data summary
    let formSummary = '';
    const leadRes = await this.db.executeSafe({
      text: `SELECT form_name, raw_data FROM leads WHERE linked_opportunity_id = $1 AND tenant_id = $2 LIMIT 1`,
      values: [task.opportunity_id, this.db.tenantId]
    }) as any[];
    if (leadRes.length > 0) {
      const raw = typeof leadRes[0].raw_data === 'string' ? JSON.parse(leadRes[0].raw_data) : leadRes[0].raw_data;
      if (raw) {
        formSummary = `${leadRes[0].form_name || 'Web Form'}: ` + Object.entries(raw)
          .filter(([k]) => !['_all_phones', 'id', 'form_id', 'ad_id', 'adgroup_id', 'campaign_id', 'leadgen_id', 'platform'].includes(k))
          .map(([k, v]) => `${k}=${v}`).join(', ').slice(0, 100);
      }
    }

    // Last message time
    let lastMsgTime = null;
    const msgRes = await this.db.executeSafe({
      text: `SELECT created_at FROM messages WHERE phone_number = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
      values: [task.phone_number, this.db.tenantId]
    }) as any[];
    if (msgRes.length > 0) {
      lastMsgTime = msgRes[0].created_at;
    } else {
      warnings.push('missing_conversation');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const patientDisplayName = pName || 'Değerli Hastamız';
    let draftMsg = '';

    // Date parsing for templates
    let dateStr = 'belirlenen tarihteki';
    if (apptDueAt) {
      try {
        dateStr = new Date(apptDueAt).toLocaleString('tr-TR', {
          timeZone: 'Europe/Istanbul',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch (_) {}
    }

    const activeDirective = botDel.active_bot_directive || metadata.active_bot_directive || task.metadata?.active_bot_directive;

    if (activeDirective) {
      if (apiKey) {
        try {
          const tenantRows = await this.db.executeSafe({
            text: `SELECT name FROM tenants WHERE id = $1 /* tenant_id */ LIMIT 1`,
            values: [this.db.tenantId]
          }) as any[];
          const tenantName = tenantRows[0]?.name || 'Başkent Sağlık';

          // 1. Fetch active WhatsApp prompt template for the tenant
          const { defaultPrompts } = await import('@/lib/domain/conversation/prompts');
          const promptsData = await this.db.executeSafe({
            text: `SELECT prompt_text FROM channel_prompts 
                   WHERE tenant_id = $1 AND name = 'WhatsApp System Prompt' AND is_active = true LIMIT 1`,
            values: [this.db.tenantId]
          }) as any[];
          const basePrompt = promptsData[0]?.prompt_text || defaultPrompts.whatsapp;

          // 2. Fetch recent conversation history
          const historyRows = await this.db.executeSafe({
            text: `SELECT direction, content FROM messages 
                   WHERE phone_number = $1 AND tenant_id = $2 
                   ORDER BY created_at DESC LIMIT 15`,
            values: [task.phone_number, this.db.tenantId]
          }) as any[];

          let conversationTranscript = '';
          if (historyRows && historyRows.length > 0) {
            conversationTranscript = historyRows
              .reverse()
              .map((m: any) => `[${m.direction === 'in' ? 'Hasta' : tenantName}]: "${m.content}"`)
              .join('\n');
          } else {
            conversationTranscript = '(Henüz konuşma geçmişi bulunmuyor)';
          }

          const systemInstruction = `Sen ${tenantName} AI Asistanısın. Görevin, koordinatörün verdiği taktik talimat doğrultusunda hastaya gönderilmek üzere ${tenantName} adına samimi, güven veren ve ikna edici bir WhatsApp mesajı yazmaktır.`;

          const prompt = `Aşağıdaki genel kurum kurallarını ve konuşma geçmişini baz alarak, koordinatörün belirttiği taktik talimata uygun olarak hastaya gönderilecek bir sonraki WhatsApp mesajını yaz.

=== GENEL KURUM VE ASİSTAN KURALLARI ===
${basePrompt}

=== HASTA İLE GÖRÜŞME GEÇMİŞİ (WHATSAPP TRANSCRIPT) ===
${conversationTranscript}

=== KOORDİNATÖRÜN TAKTİK TALİMATI ===
Lütfen hastamız ${patientDisplayName} için şu talimat doğrultusunda bir yanıt mesajı oluştur:
👉 "${activeDirective}"

=== BOTA ÖZEL YAZIM TALİMATI (ÖNEMLİ) ===
- Yazacağın mesaj, yukarıdaki konuşma geçmişinin tam olarak KALDIĞI YERDEN DEVAM ETMELİDİR.
- Son mesaj hastadan geldiyse, hastanın yazdığına (yukarıdaki son mesaja) doğrudan ve samimi bir şekilde cevap ver.
- Jenerik karşılama, kopuk başlangıçlar (Örn: "Merhaba İsa, nasılsınız?" gibi baştan alma) yapma. Eğer hastaya zaten hal hatır sorulduysa veya konuşmanın ortasındaysanız, doğrudan hastanın son ifadesine cevap vererek konuya gir.
- Sadece ve sadece hastaya gönderilecek mesajı yaz. Başına veya sonuna açıklama, tırnak işareti, "Koordinatör Notu:" gibi ifadeler KESİNLİKLE EKLEME.`;
          
          const payload = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 8192
            }
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
              draftMsg = text.trim();
            }
          }
        } catch (err) {
          log.error("Gemini dynamic draft generation failed, falling back to static templates", err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    if (!draftMsg) {
      let reason = !apiKey ? '[API Key Missing]' : '[Gemini Fetch Failed]';
      if (botDel.mode === 'unreachable_followup') {
        draftMsg = `Merhaba, bugün sizi aradık ancak ulaşamadık. Sizin için uygun olan bir görüşme saatini paylaşabilir misiniz? ${reason}`;
      } else if (botDel.mode === 'collect_phone_call_time') {
        draftMsg = `Merhaba, telefon görüşmesi için sizi arayabileceğimiz uygun bir gün ve saat paylaşabilir misiniz? ${reason}`;
      } else if (botDel.mode === 'confirm_phone_call') {
        draftMsg = `Merhaba, ${dateStr} tarihindeki telefon görüşmeniz için uygunluğunuzu teyit etmek isteriz. ${reason}`;
      } else if (botDel.mode === 'clinic_appointment_reminder') {
        draftMsg = `Merhaba, ${dateStr} tarihindeki randevunuz için katılım durumunuzu teyit etmek isteriz. ${reason}`;
      } else if (botDel.mode === 'no_response_followup') {
        draftMsg = `Merhaba, size yardımcı olabileceğimiz bir konu var mıydı? Sorularınız varsa seve seve yanıtlayabiliriz. ${reason}`;
      } else if (botDel.mode === 'report_request') {
        draftMsg = `Merhaba, elinizde paylaşmak istediğiniz belgeler varsa buradan iletebilirsiniz. Kesin değerlendirme ise hastanede ilgili uzman ekibimizin fiziksel değerlendirmesi sonrasında yapılacaktır.`;
      } else if (botDel.mode === 'appointment_reschedule_request') {
        draftMsg = `Merhaba, size ulaşamadığımız için randevu/görüşme zamanınızı yeniden planlamak isteriz. Size uygun yeni bir zaman paylaşabilir misiniz?`;
      } else {
        draftMsg = `Merhaba, sizinle randevu ve takip detaylarını görüşmek isteriz.`;
      }
    }

    // Under P0: Append coordinator only footer
    draftMsg += '\n\n*(Not: Bu taslak sadece koordinatör içindir, hastaya otomatik gönderilmez.)*';

    if (dryRun) {
      return {
        success: true,
        dry_run: true,
        task_id: taskId,
        mode: botDel.mode,
        patient_name: patientDisplayName,
        warnings,
        draft: draftMsg
      };
    }

    // 5. DB updates
    const updatedBotDel = {
      ...botDel,
      status: 'draft_ready',
      context_warnings: warnings,
      generated_draft: draftMsg,
      generated_draft_at: new Date().toISOString(),
      notification_sent_at: new Date().toISOString(),
      last_processed_at: new Date().toISOString()
    };

    const newMeta = {
      ...metadata,
      bot_delegation: updatedBotDel
    };

    // Update Handoff task status to 'in_progress' and metadata state
    await this.db.executeSafe({
      text: `UPDATE follow_up_tasks SET status = 'in_progress', metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      values: [JSON.stringify(newMeta), taskId, this.db.tenantId]
    });

    // 6. Optional: Write draft to parent appointment reminder drafts list
    // ONLY for appointment-related modes as per revision 3
    if (['confirm_phone_call', 'clinic_appointment_reminder', 'appointment_reschedule_request'].includes(botDel.mode) && apptId) {
      try {
        const parentRes = await this.db.executeSafe({
          text: `SELECT metadata FROM follow_up_tasks WHERE id = $1 AND tenant_id = $2`,
          values: [apptId, this.db.tenantId]
        }) as any[];
        
        if (parentRes.length > 0) {
          const parentMeta = typeof parentRes[0].metadata === 'string'
            ? JSON.parse(parentRes[0].metadata)
            : (parentRes[0].metadata || {});
          
          if (!parentMeta.reminder_drafts) parentMeta.reminder_drafts = [];
          
          parentMeta.reminder_drafts.push({
            reminder_type: `bot_${botDel.mode}`,
            draft: draftMsg,
            generated_at: new Date().toISOString(),
            handoff_task_id: taskId
          });
          
          await this.db.executeSafe({
            text: `UPDATE follow_up_tasks SET metadata = $1::jsonb WHERE id = $2 AND tenant_id = $3`,
            values: [JSON.stringify(parentMeta), apptId, this.db.tenantId]
          });
        }
      } catch (err) {
        log.error("Failed to append draft to parent task metadata:", err instanceof Error ? err : new Error(String(err)));
      }
    }

    // 7. Write outreach_log (Action: bot_delegation_draft_prepared)
    await this.db.executeSafe({
      text: `INSERT INTO outreach_logs (tenant_id, opportunity_id, action, channel, actor_id, metadata)
             VALUES ($1, $2, 'bot_delegation_draft_prepared', 'system', 'cron_v2', $3)`,
      values: [
        this.db.tenantId,
        task.opportunity_id,
        JSON.stringify({
          mode: botDel.mode,
          task_id: taskId,
          parent_task_id: botDel.parent_task_id || null,
          appointment_task_id: botDel.appointment_task_id || null,
          draft: draftMsg,
          zero_outbound_p0: true,
          initiated_from: 'bot_delegation_orchestrator'
        })
      ]
    });

    // 8. Send Panel Notification (category: bot_delegation_ready)
    const notifService = new NotificationService(this.db);
    const maskedPhone = this.maskPhone(task.phone_number);
    const titleMap: Record<BotDelegationMode, string> = {
      unreachable_followup: 'Ulaşılamadı',
      collect_phone_call_time: 'Uygun Saat İsteme',
      confirm_phone_call: 'Görüşme Teyidi',
      clinic_appointment_reminder: 'Randevu Teyidi',
      no_response_followup: 'Cevapsız Fırsat',
      report_request: 'Rapor/Belge İsteme',
      appointment_reschedule_request: 'Randevu Erteleme'
    };

    await notifService.send({
      tenantId: this.db.tenantId,
      category: 'bot_delegation_ready', // whitelist map category
      title: `🤖 Bot Takip Taslağı Hazır (${titleMap[botDel.mode as BotDelegationMode] || botDel.mode})`,
      body: `Hasta: ${patientDisplayName} (${maskedPhone}). Yapay zeka taslağı hazırlandı, hastaya otomatik gönderilmedi.`,
      priority: task.priority === 'hot' ? 'high' : 'normal',
      opportunityId: task.opportunity_id,
      taskId: taskId,
      phoneNumber: task.phone_number,
      metadata: {
        mode: botDel.mode,
        patient_name: patientDisplayName,
        country: country,
        draft: draftMsg,
        zero_outbound_p0: true
      }
    });

    return {
      success: true,
      processed: true,
      task_id: taskId,
      mode: botDel.mode,
      warnings,
      draft: draftMsg,
      duration_ms: Date.now() - startTime
    };
  }
}
