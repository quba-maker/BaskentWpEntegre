import crypto from 'crypto';
import { TenantBrain } from '../../brain/tenant-brain';
import { ChatMessage, AIOrchestrator } from './orchestrator';
import { PromptBuilder } from './prompt-builder';
import { ContextAwareSafeFallbackResolver } from './context-aware-safe-fallback';
import { MultilingualQualityGate } from './multilingual-quality-gate';
import { TurkishMorphologyGuard } from './turkish-morphology-guard';
import { FinalOutboundGuard } from './final-outbound-guard';
import { ResponseFormattingPolicy } from './response-formatting-policy';
import { ConversationTurnAggregator } from './conversation-turn-aggregator';
import { ConversationTopicSwitchResolver } from './conversation-topic-switch-resolver';
import { DoctorDirectoryResolver } from './doctor-directory-resolver';
import { DepartmentAliasResolver } from './department-alias-resolver';
import { RecentDepartmentContextResolver } from './recent-department-context-resolver';
import { IdentityEngine } from './engines/identity';
import { withTenantDB } from '@/lib/core/tenant-db';
// P0.16-K: Consultant brain imports
import { ConsultantConversationStateResolver } from './consultant-conversation-state-resolver';
import { MultiIntentConsultantComposer } from './multi-intent-consultant-composer';
import { DoctorNamesPolicy, isDoctorNameRequestText, isDoctorProfileQuestionText } from './doctor-names-policy';
import { ConversationIntentRouter } from './conversation-intent-router';
// P0.16-L: Live/test parity pipeline imports
import { ConversationFrameResolver } from './conversation-frame-resolver';
import { WhatsAppFormattingFinalizer } from './whatsapp-formatting-finalizer';
import { TurkishFinalQualityNormalizer } from './turkish-final-quality-normalizer';
import { hasRealDatePattern } from '../../utils/date-parser';
// P0.16-M: Final pipeline enforcer — mandatory chain for all response paths
import { FinalPipelineEnforcer } from './final-pipeline-enforcer';
// P0.19: Tenant-agnostic config resolver
import { TenantConfigResolver } from './tenant-config-resolver';
import { DateAnswerResolver } from './date-answer-resolver';
import { ConversationKnownFactsResolver } from './conversation-known-facts-resolver';


export interface OrchestratorParams {
  tenantId: string;
  phoneNumber: string;
  inboundText: string;
  mediaType?: string | null;
  mediaMetadata?: any;
  brain: TenantBrain;
  channel: 'whatsapp' | 'instagram' | 'messenger' | string;
  channelId?: string;
  conversationId?: string;
  customerId?: string;
  sandbox?: boolean;
  history?: ChatMessage[]; // Optional: passed in sandbox/test mode
  workerPath?: string; // Telemetry parameter (testBot | worker_immediate | worker_delayed)
  unifiedContext?: any;
}

export interface OrchestratorResult {
  text: string;
  modelUsed: string;
  promptVersion?: string | number;
  latencyMs: number;
  bypassed: boolean;
  isRetry: boolean;
  qualityGateFailed: boolean;
  qualityGateReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  deduplicated?: boolean; // Concurrency flag
  responseDedupeKey?: string; // Telemetry
  burstAnchorId?: string; // Telemetry
  dryRun: boolean;
  replyLanguage?: string;
}

export function getOldDedupeKey(tenantId: string, channelId: string, conversationId: string, burstAnchorId: string): string {
  return `dedupe:response:${tenantId}:${channelId || 'unknown'}:${conversationId}:${burstAnchorId}`;
}

export function getNewDedupeKey(tenantId: string, channelId: string, conversationId: string, burstAnchorId: string): string {
  return `tenant:${tenantId}:dedupe:response:${channelId || 'unknown'}:${conversationId}:${burstAnchorId}`;
}

export class AIResponseOrchestrator {
  public static sandboxLockStore = new Map<string, { token: string; expiresAt: number }>();
  public static sandboxProcessedStore = new Set<string>();

  public static addSandboxProcessed(key: string) {
    AIResponseOrchestrator.sandboxProcessedStore.add(key);
  }

  public static clearSandboxStores() {
    AIResponseOrchestrator.sandboxLockStore.clear();
    AIResponseOrchestrator.sandboxProcessedStore.clear();
  }

