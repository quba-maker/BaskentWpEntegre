import { TenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';
import { normalizePhoneForIdentity, parseAllPhones } from '@/lib/utils/phone-identity';
import { ExpectsReplyClassifier } from '@/lib/services/classification/expects-reply-classifier';
import { resolvePatientTimeDisplay } from '@/lib/utils/timezone';
import { TemplateResolverService } from '@/lib/services/template-resolver.service';
import { NotificationService } from '@/lib/services/notification.service';
import { SecondaryPhoneFallbackService } from '@/lib/services/secondary-phone-fallback.service';

const log = logger.withContext({ module: 'NoReplyAutomationService' });

export interface NoReplyAutomationSettings {
  enabled: boolean;
  mode: 'draft_only';
  firstReminderAfterHours: number;
  secondReminderAfterHours: number | null;
  thirdReminderAfterHours: number | null;
  maxAttempts: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  usePatientLocalTime: boolean;
  requireCoordinatorApproval: boolean;
  secondaryFallbackEnabled: boolean;
  templateFallbackEnabled: boolean;
}

export const DEFAULT_SETTINGS: NoReplyAutomationSettings = {
  enabled: false,
  mode: 'draft_only',
  firstReminderAfterHours: 3,
  secondReminderAfterHours: 6,
  thirdReminderAfterHours: 24,
  maxAttempts: 3,
  quietHoursEnabled: true,
  quietHoursStart: '21:00',
  quietHoursEnd: '09:00',
  usePatientLocalTime: true,
  requireCoordinatorApproval: true,
  secondaryFallbackEnabled: false,
  templateFallbackEnabled: false
};

const OPT_OUT_KEYWORDS = [
  "dur", "stop", "istemiyorum", "rahatsız etmeyin", "mesaj atmayın",
  "bırakın", "silin", "arama", "yazma", "unsubscribe", "don't write"
];

// Helper to check if a time is within quiet hours in a given timezone
function isTimeInQuietHours(date: Date, timezone: string, startStr: string, endStr: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const formatted = formatter.format(date);
    const [h, m] = formatted.split(':').map(Number);
    const currentMinutes = h * 60 + m;

    const [startHour, startMin] = startStr.split(':').map(Number);
    const startMinutes = startHour * 60 + (startMin || 0);

    const [endHour, endMin] = endStr.split(':').map(Number);
    const endMinutes = endHour * 60 + (endMin || 0);

    if (startMinutes < endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  } catch (err) {
    log.error('Quiet hours check failed, defaulting to false', err as Error);
    return false;
  }
}

// Helper to get next operational hour (out of quiet hours)
function getNextOperationalTime(date: Date, timezone: string, startStr: string, endStr: string): Date {
  let checkDate = new Date(date.getTime());
  // Add 15 minutes at a time up to 96 times (24 hours) to find when quiet hours end
  for (let i = 0; i < 96; i++) {
    checkDate = new Date(checkDate.getTime() + 15 * 60 * 1000);
    if (!isTimeInQuietHours(checkDate, timezone, startStr, endStr)) {
      return checkDate;
    }
  }
  return new Date(date.getTime() + 12 * 60 * 60 * 1000); // Safety fallback
}

export class NoReplyAutomationService {
  /**
   * Fetch current settings for a tenant. Re-creates missing default row automatically.
   */
  static async getNoReplyAutomationSettings(db: TenantDB, tenantId: string): Promise<NoReplyAutomationSettings> {
    const rows = await db.executeSafe({
      text: `SELECT is_active, metadata FROM automation_rules WHERE tenant_id = $1 AND trigger_event = 'no_reply_automation' LIMIT 1`,
      values: [tenantId]
    }) as any[];

    if (rows.length === 0) {
      const settings = { ...DEFAULT_SETTINGS };
      await db.executeSafe({
        text: `INSERT INTO automation_rules (tenant_id, name, description, trigger_event, is_active, metadata)
               VALUES ($1, 'No-Reply Reminder Rule', 'Automated reminders for conversations awaiting reply', 'no_reply_automation', false, $2::jsonb)`,
        values: [tenantId, JSON.stringify(settings)]
      });
      return settings;
    }

    const row = rows[0];
    const meta = row.metadata || {};
    return {
      enabled: !!row.is_active,
      mode: 'draft_only', // Hardcoded as draft_only for safety in this phase
      firstReminderAfterHours: meta.firstReminderAfterHours ?? DEFAULT_SETTINGS.firstReminderAfterHours,
      secondReminderAfterHours: meta.secondReminderAfterHours !== undefined ? meta.secondReminderAfterHours : DEFAULT_SETTINGS.secondReminderAfterHours,
      thirdReminderAfterHours: meta.thirdReminderAfterHours !== undefined ? meta.thirdReminderAfterHours : DEFAULT_SETTINGS.thirdReminderAfterHours,
      maxAttempts: meta.maxAttempts ?? DEFAULT_SETTINGS.maxAttempts,
      quietHoursEnabled: meta.quietHoursEnabled ?? DEFAULT_SETTINGS.quietHoursEnabled,
      quietHoursStart: meta.quietHoursStart || DEFAULT_SETTINGS.quietHoursStart,
      quietHoursEnd: meta.quietHoursEnd || DEFAULT_SETTINGS.quietHoursEnd,
      usePatientLocalTime: meta.usePatientLocalTime ?? DEFAULT_SETTINGS.usePatientLocalTime,
      requireCoordinatorApproval: true, // Hardcoded for coordinator review safety
      secondaryFallbackEnabled: !!meta.secondaryFallbackEnabled,
      templateFallbackEnabled: !!meta.templateFallbackEnabled
    };
  }

  /**
   * Save settings for a tenant.
   */
  static async updateNoReplyAutomationSettings(db: TenantDB, tenantId: string, settings: Partial<NoReplyAutomationSettings>): Promise<NoReplyAutomationSettings> {
    const current = await this.getNoReplyAutomationSettings(db, tenantId);
    const merged = { ...current, ...settings, mode: 'draft_only' as const, requireCoordinatorApproval: true };

    await db.executeSafe({
      text: `UPDATE automation_rules 
             SET is_active = $1, metadata = $2::jsonb, updated_at = NOW()
             WHERE tenant_id = $3 AND trigger_event = 'no_reply_automation'`,
      values: [merged.enabled, JSON.stringify(merged), tenantId]
    });

    return merged;
  }

  /**
   * Dry-run simulation. Returns statistics and 10 sample candidates.
   */
  static async runNoReplyAutomationDryRun(db: TenantDB, tenantId: string) {
    const settings = await this.getNoReplyAutomationSettings(db, tenantId);
    
    // Scan all candidates
    const candidates = await this.fetchPotentialCandidates(db, tenantId);
    
    let totalEligible = 0;
    let attempt1Count = 0;
    let attempt2Count = 0;
    let attempt3Count = 0;
    let blockedOptOut = 0;
    let blockedTerminal = 0;
    let blockedClosing = 0;
    let blockedQuietHours = 0;
    let blockedTemplateMissing = 0;
    let secondaryFallbackCount = 0;
    let maxAttemptsReached = 0;

    const samples: any[] = [];

    // Global sets/maps to track limits on patient level
    const patientProcessedInRun = new Set<string>();
    const processedOpps = new Set<string>();
    const processedLeads = new Set<string>();
    const processedCustomers = new Set<string>();

    for (const c of candidates) {
      const eligibility = await this.evaluateEligibility(db, tenantId, c);
      
      if (!eligibility.valid) {
        if (eligibility.reason === 'terminal_stage') blockedTerminal++;
        else if (eligibility.reason === 'opt_out') blockedOptOut++;
        else if (eligibility.reason === 'closing_message') blockedClosing++;
        continue;
      }

      // Check classification
      const content = c.last_message_content || '';
      const classifier = ExpectsReplyClassifier.classify(content);
      if (!classifier.expectsReply) {
        blockedClosing++;
        continue;
      }
      if (classifier.confidence === 'low') {
        continue;
      }

      totalEligible++;

      // Check attempts
      const attemptRes = await this.evaluateAttempt(db, tenantId, c, settings);
      
      // Patient level dedupe check
      const phoneId = normalizePhoneForIdentity(c.phone_number).e164 || c.phone_number;
      
      // Extract and parse family phones
      let parsedRaw = c.form_raw_data;
      if (typeof parsedRaw === 'string') {
        try { parsedRaw = JSON.parse(parsedRaw); } catch(_) {}
      }
      const familyPhones: string[] = [];
      if (parsedRaw && parsedRaw._all_phones) {
        const parsed = parseAllPhones(parsedRaw._all_phones);
        for (const p of parsed) {
          const pNorm = normalizePhoneForIdentity(p).e164;
          if (pNorm) familyPhones.push(pNorm);
        }
      }

      const alreadyProcessed = patientProcessedInRun.has(phoneId) ||
        familyPhones.some(p => patientProcessedInRun.has(p)) ||
        (c.active_opportunity_id && processedOpps.has(c.active_opportunity_id)) ||
        (c.lead_id && processedLeads.has(c.lead_id)) ||
        (c.customer_id && processedCustomers.has(c.customer_id));

      let quietHoursBlock = false;
      let templateMissing = false;
      let recAction = '';
      let riskReason = '';

      if (attemptRes.maxAttemptsReached) {
        maxAttemptsReached++;
        recAction = 'human_review';
        riskReason = 'Maksimum deneme sınırına ulaşıldı';
      } else if (attemptRes.attemptNumber === 0) {
        // No attempt due yet
        recAction = 'skip_no_time_yet';
        riskReason = 'Takip süresi henüz gelmedi';
      } else {
        if (attemptRes.attemptNumber === 1) attempt1Count++;
        else if (attemptRes.attemptNumber === 2) attempt2Count++;
        else if (attemptRes.attemptNumber === 3) attempt3Count++;

        // Quiet hours check
        const tz = settings.usePatientLocalTime && !attemptRes.timeDisplay.needsTimezoneClarification
          ? attemptRes.timeDisplay.patientTimezone!
          : 'Europe/Istanbul';

        if (settings.quietHoursEnabled && isTimeInQuietHours(new Date(), tz, settings.quietHoursStart, settings.quietHoursEnd)) {
          blockedQuietHours++;
          quietHoursBlock = true;
          riskReason = 'Sessiz saatler (gece) nedeniyle ertelendi';
        }

        // Template/Window check
        if (!attemptRes.windowOpen) {
          if (settings.templateFallbackEnabled) {
            const templateCtx = {
              tenantId,
              tenantName: 'Başkent Hastanesi',
              patientName: c.patient_name || undefined,
              phoneNumber: c.phone_number,
              country: c.opp_country || undefined
            };
            const resolved = await TemplateResolverService.resolve(db, templateCtx, 'auto', 'remarketing');
            if (!resolved.templateId) {
              blockedTemplateMissing++;
              templateMissing = true;
              riskReason = '24 saat penceresi kapalı ve onaylı şablon bulunamadı';
            }
          } else {
            blockedTemplateMissing++;
            templateMissing = true;
            riskReason = '24 saat penceresi kapalı ve şablon otomasyonu kapalı';
          }
        }

        if (alreadyProcessed) {
          riskReason = 'Günlük limit aşımı (aynı hasta)';
          recAction = 'skip_duplicate_patient';
        } else if (attemptRes.alreadyAttemptedToday) {
          riskReason = 'Son 24 saat içinde zaten hatırlatma oluşturulmuş';
          recAction = 'skip_already_attempted';
        } else {
          recAction = templateMissing ? 'template_required_task' : `create_draft_attempt_${attemptRes.attemptNumber}`;
          patientProcessedInRun.add(phoneId);
          for (const fp of familyPhones) {
            patientProcessedInRun.add(fp);
          }
          if (c.active_opportunity_id) processedOpps.add(c.active_opportunity_id);
          if (c.lead_id) processedLeads.add(c.lead_id);
          if (c.customer_id) processedCustomers.add(c.customer_id);
        }
      }

      // Check secondary phone fallback eligibility
      if (settings.secondaryFallbackEnabled) {
        const secFallback = new SecondaryPhoneFallbackService(db, tenantId);
        const secElig = await secFallback.checkEligibility(c.conversation_id);
        if (secElig.eligible) {
          secondaryFallbackCount++;
          if (recAction === 'skip_no_time_yet' || recAction.startsWith('skip')) {
            recAction = 'secondary_fallback_task';
            riskReason = 'İkincil telefondan takip uygun';
          }
        }
      }

      if (samples.length < 10) {
        samples.push({
          conversation_id: c.conversation_id,
          patient_name: c.patient_name || 'Bilinmiyor',
          last_outbound_at: c.last_message_at,
          no_reply_hours: attemptRes.noReplyHours,
          attempt_number: attemptRes.attemptNumber,
          window_open: attemptRes.windowOpen,
          requires_template: !attemptRes.windowOpen && templateMissing,
          quiet_hours_block: quietHoursBlock,
          recommended_action: recAction,
          risk_reason: riskReason
        });
      }
    }

    return {
      settings,
      summary: {
        totalEligible,
        attempt1Count,
        attempt2Count,
        attempt3Count,
        blockedOptOut,
        blockedTerminal,
        blockedClosing,
        blockedQuietHours,
        blockedTemplateMissing,
        secondaryFallbackCount,
        maxAttemptsReached,
        estimatedTasksToCreate: Math.min(10, Array.from(patientProcessedInRun).length)
      },
      samples
    };
  }

  /**
   * Main ticker method executed by cron. Performs real reminders task generation.
   */
  static async runNoReplyAutomationTick(db: TenantDB, tenantId: string, options: { dryRun: boolean }) {
    const isDryRun = !!options.dryRun;
    
    // Safety check env
    if (process.env.ENABLE_NO_REPLY_AUTOMATION !== 'true' && !isDryRun) {
      log.info('[TICK_SKIP] ENABLE_NO_REPLY_AUTOMATION environment variable is not true. Skipping real run.');
      return { success: false, reason: 'env_disabled' };
    }

    const settings = await this.getNoReplyAutomationSettings(db, tenantId);
    if (!settings.enabled && !isDryRun) {
      log.info('[TICK_SKIP] No-reply automation settings is disabled for tenant', { tenantId });
      return { success: false, reason: 'settings_disabled' };
    }

    if (settings.mode !== 'draft_only' && !isDryRun) {
      log.info('[TICK_SKIP] No-reply automation mode is not draft_only. Skipping real run.');
      return { success: false, reason: 'mode_not_draft_only' };
    }

    log.info('[TICK_START] Running no-reply automation tick', { tenantId, isDryRun });

    if (!isDryRun) {
      // Cancel any pending no_reply_followup / template_required_task tasks if the patient has replied (last message is inbound)
      try {
        const cancelledResult = await db.executeSafe({
          text: `UPDATE follow_up_tasks t
                 SET status = 'skipped', 
                     metadata = jsonb_set(COALESCE(t.metadata, '{}'::jsonb), '{skip_reason}', '"patient_replied"'::jsonb),
                     updated_at = NOW()
                 WHERE t.tenant_id = $1 
                   AND t.task_type IN ('no_reply_followup', 'template_required_task')
                   AND t.status = 'pending'
                   AND EXISTS (
                     SELECT 1 FROM conversations c
                     LEFT JOIN LATERAL (
                       SELECT direction FROM messages 
                       WHERE conversation_id = c.id AND tenant_id = c.tenant_id
                         AND direction IN ('in', 'out')
                         AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
                       ORDER BY created_at DESC LIMIT 1
                     ) m ON true
                     WHERE c.id::text = t.conversation_id AND c.tenant_id = t.tenant_id AND m.direction = 'in'
                   )`,
          values: [tenantId]
        }) as any;
        if (cancelledResult && cancelledResult.rowCount > 0) {
          log.info(`[TICK_CLEANUP] Automatically skipped ${cancelledResult.rowCount} pending tasks because patients replied.`);
        }
      } catch (cleanErr) {
        log.error('[TICK_CLEANUP_ERROR] Failed to auto-skip pending tasks', cleanErr as Error);
      }
    }

    const candidates = await this.fetchPotentialCandidates(db, tenantId);
    
    let processedCount = 0;
    let tasksCreatedCount = 0;
    let skippedCount = 0;
    const actionsTaken: any[] = [];

    // Limit trackers
    const maxCandidates = 20;
    const maxTasksCreated = 10;
    
    // Daily limits on patient level
    const patientProcessedInRun = new Set<string>();
    const processedOpps = new Set<string>();
    const processedLeads = new Set<string>();
    const processedCustomers = new Set<string>();

    const slicedCandidates = candidates.slice(0, maxCandidates);

    for (const c of slicedCandidates) {
      if (tasksCreatedCount >= maxTasksCreated) {
        log.info('[TICK_LIMIT] Reached maxTasksCreated limit (10) for this run. Stopping.');
        break;
      }

      const eligibility = await this.evaluateEligibility(db, tenantId, c);
      if (!eligibility.valid) {
        skippedCount++;
        continue;
      }

      // Check expects reply classifier
      const content = c.last_message_content || '';
      const classifier = ExpectsReplyClassifier.classify(content);
      if (!classifier.expectsReply || classifier.confidence === 'low') {
        skippedCount++;
        continue;
      }

      const attemptRes = await this.evaluateAttempt(db, tenantId, c, settings);
      
      const phoneId = normalizePhoneForIdentity(c.phone_number).e164 || c.phone_number;

      // Extract and parse family phones
      let parsedRaw = c.form_raw_data;
      if (typeof parsedRaw === 'string') {
        try { parsedRaw = JSON.parse(parsedRaw); } catch(_) {}
      }
      const familyPhones: string[] = [];
      if (parsedRaw && parsedRaw._all_phones) {
        const parsed = parseAllPhones(parsedRaw._all_phones);
        for (const p of parsed) {
          const pNorm = normalizePhoneForIdentity(p).e164;
          if (pNorm) familyPhones.push(pNorm);
        }
      }

      const alreadyProcessed = patientProcessedInRun.has(phoneId) ||
        familyPhones.some(p => patientProcessedInRun.has(p)) ||
        (c.active_opportunity_id && processedOpps.has(c.active_opportunity_id)) ||
        (c.lead_id && processedLeads.has(c.lead_id)) ||
        (c.customer_id && processedCustomers.has(c.customer_id));

      // Duplicate validations
      if (alreadyProcessed || attemptRes.alreadyAttemptedToday) {
        skippedCount++;
        continue;
      }

      // Max attempts check
      if (attemptRes.maxAttemptsReached) {
        // Create human review task
        if (!isDryRun) {
          const hasReviewTask = await db.executeSafe({
            text: `SELECT id FROM follow_up_tasks 
                   WHERE tenant_id = $1 AND phone_number = $2 AND task_type = 'no_reply_followup' 
                     AND (metadata->>'max_attempts_reached' = 'true') AND status = 'pending' LIMIT 1`,
            values: [tenantId, c.phone_number]
          }) as any[];

          if (hasReviewTask.length === 0) {
            await db.executeSafe({
              text: `INSERT INTO follow_up_tasks (
                       tenant_id, opportunity_id, conversation_id, phone_number,
                       task_type, title, description, due_at, is_automated, created_by, source_event, metadata
                     ) VALUES ($1, $2, $3, $4, 'no_reply_followup', $5, $6, NOW(), true, 'no_reply_automation', 'max_attempts', $7::jsonb)`,
              values: [
                tenantId,
                c.active_opportunity_id,
                c.conversation_id,
                c.phone_number,
                'Cevap alınamadı - Koordinatör İncelemesi Gerekli',
                `Hasta ${settings.maxAttempts} hatırlatma denemesine rağmen dönüş yapmadı. Lütfen durumu manuel inceleyin.`,
                JSON.stringify({
                  source: 'no_reply_automation',
                  max_attempts_reached: true,
                  last_outbound_message_id: c.last_message_id,
                  auto_send_enabled: false
                })
              ]
            });
            tasksCreatedCount++;
          }
        }
        processedCount++;
        patientProcessedInRun.add(phoneId);
        for (const fp of familyPhones) {
          patientProcessedInRun.add(fp);
        }
        if (c.active_opportunity_id) processedOpps.add(c.active_opportunity_id);
        if (c.lead_id) processedLeads.add(c.lead_id);
        if (c.customer_id) processedCustomers.add(c.customer_id);
        actionsTaken.push({ phone: c.phone_number, action: 'human_review_task_created' });
        continue;
      }

      if (attemptRes.attemptNumber > 0) {
        // We have a valid attempt to trigger
        const attempt = attemptRes.attemptNumber;
        
        // Quiet hours handling (if timezone confidence is low, fallback to Turkey)
        const tz = settings.usePatientLocalTime && attemptRes.timeDisplay.patientTimezone
          ? attemptRes.timeDisplay.patientTimezone
          : 'Europe/Istanbul';

        let dueAt = new Date();
        let quietHoursPostponed = false;

        if (settings.quietHoursEnabled && isTimeInQuietHours(dueAt, tz, settings.quietHoursStart, settings.quietHoursEnd)) {
          dueAt = getNextOperationalTime(dueAt, tz, settings.quietHoursStart, settings.quietHoursEnd);
          quietHoursPostponed = true;
          log.info('[QUIET_HOURS_POSTPONE] Postponing task due_at due to quiet hours', {
            phone: c.phone_number,
            timezone: tz,
            adjustedDueAt: dueAt.toISOString()
          });
        }

        // Draft message template fallback
        let draftText = '';
        let templateRequired = false;

        if (attemptRes.windowOpen) {
          draftText = "Merhaba, müsait olduğunuzda geri dönüş yapabilirseniz size yardımcı olmaktan memnuniyet duyarız. İyi günler dileriz.";
        } else {
          templateRequired = true;
          if (settings.templateFallbackEnabled) {
            const templateCtx = {
              tenantId,
              tenantName: 'Başkent Hastanesi',
              patientName: c.patient_name || undefined,
              phoneNumber: c.phone_number,
              country: c.opp_country || undefined
            };
            const resolved = await TemplateResolverService.resolve(db, templateCtx, 'auto', 'remarketing');
            if (resolved.templateId) {
              draftText = resolved.rendered;
              templateRequired = false; // Resolved successfully
            } else {
              draftText = "24 saat penceresi kapalı. Onaylı WhatsApp template tanımlanmadan otomatik gönderim yapılamaz.";
            }
          } else {
            draftText = "24 saat penceresi kapalı. Onaylı WhatsApp template tanımlanmadan otomatik gönderim yapılamaz.";
          }
        }
        if (draftText && !templateRequired) {
          const { sanitizePatientFacingMessage } = await import('@/lib/utils/patient-message-sanitizer');
          draftText = sanitizePatientFacingMessage(draftText);
        }

        // Generate dedupe_key
        const dedupeKey = `no_reply_att_${attempt}_msg_${c.last_message_id}`;

        if (!isDryRun) {
          // Double verify duplicate guard against both follow_up_tasks and outreach_logs
          const taskDuplicate = await db.executeSafe({
            text: `SELECT id FROM follow_up_tasks 
                   WHERE tenant_id = $1 AND conversation_id = $2
                     AND (
                       metadata->>'dedupe_key' = $3 
                       OR (metadata->>'last_outbound_message_id' = $4 AND (metadata->>'attempt_number')::int = $5)
                     )
                     AND status IN ('pending', 'in_progress', 'completed', 'snoozed')
                   LIMIT 1`,
            values: [tenantId, c.conversation_id, dedupeKey, c.last_message_id, attempt]
          }) as any[];

          const logDuplicate = await db.executeSafe({
            text: `SELECT id FROM outreach_logs 
                   WHERE tenant_id = $1 AND conversation_id = $2
                     AND (
                       metadata->>'dedupe_key' = $3 
                       OR (metadata->>'last_outbound_message_id' = $4 AND (metadata->>'attempt_number')::int = $5)
                     )
                   LIMIT 1`,
            values: [tenantId, c.conversation_id, dedupeKey, c.last_message_id, attempt]
          }) as any[];

          if (taskDuplicate.length > 0 || logDuplicate.length > 0) {
            skippedCount++;
            continue;
          }

          // Create draft task metadata
          const taskMetadata = {
            source: 'no_reply_automation',
            mode: 'draft_only',
            attempt_number: attempt,
            last_outbound_message_id: c.last_message_id,
            expects_reply_reason: classifier.reason,
            no_reply_hours: attemptRes.noReplyHours,
            window_open: attemptRes.windowOpen,
            requires_template: templateRequired,
            auto_send_enabled: false,
            sent: false,
            draft_text: draftText,
            dedupe_key: dedupeKey,
            quiet_hours_postponed: quietHoursPostponed
          };

          // Priority logic (high if third attempt or quiet hours postponed)
          const priority = attempt === 3 ? 'high' : 'normal';

          const title = templateRequired
            ? 'Cevap bekleyen hasta için şablon hatırlatma taslağı'
            : `Cevap bekleyen hasta için hatırlatma taslağı (${attempt}. Takip)`;

          const taskType = templateRequired ? 'template_required_task' : 'no_reply_followup';

          await db.executeSafe({
            text: `INSERT INTO follow_up_tasks (
                     tenant_id, opportunity_id, conversation_id, phone_number,
                     task_type, title, description, due_at, is_automated, created_by, source_event, metadata
                   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'no_reply_automation', 'tick', $9::jsonb)`,
            values: [
              tenantId,
              c.active_opportunity_id,
              c.conversation_id,
              c.phone_number,
              taskType,
              title,
              draftText,
              dueAt.toISOString(),
              JSON.stringify(taskMetadata)
            ]
          });

          // Insert into outreach_logs
          await db.executeSafe({
            text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, opportunity_id, action, channel, actor_id, metadata)
                   VALUES ($1, $2, $3, $4, 'no_reply_automation_draft_created', 'whatsapp', 'system', $5::jsonb)`,
            values: [
              tenantId,
              c.lead_id || null,
              c.conversation_id,
              c.active_opportunity_id || null,
              JSON.stringify(taskMetadata)
            ]
          });

          // Send panel notification
          const notifService = new NotificationService(db);
          await notifService.send({
            tenantId,
            category: 'overdue_task',
            title: `⏳ Hatırlatma Taslağı Hazır (${attempt}. Takip)`,
            body: `${c.patient_name || c.phone_number} için takip taslağı oluşturuldu.`,
            priority: priority,
            opportunityId: c.active_opportunity_id,
            conversationId: c.conversation_id,
            phoneNumber: c.phone_number,
            metadata: {
              attempt_number: attempt,
              draft_message: draftText
            }
          });

          tasksCreatedCount++;
        }

        processedCount++;
        patientProcessedInRun.add(phoneId);
        for (const fp of familyPhones) {
          patientProcessedInRun.add(fp);
        }
        if (c.active_opportunity_id) processedOpps.add(c.active_opportunity_id);
        if (c.lead_id) processedLeads.add(c.lead_id);
        if (c.customer_id) processedCustomers.add(c.customer_id);
        actionsTaken.push({ phone: c.phone_number, attempt, action: 'draft_task_created', quietHoursPostponed });
      } else {
        // No attempt due, or check secondary phone fallback
        if (settings.secondaryFallbackEnabled) {
          const secFallback = new SecondaryPhoneFallbackService(db, tenantId);
          const secElig = await secFallback.checkEligibility(c.conversation_id);
          if (secElig.eligible) {
            // Create secondary fallback draft task
            if (!isDryRun) {
              const hasSecTask = await db.executeSafe({
                text: `SELECT id FROM follow_up_tasks 
                       WHERE tenant_id = $1 AND phone_number = $2 AND task_type = 'no_reply_followup' 
                         AND (metadata->>'is_secondary' = 'true') AND status = 'pending' LIMIT 1`,
                values: [tenantId, secElig.secondaryPhone]
              }) as any[];

              if (hasSecTask.length === 0) {
                const secDraft = await secFallback.prepareDraft(c.conversation_id);
                if (secDraft.success) {
                  await db.executeSafe({
                    text: `INSERT INTO follow_up_tasks (
                             tenant_id, opportunity_id, conversation_id, phone_number,
                             task_type, title, description, due_at, is_automated, created_by, source_event, metadata
                           ) VALUES ($1, $2, $3, $4, 'no_reply_followup', $5, $6, NOW(), true, 'no_reply_automation', 'secondary_fallback', $7::jsonb)`,
                    values: [
                      tenantId,
                      c.active_opportunity_id,
                      c.conversation_id,
                      secElig.secondaryPhone!,
                      'İkincil telefon için takip taslağı',
                      secDraft.draft!,
                      JSON.stringify({
                        source: 'no_reply_automation',
                        is_secondary: true,
                        primary_phone: c.phone_number,
                        secondary_phone: secElig.secondaryPhone,
                        draft_text: secDraft.draft,
                        auto_send_enabled: false
                      })
                    ]
                  });
                  tasksCreatedCount++;
                }
              }
            }
            processedCount++;
            patientProcessedInRun.add(phoneId);
            for (const fp of familyPhones) {
              patientProcessedInRun.add(fp);
            }
            if (c.active_opportunity_id) processedOpps.add(c.active_opportunity_id);
            if (c.lead_id) processedLeads.add(c.lead_id);
            if (c.customer_id) processedCustomers.add(c.customer_id);
            actionsTaken.push({ phone: c.phone_number, action: 'secondary_fallback_task_created' });
          }
        }
      }
    }

    return {
      success: true,
      processedCount,
      tasksCreatedCount,
      skippedCount,
      actionsTaken
    };
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  private static async fetchPotentialCandidates(db: TenantDB, tenantId: string): Promise<any[]> {
    return await db.executeSafe({
      text: `SELECT 
              c.id as conversation_id,
              c.phone_number,
              c.patient_name,
              c.active_opportunity_id,
              c.customer_id,
              active_opp.stage as opp_stage,
              active_opp.metadata as opp_metadata,
              active_opp.automation_status as opp_automation_status,
              active_opp.country as opp_country,
              m.id as last_message_id,
              m.content as last_message_content,
              m.created_at as last_message_at,
              l.id as lead_id,
              l.raw_data as form_raw_data,
              l.phone_number as lead_phone
            FROM conversations c
            LEFT JOIN opportunities active_opp 
              ON active_opp.id = c.active_opportunity_id 
              AND active_opp.tenant_id = c.tenant_id
            LEFT JOIN LATERAL (
              SELECT id, content, created_at, direction
              FROM messages 
              WHERE conversation_id = c.id 
                AND tenant_id = c.tenant_id
                AND direction IN ('in', 'out')
                AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
              ORDER BY created_at DESC 
              LIMIT 1
            ) m ON true
            LEFT JOIN LATERAL (
              SELECT id, raw_data, phone_number
              FROM leads 
              WHERE leads.tenant_id = c.tenant_id
                AND (
                  (c.customer_id IS NOT NULL AND leads.customer_id = c.customer_id)
                  OR leads.phone_number = c.phone_number
                )
              ORDER BY created_at DESC 
              LIMIT 1
            ) l ON true
            WHERE c.tenant_id = $1
              AND m.direction = 'out'
              AND (active_opp.id IS NULL OR active_opp.stage NOT IN ('lost', 'not_qualified', 'arrived'))
            ORDER BY m.created_at ASC
            LIMIT 100`,
      values: [tenantId]
    }) as any[];
  }

  private static async evaluateEligibility(db: TenantDB, tenantId: string, conv: any): Promise<{ valid: boolean; reason?: string }> {
    // Stage check
    const currentStage = conv.opp_stage || '';
    if (['lost', 'not_qualified', 'arrived'].includes(currentStage)) {
      return { valid: false, reason: 'terminal_stage' };
    }

    // Automation status check
    if (conv.opp_automation_status === 'stopped' || conv.opp_automation_status === 'paused') {
      return { valid: false, reason: 'automation_disabled' };
    }

    // Opt-out checks (direct & family phone opt-out)
    const primaryNorm = normalizePhoneForIdentity(conv.phone_number).e164;
    const optOutPhones = new Set<string>();

    try {
      const optOutOpps = await db.executeSafe({
        text: `SELECT phone_number FROM opportunities WHERE tenant_id = $1 AND (COALESCE(metadata->>'opt_out_requested', 'false') = 'true')`,
        values: [tenantId]
      }) as any[];
      
      for (const o of optOutOpps) {
        const norm = normalizePhoneForIdentity(o.phone_number).e164;
        if (norm) optOutPhones.add(norm);
      }

      // Check last inbound messages for opt-out keywords
      const lastInbounds = await db.executeSafe({
        text: `SELECT phone_number, content FROM messages 
               WHERE tenant_id = $1 AND direction = 'in' AND phone_number LIKE '%' || RIGHT($2, 10)
                 AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
               ORDER BY created_at DESC LIMIT 1`,
        values: [tenantId, conv.phone_number]
      }) as any[];

      const hasOptOutKeywords = (text: string): boolean => {
        const clean = (text || '').toLowerCase().trim();
        return OPT_OUT_KEYWORDS.some(kw => clean.includes(kw));
      };

      if (lastInbounds.length > 0 && hasOptOutKeywords(lastInbounds[0].content)) {
        if (primaryNorm) optOutPhones.add(primaryNorm);
      }
    } catch (e) {
      log.error('Failed to run opt-out query', e as Error);
    }

    const isPrimaryOptedOut = (conv.opp_metadata?.opt_out_requested === true) || 
                              (conv.opp_metadata?.opt_out_requested === 'true') ||
                              (primaryNorm && optOutPhones.has(primaryNorm));

    let hasOptOutKeywordInFamily = false;
    let parsedRaw = conv.form_raw_data;
    if (typeof parsedRaw === 'string') {
      try { parsedRaw = JSON.parse(parsedRaw); } catch(_) {}
    }
    if (parsedRaw && parsedRaw._all_phones) {
      const parsed = parseAllPhones(parsedRaw._all_phones);
      for (const p of parsed) {
        const pNorm = normalizePhoneForIdentity(p).e164;
        if (pNorm && optOutPhones.has(pNorm)) {
          hasOptOutKeywordInFamily = true;
          break;
        }
      }
    }

    if (isPrimaryOptedOut || hasOptOutKeywordInFamily) {
      return { valid: false, reason: 'opt_out' };
    }

    return { valid: true };
  }

  private static async evaluateAttempt(db: TenantDB, tenantId: string, conv: any, settings: NoReplyAutomationSettings) {
    const lastOutboundTimeMs = new Date(conv.last_message_at).getTime();
    const noReplyHours = Math.round(((Date.now() - lastOutboundTimeMs) / (1000 * 60 * 60)) * 10) / 10;

    // Fetch existing follow-up tasks and outreach logs for this message and attempt
    const tasks = await db.executeSafe({
      text: `SELECT metadata->>'attempt_number' as attempt_number, created_at, status FROM follow_up_tasks 
             WHERE tenant_id = $1 AND conversation_id = $2 
               AND (metadata->>'last_outbound_message_id' = $3)
               AND metadata->>'source' = 'no_reply_automation'
               AND status IN ('pending', 'in_progress', 'completed', 'snoozed')`,
      values: [tenantId, conv.conversation_id, conv.last_message_id]
    }) as any[];

    const logs = await db.executeSafe({
      text: `SELECT metadata->>'attempt_number' as attempt_number, created_at FROM outreach_logs 
             WHERE tenant_id = $1 AND conversation_id = $2 AND (metadata->>'last_outbound_message_id' = $3) 
               AND action IN ('no_reply_automation_draft_created', 'no_reply_automation_draft_approved')
               AND metadata->>'source' = 'no_reply_automation'`,
      values: [tenantId, conv.conversation_id, conv.last_message_id]
    }) as any[];

    // Parse executed attempts
    const executedAttempts = new Set<number>();
    const parseAndAdd = (item: any) => {
      const att = parseInt(item.attempt_number || '0', 10);
      if (att > 0) executedAttempts.add(att);
    };

    tasks.forEach(parseAndAdd);
    logs.forEach(parseAndAdd);

    // Fetch any no_reply_automation tasks/logs in the last 24 hours for this patient
    // Normalize and group all possible patient phones
    const primaryPhoneNorm = normalizePhoneForIdentity(conv.phone_number).e164;
    const leadPhoneNorm = conv.lead_phone ? normalizePhoneForIdentity(conv.lead_phone).e164 : null;
    
    let parsedRaw = conv.form_raw_data;
    if (typeof parsedRaw === 'string') {
      try { parsedRaw = JSON.parse(parsedRaw); } catch(_) {}
    }
    const familyPhones: string[] = [];
    if (parsedRaw && parsedRaw._all_phones) {
      const parsed = parseAllPhones(parsedRaw._all_phones);
      for (const p of parsed) {
        const pNorm = normalizePhoneForIdentity(p).e164;
        if (pNorm) familyPhones.push(pNorm);
      }
    }

    const patientPhones = Array.from(new Set([
      conv.phone_number,
      conv.lead_phone,
      primaryPhoneNorm,
      leadPhoneNorm,
      ...familyPhones
    ].filter(Boolean) as string[]));

    let alreadyAttemptedToday = false;

    if (patientPhones.length > 0) {
      const recentTasks = await db.executeSafe({
        text: `SELECT id FROM follow_up_tasks 
               WHERE tenant_id = $1 
                 AND metadata->>'source' = 'no_reply_automation'
                 AND created_at >= NOW() - INTERVAL '24 hours'
                 AND (
                   phone_number = ANY($2::text[]) 
                   OR conversation_id = $3 
                   OR (opportunity_id IS NOT NULL AND opportunity_id = $4)
                 )
               LIMIT 1`,
        values: [tenantId, patientPhones, conv.conversation_id, conv.active_opportunity_id || null]
      }) as any[];

      const recentLogs = await db.executeSafe({
        text: `SELECT id FROM outreach_logs 
               WHERE tenant_id = $1 
                 AND metadata->>'source' = 'no_reply_automation'
                 AND created_at >= NOW() - INTERVAL '24 hours'
                 AND (
                   conversation_id = $2 
                   OR (opportunity_id IS NOT NULL AND opportunity_id = $3)
                 )
               LIMIT 1`,
        values: [tenantId, conv.conversation_id, conv.active_opportunity_id || null]
      }) as any[];

      if (recentTasks.length > 0 || recentLogs.length > 0) {
        alreadyAttemptedToday = true;
      }
    }

    // Determine next attempt: we always do the lowest missing attempt
    let attemptNumber = 0;
    let maxAttemptsReached = false;

    if (executedAttempts.size >= settings.maxAttempts) {
      maxAttemptsReached = true;
    } else {
      if (!executedAttempts.has(1)) {
        if (noReplyHours >= settings.firstReminderAfterHours) {
          attemptNumber = 1;
        }
      } else if (!executedAttempts.has(2)) {
        if (settings.secondReminderAfterHours !== null && noReplyHours >= settings.secondReminderAfterHours) {
          attemptNumber = 2;
        }
      } else if (!executedAttempts.has(3)) {
        if (settings.thirdReminderAfterHours !== null && noReplyHours >= settings.thirdReminderAfterHours) {
          attemptNumber = 3;
        }
      }
    }

    // Check 24-hour WhatsApp window
    const lastInboundMsgRows = await db.executeSafe({
      text: `SELECT created_at FROM messages WHERE conversation_id = $1 AND tenant_id = $2 AND direction = 'in'
               AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
             ORDER BY created_at DESC LIMIT 1`,
      values: [conv.conversation_id, tenantId]
    }) as any[];

    let windowOpen = false;
    if (lastInboundMsgRows.length > 0) {
      const lastInboundTimeMs = new Date(lastInboundMsgRows[0].created_at).getTime();
      windowOpen = (Date.now() - lastInboundTimeMs) <= 24 * 60 * 60 * 1000;
    }

    // Resolve timezone for quiet hours checking
    const timeDisplay = resolvePatientTimeDisplay({
      country: conv.country || conv.opp_country,
      phoneNumber: conv.phone_number,
      metadata: conv.opp_metadata,
      referenceDate: new Date()
    });

    return {
      attemptNumber,
      maxAttemptsReached,
      noReplyHours,
      windowOpen,
      timeDisplay,
      alreadyAttemptedToday
    };
  }
}