  public static async run(params: OrchestratorParams): Promise<OrchestratorResult> {
    const {
      tenantId,
      phoneNumber,
      inboundText,
      mediaType = null,
      mediaMetadata = null,
      brain,
      channelId,
      conversationId,
      customerId,
      sandbox = false,
      history: passedHistory,
      workerPath = 'unknown',
      unifiedContext: passedUnifiedContext
    } = params;

    const startTime = Date.now();
    const settingsDb = withTenantDB(tenantId);

    const parseToUtcWithTz = (dStr: string, tStr: string, tz: string): string => {
      const [yyyy, mm, dd] = dStr.split('-').map(Number);
      const [hh, min] = tStr.split(':').map(Number);
      const localUtc = Date.UTC(yyyy, mm - 1, dd, hh, min);
      let offsetMin = 180; // default Turkey +3
      try {
        const tzFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric',
          hour12: false
        });
        const utcFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'UTC',
          year: 'numeric', month: 'numeric', day: 'numeric',
          hour: 'numeric', minute: 'numeric', second: 'numeric',
          hour12: false
        });
        const dummyDate = new Date(localUtc);
        const tzParts = tzFormatter.formatToParts(dummyDate);
        const utcParts = utcFormatter.formatToParts(dummyDate);
        const getVal = (parts: Intl.DateTimeFormatPart[], type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
        const tzYear = getVal(tzParts, 'year');
        const tzMonth = getVal(tzParts, 'month') - 1;
        const tzDay = getVal(tzParts, 'day');
        const tzHour = getVal(tzParts, 'hour');
        const tzMinute = getVal(tzParts, 'minute');
        const utcYear = getVal(utcParts, 'year');
        const utcMonth = getVal(utcParts, 'month') - 1;
        const utcDay = getVal(utcParts, 'day');
        const utcHour = getVal(utcParts, 'hour');
        const utcMinute = getVal(utcParts, 'minute');
        const tzDate = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute);
        const utcDate = Date.UTC(utcYear, utcMonth, utcDay, utcHour, utcMinute);
        offsetMin = (tzDate - utcDate) / 60000;
      } catch (err) {
        offsetMin = 180;
      }
      return new Date(localUtc - offsetMin * 60000).toISOString();
    };

    const processCallbackSuggestion = async (input: {
      parsedSugg: any;
      convMeta: any;
      unifiedContext: any;
      country: string | null;
      sandbox: boolean;
      tenantId: string;
      channelId: string;
      phoneNumber: string;
      history: any[];
      db: any;
      isTurkeyBasisInherited: boolean;
      isPatientBasisInherited?: boolean;
      inboundText?: string;
      allowTaskCreation?: boolean;
    }): Promise<{
      isSuccess: boolean;
      status?: string;
      reason?: string;
      requestedTime?: string;
      requestedTimeEnd?: string;
      requestedDate?: string;
      timezoneBasis?: string;
      patientCountry?: string | null;
    }> => {
      const {
        parsedSugg,
        convMeta,
        unifiedContext,
        country,
        sandbox,
        tenantId,
        channelId,
        phoneNumber,
        history,
        db,
        isTurkeyBasisInherited,
        isPatientBasisInherited = false,
        inboundText,
        allowTaskCreation = false
      } = input;

      const { resolvePatientTimezone } = require('../../utils/timezone');
      const tzRes = resolvePatientTimezone(country);
      const buildCallbackState = (status: string, reason?: string, timezoneBasis?: string) => ({
        isSuccess: false,
        status,
        reason,
        requestedTime: parsedSugg?.suggested_time || undefined,
        requestedTimeEnd: parsedSugg?.suggested_time_end || undefined,
        requestedDate: parsedSugg?.suggested_date || undefined,
        timezoneBasis,
        patientCountry: country || null
      });

      if (parsedSugg && parsedSugg.suggested_time && !parsedSugg.suggested_date) {
        const lastOffer = convMeta?.last_callback_offer;
        if (lastOffer && lastOffer.proposed_due_at) {
          const dt = new Date(lastOffer.proposed_due_at);
          if (!isNaN(dt.getTime())) {
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: 'Europe/Istanbul',
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour12: false
            });
            const parts = formatter.formatToParts(dt);
            const getVal = (type: string) => parts.find(p => p.type === type)?.value || '';
            parsedSugg.suggested_date = `${getVal('year')}-${getVal('month')}-${getVal('day')}`;
          }
        }
      }

      if (parsedSugg && parsedSugg.suggested_time && !parsedSugg.suggested_date) {
        let timezoneBasisToUse = parsedSugg.suggested_timezone_basis;
        if (isTurkeyBasisInherited) {
          timezoneBasisToUse = 'turkey_time';
        } else if (isPatientBasisInherited) {
          timezoneBasisToUse = 'patient_local_time';
        }
        
        const isPatientTzDifferent = tzRes.timezone && tzRes.timezone !== 'Europe/Istanbul';
        if (timezoneBasisToUse === 'unknown' && isPatientTzDifferent) {
          return buildCallbackState('timezone_clarification', 'missing_day_and_timezone', timezoneBasisToUse);
        }
        return buildCallbackState('day_clarification', 'missing_day', timezoneBasisToUse);
      }

      if (parsedSugg && parsedSugg.suggested_date && parsedSugg.suggested_time) {
        let timezoneBasisToUse = parsedSugg.suggested_timezone_basis;
        if (isTurkeyBasisInherited) {
          timezoneBasisToUse = 'turkey_time';
        } else if (isPatientBasisInherited) {
          timezoneBasisToUse = 'patient_local_time';
        }

        const isPatientTzDifferent = tzRes.timezone && tzRes.timezone !== 'Europe/Istanbul';

        if (timezoneBasisToUse === 'unknown' && isPatientTzDifferent) {
          return buildCallbackState('timezone_clarification', 'missing_timezone', timezoneBasisToUse);
        }

        const timeZone = (timezoneBasisToUse === 'turkey_time' || tzRes.timezone === 'Europe/Istanbul')
          ? 'Europe/Istanbul'
          : tzRes.timezone;

        const correctedUtc = parseToUtcWithTz(parsedSugg.suggested_date, parsedSugg.suggested_time, timeZone);
        parsedSugg.proposed_date = correctedUtc;

        let currentD = new Date(correctedUtc);
        let trTime = currentD.getTime() + 3 * 60 * 60 * 1000;
        let trDate = new Date(trTime);

        const wh = (brain.context.settings?.workingHours || brain.context.config?.workingHours || { enabled: true, start: "09:00", end: "21:00" }) as any;
        const isDayOpen = (dateObj: Date) => {
          const day = dateObj.getUTCDay();
          if (wh && Array.isArray(wh.days)) {
            return wh.days.includes(day);
          }
          return day !== 0;
        };

        const dayOpen = isDayOpen(trDate);

        let startMin = 9 * 60;
        let endMin = 21 * 60;
        if (wh?.start) {
          const [h, m] = wh.start.split(':').map(Number);
          startMin = h * 60 + (m || 0);
        }
        if (wh?.end) {
          const [h, m] = wh.end.split(':').map(Number);
          endMin = h * 60 + (m || 0);
        }

        const trHour = trDate.getUTCHours();
        const trMinute = trDate.getUTCMinutes();
        const trTotalMinutes = trHour * 60 + trMinute;
        const insideHours = trTotalMinutes >= startMin && trTotalMinutes <= endMin;

        if (!dayOpen || !insideHours) {
          return {
            isSuccess: false,
            status: 'out_of_bounds',
            reason: !dayOpen ? 'sunday_closed' : 'outside_hours'
          };
        }

        const proposedUtc = new Date(trDate.getTime() - 3 * 60 * 60 * 1000).toISOString();
        parsedSugg.proposed_date = proposedUtc;

        // Fix 3: Check for time conflict between user's current message (inboundText) and scheduled time (trDate)
        if (inboundText) {
          const { parseDeterministicSuggestion } = require('../../utils/date-parser');
          const userParsed = parseDeterministicSuggestion(inboundText, new Date(), null, null);
          if (userParsed.suggested_time) {
            const tzToUse = timeZone || 'Europe/Istanbul';
            const dtUser = new Date(proposedUtc);
            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: tzToUse,
              hour: '2-digit', minute: '2-digit', hour12: false
            });
            const formattedUserTz = formatter.format(dtUser); // "HH:MM"
            const [trH, trM] = formattedUserTz.split(':').map(Number);
            const [userH, userM] = userParsed.suggested_time.split(':').map(Number);
            
            const isMatchingTime = (userH === trH && userM === trM);
            let isInsideRange = false;
            if (userParsed.suggested_time_end) {
              const [userEndH, userEndM] = userParsed.suggested_time_end.split(':').map(Number);
              const userStartMin = userH * 60 + userM;
              const userEndMin = userEndH * 60 + userEndM;
              const trMinVal = trH * 60 + trM;
              if (trMinVal >= userStartMin && trMinVal <= userEndMin) {
                isInsideRange = true;
              }
            }
            
            if (!isMatchingTime && !isInsideRange) {
              console.warn(`[processCallbackSuggestion] Time conflict detected: user specified ${userParsed.suggested_time} but proposed is ${trH}:${trM}. Aborting task creation.`);
              return { isSuccess: false, status: 'conflict', reason: 'time_conflict' };
            }
          }
        }

        if (!allowTaskCreation) {
          return buildCallbackState('pending_confirmation', 'awaiting_patient_confirmation', timezoneBasisToUse);
        }

        if (!sandbox) {
          try {
            await db.executeSafe({
              text: `UPDATE follow_up_tasks
                     SET status = 'cancelled',
                         skipped_reason = $4,
                         metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
                         updated_at = NOW()
                     WHERE tenant_id = $1
                       AND conversation_id = $2
                       AND task_type = $3
                       AND status IN ('pending', 'in_progress')
                       AND due_at <> $6::timestamptz`,
              values: [
                tenantId,
                conversationId,
                'callback_scheduled',
                'callback_rescheduled_by_patient',
                JSON.stringify({
                  superseded_by_callback_time: proposedUtc,
                  superseded_at: new Date().toISOString(),
                  superseded_source: 'callback_confirmation'
                }),
                proposedUtc
              ]
            });

            const existing = await db.executeSafe({
              text: `SELECT id FROM follow_up_tasks 
                     WHERE tenant_id = $1 
                       AND conversation_id = $2 
                       AND task_type = $3 
                       AND due_at = $4::timestamptz
                       AND status IN ('pending', 'in_progress')`,
              values: [tenantId, conversationId, 'callback_scheduled', proposedUtc]
            }) as any[];
            
            if (existing.length === 0) {
              const { TaskService } = require('../task.service');
              const taskService = new TaskService(db);
              const opportunityId = unifiedContext?.opportunity?.id || null;

              const crypto = require('crypto');
              const idempotencyKey = crypto.createHash('sha256')
                .update(`${tenantId}:${channelId || 'whatsapp'}:${conversationId}:callback_scheduled:${proposedUtc}`)
                .digest('hex');

              await taskService.create({
                tenantId,
                opportunityId: opportunityId || undefined,
                conversationId: conversationId || undefined,
                phoneNumber,
                taskType: 'callback_scheduled',
                title: '📞 Geri Arama',
                description: 'Telefon görüşmesi planlandı.',
                dueAt: proposedUtc,
                isAutomated: true,
                createdBy: 'system',
                metadata: {
                  idempotency_key: idempotencyKey,
                  scheduled_for_utc: proposedUtc,
                  confirmation_status: 'confirmed',
                  time_confirmed_by_patient: true,
                  callback_time_tr: parsedSugg.suggested_time,
                  callback_time_tr_end: parsedSugg.suggested_time_end || undefined,
                  source: 'callback_confirmation_bypass'
                }
              });
            }
          } catch (taskErr) {
            console.error('[AIResponseOrchestrator] Failed to create callback follow-up task:', taskErr);
          }
        }

        return {
          isSuccess: true,
          status: 'success',
          requestedTime: parsedSugg?.suggested_time || undefined,
          requestedTimeEnd: parsedSugg?.suggested_time_end || undefined,
          requestedDate: parsedSugg?.suggested_date || undefined,
          timezoneBasis: timezoneBasisToUse
        };
      }

      return buildCallbackState('failed', 'missing_fields');
    };

    let dryRun = true;
    let cachedInboundSettings: any = null;

    if (!sandbox) {
      try {
        const { getInboundAutopilotSettings } = await import("../forms/form-autopilot-eligibility-resolver");
        cachedInboundSettings = await getInboundAutopilotSettings(tenantId, settingsDb);
        if (cachedInboundSettings && typeof cachedInboundSettings.dryRun === 'boolean') {
          dryRun = cachedInboundSettings.dryRun;
        }
      } catch (err) {
        console.error("AIResponseOrchestrator: Failed to fetch inbound settings, defaulting dryRun to true:", err);
        dryRun = true;
      }
    }

    let replyLanguage: string | undefined = undefined;
    let tenantDefaultLang: string | undefined = undefined;

    const buildResult = (data: Omit<OrchestratorResult, 'dryRun'>): OrchestratorResult => {
      return {
        replyLanguage,
        ...data,
        dryRun
      };
    };

    // P0.20-K: Anomalous Text Check (Skip punctuation-only or empty texts completely)
    const cleanInboundText = (inboundText || '').trim();
    const isAnomalousText = cleanInboundText === '' || /^[.!?,\-\s]+$/.test(cleanInboundText);
    if (isAnomalousText) {
      console.log(JSON.stringify({
        tag: "AI_RESPONSE_ORCHESTRATOR_ANOMALOUS_TEXT_BYPASS",
        tenantId,
        conversationId,
        inboundText,
        reason: "only_punctuation_or_empty"
      }));
      return buildResult({
        text: '',
        modelUsed: 'bypass_anomalous',
        latencyMs: Date.now() - startTime,
        bypassed: true,
        isRetry: false,
        qualityGateFailed: false
      });
    }

    // P3.01: Customer-level permanent override check (channel-scoped) in orchestrator
    const db = withTenantDB(tenantId);
    let customerProfileMetadata: any = {};
    if (customerId) {
      try {
        const cprof = await db.executeSafe({
          text: `SELECT metadata FROM customer_profiles WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [customerId, tenantId]
        }) as any[];
        customerProfileMetadata = cprof[0]?.metadata || {};
      } catch (err) {
        console.error("AIResponseOrchestrator: Failed to fetch customer profile metadata by customerId:", err);
      }
    } else if (phoneNumber) {
      try {
        const cprof = await db.executeSafe({
          text: `SELECT metadata FROM customer_profiles WHERE primary_phone = $1 AND tenant_id = $2 LIMIT 1`,
          values: [phoneNumber, tenantId]
        }) as any[];
        customerProfileMetadata = cprof[0]?.metadata || {};
      } catch (err) {
        console.error("AIResponseOrchestrator: Failed to fetch customer profile metadata by phone:", err);
      }
    }

    const overrides = customerProfileMetadata.inbound_autopilot_overrides || {};
    const channelOverride = overrides[channelId || ''];
    if (channelOverride?.disabled === true || channelOverride?.disabled === 'true') {
      console.log(JSON.stringify({
        tag: "AI_RESPONSE_ORCHESTRATOR_MANUALLY_DISABLED_BYPASS",
        tenantId,
        conversationId,
        customerId,
        channelId,
        reason: "contact_inbound_autopilot_manually_disabled"
      }));
      return buildResult({
        text: '',
        modelUsed: 'contact_inbound_autopilot_manually_disabled',
        latencyMs: Date.now() - startTime,
        bypassed: true,
        isRetry: false,
        qualityGateFailed: false
      });
    }

    let burstAnchorId = '';
    let responseDedupeKey = '';
    let convMeta: any = {};
    let resolvedChannelId = channelId || '';
    let isDbLockAcquired = false;
    let isRedisLockAcquired = false;
    let timezone: string | null = null;
    const lockToken = crypto.randomUUID();

    // ────────────────────────────────────────────────────────
    // 1. CONCURRENCY LOCKING & IDEMPOTENCY BOUNDARY
    // ────────────────────────────────────────────────────────
    if (conversationId) {
      console.log(JSON.stringify({
        tag: "AI_RESPONSE_ORCHESTRATOR_STARTED",
        tenantId,
        conversationId,
        workerPath
      }));

      const db = withTenantDB(tenantId);
      let lastOutboundTime = new Date(0).toISOString();
      resolvedChannelId = channelId || '';
      convMeta = {};

      if (!sandbox) {
        // A. Query the last outbound message created_at
        const lastOutboundQuery = await db.executeSafe({
          text: `SELECT created_at FROM messages 
                 WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'out' 
                 ORDER BY created_at DESC LIMIT 1`,
          values: [tenantId, conversationId]
        }) as any[];
        lastOutboundTime = lastOutboundQuery.length > 0 
          ? new Date(lastOutboundQuery[0].created_at).toISOString() 
          : new Date(0).toISOString();

        // B. Query the first inbound message after that time (burst anchor)
        const firstInboundQuery = await db.executeSafe({
          text: `SELECT provider_message_id, id, created_at FROM messages 
                 WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'in' AND created_at > $3
                 ORDER BY created_at ASC LIMIT 1`,
          values: [tenantId, conversationId, lastOutboundTime]
        }) as any[];

        if (firstInboundQuery.length > 0) {
          burstAnchorId = firstInboundQuery[0].provider_message_id || firstInboundQuery[0].id;
          const firstInboundTime = new Date(firstInboundQuery[0].created_at).getTime();

          // Extra check: if an outbound has been sent after the current burst started, skip!
          if (lastOutboundQuery.length > 0) {
            const lastOutboundTimeMs = new Date(lastOutboundQuery[0].created_at).getTime();
            if (lastOutboundTimeMs > firstInboundTime) {
              console.log(JSON.stringify({
                tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
                tenantId,
                conversationId,
                reason: "already_replied_newer_outbound",
                workerPath,
                burstAnchorId
              }));
              return buildResult({
                text: '',
                modelUsed: 'deduplicated',
                latencyMs: 0,
                bypassed: true,
                isRetry: false,
                qualityGateFailed: false,
                deduplicated: true
              });
            }
          }
        } else {
          burstAnchorId = inboundText || 'no-inbound-anchor';
        }
      } else {
        // Sandbox mode - try mock DB but fall back gracefully
        try {
          const lastOutboundQuery = await db.executeSafe({
            text: `SELECT created_at FROM messages 
                   WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'out' 
                   ORDER BY created_at DESC LIMIT 1`,
            values: [tenantId, conversationId]
          }) as any[];
          lastOutboundTime = lastOutboundQuery.length > 0 
            ? new Date(lastOutboundQuery[0].created_at).toISOString() 
            : new Date(0).toISOString();

          const firstInboundQuery = await db.executeSafe({
            text: `SELECT provider_message_id, id, created_at FROM messages 
                   WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'in' AND created_at > $3
                   ORDER BY created_at ASC LIMIT 1`,
            values: [tenantId, conversationId, lastOutboundTime]
          }) as any[];

          if (firstInboundQuery.length > 0) {
            burstAnchorId = firstInboundQuery[0].provider_message_id || firstInboundQuery[0].id;
          } else {
            burstAnchorId = inboundText || 'no-inbound-anchor';
          }
        } catch (_) {
          burstAnchorId = inboundText || 'no-inbound-anchor';
        }
      }

      // Query DB for channelId and metadata
      if (!sandbox) {
        const convCheck = await db.executeSafe({
          text: `SELECT metadata, channel_id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          values: [conversationId, tenantId]
        }) as any[];
        const convRecord = convCheck[0];
        convMeta = convRecord?.metadata || {};
        resolvedChannelId = convRecord?.channel_id || channelId || '';
      } else {
        try {
          const convCheck = await db.executeSafe({
            text: `SELECT metadata, channel_id FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
            values: [conversationId, tenantId]
          }) as any[];
          const convRecord = convCheck[0];
          convMeta = convRecord?.metadata || {};
          resolvedChannelId = convRecord?.channel_id || channelId || '';
        } catch (_) {
          resolvedChannelId = channelId || '';
        }

        try {
          const tenantTzRow = await db.executeSafe({
            text: `SELECT timezone FROM tenants WHERE id = $1 LIMIT 1`,
            values: [tenantId]
          }) as any[];
          timezone = tenantTzRow[0]?.timezone || null;
        } catch (_) {
          timezone = null;
        }
      }

      // Inbound Autopilot Settings & Eligibility checks (only when sandbox is false)
      if (!sandbox) {
        const inboundSettings = cachedInboundSettings || { enabled: false, dryRun: true, rolloutPercentage: 0, departmentMode: 'selected', allowedDepartments: [] };

        if (!inboundSettings.enabled) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_BYPASSED",
            tenantId,
            conversationId,
            reason: "inbound_autopilot_disabled"
          }));
          return buildResult({
            text: '',
            modelUsed: 'inbound_autopilot_disabled',
            latencyMs: Date.now() - startTime,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false
          });
        }

        // Timezone Check (if timezone settings/details fail or are missing, we fall back to not_eligible / dry-run)
        try {
          const tenantTzRow = await db.executeSafe({
            text: `SELECT timezone FROM tenants WHERE id = $1 LIMIT 1`,
            values: [tenantId]
          }) as any[];
          timezone = tenantTzRow[0]?.timezone || null;
        } catch (e) {
          timezone = null;
        }

        if (!timezone) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_BYPASSED",
            tenantId,
            conversationId,
            reason: "timezone_missing_not_eligible"
          }));
          return buildResult({
            text: '',
            modelUsed: 'timezone_missing_not_eligible',
            latencyMs: Date.now() - startTime,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false
          });
        }

        // Human Takeover Check
        const { HumanTakeoverGuard } = await import("../automation/human-takeover-guard");
        const takeoverCheck = await HumanTakeoverGuard.isHumanTakeoverActive(tenantId, conversationId, db);
        if (takeoverCheck.active) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_BYPASSED",
            tenantId,
            conversationId,
            reason: `human_takeover_active_${takeoverCheck.reason}`
          }));
          return buildResult({
            text: '',
            modelUsed: `human_takeover_active_${takeoverCheck.reason}`,
            latencyMs: Date.now() - startTime,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false
          });
        }

        // SHA-256 Rollout Percentage Check
        if (inboundSettings.rolloutPercentage < 100) {
          const { getRolloutBucket } = await import("@/lib/utils/hash");
          const bucketKey = `${tenantId}:${resolvedChannelId || 'whatsapp'}:inbound_autopilot_settings:${conversationId}`;
          const bucket = getRolloutBucket(bucketKey);
          if (bucket >= inboundSettings.rolloutPercentage) {
            console.log(JSON.stringify({
              tag: "AI_RESPONSE_ORCHESTRATOR_BYPASSED",
              tenantId,
              conversationId,
              reason: "rollout_percentage_excluded",
              bucket,
              rolloutPercentage: inboundSettings.rolloutPercentage
            }));
            return buildResult({
              text: '',
              modelUsed: 'rollout_percentage_excluded',
              latencyMs: Date.now() - startTime,
              bypassed: true,
              isRetry: false,
              qualityGateFailed: false
            });
          }
        }
      }

      responseDedupeKey = getNewDedupeKey(tenantId, resolvedChannelId || params.channel || 'unknown', conversationId, burstAnchorId);

      // C. Idempotency Check: Check if response has already been processed for this burst
      if (sandbox) {
        if (AIResponseOrchestrator.sandboxProcessedStore.has(responseDedupeKey)) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
            tenantId,
            conversationId,
            reason: "sandbox_inmemory_idempotency_marker",
            workerPath,
            responseDedupeKey
          }));
          return buildResult({
            text: '',
            modelUsed: 'deduplicated',
            latencyMs: 0,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false,
            deduplicated: true,
            responseDedupeKey,
            burstAnchorId
          });
        }
      } else {
        // C1. Check Redis processed marker
        try {
          const { redis } = await import('@/lib/redis');
          if (redis) {
            const oldDedupeKey = getOldDedupeKey(tenantId, resolvedChannelId || params.channel || 'unknown', conversationId, burstAnchorId);
            let isProcessed = await redis.get(`${responseDedupeKey}:processed`);
            if (!isProcessed) {
              isProcessed = await redis.get(`${oldDedupeKey}:processed`);
            }
            if (isProcessed) {
              console.log(JSON.stringify({
                tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
                tenantId,
                conversationId,
                reason: "redis_idempotency_marker",
                workerPath,
                responseDedupeKey
              }));
              return buildResult({
                text: '',
                modelUsed: 'deduplicated',
                latencyMs: 0,
                bypassed: true,
                isRetry: false,
                qualityGateFailed: false,
                deduplicated: true,
                responseDedupeKey,
                burstAnchorId
              });
            }
          }
        } catch (redisErr) {
          console.warn('[AIResponseOrchestrator] Redis idempotency check failed:', redisErr);
        }

        // C2. Check DB metadata processed marker
        if (convMeta.last_processed_dedupe_key === responseDedupeKey) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
            tenantId,
            conversationId,
            reason: "db_idempotency_marker",
            workerPath,
            responseDedupeKey
          }));
          return buildResult({
            text: '',
            modelUsed: 'deduplicated',
            latencyMs: 0,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false,
            deduplicated: true,
            responseDedupeKey,
            burstAnchorId
          });
        }
      }

      // D. Acquire Processing Lock
      let lockAcquired = false;

      if (sandbox) {
        const activeLock = AIResponseOrchestrator.sandboxLockStore.get(responseDedupeKey);
        if (activeLock && activeLock.expiresAt > Date.now()) {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
            tenantId,
            conversationId,
            reason: "sandbox_inmemory_processing_lock_active",
            workerPath,
            responseDedupeKey
          }));
          return buildResult({
            text: '',
            modelUsed: 'deduplicated',
            latencyMs: 0,
            bypassed: true,
            isRetry: false,
            qualityGateFailed: false,
            deduplicated: true,
            responseDedupeKey,
            burstAnchorId
          });
        } else {
          AIResponseOrchestrator.sandboxLockStore.set(responseDedupeKey, {
            token: lockToken,
            expiresAt: Date.now() + 120 * 1000
          });
          lockAcquired = true;
        }
      } else {
        // D1. Try Redis Lock
        try {
          const { redis } = await import('@/lib/redis');
          if (redis) {
            const oldChannelId = resolvedChannelId || params.channel || 'unknown';
            const oldLockKey = `dedupe:response:${tenantId}:${oldChannelId}:${conversationId}:${burstAnchorId}:processing`;
            const newLockKey = `${responseDedupeKey}:processing`;

            // 1. Dual-Read: Check if either lock is already active
            const [oldLockExists, newLockExists] = await Promise.all([
              redis.get(oldLockKey),
              redis.get(newLockKey)
            ]);

            if (oldLockExists || newLockExists) {
              console.log(JSON.stringify({
                tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
                tenantId,
                conversationId,
                reason: "redis_processing_lock_active",
                workerPath,
                responseDedupeKey
              }));
              return buildResult({
                text: '',
                modelUsed: 'deduplicated',
                latencyMs: 0,
                bypassed: true,
                isRetry: false,
                qualityGateFailed: false,
                deduplicated: true,
                responseDedupeKey,
                burstAnchorId
              });
            }

            // 2. Dual-Write: Acquire both locks with NX
            const [setOldSuccess, setNewSuccess] = await Promise.all([
              redis.set(oldLockKey, lockToken, { nx: true, ex: 120 }),
              redis.set(newLockKey, lockToken, { nx: true, ex: 120 })
            ]);

            if (setOldSuccess && setNewSuccess) {
              lockAcquired = true;
              isRedisLockAcquired = true;
            } else {
              // 3. Rollback (Token-Controlled): Safe release without overwriting other workers
              const releaseScript = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                  return redis.call("del", KEYS[1])
                else
                  return 0
                end
              `;
              const rollbackPromises: Promise<any>[] = [];
              if (setOldSuccess) {
                rollbackPromises.push(redis.eval(releaseScript, [oldLockKey], [lockToken]));
              }
              if (setNewSuccess) {
                rollbackPromises.push(redis.eval(releaseScript, [newLockKey], [lockToken]));
              }
              await Promise.all(rollbackPromises);

              console.log(JSON.stringify({
                tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
                tenantId,
                conversationId,
                reason: "redis_processing_lock_conflict",
                workerPath,
                responseDedupeKey
              }));
              return buildResult({
                text: '',
                modelUsed: 'deduplicated',
                latencyMs: 0,
                bypassed: true,
                isRetry: false,
                qualityGateFailed: false,
                deduplicated: true,
                responseDedupeKey,
                burstAnchorId
              });
            }
          }
        } catch (redisErr) {
          console.warn('[AIResponseOrchestrator] Redis lock acquire failed, falling back to DB:', redisErr);
        }

        // D2. DB Fallback Lock (Atomic Postgres Update tenant/channel/conversation bound)
        if (!lockAcquired) {
          const nowIso = new Date().toISOString();
          const updateResult = await db.executeSafe({
            text: `
              UPDATE conversations 
              SET metadata = jsonb_set(
                jsonb_set(COALESCE(metadata, '{}'::jsonb), '{response_dedupe_key}', to_jsonb($1::text)),
                '{processing_locked_at}', to_jsonb($2::text)
              )
              WHERE id = $3 
                AND tenant_id = $4
                AND channel_id = $5
                AND (
                  metadata->>'processing_locked_at' IS NULL
                  OR (metadata->>'processing_locked_at')::timestamptz < NOW() - INTERVAL '120 seconds'
                )
                AND (
                  metadata->>'last_processed_dedupe_key' IS NULL
                  OR metadata->>'last_processed_dedupe_key' <> $1
                )
              RETURNING id
            `,
            values: [responseDedupeKey, nowIso, conversationId, tenantId, resolvedChannelId]
          }) as any[];

          if (updateResult.length > 0) {
            lockAcquired = true;
            isDbLockAcquired = true;
          } else {
            console.log(JSON.stringify({
              tag: "AI_RESPONSE_ORCHESTRATOR_DEDUPED",
              tenantId,
              conversationId,
              reason: "db_processing_lock_active",
              workerPath,
              responseDedupeKey
            }));
            return buildResult({
              text: '',
              modelUsed: 'deduplicated',
              latencyMs: 0,
              bypassed: true,
              isRetry: false,
              qualityGateFailed: false,
              deduplicated: true,
              responseDedupeKey,
              burstAnchorId
            });
          }
        }
      }
    }

    // ────────────────────────────────────────────────────────
    // 2. RESPONSE GENERATION PIPELINE
    // ────────────────────────────────────────────────────────
    try {
      // 1. Fetch CRM / Identity Context
      let unifiedContext: any = passedUnifiedContext || null;
      if (!unifiedContext && conversationId && customerId && !sandbox) {
        try {
          unifiedContext = await IdentityEngine.getContext(tenantId, customerId, conversationId);
        } catch (e) {
          console.error('[AIResponseOrchestrator] Error fetching identity context:', e);
        }
      }

      if (!unifiedContext) {
        unifiedContext = {};
      }

      // 3. Debounce & Turn Aggregation
      const history = await ConversationTurnAggregator.aggregate(
        tenantId,
        phoneNumber,
        passedHistory,
        10
      );
      unifiedContext.history = history;
      unifiedContext.currentMessageText = inboundText;
      unifiedContext.currentMessageMediaType = mediaType;

      // 3b. Resolve Language Response Policy with full history and tenant settings
      try {
        const { LanguageResponsePolicy } = await import('./language-response-policy');
        tenantDefaultLang = brain.context.config?.defaultLanguage || undefined;
        const channelFixedLang = brain.context.config?.fixedLanguage || undefined;
        const languagePolicy = LanguageResponsePolicy.resolve(
          inboundText,
          history.map(m => ({ role: m.role, content: m.content || '' })),
          tenantDefaultLang,
          channelFixedLang
        );
        replyLanguage = languagePolicy.replyLanguage;
        unifiedContext.languageContext = {
          detected_patient_language: languagePolicy.replyLanguageName,
          reply_language: languagePolicy.replyLanguageName,
          language_confidence: languagePolicy.languageConfidence,
          language_detection_source: 'latest_patient_message'
        };
      } catch (langErr) {
        console.warn('[AIResponseOrchestrator] Language policy resolution failed:', langErr);
      }
      unifiedContext.currentMessageText = inboundText;
      unifiedContext.currentMessageMediaType = mediaType;

      // P0.29: Turkey Visit Intent detection & persistence
      const { TurkeyVisitIntentResolver } = require('./turkey-visit-intent-resolver');
      const assistantHistoryForVisitIntent = history.filter(m => m.role === 'assistant');
      const lastAssistantForVisitIntent = assistantHistoryForVisitIntent.length > 0
        ? assistantHistoryForVisitIntent[assistantHistoryForVisitIntent.length - 1].content
        : '';
      const resolvedIntentFromMsg = TurkeyVisitIntentResolver.detectWithContext(inboundText, lastAssistantForVisitIntent);
      const hasExplicitCall = TurkeyVisitIntentResolver.hasExplicitCallRequest(inboundText);

      let currentVisitIntent = convMeta.turkey_visit_intent || 'turkey_visit_intent_unknown';
      if (resolvedIntentFromMsg) {
        currentVisitIntent = resolvedIntentFromMsg;
      }
      if (hasExplicitCall) {
        currentVisitIntent = 'turkey_visit_intent_positive';
      }

      if (currentVisitIntent !== convMeta.turkey_visit_intent) {
        convMeta.turkey_visit_intent = currentVisitIntent;
        if (conversationId) {
          try {
            const conv = await db.executeSafe({
              text: `SELECT metadata FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
              values: [conversationId, tenantId]
            }) as any[];
            const currentMeta = conv[0]?.metadata || {};
            currentMeta.turkey_visit_intent = currentVisitIntent;
            
            await db.executeSafe({
              text: `UPDATE conversations SET metadata = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
              values: [JSON.stringify(currentMeta), conversationId, tenantId]
            });
          } catch (dbErr) {
            console.error('[AIResponseOrchestrator] Failed to save turkey_visit_intent to DB:', dbErr);
          }
        }
      }
      unifiedContext.turkeyVisitIntent = currentVisitIntent;

      // 4. P0.16-G: Active Department Arbitration (extended priority chain)
      // Priority order:
      //   1. Current message alias      (DepartmentAliasResolver)
      //   2. Recent conversation        (RecentDepartmentContextResolver) ← P0.16-G
      //   3. Topic switch resolver      (ConversationTopicSwitchResolver)
      //   4. Stale CRM/opportunity      (staleDept)
      const tenantAliasConfig = brain.context.config?.departmentAliases || null;
      const staleDept = unifiedContext.opportunity?.department || unifiedContext.conversation?.department || null;

      // Step 4a: Current message alias resolution
      const aliasArbitration = DepartmentAliasResolver.resolveWithStalenessCheck(
        inboundText,
        staleDept,
        tenantAliasConfig
      );
      const currentMsgDept = aliasArbitration.isOverride ? aliasArbitration.activeDepartment : null;

      // Step 4b: P0.16-G — Recent conversation context (runs when current message has no dept keyword)
      let recentContextDept: string | null = null;
      let recentContextSource = 'none';
      let recentContextConfidence = 'none';
      if (!currentMsgDept && history.length > 0) {
        const safeHistory = history
          .filter(m => m.content != null)
          .map(m => ({ role: m.role, content: m.content as string }));
        const recentResult = RecentDepartmentContextResolver.resolve(
          safeHistory,
          10,
          tenantAliasConfig
        );
        if (recentResult) {
          recentContextDept = recentResult.department;
          recentContextSource = recentResult.matchedBy;
          recentContextConfidence = recentResult.confidence;
          console.log(JSON.stringify({
            tag: 'RECENT_DEPARTMENT_CONTEXT_RESOLVED',
            tenantId,
            conversationId: conversationId || 'unknown',
            resolvedDepartment: recentResult.department,
            confidence: recentResult.confidence,
            matchedBy: recentResult.matchedBy,
            staleDepartment: staleDept,
            workerPath
          }));
        }
      }

      // Step 4c: Topic switch resolver — receives best-known dept so far
      const step4cInput = currentMsgDept || recentContextDept || staleDept;
      const topicSwitch = ConversationTopicSwitchResolver.resolve(
        inboundText,
        step4cInput,
        unifiedContext.conversation?.metadata,
        tenantAliasConfig
      );

      // Step 4d: Final resolved department — first non-null wins
      const resolvedActiveDepartment =
        currentMsgDept ||
        recentContextDept ||
        topicSwitch.activeTopic ||
        staleDept;

      // Gradual branch department check (only when sandbox is false)
      if (!sandbox) {
        const inboundSettings = cachedInboundSettings || { enabled: false, dryRun: true, rolloutPercentage: 0, departmentMode: 'selected', allowedDepartments: [] };

        if (inboundSettings.departmentMode === 'selected') {
          if (!resolvedActiveDepartment || !inboundSettings.allowedDepartments.includes(resolvedActiveDepartment)) {
            console.log(JSON.stringify({
              tag: "AI_RESPONSE_ORCHESTRATOR_BYPASSED",
              tenantId,
              conversationId,
              reason: "department_not_allowed",
              resolvedActiveDepartment,
              allowedDepartments: inboundSettings.allowedDepartments
            }));
            return buildResult({
              text: '',
              modelUsed: 'department_not_allowed',
              latencyMs: Date.now() - startTime,
              bypassed: true,
              isRetry: false,
              qualityGateFailed: false
            });
          }
        }
      }

      if (resolvedActiveDepartment) {
        if (!unifiedContext.conversation) unifiedContext.conversation = {};
        unifiedContext.conversation.department = resolvedActiveDepartment;
        if (unifiedContext.opportunity) {
          unifiedContext.opportunity.department = resolvedActiveDepartment;
        }

        // Telemetry: log when stale CRM was overridden
        if (staleDept && staleDept !== resolvedActiveDepartment) {
          console.log(JSON.stringify({
            tag: 'ACTIVE_DEPARTMENT_OVERRIDE',
            tenantId,
            conversationId: conversationId || 'unknown',
            staleDepartment: staleDept,
            resolvedDepartment: resolvedActiveDepartment,
            source: currentMsgDept ? 'current_message' : recentContextSource || 'topic_switch',
            workerPath
          }));
        }
      }

      // Inject previous topics as facts/context
      if (topicSwitch.previousTopics.length > 0) {
        if (!unifiedContext.patient_known_facts) unifiedContext.patient_known_facts = [];
        unifiedContext.patient_known_facts.push(`Geçmiş İlgilenilen Branşlar: ${topicSwitch.previousTopics.join(', ')}.`);
      }

      if (unifiedContext?.latestForm && (!Array.isArray(unifiedContext.patient_known_facts) || unifiedContext.patient_known_facts.length === 0)) {
        const resolvedFacts = ConversationKnownFactsResolver.resolve({
          history: history
            .filter((message: ChatMessage) => typeof message.content === 'string')
            .map((message: ChatMessage) => ({
              role: message.role,
              content: message.content as string,
            })),
          opportunity: unifiedContext.opportunity,
          profile: unifiedContext.profile,
          latestForm: unifiedContext.latestForm,
          conversation: unifiedContext.conversation,
        });
        unifiedContext.patient_known_facts = ConversationKnownFactsResolver.formatFacts(resolvedFacts);
      }

      // 5. Approved Learning hints injection
      try {
        const { TenantLearningRuntimeResolver } = await import('@/lib/services/ai/tenant-learning-runtime-resolver');
        if (channelId) {
          unifiedContext.approvedLearningHints = await TenantLearningRuntimeResolver.resolveHints(brain, channelId);
        } else {
          unifiedContext.approvedLearningHints = [];
        }
      } catch {
        unifiedContext.approvedLearningHints = [];
      }

      // 5b. Resolve Intent Arbitration, Greeting-Only, and Intent Elevation
      const { PendingQuestionResolver } = require('./pending-question-resolver');
      const { ShortAnswerInterpreter } = require('./short-answer-interpreter');
      const { ConversationStateArbitrator } = require('./conversation-state-arbitrator');

      const _tenantDeptKw = TenantConfigResolver.getIntentDepartmentKeywords(brain) ?? undefined;
      const rawPendingSlot = PendingQuestionResolver.resolve(history);
      const rawInterpretedIntent = ShortAnswerInterpreter.interpret(inboundText, rawPendingSlot);
      const routedIntent = ConversationIntentRouter.route(inboundText, _tenantDeptKw);

      const arbitration = ConversationStateArbitrator.arbitrate({
        lastUserMessage: inboundText,
        rawPendingSlot: rawPendingSlot || 'generic_none',
        rawInterpretedIntent: rawInterpretedIntent || 'none',
        routerIntent: routedIntent,
        history,
        convMeta,
        unifiedContext
      });

      let effectiveIntent = arbitration.effectiveIntent;
      let overrideReason = 'none';

      // Turn indicators: bot has not responded in this conversation yet?
      const assistantHistory = history.filter(m => m.role === 'assistant');
      const isFirstAssistantTurn = assistantHistory.length === 0;

      // Has a verified form lead context? A CRM/opportunity record alone is not a form.
      const oppResolvedFrom = unifiedContext?.opportunity?.resolvedFrom || '';
      const oppSource = unifiedContext?.opportunity?.source || unifiedContext?.opportunity?.opp_source || '';
      const hasVerifiedFormContext = !!(
        unifiedContext?.latestForm ||
        unifiedContext?.outreachContext ||
        ['lead_linked_active_opp', 'lead_id_active_opp'].includes(oppResolvedFrom) ||
        (unifiedContext?.opportunity?.lead_id && String(oppSource).toLowerCase() === 'form')
      );
      const hasForm = hasVerifiedFormContext;
      unifiedContext.hasVerifiedFormContext = hasVerifiedFormContext;
      unifiedContext.hasFormContext = hasVerifiedFormContext;

      // Check if the form/opportunity has already been addressed by the bot
      let formAlreadyAddressed = false;
      if (hasForm) {
        let latestFormCreatedAt: Date | null = null;
        if (unifiedContext?.latestForm?.created_at) {
          latestFormCreatedAt = new Date(unifiedContext.latestForm.created_at);
        } else if (unifiedContext?.opportunity?.created_at) {
          latestFormCreatedAt = new Date(unifiedContext.opportunity.created_at);
        }

        // Check opportunity metadata first
        const oppMeta = unifiedContext?.opportunity?.metadata || {};
        if (oppMeta.form_greeted_at || oppMeta.form_followup_started_at || oppMeta.form_context_handled || oppMeta.arrival_date) {
          formAlreadyAddressed = true;
        }

        if (!formAlreadyAddressed && latestFormCreatedAt) {
          try {
            // Get all conversations for this customer or phone, ignoring soft-deleted ones
            const convs = await db.executeSafe({
              text: `SELECT id, metadata FROM conversations 
                     WHERE tenant_id = $1 
                       AND (customer_id = $2 OR phone_number = $3)
                       AND (metadata IS NULL OR metadata->>'deleted_at' IS NULL)`,
              values: [tenantId, customerId || null, phoneNumber || null]
            }) as any[];

            const convIds = convs.map(c => c.id);
            
            // Check metadata of all these conversations
            for (const c of convs) {
              const meta = c.metadata || {};
              if (
                meta.form_greeted_at || 
                meta.form_followup_started_at || 
                meta.form_context_handled || 
                meta.arrival_date
              ) {
                formAlreadyAddressed = true;
                break;
              }
            }

            if (!formAlreadyAddressed && convIds.length > 0) {
              // Check if any outbound message exists in any of these conversations after latestFormCreatedAt
              const outboundAfterForm = await db.executeSafe({
                text: `SELECT id FROM messages 
                       WHERE tenant_id = $1 
                         AND conversation_id = ANY($2) 
                         AND direction = 'out' 
                         AND created_at > $3 
                       LIMIT 1`,
                values: [tenantId, convIds, latestFormCreatedAt]
              }) as any[];
              if (outboundAfterForm.length > 0) {
                formAlreadyAddressed = true;
              }
            }
          } catch (err) {
            console.warn('[AIResponseOrchestrator] Failed to query past form greetings:', err);
          }
        }
      }

      const contactMode = !hasVerifiedFormContext
        ? 'direct_whatsapp'
        : formAlreadyAddressed || assistantHistory.length > 0
          ? 'continuing_conversation'
          : unifiedContext?.outreachContext?.greetingSent
            ? 'system_outbound_greeting'
            : 'patient_inbound_after_form';
      unifiedContext.contactMode = contactMode;

      // Elevate greeting if unaddressed form exists
      if (effectiveIntent === 'greeting' && isFirstAssistantTurn && hasForm && !formAlreadyAddressed) {
        effectiveIntent = 'form_followup';
        overrideReason = 'greeting_with_active_unaddressed_form';
        
        console.log(JSON.stringify({
          tag: 'INTENT_OVERRIDE',
          tenantId,
          conversationId,
          originalIntent: routedIntent,
          effectiveIntent,
          overrideReason,
          isFirstAssistantTurn,
          hasForm,
          formAlreadyAddressed
        }));
      }

      // Populate unifiedContext values for prompt builder
      unifiedContext.effectiveIntent = effectiveIntent;
      unifiedContext.overrideReason = overrideReason;
      unifiedContext.formAlreadyAddressed = formAlreadyAddressed;

      // Resolve isGreetingOnly context for Bot Reply prompt generation
      const hasQuotedReply = !!(mediaMetadata?.native?.quoted_message_snapshot || mediaMetadata?.native?.reply_to_provider_message_id);
      if (inboundText && !hasQuotedReply) {
        const lowerContent = inboundText.toLowerCase().trim();
        const defaultGreetings = ['merhaba', 'merhabalar', 'selam', 'iyi günler', 'iyi akşamlar', 'iyi sabahlar', 'günaydın', 'kolay gelsin', 'iyi çalışmalar'];
        const greetings: string[] = (brain?.context?.config?.greetingTokens && Array.isArray(brain.context.config.greetingTokens) && brain.context.config.greetingTokens.length > 0)
          ? brain.context.config.greetingTokens.map((t: string) => t.toLowerCase().trim())
          : defaultGreetings;
        
        const isInitialFormWelcome = !formAlreadyAddressed && isFirstAssistantTurn && hasForm;

        if (greetings.includes(lowerContent) || (lowerContent.length < 20 && greetings.some(g => lowerContent.includes(g)))) {
          if (!isInitialFormWelcome && effectiveIntent !== 'form_followup') {
            unifiedContext.isGreetingOnly = true;
          } else {
            delete unifiedContext.isGreetingOnly;
          }
        } else {
          delete unifiedContext.isGreetingOnly;
        }
      }

      // 5c. Resolve Intent Flags and process Callback/Arrival Date Answers early (v75 Paradigm)
      const isCallbackConfirmation = effectiveIntent === 'callback_confirmation' || effectiveIntent === 'schedule_confirmation';
      const isArrivalDateAnswer = effectiveIntent === 'arrival_date_answer' && !inboundText.includes('?');
      const isCallbackTimeAnswer = effectiveIntent === 'callback_time_answer';

      let hasExplicitTimeInUserMsg = false;
      if (isCallbackConfirmation && inboundText) {
        const { parseDeterministicSuggestion } = require('../../utils/date-parser');
        const userParsed = parseDeterministicSuggestion(inboundText, new Date(), null, null);
        if (userParsed.suggested_time || userParsed.suggested_date) {
          hasExplicitTimeInUserMsg = true;
        }
      }

      const effectiveIsCallbackConfirmation = isCallbackConfirmation && !hasExplicitTimeInUserMsg;
      const effectiveIsCallbackTimeAnswer = isCallbackTimeAnswer || (isCallbackConfirmation && hasExplicitTimeInUserMsg);

      const isPositiveIntent = currentVisitIntent === 'turkey_visit_intent_positive';
      const lastBotAskedTime = history.length > 0 &&
        history[history.length - 1].role === 'assistant' &&
        /saat|zaman|gün|gun|tarih|ne zaman|uygun/i.test(history[history.length - 1].content || '');
      const isAppointmentContext = history.some(m =>
        /randevu|arama|görüşme|gorusme|telefon/i.test(m.content || '')
      );
      const callbackAlreadyConfirmed = !!(
        convMeta?.last_callback_offer?.source === 'callback_confirmation_bypass' ||
        convMeta?.last_callback_offer?.confirmed_at
      );

      const lastAssistantMsg = (assistantHistory.length > 0 ? assistantHistory[assistantHistory.length - 1].content : '') || '';
      const hasStoredCallbackOffer = !!(
        convMeta?.last_callback_offer?.proposed_due_at &&
        convMeta?.last_callback_offer?.source === 'bot_callback_offer'
      );
      const botSummarizedSlot = hasStoredCallbackOffer || (
        /(?:\d{1,2}[:.]\d{2}|\d{1,2}\s*[-–]\s*\d{1,2}|saat|aralık|aralig|tarih|gün|gun)/i.test(lastAssistantMsg) &&
        /(?:teyit|onay|uygun|doğru|dogru|not|planla|görüşme|gorusme|telefon|arama)/i.test(lastAssistantMsg)
      );
      const patientExplicitlyConfirmed = /\b(?:tamam|uygundur|uygun|olur|evet|onaylıyorum|onayliyorum|teyit ediyorum|doğrudur|dogrudur|doğru|dogru|ok|okay|yes|confirm|confirmed|approve|approved|ja|نعم|موافق)\b/i.test(inboundText || '');
      const allowCallbackTaskCreation = botSummarizedSlot && patientExplicitlyConfirmed && !callbackAlreadyConfirmed;
      const shouldProcessCallbackTimeAnswer = !callbackAlreadyConfirmed && (
        lastBotAskedTime ||
        isAppointmentContext ||
        hasExplicitCall ||
        isPositiveIntent
      );

      let callbackResult: any = null;
      let shouldBypassCallbackTimeAnswer = false;

      if (effectiveIsCallbackTimeAnswer && shouldProcessCallbackTimeAnswer) {
        const { parseDeterministicSuggestion } = require('../../utils/date-parser');
        const parsedSugg = parseDeterministicSuggestion(inboundText, new Date(), null, lastAssistantMsg);

        if (parsedSugg) {
          const country = unifiedContext?.opportunity?.country || convMeta?.patient_country || null;
          const userMessages = history.filter(m => m.role === 'user');
          const recentUserTexts = userMessages.slice(-3).map(m => (m.content || '').toLowerCase()).join(' ');
          const hasRecentTurkeyTimeExplicit = /\b(t%C3%BCrkiye saati|türkiye saati|tr saat|ts\b)/i.test(recentUserTexts) || /\b(türkiye saatiyle)\b/i.test(inboundText.toLowerCase());
          const hasRecentPatientTimeExplicit = /\b(yerel saat|kendi saat|benim saat|hollanda saat|almanya saat|local time)\b/i.test(recentUserTexts) || /\b(yerel saatle|kendi saatimle|local saatle)\b/i.test(inboundText.toLowerCase());

          callbackResult = await processCallbackSuggestion({
            parsedSugg,
            convMeta,
            unifiedContext,
            country,
            sandbox,
            tenantId,
            channelId: channelId || 'whatsapp',
            phoneNumber,
            history,
            db,
            isTurkeyBasisInherited: hasRecentTurkeyTimeExplicit,
            isPatientBasisInherited: hasRecentPatientTimeExplicit,
            inboundText,
            allowTaskCreation: allowCallbackTaskCreation
          });
          
          unifiedContext.callbackResult = callbackResult;
          shouldBypassCallbackTimeAnswer = callbackResult.isSuccess;
        }
      } else if (effectiveIsCallbackConfirmation) {
        const lastOffer = convMeta?.last_callback_offer;
        let parsedSugg: any = null;
        
        if (lastOffer && lastOffer.proposed_due_at) {
          const dt = new Date(lastOffer.proposed_due_at);
          if (!isNaN(dt.getTime())) {
            const country = unifiedContext?.opportunity?.country || convMeta?.patient_country || null;
            const { resolvePatientTimezone } = require('../../utils/timezone');
            const tzRes = resolvePatientTimezone(country);
            const targetTz = (lastOffer.timezone === 'patient_local_time' && tzRes.timezone)
              ? tzRes.timezone
              : 'Europe/Istanbul';

            const formatter = new Intl.DateTimeFormat('en-US', {
              timeZone: targetTz,
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit',
              hour12: false
            });
            const parts = formatter.formatToParts(dt);
            const getVal = (type: string) => parts.find(p => p.type === type)?.value || '';
            const yyyy = getVal('year');
            const mm = getVal('month');
            const dd = getVal('day');
            const hh = getVal('hour');
            const min = getVal('minute');
            
            parsedSugg = {
              suggested_date: `${yyyy}-${mm}-${dd}`,
              suggested_time: `${hh}:${min}`,
              proposed_date: lastOffer.proposed_due_at,
              suggested_timezone_basis: lastOffer.timezone === 'patient_local_time'
                ? 'patient_local_time'
                : 'turkey_time'
            };
          }
        }
        
        if (!parsedSugg) {
          const isGenuineOffer = 
            lastOffer?.source === 'bot_callback_offer' || 
            lastOffer?.source === 'callback_confirmation_bypass' ||
            effectiveIntent === 'call_scheduling_request' || 
            effectiveIntent === 'callback_confirmation';
            
          const isArrivalBypassResponse = 
            lastAssistantMsg.includes('geliş tarihi') || 
            lastAssistantMsg.includes('geliş tarihiniz') ||
            lastAssistantMsg.includes('not aldım');

          if (isGenuineOffer && !isArrivalBypassResponse) {
            const { parseDeterministicSuggestion } = require('../../utils/date-parser');
            parsedSugg = parseDeterministicSuggestion(lastAssistantMsg, new Date(), null, null);
          }
        }

        if (parsedSugg) {
          const country = unifiedContext?.opportunity?.country || convMeta?.patient_country || null;
          const userMessages = history.filter(m => m.role === 'user');
          const recentUserTexts = userMessages.slice(-3).map(m => (m.content || '').toLowerCase()).join(' ');
          const hasRecentTurkeyTimeExplicit = /\b(t%C3%BCrkiye saati|türkiye saati|tr saat|ts\b)/i.test(recentUserTexts) || /\b(türkiye saatiyle)\b/i.test(inboundText.toLowerCase());
          const hasRecentPatientTimeExplicit = /\b(yerel saat|kendi saat|benim saat|hollanda saat|almanya saat|local time)\b/i.test(recentUserTexts) || /\b(yerel saatle|kendi saatimle|local saatle)\b/i.test(inboundText.toLowerCase());

          callbackResult = await processCallbackSuggestion({
            parsedSugg,
            convMeta,
            unifiedContext,
            country,
            sandbox,
            tenantId,
            channelId: channelId || 'whatsapp',
            phoneNumber,
            history,
            db,
            isTurkeyBasisInherited: hasRecentTurkeyTimeExplicit,
            isPatientBasisInherited: hasRecentPatientTimeExplicit,
            inboundText,
            allowTaskCreation: allowCallbackTaskCreation
          });
          
          unifiedContext.callbackResult = callbackResult;
        }
      } else if (isArrivalDateAnswer) {
        const ambiguity = DateAnswerResolver.isAmbiguousNumericDateReply(inboundText);
        if (ambiguity.ambiguous) {
          unifiedContext.dateAmbiguityClarification = ambiguity;
        } else {
          const parsed = DateAnswerResolver.parse(inboundText, brain.context.config?.timezone || 'Europe/Istanbul');
          const normalizedDate = parsed.raw || inboundText.trim();

          if (conversationId) {
            try {
              const convCheck = await db.executeSafe({
                text: `SELECT metadata FROM conversations WHERE id = $1 LIMIT 1`,
                values: [conversationId]
              }) as any[];
              const existingMeta = convCheck[0]?.metadata || {};
              const updatedMeta = {
                ...existingMeta,
                arrival_date: normalizedDate
              };
              delete updatedMeta.phone_number;
              delete updatedMeta.patient_name;
              delete updatedMeta.raw_message;

              if (updatedMeta.last_callback_offer) {
                let shouldDeleteOffer = false;
                const proposedDueAt = updatedMeta.last_callback_offer.proposed_due_at;
                if (proposedDueAt) {
                  const proposedDateOnly = proposedDueAt.split('T')[0];
                  if (parsed.date) {
                    const parsedDateOnly = parsed.date.toISOString().split('T')[0];
                    if (proposedDateOnly === parsedDateOnly) {
                      shouldDeleteOffer = true;
                    }
                  }
                }
                if (updatedMeta.last_callback_offer.source === 'bot_callback_offer') {
                  shouldDeleteOffer = true;
                }
                if (shouldDeleteOffer) {
                  delete updatedMeta.last_callback_offer;
                }
              }

              await db.executeSafe({
                text: `UPDATE conversations SET metadata = $1, updated_at = NOW() WHERE id = $2`,
                values: [JSON.stringify(updatedMeta), conversationId]
              });

              if (unifiedContext?.opportunity?.id) {
                await db.executeSafe({
                  text: `UPDATE opportunities SET travel_date = $1, updated_at = NOW() WHERE id = $2`,
                  values: [normalizedDate, unifiedContext.opportunity.id]
                });
              }

              if (convMeta) {
                convMeta.arrival_date = normalizedDate;
                if (updatedMeta.last_callback_offer === undefined) {
                  delete convMeta.last_callback_offer;
                }
              }
            } catch (dbErr) {
              console.error('[AIResponseOrchestrator] Failed to update arrival date in DB before prompt builder:', dbErr);
            }
          }
        }
      }

      // 6. Build Prompt
      const phase = unifiedContext.opportunity?.stage || 'lead';
      const systemPromptText = PromptBuilder.buildSystemPrompt(brain, phase, false, unifiedContext);

      // 7. Check for LLM Bypass/Challenge cases
      const cleanInbound = inboundText.toLowerCase().trim();
      const isBotAccusation = ['bot musun', 'sen bot musun', 'are you a bot', 'botsun', 'robot musun', 'yapay zeka mısın', 'yapay zeka misin', 'insan mısın', 'insan misin'].some(kw => cleanInbound.includes(kw));
      const isAiAccusation = ['yapay zeka', 'yapayzeka', 'gpt', 'gemini', 'openai', 'claude', 'dil modeli', 'hangi model'].some(kw => cleanInbound.includes(kw));
      const isPromptChallenge = ['prompt', 'promt', 'sistem prompt', 'system prompt', 'talimatların', 'sistem talimati', 'kuralın ne', 'direktifin ne', 'uydurma'].some(kw => cleanInbound.includes(kw));
      const isAngryPromptChallenge = isPromptChallenge && ['şikayet', 'sikayet', 'rezalet', 'berbat', 'kötü', 'sinir', 'bıktım', 'yeter', 'dalga'].some(kw => cleanInbound.includes(kw));
      const isStructuredFormPayload = /(?:Full\s+name|Phone\s+number|WhatsApp\s+number|Şikayetiniz\s+Nedir|Sikayetiniz\s+Nedir|Hangi\s+[üu]lkede\s+ya[şs][ıi]yorsunuz|Date\s+of\s+birth|Türkiye'ye\s*\(Konya'ya\)\s+tedavi)/i.test(inboundText);

      // Resolve doctor directory — use resolvedActiveDepartment from full priority chain
      const doctorsList = DoctorDirectoryResolver.getDoctors(brain, resolvedActiveDepartment || undefined);
      const doctorNames = doctorsList.map(d => d.name);
      const hasDoctorDirectory = doctorsList.length > 0;

      // Doctor lookup check
      const isDoctorLookup = !isStructuredFormPayload && ['doktor', 'hekim', 'uzman', 'cerrah', 'hoca'].some(kw => cleanInbound.includes(kw));
      const shouldBypassDoctorLookup = isDoctorLookup && !hasDoctorDirectory;

      // P0.16-I: Mixed intent detection — doctor_lookup + process_question in same burst
      const isProcessQuestion = [
        'süreç', 'surec', 'nasıl işliyor', 'nasil isliyor', 'nasıl çalışıyor', 'nasil calisiyor',
        'nasıl yürüyor', 'nasil yuruyor', 'tedavi süreci', 'muayene süreci', 'randevu süreci',
        'tanı süreci', 'tani sureci', 'aşama', 'asama', 'adım', 'adim'
      ].some(kw => cleanInbound.includes(kw));
      const isMixedDoctorProcess = isDoctorLookup && isProcessQuestion;

      // P0.30 Gate Diet: isNextStepRequest bypass removed — LLM handles next-step/process questions.
      // 'ne zaman' was also removed from router keywords to prevent misrouting.

      // P0.16-K: Multi-intent detection (address+price+doctor+process in one message)
      const isMultiIntentQuery = !isStructuredFormPayload && MultiIntentConsultantComposer.isMultiIntent(inboundText);

      // P0.16-K: Doctor names request detection (with repeat check)
      const hasPreviousDoctorAsk = history.some(m =>
        m.role === 'user' &&
        isDoctorNameRequestText(String(m.content || ''), false)
      );
      const isDoctorNamesRequest = !isStructuredFormPayload && isDoctorNameRequestText(inboundText, hasPreviousDoctorAsk);
      const doctorsForProfileQuestion = DoctorDirectoryResolver.getDoctors(brain);
      const isDoctorProfileQuestion = !isStructuredFormPayload && isDoctorProfileQuestionText(inboundText, doctorsForProfileQuestion);

      // P0.16-K: "başka bilgi" / open-ended continuation — kept for LLM hint injection only, NOT for bypass
      // P0.16-K: match both Turkish ş and ASCII s for real WhatsApp messages
      const isOpenContinuation = /ba(?:ş|s)ka\s+(?:bir\s+)?(bilgi|soru|[şs]ey)|ba(?:ş|s)ka\s+bir\s+(?:ş|s)ey\s+sorabilir|daha\s+fazla\s+bilgi|bir\s+(?:ş|s)ey\s+daha/i.test(inboundText);

      // P0.16-L: routeAll — full intent matrix
      // P0.30 Gate Diet: isCannotTravelObjection, isDistanceObjection, isPoliteClose kept as
      // detection variables but their bypass blocks are removed. LLM + tenant prompt handles these.
      const allIntents = ConversationIntentRouter.routeAll(inboundText, _tenantDeptKw);
      const isThanksButContinue = allIntents.includes('thanks_but_continue');
      const isOpenContinuationIntent = allIntents.includes('open_continuation') || isOpenContinuation;

      // P0.16-L: Conversation frame (extends ConsultantConversationStateResolver with duration/objections)
      const safeHistoryForFrame = history.filter(m => m.content != null).map(m => ({ role: m.role, content: m.content as string }));
      const conversationFrame = ConversationFrameResolver.resolve(safeHistoryForFrame);
      const selfParticipant = conversationFrame.participants.find(p => p.relation === 'self') || null;
      const locationLabel = selfParticipant?.location || null;

      // Telemetry: doctor lookup department selection
      if (isDoctorLookup) {
        console.log(JSON.stringify({
          tag: 'DOCTOR_LOOKUP_DEPARTMENT_SELECTED',
          tenantId,
          conversationId: conversationId || 'unknown',
          resolvedActiveDepartment: resolvedActiveDepartment || null,
          staleDepartment: staleDept,
          source: currentMsgDept ? 'current_message' : recentContextDept ? 'recent_conversation' : staleDept ? 'stale_crm' : 'null',
          confidence: currentMsgDept ? 'high' : recentContextConfidence,
          hasDoctorDirectory,
          shouldBypass: isDoctorLookup && !hasDoctorDirectory,
          workerPath
        }));
      }

      // Check for recall frustration with facts
      const isRecallFrustration = ['söyledim', 'soyledim', 'belirttim', 'belirtmiştim', 'belirtmistim', 'yazdım ya', 'yazdim ya', 'aynı şeyi söyleme', 'ayni seyi soyleme'].some(kw => cleanInbound.includes(kw));
      const { buildRecallFactsSummary } = require('./context-aware-safe-fallback');
      const recallSummary = buildRecallFactsSummary(history);
      const isRecallWithFacts = isRecallFrustration && recallSummary.length > 0;

      // P0.30 Gate Diet: isThanksButContinueBypass and isOpenContinuationBypass removed.
      // LLM handles these naturally via hint injection at L2121.

      // Flags and bypass targets resolved early in step 5c
      const cleanInboundPunct = cleanInbound.replace(/[?.!,;:]/g, '').trim();
      const isWhatTurkishBypass = cleanInboundPunct === 'what' && (replyLanguage === 'tr');

      const multiIntentGuidance = isMultiIntentQuery
        ? MultiIntentConsultantComposer.buildPromptGuidance(inboundText)
        : '';

      const collectDoctorPolicyDepartments = (consultantState?: any): string[] => {
        const depts: string[] = [];
        const addDept = (dept?: string | null) => {
          const clean = String(dept || '').trim();
          if (!clean) return;
          if (depts.some(d => d.toLocaleLowerCase('tr-TR') === clean.toLocaleLowerCase('tr-TR'))) return;
          depts.push(clean);
        };

        // The department resolved from the latest inbound text has priority.
        // Conversation/CRM state may still carry older topics such as Check-up
        // or Kardiyoloji while the patient is now asking Dermatoloji doctors.
        addDept(resolvedActiveDepartment || null);
        for (const p of consultantState?.participants || []) {
          addDept(p?.department || null);
        }
        return depts;
      };

      const isLlmBypassChallenge = isPromptChallenge || isBotAccusation || isAiAccusation || isAngryPromptChallenge
        || shouldBypassDoctorLookup || isRecallWithFacts
        || (isDoctorNamesRequest && !isMultiIntentQuery)
        || (isDoctorProfileQuestion && !isMultiIntentQuery)
        || isWhatTurkishBypass;

      let text = '';
      let bypassed = false;
      let modelUsed = 'gemini-2.5-flash';
      let inputTokens = 0;
      let outputTokens = 0;
      let isCallbackTimeAnswerPath = false;

      if (isLlmBypassChallenge) {
        // P0.16-H/K Telemetry: intent list
        const intentList: string[] = [];
        if (shouldBypassDoctorLookup) intentList.push('doctor_lookup');
        if (isRecallWithFacts)        intentList.push('recall_frustration');
        if (isPromptChallenge)        intentList.push('prompt_challenge');
        if (isBotAccusation || isAiAccusation) intentList.push('identity_question');
        if (isMixedDoctorProcess)     intentList.push('process_question');
        if (isMultiIntentQuery)       intentList.push('multi_intent_query_hint_only');
        if (isDoctorNamesRequest)     intentList.push('doctor_names_request');
        if (isDoctorProfileQuestion)  intentList.push('doctor_profile_question');
        if (effectiveIsCallbackConfirmation)   intentList.push('callback_confirmation');
        if (isArrivalDateAnswer)      intentList.push('arrival_date_answer');
        if (shouldBypassCallbackTimeAnswer) intentList.push('callback_time_answer');


        if (intentList.length > 0) {
          console.log(JSON.stringify({
            tag: 'MULTI_INTENT_DEPARTMENT_SELECTED',
            tenantId,
            conversationId: conversationId || 'unknown',
            resolvedActiveDepartment: resolvedActiveDepartment || null,
            staleDepartment: staleDept,
            source: currentMsgDept ? 'current_message' : recentContextDept ? 'recent_conversation' : staleDept ? 'stale_crm' : 'null',
            intentList,
            confidence: currentMsgDept ? 'high' : recentContextConfidence,
            isMixedDoctorProcess,
            workerPath
          }));
        }

        // Resolve consultant state for all bypass paths (P0.16-K)
        const safeHistoryForState = history.filter(m => m.content != null).map(m => ({ role: m.role, content: m.content as string }));
        const consultantState = ConsultantConversationStateResolver.resolve(safeHistoryForState);

        let fallbackResult: any;
        // ── Doctor profile/trust question — grounded, no subjective ranking ─────────
        if (!fallbackResult && isDoctorProfileQuestion) {
          const depts = collectDoctorPolicyDepartments(consultantState);
          const profilePolicy = DoctorNamesPolicy.resolveDoctorProfile(brain, inboundText, depts, replyLanguage);
          if (profilePolicy) {
            fallbackResult = { text: profilePolicy.text, finalPath: `doctor_profile_policy_${profilePolicy.mode}` };
            console.log(JSON.stringify({
              tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
              path: `doctor_profile_policy_${profilePolicy.mode}`,
              tenantId,
              conversationId: conversationId || 'unknown',
              workerPath
            }));
          }
        }

        // ── P0.16-K: Doctor names request ────────────────────────────────────
        if (!fallbackResult && isDoctorNamesRequest) {
          // Collect departments from consultant state (multi-patient aware)
          const depts = collectDoctorPolicyDepartments(consultantState);
          const doctorPolicy = DoctorNamesPolicy.resolve(brain, depts, hasPreviousDoctorAsk, replyLanguage);
          fallbackResult = { text: doctorPolicy.text, finalPath: `doctor_names_policy_${doctorPolicy.mode}` };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: `doctor_names_policy_${doctorPolicy.mode}`,
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // ── P0.16-M: Mixed doctor+process — DoctorNamesPolicy + inline process (legacy ContextAwareSafeFallbackResolver removed) ─
        if (!fallbackResult && isMixedDoctorProcess) {
          // Doctor part — use DoctorNamesPolicy (avoids legacy "bu ekrandan" text)
          const mixedDepts = collectDoctorPolicyDepartments(consultantState);
          const mixedDoctorPolicy = DoctorNamesPolicy.resolve(brain, mixedDepts, hasPreviousDoctorAsk);

          // Process part — inline consultant-owned response
          const dept = resolvedActiveDepartment || (mixedDepts[0] || 'ilgili bölümümüz');
          const processText = [
            `${dept} sürecinde ilk adım uzman hekim değerlendirmesidir.`,
            `Muayenede şikayetiniz ve varsa mevcut tetkikleriniz birlikte değerlendirilir; size özel plan hekim değerlendirmesiyle netleşir.`,
            `Bu bölümde özellikle hangi bilgiyi netleştirmek istersiniz?`,
          ].join('\n');

          const composedText = [mixedDoctorPolicy.text, processText]
            .filter(t => t && t.trim().length > 0)
            .join('\n\n');
          fallbackResult = { text: composedText, finalPath: 'mixed_intent_doctor_process' };
          console.log(JSON.stringify({
            tag: 'MIXED_INTENT_COMPOSED',
            tenantId,
            conversationId: conversationId || 'unknown',
            resolvedActiveDepartment: resolvedActiveDepartment || null,
            doctorPolicyMode: mixedDoctorPolicy.mode,
            workerPath
          }));
        }

        // ── Default: other bypass intents via ContextAwareSafeFallbackResolver ─
        if (!fallbackResult) {
          fallbackResult = ContextAwareSafeFallbackResolver.resolve({
            inboundText,
            brain,
            identityConfig: brain.prompts.metadata?.identity || brain.context.config?.identity || {},
            unifiedContext,
            channelId,
            systemPromptText,
            resolvedActiveDepartment: resolvedActiveDepartment || null,
            replyLanguage,
            turkeyVisitIntent: currentVisitIntent,
            formAlreadyAddressed
          });
        }

        text = fallbackResult.text;
        bypassed = true;
        modelUsed = 'bypass';

        console.log(JSON.stringify({
          tag: "AI_RESPONSE_ORCHESTRATOR_FALLBACK_APPLIED",
          tenantId,
          conversationId: conversationId || 'unknown',
          reason: "llm_bypass_challenge",
          workerPath
        }));
      } else {
        // P0.16-K: "başka bilgi" open-continuation — ensure LLM doesn't close conversation
        let llmSystemPrompt = systemPromptText;

        try {
          if (!sandbox) {
            const { QubaBrainCompiler } = await import('@/lib/brain/core');
            const qubaBrainProfile = QubaBrainCompiler.compile(brain);
            if (qubaBrainProfile.rollout.liveDirectiveEnabled) {
              llmSystemPrompt += QubaBrainCompiler.buildDirective(qubaBrainProfile);
              console.log(JSON.stringify({
                tag: 'QUBA_BRAIN_CORE_LIVE_DIRECTIVE_APPLIED',
                tenantId,
                conversationId: conversationId || 'unknown',
                industry: qubaBrainProfile.industry,
                readinessStatus: qubaBrainProfile.readiness.status,
                readinessScore: qubaBrainProfile.readiness.score,
                rolloutMode: qubaBrainProfile.rollout.mode,
                promptBudgetStatus: qubaBrainProfile.diagnostics.promptBudget?.status || 'unknown',
                workerPath
              }));
            } else if (qubaBrainProfile.rollout.mode === 'active') {
              console.log(JSON.stringify({
                tag: 'QUBA_BRAIN_CORE_LIVE_DIRECTIVE_BLOCKED',
                tenantId,
                conversationId: conversationId || 'unknown',
                readinessStatus: qubaBrainProfile.readiness.status,
                readinessScore: qubaBrainProfile.readiness.score,
                blockers: qubaBrainProfile.readiness.blockers.slice(0, 8),
                rolloutMode: qubaBrainProfile.rollout.mode,
                workerPath
              }));
            }
          }
        } catch (qubaBrainLiveErr) {
          console.error('[AIResponseOrchestrator] Quba Brain live directive failed:', qubaBrainLiveErr);
        }
        if (multiIntentGuidance) {
          let enrichedMultiIntentGuidance = multiIntentGuidance;
          const multiIntentList = MultiIntentConsultantComposer.detectIntentList(inboundText);
          if (multiIntentList.includes('doctor_names')) {
            const doctorDeptHints: string[] = [];
            const addDeptHint = (dept?: string | null) => {
              const clean = String(dept || '').trim();
              if (!clean) return;
              if (doctorDeptHints.some(d => d.toLocaleLowerCase('tr-TR') === clean.toLocaleLowerCase('tr-TR'))) return;
              doctorDeptHints.push(clean);
            };
            addDeptHint(resolvedActiveDepartment || null);
            for (const p of conversationFrame.participants || []) addDeptHint(p.department || null);
            const verifiedDoctorHint = DoctorNamesPolicy.resolve(brain, doctorDeptHints, true, replyLanguage);
            if (verifiedDoctorHint.mode === 'verified_list') {
              enrichedMultiIntentGuidance += `\nDoğrulanmış hekim bilgisi (yalnızca hasta doktor adı sorusuna cevap verirken kullan):\n${verifiedDoctorHint.text}`;
            } else {
              enrichedMultiIntentGuidance += `\nDoktor adı sorusu var ama doğrulanmış liste çözülemediyse isim uydurma; kısa ve dürüst şekilde güncel hekim listesini netleştireceğini söyle.`;
            }
          }
          llmSystemPrompt = llmSystemPrompt + `\n\n[ÇOKLU NİYET REHBERİ - HASTAYA AYNEN YAZMA]\n${enrichedMultiIntentGuidance}\n[/ÇOKLU NİYET REHBERİ]`;
          try {
            console.log(JSON.stringify({
              tag: 'MULTI_INTENT_LLM_GUIDANCE_INJECTED',
              tenantId,
              conversationId: conversationId || 'unknown',
              intentList: multiIntentList,
              workerPath
            }));
          } catch { /* non-fatal */ }
        }
        if (isOpenContinuation || isOpenContinuationIntent || isThanksButContinue) {
          llmSystemPrompt = llmSystemPrompt + '\n\n[NOT: Kullanıcı konuşmayı sürdürmek istiyor. "İyi günler" veya kapatma cümlesi KULLANMA. Yeni sorusunu bekle veya yardıma açık olduğunu nazikçe belirt.]';
        }

        // P0.16-M: Short affirmative ("tamam", "olur", "evet", "peki") — inject conversation-state-first directive
        // Prevents LLM from regressing to stale CRM context (Kardiyoloji/Ağustos 2026 etc.)
        const isShortAffirmative = /^(?:tamam|olur|evet|peki|harika|super|süper|anla[ydş]|anlad[ıi]m|anlaşıldı|anlasild[ıi]|tamamdır|tamamdir|tamamsa)[\.!?\s]*$/i.test(inboundText.trim());
        if (isShortAffirmative && history.length > 2) {
          llmSystemPrompt = llmSystemPrompt + '\n\n[ÖNEMLİ KURAL: Kullanıcı kısa bir onay/kabul mesajı gönderdi. Son konuşma bağlamına (hastanın şikayeti, branş, konum) göre yanıt ver. CRM kayıtlarındaki eski departman/tarih bilgilerine (Kardiyoloji, Ağustos 2026 vb.) GÖRE HAREKET ETME. Asıl konuşmayı referans al.]';
        }

        // P0.16-M: Conversation frame priority — inject active state BEFORE CRM context
        if (conversationFrame.participants.length > 0 && history.length > 1) {
          const frameSelfParticipant = conversationFrame.participants.find(p => p.relation === 'self');
          if (frameSelfParticipant?.complaint && frameSelfParticipant.complaint !== '') {
            const frameNote = `\n\n[AKTIF KONUŞMA DURUMU (yüksek öncelik): Hasta şikayeti: "${frameSelfParticipant.complaint}". Konum: "${frameSelfParticipant.location || 'bilinmiyor'}". CRM/form kayıtlarındaki önceki bilgiler bu konuşma bağlamıyla çelişiyorsa KONUŞMAYI referans al.]`;
            llmSystemPrompt = llmSystemPrompt + frameNote;
          }
        }

        // P0.16-K: Inject conversation summary to LLM prompt (max 10 lines)
        const safeHistoryForLLM = history.filter(m => m.content != null).map(m => ({ role: m.role, content: m.content as string }));
        const conversationSummary = ConsultantConversationStateResolver.buildPromptSummary(safeHistoryForLLM);
        if (conversationSummary) {
          llmSystemPrompt = llmSystemPrompt + conversationSummary;
        }

        // Run LLM Response generation
        const formattedMessages: ChatMessage[] = [
          { role: 'system' as const, content: llmSystemPrompt },
          ...history
        ];
        if (history.length === 0 || history[history.length - 1].role !== 'user') {
          formattedMessages.push({ role: 'user' as const, content: inboundText });
        }

        const llmModel = brain.context.settings?.aiModel || 'gemini-2.5-flash';
        const apiKey = brain.context.config?.raw?.gemini_api_key || process.env.GEMINI_API_KEY || '';

        const aiConfig = {
          provider: 'gemini' as const,
          modelId: llmModel,
          apiKey,
          temperature: 0.7,
          maxTokens: brain.context.settings?.maxResponseTokens || 1500
        };

        const orchestrator = new AIOrchestrator();
        
        const response = await orchestrator.generateResponse(
          formattedMessages,
          aiConfig,
          tenantId,
          conversationId || 'sandbox_test_conversation',
          { sandbox }
        );
        
        text = response.text || '';
        modelUsed = response.modelUsed || llmModel;
        inputTokens = response.inputTokens || 0;
        outputTokens = response.outputTokens || 0;

        if (modelUsed === 'fallback') {
          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_FALLBACK_APPLIED",
            tenantId,
            conversationId: conversationId || 'unknown',
            reason: response.finishReason || "llm_generation_error",
            workerPath
          }));

          // Unconditionally set generic multilingual load/retry message
          const lang = replyLanguage || tenantDefaultLang || 'tr';
          let fallbackMsg = '';
          if (lang === 'tr') {
            fallbackMsg = "Sistemlerimizde geçici bir yoğunluk yaşanıyor. Lütfen birkaç dakika sonra tekrar dener misiniz? 🙏";
          } else if (lang === 'de') {
            fallbackMsg = "In unseren Systemen tritt derzeit eine vorübergehende Auslastung auf. Bitte versuchen Sie es in ein paar Minuten noch einmal. 🙏";
          } else if (lang === 'nl') {
            fallbackMsg = "Er is momenteel een tijdelijke drukte in onze systemen. Probeer het over een paar minuten nog eens. 🙏";
          } else if (lang === 'ar') {
            fallbackMsg = "نواجه حاليًا ضغطًا مؤقتًا في أنظمتنا. يرجى المحاولة مرة أخرى بعد بضع دقائق. 🙏";
          } else {
            fallbackMsg = "We are currently experiencing a temporary high load in our systems. Please try again in a few minutes. 🙏";
          }
          text = fallbackMsg;
        }
      }


      let ctaOfferedRecently = false;
      if (Array.isArray(history)) {
        const last3Assistant = assistantHistory.slice(-3);
        ctaOfferedRecently = last3Assistant.some((m: any) => {
          const textLower = (m.content || '').toLowerCase();
          return ['randevu', 'görüşme', 'gorusme', 'arayalım', 'arayalim', 'arayebiliriz', 'arama', 'telefon'].some(kw => textLower.includes(kw));
        });
      }

      const callbackIntents = ['call_scheduling_request', 'callback_time_answer', 'callback_confirmation', 'schedule_confirmation'];
      if (callbackIntents.includes(effectiveIntent)) {
        ctaOfferedRecently = false;
      }

      const qgOptions = {
        ctaOfferedRecently,
        angryPatientMode: isAngryPromptChallenge,
        personaName: brain.prompts.metadata?.identity?.personaName || brain.context.config?.identity?.personaName,
        organizationName: brain.prompts.metadata?.identity?.organizationName || brain.context.config?.identity?.organizationName,
        organizationShortName: brain.prompts.metadata?.identity?.organizationShortName || brain.context.config?.identity?.organizationShortName,
        identityAlreadyIntroduced: !isFirstAssistantTurn,
        asksIdentity: isBotAccusation,
        asksName: isBotAccusation,
        patientClaimsBot: isBotAccusation || isAiAccusation,
        patientProvidedAvailability: !!unifiedContext?.patientProvidedAvailability
      };


      // Run Turkish Quality Gate check on LLM response
      let qualityGateValid = true;
      let qualityGateReason = '';
      
      if (!bypassed) {
        const qualityGate = MultilingualQualityGate.validate({
          responseText: text,
          replyLanguage: replyLanguage === 'tr' ? 'Türkçe' : 'İngilizce',
          qualityGateLocale: replyLanguage === 'tr' ? 'tr' : 'generic',
          qgOptions
        });
        
        if (qualityGate.valid) {
          text = qualityGate.morphologyCorrectedText || text;
        } else {
          qualityGateValid = false;
          qualityGateReason = qualityGate.reason || 'quality_gate_failed';

          const fallbackResult = ContextAwareSafeFallbackResolver.resolve({
            inboundText,
            brain,
            identityConfig: brain.prompts.metadata?.identity || brain.context.config?.identity || {},
            unifiedContext,
            channelId,
            systemPromptText,
            resolvedActiveDepartment: resolvedActiveDepartment || null,
            replyLanguage,
            turkeyVisitIntent: currentVisitIntent,
            formAlreadyAddressed
          });
          text = fallbackResult.text;
          modelUsed = 'fallback';

          console.log(JSON.stringify({
            tag: "AI_RESPONSE_ORCHESTRATOR_FALLBACK_APPLIED",
            tenantId,
            conversationId: conversationId || 'unknown',
            reason: `quality_gate_failed:${qualityGateReason}`,
            workerPath
          }));
        }
      }

      // 9. Morphology Guard — applies to ALL response paths (LLM + bypass + mixed)
      const morphology = TurkishMorphologyGuard.check(text, true, doctorNames);
      if (morphology.hasMorphologyError && morphology.correctedText) {
        text = morphology.correctedText;
      }
      // P0.16-I: TURKISH_MORPHOLOGY_GUARD_APPLIED telemetry (safe metadata only)
      if (morphology.hasMorphologyError || morphology.correctionApplied) {
        console.log(JSON.stringify({
          tag: 'TURKISH_MORPHOLOGY_GUARD_APPLIED',
          tenantId,
          conversationId: conversationId || 'unknown',
          workerPath,
          responseSource: modelUsed === 'fallback' ? 'fallback/context_aware_fallback' : (bypassed ? 'bypass' : 'llm'),
          detectedPatterns: morphology.errors.map(e => e.pattern),
          changed: morphology.correctionApplied
        }));
      }

      // 9b-9c. P0.16-M: FinalPipelineEnforcer — mandatory chain (normalizer + formatter + telemetry)
      // Replaces separate 9b/9c steps; enforces FINAL_RESPONSE_SOURCE telemetry for all paths
      // Also runs checkLegacyBlock to catch any "bu ekrandan" text that slipped through
      const legacyBlock = FinalPipelineEnforcer.checkLegacyBlock(text);
      if (legacyBlock) {
        text = legacyBlock;
        console.log(JSON.stringify({ tag: 'FINAL_PIPELINE_ENFORCED', reason: 'legacy_block', tenantId, conversationId: conversationId || 'unknown', workerPath }));
      }
      const finalPipeCtx = {
        tenantId,
        conversationId: conversationId || undefined,
        workerPath,
        responseSource: modelUsed === 'fallback' ? 'fallback/context_aware_fallback' : (bypassed ? (modelUsed === 'bypass' ? 'bypass' : 'bypass_unknown') : 'llm'),
        complaint: selfParticipant?.complaint || undefined,
        location: locationLabel || undefined,
        channel: channelId ? 'whatsapp' : undefined,
        replyLanguage,
      };
      const finalPipeResult = FinalPipelineEnforcer.enforce(text, finalPipeCtx);
      text = finalPipeResult.text;

      // 10. Outbound Guard Checks
      // P0.17-FP BUGFIX: Inject identityConfig into unifiedContext before FinalOutboundGuard.process
      // so that the guard's internal recovery (ContextAwareSafeFallbackResolver) has the persona name.
      // Without this, recovery falls through to 'Merhaba, ben hastane iletişim asistanıyım.' generic path.
      if (unifiedContext && !unifiedContext.identityConfig) {
        const resolvedIdentityForGuard = brain.prompts.metadata?.identity || brain.context.config?.identity || {};
        if (Object.keys(resolvedIdentityForGuard).length > 0) {
          unifiedContext.identityConfig = resolvedIdentityForGuard;
        }
      }
      text = FinalOutboundGuard.process(text, {
        tenantId,
        channelId,
        conversationId: conversationId || 'unknown',
        inboundText,
        unifiedContext,
        industry: brain.context.config?.industry || (brain.prompts.metadata as any)?.industry || '',
        systemPromptText,
        promptVersion: brain.prompts.metadata?.version || undefined,
        workerPath,
        responseDedupeKey: responseDedupeKey || undefined,
        aggregatedMessageCount: history.length,
        intent: topicSwitch.hasSwitched ? 'topic_switch' : (isLlmBypassChallenge ? 'prompt_challenge' : 'generic_other'),
        fallbackApplied: bypassed || !qualityGateValid,
        fallbackReason: qualityGateReason || (bypassed ? 'llm_bypass_challenge' : undefined),
        doctorDirectoryHit: hasDoctorDirectory,
        topicSwitchApplied: topicSwitch.hasSwitched
      });

      const noFormFirstGreeting = !hasVerifiedFormContext && isFirstAssistantTurn && unifiedContext?.isGreetingOnly === true;
      const containsFormLeadPhrase = /doldurduğunuz form|formunuzda|form doğrultusunda|form dogrultusunda|başvurunuz|basvurunuz|form doldur/i.test(text || '');
      if (noFormFirstGreeting && containsFormLeadPhrase) {
        text = "Merhaba, Başkent Üniversitesi Konya Hastanesi'nden Rüya ben. Size nasıl yardımcı olabilirim?";
        console.log(JSON.stringify({
          tag: 'NO_FORM_GREETING_FORM_PHRASE_RECOVERY',
          tenantId,
          conversationId: conversationId || 'unknown',
          workerPath
        }));
      }

      // 11. WhatsApp formatting policy applied
      text = ResponseFormattingPolicy.format(text);

      // P0.27: Save last_callback_offer to conversation metadata if the bot response proposes a date/time
      if (!sandbox && conversationId && text && !isCallbackTimeAnswerPath && effectiveIntent !== 'arrival_date_answer' && effectiveIntent !== 'callback_time_answer' && effectiveIntent !== 'call_time_answer' && !effectiveIsCallbackTimeAnswer) {
        try {
          const { parseDeterministicSuggestion } = require('../../utils/date-parser');
          const parsedSugg = parseDeterministicSuggestion(text, new Date(), null, null);
          if (parsedSugg.suggested_date && parsedSugg.suggested_time && parsedSugg.proposed_date) {
            // Fix 1: Filter out broad working hours / mesai statements
            let isBroadRange = false;
            if (parsedSugg.suggested_time && parsedSugg.suggested_time_end) {
              const [h1, m1] = parsedSugg.suggested_time.split(':').map(Number);
              const [h2, m2] = parsedSugg.suggested_time_end.split(':').map(Number);
              const diffMin = (h2 * 60 + m2) - (h1 * 60 + m1);
              if (diffMin >= 180) { // 3 hours or more
                isBroadRange = true;
              }
            }
            const lowerText = text.toLowerCase();
            const isWorkingHoursInfo = lowerText.includes('çalışma saat') || 
                                       lowerText.includes('mesai') || 
                                       lowerText.includes('hizmet vermekte') ||
                                       lowerText.includes('pazar hariç') ||
                                       lowerText.includes('pazar haric') ||
                                       /09:00.*21:00/i.test(lowerText) ||
                                       /09\.00.*21\.00/i.test(lowerText);
            
            const isBroadWorkingHours = isBroadRange && isWorkingHoursInfo;

            if (!isBroadWorkingHours) {
              const db = withTenantDB(tenantId);
              // Fetch existing metadata to preserve other fields
              const conv = await db.executeSafe({
                text: `SELECT metadata FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
                values: [conversationId, tenantId]
              }) as any[];
              const currentMeta = conv[0]?.metadata || {};
              const updatedMeta = {
                ...currentMeta,
                last_callback_offer: {
                  proposed_due_at: parsedSugg.proposed_date,
                  timezone: parsedSugg.suggested_timezone_basis || 'Europe/Istanbul',
                  source: 'bot_callback_offer',
                  offered_at: new Date().toISOString()
                }
              };
              await db.executeSafe({
                text: `UPDATE conversations SET metadata = $1 WHERE id = $2 AND tenant_id = $3`,
                values: [JSON.stringify(updatedMeta), conversationId, tenantId]
              });
            }
          }
        } catch (err) {
          console.error('[AIResponseOrchestrator] Failed to save last_callback_offer metadata:', err);
        }
      }

      if (!sandbox && conversationId && text) {
        try {
          const { BrainV2ShadowPlanner } = await import('./brain-v2-shadow-planner');
          const { BrainV2ResponseEvaluator } = await import('./brain-v2-response-evaluator');
          const brainV2ShadowPlan = BrainV2ShadowPlanner.build({
            inboundText,
            history: history
              .filter((message: ChatMessage) => typeof message.content === 'string')
              .map((message: ChatMessage) => ({
                role: message.role,
                content: message.content as string,
              })),
            brain,
            channel: params.channel,
            now: new Date(),
            conversation: unifiedContext?.conversation,
            opportunity: unifiedContext?.opportunity,
            profile: unifiedContext?.profile,
            latestForm: unifiedContext?.latestForm,
          });
          const brainV2ResponseEvaluation = BrainV2ResponseEvaluator.evaluate(
            text,
            brainV2ShadowPlan,
            inboundText
          );
          const hasHighValueLearningSignal = brainV2ShadowPlan.riskFlags.length > 0
            || brainV2ShadowPlan.mustAnswer.length > 1
            || brainV2ShadowPlan.detectedIntents.some((intent: string) => [
              'price_question',
              'doctor_names',
              'doctor_profile',
              'accommodation_question',
              'address_question',
              'concern_objection',
            ].includes(intent));
          const shouldLogBrainV2Shadow = brainV2ResponseEvaluation.status !== 'pass'
            || hasHighValueLearningSignal;

          if (shouldLogBrainV2Shadow) {
            await settingsDb.executeSafe({
              text: `INSERT INTO ai_audit_logs (tenant_id, conversation_id, action, reasoning_summary, result_summary)
                     VALUES ($1, $2, $3, $4, $5)`,
              values: [
                tenantId,
                conversationId,
                'brain_v2_shadow_eval',
                `Brain v2 shadow status: ${brainV2ResponseEvaluation.status}, score: ${brainV2ResponseEvaluation.score}`,
                JSON.stringify({
                  version: brainV2ResponseEvaluation.version,
                  score: brainV2ResponseEvaluation.score,
                  status: brainV2ResponseEvaluation.status,
                  contactMode: brainV2ShadowPlan.contactMode,
                  detectedIntents: brainV2ShadowPlan.detectedIntents.slice(0, 12),
                  mustAnswer: brainV2ShadowPlan.mustAnswer.slice(0, 12),
                  riskFlags: brainV2ShadowPlan.riskFlags.slice(0, 12),
                  missingAnswers: brainV2ResponseEvaluation.missingAnswers.slice(0, 12),
                  forbiddenHits: brainV2ResponseEvaluation.forbiddenHits.slice(0, 12),
                  qualityWarnings: brainV2ResponseEvaluation.qualityWarnings.slice(0, 12),
                  workerPath,
                  timestamp: new Date().toISOString(),
                })
              ]
            });
          }
        } catch (brainV2ShadowErr) {
          console.error('[AIResponseOrchestrator] Brain v2 shadow evaluation failed:', brainV2ShadowErr);
        }
      }

      if (conversationId) {
        console.log(JSON.stringify({
          tag: "AI_RESPONSE_ORCHESTRATOR_COMPLETED",
          tenantId,
          conversationId,
          workerPath,
          responseDedupeKey,
          latencyMs: Date.now() - startTime
        }));
      }

      return buildResult({
        text,
        modelUsed,
        promptVersion: brain.prompts.metadata?.version,
        latencyMs: Date.now() - startTime,
        bypassed,
        isRetry: false,
        qualityGateFailed: !qualityGateValid,
        qualityGateReason: qualityGateReason || undefined,
        inputTokens,
        outputTokens,
        responseDedupeKey: responseDedupeKey || undefined,
        burstAnchorId: burstAnchorId || undefined,
        replyLanguage,
      });

    } finally {
      // ────────────────────────────────────────────────────────
      // 3. RELEASE PROCESSING LOCKS
      // ────────────────────────────────────────────────────────
      if (conversationId && responseDedupeKey) {
        if (sandbox) {
          const activeLock = AIResponseOrchestrator.sandboxLockStore.get(responseDedupeKey);
          if (activeLock && activeLock.token === lockToken) {
            AIResponseOrchestrator.sandboxLockStore.delete(responseDedupeKey);
          }
        } else {
          const db = withTenantDB(tenantId);
          
          if (isRedisLockAcquired) {
            try {
              const { redis } = await import('@/lib/redis');
              if (redis) {
                const oldChannelId = resolvedChannelId || params.channel || 'unknown';
                const oldLockKey = `dedupe:response:${tenantId}:${oldChannelId}:${conversationId}:${burstAnchorId}:processing`;
                const newLockKey = `${responseDedupeKey}:processing`;

                const releaseScript = `
                  if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                  else
                    return 0
                  end
                `;
                await Promise.all([
                  redis.eval(releaseScript, [oldLockKey], [lockToken]),
                  redis.eval(releaseScript, [newLockKey], [lockToken])
                ]);
              }
            } catch (redisErr) {
              console.error('[AIResponseOrchestrator] Redis unlock failed:', redisErr);
            }
          }
          
          if (isDbLockAcquired) {
            try {
              await db.executeSafe({
                text: `UPDATE conversations 
                       SET metadata = COALESCE(metadata, '{}'::jsonb) - 'processing_locked_at' - 'response_dedupe_key'
                       WHERE id = $1 AND tenant_id = $2`,
                values: [conversationId, tenantId]
              });
            } catch (dbErr) {
              console.error('[AIResponseOrchestrator] DB unlock failed:', dbErr);
            }
          }
        }
      }
    }
  }
}
