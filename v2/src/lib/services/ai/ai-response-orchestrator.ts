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
import { DoctorNamesPolicy } from './doctor-names-policy';
import { ConversationIntentRouter } from './conversation-intent-router';
// P0.16-L: Live/test parity pipeline imports
import { ConversationFrameResolver } from './conversation-frame-resolver';
import { WhatsAppFormattingFinalizer } from './whatsapp-formatting-finalizer';
import { TurkishFinalQualityNormalizer } from './turkish-final-quality-normalizer';
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
        let timezone: string | null = null;
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
        const tenantDefaultLang = brain.context.config?.defaultLanguage || undefined;
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

      // Has active/latest form or open opportunity?
      const hasForm = !!(unifiedContext?.latestForm || (Array.isArray(unifiedContext?.patient_known_facts) && unifiedContext.patient_known_facts.length > 0) || unifiedContext?.opportunity);

      // Check if the form/opportunity has already been addressed by the bot in this conversation
      let formAlreadyAddressed = false;
      if (hasForm) {
        let latestFormCreatedAt: Date | null = null;
        if (unifiedContext?.latestForm?.created_at) {
          latestFormCreatedAt = new Date(unifiedContext.latestForm.created_at);
        } else if (unifiedContext?.opportunity?.created_at) {
          latestFormCreatedAt = new Date(unifiedContext.opportunity.created_at);
        }

        if (latestFormCreatedAt && !sandbox) {
          try {
            const outboundAfterForm = await db.executeSafe({
              text: `SELECT id FROM messages 
                     WHERE tenant_id = $1 AND conversation_id = $2 AND direction = 'out' AND created_at > $3 
                     LIMIT 1`,
              values: [tenantId, conversationId, latestFormCreatedAt]
            }) as any[];
            if (outboundAfterForm.length > 0) {
              formAlreadyAddressed = true;
            }
          } catch (err) {
            console.warn('[AIResponseOrchestrator] Failed to query outbound messages after form:', err);
          }
        }
      }

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

      // 6. Build Prompt
      const phase = unifiedContext.opportunity?.stage || 'lead';
      const systemPromptText = PromptBuilder.buildSystemPrompt(brain, phase, false, unifiedContext);

      // 7. Check for LLM Bypass/Challenge cases
      const cleanInbound = inboundText.toLowerCase().trim();
      const isBotAccusation = ['bot musun', 'sen bot musun', 'are you a bot', 'botsun', 'robot musun', 'yapay zeka mısın', 'yapay zeka misin', 'insan mısın', 'insan misin'].some(kw => cleanInbound.includes(kw));
      const isAiAccusation = ['yapay zeka', 'yapayzeka', 'gpt', 'gemini', 'openai', 'claude', 'dil modeli', 'hangi model'].some(kw => cleanInbound.includes(kw));
      const isPromptChallenge = ['prompt', 'promt', 'sistem prompt', 'system prompt', 'talimatların', 'sistem talimati', 'kuralın ne', 'direktifin ne', 'uydurma'].some(kw => cleanInbound.includes(kw));
      const isAngryPromptChallenge = isPromptChallenge && ['şikayet', 'sikayet', 'rezalet', 'berbat', 'kötü', 'sinir', 'bıktım', 'yeter', 'dalga'].some(kw => cleanInbound.includes(kw));

      // Resolve doctor directory — use resolvedActiveDepartment from full priority chain
      const doctorsList = DoctorDirectoryResolver.getDoctors(brain, resolvedActiveDepartment || undefined);
      const doctorNames = doctorsList.map(d => d.name);
      const hasDoctorDirectory = doctorsList.length > 0;

      // Doctor lookup check
      const isDoctorLookup = ['doktor', 'hekim', 'uzman', 'cerrah', 'hoca'].some(kw => cleanInbound.includes(kw));
      const shouldBypassDoctorLookup = isDoctorLookup && !hasDoctorDirectory;

      // P0.16-I: Mixed intent detection — doctor_lookup + process_question in same burst
      const isProcessQuestion = ['süreç', 'surec', 'nasıl ışliyor', 'nasıl çalışıyor', 'nasıl yürüyor', 'tanı', 'tedavi', 'muayene', 'operasyon', 'ameliyat', 'aşama', 'adım'].some(kw => cleanInbound.includes(kw));
      const isMixedDoctorProcess = isDoctorLookup && isProcessQuestion;

      // P0.16-K: Intent routing for next_step_request bypass (before LLM)
      const isNextStepRequest = routedIntent === 'next_step_request';

      // P0.16-K: Multi-intent detection (address+price+doctor+process in one message)
      const isMultiIntentQuery = MultiIntentConsultantComposer.isMultiIntent(inboundText);

      // P0.16-K: Doctor names request detection (with repeat check)
      const isDoctorNamesRequest = /doktor\s+isim|hekim\s+isim|doktor\s+isimleri|kimler\s+var|hangi\s+doktorlar|doktor\s+list/.test(cleanInbound);
      const hasPreviousDoctorAsk = history.some(m =>
        m.role === 'user' &&
        /doktor\s+isim|hekim\s+isim|hangi\s+doktorlar/.test((m.content || '').toLowerCase())
      );

      // P0.16-K: "başka bilgi" / open-ended continuation — must NOT close conversation
      // P0.16-K: match both Turkish ş and ASCII s for real WhatsApp messages
      const isOpenContinuation = /ba(?:ş|s)ka\s+(?:bir\s+)?(bilgi|soru|[şs]ey)|ba(?:ş|s)ka\s+bir\s+(?:ş|s)ey\s+sorabilir|daha\s+fazla\s+bilgi|bir\s+(?:ş|s)ey\s+daha/i.test(inboundText);

      // P0.16-L: routeAll — full intent matrix for new bypass paths
      const allIntents = ConversationIntentRouter.routeAll(inboundText, _tenantDeptKw);
      const isThanksButContinue = allIntents.includes('thanks_but_continue');
      const isOpenContinuationIntent = allIntents.includes('open_continuation') || isOpenContinuation;
      const isCannotTravelObjection = allIntents.includes('cannot_travel_objection');
      const isDistanceObjection = allIntents.includes('distance_objection');
      const isPoliteClose = allIntents.includes('polite_close') && !isThanksButContinue && !isOpenContinuationIntent;

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

      // Safe guard: If it's thanks_but_continue or open_continuation, but contains a question mark '?'
      // or is a longer text (possibly containing a specific question not caught by router regex),
      // do NOT bypass LLM. Let Gemini handle the detailed question.
      const isThanksButContinueBypass = isThanksButContinue && !cleanInbound.includes('?') && cleanInbound.length < 45;
      const isOpenContinuationBypass = isOpenContinuationIntent && !cleanInbound.includes('?') && cleanInbound.length < 45;

      const isCallbackConfirmation = effectiveIntent === 'callback_confirmation' || effectiveIntent === 'schedule_confirmation';
      const isArrivalDateAnswer = effectiveIntent === 'arrival_date_answer' && !inboundText.includes('?') && inboundText.length < 50;
      const isCallbackTimeAnswer = effectiveIntent === 'callback_time_answer';

      const isLlmBypassChallenge = isPromptChallenge || isBotAccusation || isAiAccusation || isAngryPromptChallenge || shouldBypassDoctorLookup || isRecallWithFacts || isNextStepRequest || isMultiIntentQuery || isDoctorNamesRequest
        || isThanksButContinueBypass || isOpenContinuationBypass || isCannotTravelObjection || isDistanceObjection || isPoliteClose || isCallbackConfirmation || isArrivalDateAnswer || isCallbackTimeAnswer; // P0.16-L

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
        if (isRecallWithFacts) intentList.push('recall_frustration');
        if (isPromptChallenge) intentList.push('prompt_challenge');
        if (isBotAccusation || isAiAccusation) intentList.push('identity_question');
        if (isMixedDoctorProcess) intentList.push('process_question');
        if (isNextStepRequest)    intentList.push('next_step_request');
        if (isMultiIntentQuery)   intentList.push('multi_intent_query');
        if (isDoctorNamesRequest) intentList.push('doctor_names_request');
        // P0.16-L
        if (isThanksButContinue)      intentList.push('thanks_but_continue');
        if (isOpenContinuationIntent) intentList.push('open_continuation');
        if (isCannotTravelObjection)  intentList.push('cannot_travel_objection');
        if (isDistanceObjection)      intentList.push('distance_objection');
        if (isPoliteClose)            intentList.push('polite_close');
        if (isCallbackConfirmation)   intentList.push('callback_confirmation');
        if (isArrivalDateAnswer)      intentList.push('arrival_date_answer');

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

        // ── P0.16-K: Multi-intent query (4-question burst) — highest priority ──
        if (isMultiIntentQuery) {
          const composed = MultiIntentConsultantComposer.compose(
            inboundText,
            brain,
            safeHistoryForState,
            resolvedActiveDepartment || null,
            workerPath
          );
          if (composed) {
            fallbackResult = { text: composed.text, finalPath: 'multi_intent_consultant_composed' };
            console.log(JSON.stringify({
              tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
              path: 'multi_intent_consultant_composed',
              intentCount: composed.intentList.length,
              tenantId,
              conversationId: conversationId || 'unknown',
              workerPath
            }));
          }
        }

        // ── P0.16-K: Next step request — ask for day/time slot ──────────────
        if (!fallbackResult && isNextStepRequest) {
          fallbackResult = ContextAwareSafeFallbackResolver.resolve({
            inboundText,
            brain,
            identityConfig: brain.prompts.metadata?.identity || brain.context.config?.identity || {},
            unifiedContext,
            channelId,
            systemPromptText,
            resolvedActiveDepartment: resolvedActiveDepartment || null
          });
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'next_step_consultant_ownership',
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // ── P0.16-K: Doctor names request ────────────────────────────────────
        if (!fallbackResult && isDoctorNamesRequest) {
          // Collect departments from consultant state (multi-patient aware)
          const depts: string[] = [];
          for (const p of consultantState.participants) {
            if (p.department && !depts.includes(p.department)) depts.push(p.department);
          }
          if (depts.length === 0 && resolvedActiveDepartment) depts.push(resolvedActiveDepartment);
          const doctorPolicy = DoctorNamesPolicy.resolve(brain, depts, hasPreviousDoctorAsk);
          fallbackResult = { text: doctorPolicy.text, finalPath: `doctor_names_policy_${doctorPolicy.mode}` };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: `doctor_names_policy_${doctorPolicy.mode}`,
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // ── P0.16-L: Thanks but continue (teşekkür ama bir soru daha) ──────────
        if (!fallbackResult && isThanksButContinueBypass) {
          const selfComplaint = selfParticipant?.complaint;
          const openPhrase = selfComplaint
            ? `Tabii, memnuniyetle. ${selfComplaint} ile ilgili başka ne öğrenmek istersiniz?`
            : 'Tabii, memnuniyetle. Başka hangi konuda bilgi almak istersiniz?';
          fallbackResult = { text: openPhrase, finalPath: 'thanks_but_continue' };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'thanks_but_continue_handled',
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // ── P0.16-L: Open continuation (başka bilgi, bir soru daha) ─────────────
        if (!fallbackResult && isOpenContinuationBypass && !isThanksButContinueBypass) {
          fallbackResult = {
            text: 'Tabii, hangi konuda bilgi almak istersiniz? Sormak istediğiniz her şeyi paylaşabilirsiniz.',
            finalPath: 'open_continuation'
          };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'open_continuation_handled',
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // ── P0.16-L: Cannot travel objection (yani ben gelemem) ──────────────────
        if (!fallbackResult && isCannotTravelObjection) {
          const locationNote = locationLabel ? `Almanya'dan` : 'Uzaktan';
          const selfComp = selfParticipant?.complaint || 'şikayetiniz';
          const cannotTravelText = [
            `Anlıyorum, şu an gelmek zor olabilir. Bu tamamen doğal.`,
            ``,
            `${locationNote} gelen ziyaretçilerimiz için önce bir telefon görüşmesiyle süreci netleştiriyoruz. Bu görüşmede:`,
            `• ${selfComp} için hangi branşın değerlendireceğini,`,
            `• Varsa mevcut MR/tetkiklerinizin nasıl paylaşılabileceğini,`,
            `• Geliş planı ve tahmini süreci,`,
            `• Konaklama ve ulaşım seçeneklerini`,
            ``,
            `konuşabiliriz. Böylece gelmeden önce tabloyu net görürsünüz.`,
            ``,
            `Telefon görüşmesi için uygun olduğunuz gün ve saati paylaşır mısınız?`,
          ].join('\n');
          fallbackResult = { text: cannotTravelText, finalPath: 'cannot_travel_objection' };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'cannot_travel_handled',
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // ── P0.16-L: Distance objection (Konya uzak, ama devam) ─────────────────
        if (!fallbackResult && isDistanceObjection && !isCannotTravelObjection) {
          const selfComp = selfParticipant?.complaint || 'şikayetiniz';
          const locNote = locationLabel ? `${locationLabel}'dan` : 'Uzaktan';
          const distText = [
            `Anlıyorum, uzaklık doğal bir endişe olabilir.`,
            ``,
            `${locNote} gelen ziyaretçilerimiz için süreci önce telefonla netleştiriyoruz. Bu görüşmede:`,
            `• ${selfComp} için doğru branş ve uzman bilgisi,`,
            `• Varsa tetkiklerinizin önceden değerlendirilebileceği,`,
            `• Geliş, konaklama ve ulaşım planlaması,`,
            `• Tahmini maliyet aralığı`,
            ``,
            `gibi konuları konuşabilirsiniz. Karar vermeden önce her şeyi net görmüş olursunuz.`,
            ``,
            `Telefon görüşmesi için uygun bir gün ve saat belirleyelim mi?`,
          ].join('\n');
          fallbackResult = { text: distText, finalPath: 'distance_objection' };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'distance_objection_handled',
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // ── P0.16-L: Polite close (yok sağolun, gerek kalmadı) ─────────────────
        if (!fallbackResult && isPoliteClose) {
          fallbackResult = {
            text: 'Anladım, başka bir sorunuz olursa buradan yazabilirsiniz. Geçmiş olsun ve iyi günler dileriz 🙏',
            finalPath: 'polite_close'
          };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'polite_close_handled',
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // ── P0.16-M: Mixed doctor+process — DoctorNamesPolicy + inline process (legacy ContextAwareSafeFallbackResolver removed) ─
        if (!fallbackResult && isMixedDoctorProcess) {
          // Doctor part — use DoctorNamesPolicy (avoids legacy "bu ekrandan" text)
          const mixedDepts: string[] = [];
          for (const p of consultantState.participants) {
            if (p.department && !mixedDepts.includes(p.department)) mixedDepts.push(p.department);
          }
          if (mixedDepts.length === 0 && resolvedActiveDepartment) mixedDepts.push(resolvedActiveDepartment);
          const mixedDoctorPolicy = DoctorNamesPolicy.resolve(brain, mixedDepts, hasPreviousDoctorAsk);

          // Process part — inline consultant-owned response
          const dept = resolvedActiveDepartment || (mixedDepts[0] || 'ilgili bölümümüz');
          const processText = [
            `${dept} sürecinde ilk adım uzman hekim değerlendirmesidir.`,
            `Bu değerlendirmede mevcut bulgularınız (varsa MR/tetkikler) incelenerek size özel bir tedavi planı oluşturulur.`,
            `Sonraki adım için kısa bir telefon görüşmesi planlanabilir.`,
            `Hangi gün ve saat aralığında uygun olursunuz?`,
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

        // ── P0.27: Callback Confirmation Bypass ──────────────────
        if (!fallbackResult && isCallbackConfirmation) {
          // 1. Try to read from conversation.metadata.last_callback_offer first
          const lastOffer = convMeta?.last_callback_offer;
          let parsedSugg: any = null;
          
          if (lastOffer && lastOffer.proposed_due_at) {
            const dt = new Date(lastOffer.proposed_due_at);
            if (!isNaN(dt.getTime())) {
              const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Europe/Istanbul',
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
                suggested_timezone_basis: lastOffer.timezone || 'Europe/Istanbul'
              };
            }
          }
          
          // 2. Fallback to parsing from last assistant message (restricted)
          if (!parsedSugg) {
            const assistantHistory = history.filter(m => m.role === 'assistant');
            const lastAssistantMsg = (assistantHistory.length > 0 ? assistantHistory[assistantHistory.length - 1].content : '') || '';
            
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
          
          let responseText = '';
          const resolvedIndustry = brain.context.config?.industry || (brain.prompts.metadata as any)?.industry || '';
          const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'medical';
          // Deterministic cliches avoided per Rule 6 (no "Müşteri temsilcimiz")
          const agentLabelPossessive = 'Hasta danışmanımızın';
          const agentLabel = 'Hasta danışmanımız';
          
          if (parsedSugg && parsedSugg.suggested_date && parsedSugg.suggested_time && parsedSugg.proposed_date) {
            const [yyyy, mm, dd] = parsedSugg.suggested_date.split('-').map(Number);
            const d = new Date(yyyy, mm - 1, dd);
            const dayName = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'][d.getDay()];
            const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
            const formattedDate = `${dd} ${monthNames[mm - 1]} ${dayName}`;
            
            // Custom Turkish suffix rule
            const hour = parseInt(parsedSugg.suggested_time.split(':')[0], 10);
            const suffixes: Record<number, string> = {
              0: 'de', 1: 'de', 2: 'de', 3: 'te', 4: 'te', 5: 'te', 6: 'da', 7: 'de', 8: 'de', 9: 'da',
              10: 'da', 11: 'de', 12: 'de', 13: 'te', 14: 'te', 15: 'te', 16: 'da', 17: 'de', 18: 'de',
              19: 'da', 20: 'de', 21: 'de', 22: 'de', 23: 'te'
            };
            const suffix = suffixes[hour] || 'da';
            const formattedTime = `${parsedSugg.suggested_time}’${suffix}`;
            
            responseText = `Teyidinizi aldım. ${agentLabel} sizi ${formattedDate} Türkiye saatiyle ${formattedTime} arayacaktır 🙏`;
            
            // Create follow-up task idempotently
            if (!sandbox) {
              try {
                // Task duplicate check on combined fields to enforce idempotency
                const existing = await db.executeSafe({
                  text: `SELECT id FROM follow_up_tasks 
                         WHERE tenant_id = $1 
                           AND conversation_id = $2 
                           AND task_type = $3 
                           AND due_at = $4 
                           AND status IN ('pending', 'in_progress')`,
                  values: [tenantId, conversationId, 'callback_scheduled', parsedSugg.proposed_date]
                }) as any[];
                
                if (existing.length === 0) {
                  const { TaskService } = require('../task.service');
                  const taskService = new TaskService(db);
                  const opportunityId = unifiedContext?.opportunity?.id || null;
                  
                  // Construct a unique hash for metadata idempotency control
                  const crypto = require('crypto');
                  const idempotencyKey = crypto.createHash('sha256')
                    .update(`${tenantId}:${channelId || 'whatsapp'}:${conversationId}:callback_scheduled:${parsedSugg.proposed_date}`)
                    .digest('hex');
                  
                  // Metadata is kept strictly PII-free (no raw phone, patient name, or message text)
                  await taskService.create({
                    tenantId,
                    opportunityId: opportunityId || undefined,
                    conversationId: conversationId || undefined,
                    phoneNumber,
                    taskType: 'callback_scheduled',
                    title: '📞 Geri Arama',
                    description: 'Telefon görüşmesi planlandı.',
                    dueAt: parsedSugg.proposed_date,
                    isAutomated: true,
                    createdBy: 'system',
                    metadata: {
                      idempotency_key: idempotencyKey,
                      callback_time_tr: parsedSugg.suggested_time,
                      source: 'callback_confirmation_bypass'
                    }
                  });
                }
              } catch (taskErr) {
                console.error('[AIResponseOrchestrator] Failed to create callback follow-up task:', taskErr);
              }
            }
          } else {
            const { CallPreferenceLabelResolver } = require('./call-preference-label-resolver');
            const facts = ConversationKnownFactsResolver.resolve({
              history: history.filter((m: any) => m.content != null).map((m: any) => ({ role: m.role, content: m.content as string })),
              opportunity: unifiedContext?.opportunity,
              profile: unifiedContext?.profile,
              latestForm: unifiedContext?.latestForm,
              conversation: unifiedContext?.conversation
            });
            const callTime = facts.preferredCallTime || '';
            const cleanCallTime = callTime ? CallPreferenceLabelResolver.resolve(callTime) : 'en yakın uygun çalışma saatlerinde';
            
            responseText = `Teyidinizi aldım. ${agentLabelPossessive} sizi ${cleanCallTime} araması için notunuzu iletiyorum 🙏`;
          }
          
          fallbackResult = { text: responseText, finalPath: 'callback_confirmation_bypass' };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'callback_confirmation_bypass',
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // P0.28: arrival_date_answer bypass
        if (!fallbackResult && isArrivalDateAnswer) {
          const parsed = DateAnswerResolver.parse(inboundText, brain.context.config?.timezone || 'Europe/Istanbul');
          const normalizedDate = parsed.raw || inboundText.trim();

          const facts = ConversationKnownFactsResolver.resolve({
            history: history.filter((m: any) => m.content != null).map((m: any) => ({ role: m.role, content: m.content as string })),
            opportunity: unifiedContext?.opportunity,
            profile: unifiedContext?.profile,
            latestForm: unifiedContext?.latestForm,
            conversation: unifiedContext?.conversation
          });
          const { CallPreferenceLabelResolver } = require('./call-preference-label-resolver');
          const callTime = facts.preferredCallTime || '';
          const cleanCallTime = callTime ? CallPreferenceLabelResolver.resolve(callTime) : 'en yakın uygun çalışma saatlerinde';

          const resolvedIndustry = brain.context.config?.industry || (brain.prompts.metadata as any)?.industry || '';
          const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'medical';
          // Deterministic cliches avoided per Rule 6 (no "Müşteri temsilcimiz")
          const agentLabelPossessive = 'Hasta danışmanımızın';

          const responseText = `Teşekkür ederim, ${normalizedDate} tarihini not aldım. ${agentLabelPossessive} sizi ${cleanCallTime} araması için notunuzu iletiyorum 🙏`;

          if (!sandbox) {
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

              // P0.28.1: Clean up old/stale last_callback_offer if it conflicts with arrival date or is unverified bot offer
              if (updatedMeta.last_callback_offer) {
                let shouldDeleteOffer = false;
                const proposedDueAt = updatedMeta.last_callback_offer.proposed_due_at;
                if (proposedDueAt) {
                  const proposedDateOnly = proposedDueAt.split('T')[0]; // YYYY-MM-DD
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
            } catch (dbErr) {
              console.error('[AIResponseOrchestrator] Failed to update arrival date in DB:', dbErr);
            }
          }

          fallbackResult = { text: responseText, finalPath: 'arrival_date_bypass' };
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'arrival_date_bypass',
            tenantId,
            conversationId: conversationId || 'unknown',
            workerPath
          }));
        }

        // P0.28.2: callback_time_answer bypass
        if (!fallbackResult && isCallbackTimeAnswer) {
          const { parseDeterministicSuggestion } = require('../../utils/date-parser');
          // Parse using current local time as reference
          const parsedSugg = parseDeterministicSuggestion(inboundText, new Date(), null, null);
          
          let responseText = '';
          let isSuccess = false;
          let proposedDateStr: string | null = null;
          let shiftedDateStr: string | null = null;
          
          const wh = (brain.context.settings?.workingHours || brain.context.config?.workingHours || { enabled: true, start: "09:00", end: "21:00" }) as any;
          
          if (parsedSugg && parsedSugg.suggested_date && parsedSugg.suggested_time && parsedSugg.proposed_date) {
            proposedDateStr = parsedSugg.proposed_date;
            
            // Adjust to operating hours dynamically (not hardcoded)
            let currentD = new Date(parsedSugg.proposed_date);
            let trTime = currentD.getTime() + 3 * 60 * 60 * 1000;
            let trDate = new Date(trTime);
            
            const isDayOpen = (dateObj: Date) => {
              const day = dateObj.getUTCDay(); // 0 is Sunday, 1 is Monday...
              if (wh && Array.isArray(wh.days)) {
                return wh.days.includes(day);
              }
              return day !== 0; // Default: closed on Sunday (0)
            };
            
            let shifted = false;
            let loopCount = 0;
            while (!isDayOpen(trDate) && loopCount < 7) {
              trDate.setUTCDate(trDate.getUTCDate() + 1);
              shifted = true;
              loopCount++;
            }
            
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
            
            if (trTotalMinutes < startMin) {
              trDate.setUTCHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
            } else if (trTotalMinutes > endMin) {
              trDate.setUTCDate(trDate.getUTCDate() + 1);
              let loopCount2 = 0;
              while (!isDayOpen(trDate) && loopCount2 < 7) {
                trDate.setUTCDate(trDate.getUTCDate() + 1);
                loopCount2++;
              }
              trDate.setUTCHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
            }
            
            // Convert back to UTC
            shiftedDateStr = new Date(trDate.getTime() - 3 * 60 * 60 * 1000).toISOString();
            
            // Format Turkish date
            const finalTrD = new Date(trDate.getTime()); // Turkey time representation
            const dd = finalTrD.getUTCDate();
            const mm = finalTrD.getUTCMonth();
            const dayIndex = finalTrD.getUTCDay();
            const hh = String(finalTrD.getUTCHours()).padStart(2, '0');
            const min = String(finalTrD.getUTCMinutes()).padStart(2, '0');
            
            const dayName = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'][dayIndex];
            const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
            const formattedDate = `${dd} ${monthNames[mm]} ${dayName}`;
            
            // Turkish suffix rule for the hour
            const hourInt = parseInt(hh, 10);
            const suffixes: Record<number, string> = {
              0: 'de', 1: 'de', 2: 'de', 3: 'te', 4: 'te', 5: 'te', 6: 'da', 7: 'de', 8: 'de', 9: 'da',
              10: 'da', 11: 'de', 12: 'de', 13: 'te', 14: 'te', 15: 'te', 16: 'da', 17: 'de', 18: 'de',
              19: 'da', 20: 'de', 21: 'de', 22: 'de', 23: 'te'
            };
            const suffix = suffixes[hourInt] || 'da';
            const formattedTime = `${hh}:${min}’${suffix}`;
            
            responseText = `Teyidinizi aldım. Hasta danışmanımızın sizi ${formattedDate} Türkiye saatiyle ${formattedTime} araması için notunuzu iletiyorum. 🙏`;
            isSuccess = true;
          }
          
          if (!isSuccess) {
            // Determine time of day based on user message content
            const lower = inboundText.toLowerCase();
            let period = 'sabah saatlerinde';
            if (lower.includes('akşam') || lower.includes('aksam') || lower.includes('gece')) {
              period = 'akşam saatlerinde';
            } else if (lower.includes('öğle') || lower.includes('ogle') || lower.includes('öğlen') || lower.includes('oglen') || lower.includes('öğleden sonra') || lower.includes('ogleden sonra')) {
              period = 'öğleden sonra saatlerinde';
            }
            responseText = `Teyidinizi aldım. Hasta danışmanımızın sizi ${period} araması için notunuzu iletiyorum. 🙏`;
          }
          
          // Create follow-up task if we have a proposed date (success path)
          if (isSuccess && shiftedDateStr && !sandbox) {
            try {
              // Task duplicate check on combined fields to enforce idempotency
              const existing = await db.executeSafe({
                text: `SELECT id FROM follow_up_tasks 
                       WHERE tenant_id = $1 
                         AND conversation_id = $2 
                         AND task_type = $3 
                         AND due_at = $4 
                         AND status IN ('pending', 'in_progress')`,
                values: [tenantId, conversationId, 'callback_scheduled', shiftedDateStr]
              }) as any[];
              
              if (existing.length === 0) {
                const { TaskService } = require('../task.service');
                const taskService = new TaskService(db);
                const opportunityId = unifiedContext?.opportunity?.id || null;
                
                // Construct a unique hash for metadata idempotency control (PII-free)
                const crypto = require('crypto');
                const idempotencyKey = crypto.createHash('sha256')
                  .update(`${tenantId}:${channelId || 'whatsapp'}:${conversationId}:callback_scheduled:${shiftedDateStr}`)
                  .digest('hex');
                
                // Save task - strictly PII-free description/title, no raw phone, name, or msg
                await taskService.create({
                  tenantId,
                  opportunityId: opportunityId || undefined,
                  conversationId: conversationId || undefined,
                  phoneNumber,
                  taskType: 'callback_scheduled',
                  title: '📞 Geri Arama',
                  description: 'Telefon görüşmesi planlandı.',
                  dueAt: shiftedDateStr,
                  isAutomated: true,
                  createdBy: 'system',
                  metadata: {
                    idempotency_key: idempotencyKey,
                    callback_time_tr: parsedSugg.suggested_time,
                    source: 'callback_time_answer'
                  }
                });
              }
            } catch (taskErr) {
              console.error('[AIResponseOrchestrator] Failed to create callback follow-up task for callback_time_answer:', taskErr);
            }
          }
          
          fallbackResult = { text: responseText, finalPath: 'callback_time_answer_bypass' };
          isCallbackTimeAnswerPath = true; // flag to skip last_callback_offer writing
          console.log(JSON.stringify({
            tag: 'LIVE_TEST_PARITY_PATH_SELECTED',
            path: 'callback_time_answer_bypass',
            tenantId,
            conversationId: conversationId || 'unknown',
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
            resolvedActiveDepartment: resolvedActiveDepartment || null
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
        if (isOpenContinuation || isOpenContinuationIntent || isThanksButContinue) {
          llmSystemPrompt = systemPromptText + '\n\n[NOT: Kullanıcı konuşmayı sürdürmek istiyor. "İyi günler" veya kapatma cümlesi KULLANMA. Yeni sorusunu bekle veya yardıma açık olduğunu nazikçe belirt.]';
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

        const llmModel = brain.context.settings.aiModel || 'gemini-2.5-flash';
        const apiKey = brain.context.config?.raw?.gemini_api_key || process.env.GEMINI_API_KEY || '';

        const aiConfig = {
          provider: 'gemini' as const,
          modelId: llmModel,
          apiKey,
          temperature: 0.7,
          maxTokens: brain.context.settings.maxResponseTokens || 1500
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

          // P0.28: Context-aware fallback resolution
          const assistantHistory = history.filter((m: any) => m.role === 'assistant');
          const lastAssistantMsg = assistantHistory.length > 0 ? (assistantHistory[assistantHistory.length - 1].content || '') : '';
          const lowerUser = inboundText.toLowerCase().trim();

          const isArrivalDateQuestion = (text: string) => {
            const lowerText = text.toLowerCase();
            return [
              'gelmeyi düşündüğünüz', 'gelmeyi dusundugunuz', 'ne zaman gelmeyi', 'ziyaret tarihi',
              'tarih aralığı', 'tarih araligi', 'tahmini tarih', 'tahmini ziyaret', 'gelmeyi planlıyorsunuz',
              'gelmeyi planliyorsunuz', 'geliş tarih'
            ].some(kw => lowerText.includes(kw));
          };

          const isSpecificCallTimeOffer = (text: string) => {
            const lowerText = text.toLowerCase();
            const hasCallKw = [
              'görüşmek', 'gorusmek', 'arayalım', 'arayalim', 'arayebiliriz',
              'arama planlama', 'telefon görüşmesi', 'telefon gorusmesi',
              'danışmanımızla', 'danismanimizla', 'arama teklif', 'telefonla gorusalim', 'telefonla görüşelim'
            ].some(kw => lowerText.includes(kw));
            if (!hasCallKw) return false;

            const hasTimeOrDate = [
              'saat', 'saatiyle', 'saatinde', 'pazartesi', 'salı', 'sali', 'çarşamba', 'carsamba', 'perşembe', 'persembe', 'cuma', 'cumartesi', 'pazar',
              'yarın', 'yarin', 'bugün', 'bugun', 'haziran', 'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik'
            ].some(kw => lowerText.includes(kw)) || /\d{1,2}[:.]\d{2}/.test(lowerText);

            return hasTimeOrDate;
          };

          const dateIndicators = [
            'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
            'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik',
            'ay sonu', 'ay başı', 'ay basi', 'ayın sonu', 'ayın başı'
          ];
          const isDateMessage = dateIndicators.some(kw => lowerUser.includes(kw)) || /\d{1,2}[./]\d{1,2}/.test(lowerUser);

          const affirmatives = ['evet', 'olur', 'tamam', 'ok', 'okay', 'yes', 'uygun', 'uygundur', 'evet uygun', 'kabul', 'tamamdir', 'hay hay', 'tabii', 'onaylıyorum', 'arayabilirsiniz', 'arayın', 'arayin', 'ararlar'];
          const isAffirmative = affirmatives.some(kw => lowerUser === kw || lowerUser.startsWith(kw + ' ') || lowerUser.endsWith(' ' + kw) || lowerUser.includes(' ' + kw + ' '));

          if (isArrivalDateQuestion(lastAssistantMsg) && isDateMessage) {
            const parsed = DateAnswerResolver.parse(inboundText, brain.context.config?.timezone || 'Europe/Istanbul');
            const normalizedDate = parsed.raw || inboundText.trim();

            const facts = ConversationKnownFactsResolver.resolve({
              history: history.filter((m: any) => m.content != null).map((m: any) => ({ role: m.role, content: m.content as string })),
              opportunity: unifiedContext?.opportunity,
              profile: unifiedContext?.profile,
              latestForm: unifiedContext?.latestForm,
              conversation: unifiedContext?.conversation
            });
            const { CallPreferenceLabelResolver } = require('./call-preference-label-resolver');
            const callTime = facts.preferredCallTime || '';
            const cleanCallTime = callTime ? CallPreferenceLabelResolver.resolve(callTime) : 'en yakın uygun çalışma saatlerinde';

            const resolvedIndustry = brain.context.config?.industry || (brain.prompts.metadata as any)?.industry || '';
            const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'medical';
            // Deterministic cliches avoided per Rule 6 (no "Müşteri temsilcimiz")
            const agentLabelPossessive = 'Hasta danışmanımızın';

            text = `Teşekkür ederim, ${normalizedDate} tarihini not aldım. ${agentLabelPossessive} sizi ${cleanCallTime} araması için notunuzu iletiyorum 🙏`;
            
            if (!sandbox) {
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

                // P0.28.1: Clean up old/stale last_callback_offer if it conflicts with arrival date or is unverified bot offer
                if (updatedMeta.last_callback_offer) {
                  let shouldDeleteOffer = false;
                  const proposedDueAt = updatedMeta.last_callback_offer.proposed_due_at;
                  if (proposedDueAt) {
                    const proposedDateOnly = proposedDueAt.split('T')[0]; // YYYY-MM-DD
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
              } catch (dbErr) {
                console.error('[AIResponseOrchestrator] Failed to update arrival date in DB during fallback recovery:', dbErr);
              }
            }
          } else if (isSpecificCallTimeOffer(lastAssistantMsg) && isAffirmative) {
            // Deterministic cliches avoided per Rule 6 (no "temsilci" or "Müşteri temsilcimiz")
            const agentLabel = 'hasta danışmanımıza';
            text = `Teyidinizi aldım. Telefon görüşmesi için belirttiğiniz zamanı ilgili ${agentLabel} iletiyorum. Görüşmek üzere. 🙏`;
          } else if (isCallbackTimeAnswer) {
            const { parseDeterministicSuggestion } = require('../../utils/date-parser');
            const parsedSugg = parseDeterministicSuggestion(inboundText, new Date(), null, null);
            
            let responseText = '';
            let isSuccess = false;
            let shiftedDateStr: string | null = null;
            
            const wh = (brain.context.settings?.workingHours || brain.context.config?.workingHours || { enabled: true, start: "09:00", end: "21:00" }) as any;
            
            if (parsedSugg && parsedSugg.suggested_date && parsedSugg.suggested_time && parsedSugg.proposed_date) {
              let currentD = new Date(parsedSugg.proposed_date);
              let trTime = currentD.getTime() + 3 * 60 * 60 * 1000;
              let trDate = new Date(trTime);
              
              const isDayOpen = (dateObj: Date) => {
                const day = dateObj.getUTCDay();
                if (wh && Array.isArray(wh.days)) {
                  return wh.days.includes(day);
                }
                return day !== 0;
              };
              
              let shifted = false;
              let loopCount = 0;
              while (!isDayOpen(trDate) && loopCount < 7) {
                trDate.setUTCDate(trDate.getUTCDate() + 1);
                shifted = true;
                loopCount++;
              }
              
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
              
              if (trTotalMinutes < startMin) {
                trDate.setUTCHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
              } else if (trTotalMinutes > endMin) {
                trDate.setUTCDate(trDate.getUTCDate() + 1);
                let loopCount2 = 0;
                while (!isDayOpen(trDate) && loopCount2 < 7) {
                  trDate.setUTCDate(trDate.getUTCDate() + 1);
                  loopCount2++;
                }
                trDate.setUTCHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
              }
              
              shiftedDateStr = new Date(trDate.getTime() - 3 * 60 * 60 * 1000).toISOString();
              
              const finalTrD = new Date(trDate.getTime());
              const dd = finalTrD.getUTCDate();
              const mm = finalTrD.getUTCMonth();
              const dayIndex = finalTrD.getUTCDay();
              const hh = String(finalTrD.getUTCHours()).padStart(2, '0');
              const min = String(finalTrD.getUTCMinutes()).padStart(2, '0');
              
              const dayName = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'][dayIndex];
              const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
              const formattedDate = `${dd} ${monthNames[mm]} ${dayName}`;
              
              const hourInt = parseInt(hh, 10);
              const suffixes: Record<number, string> = {
                0: 'de', 1: 'de', 2: 'de', 3: 'te', 4: 'te', 5: 'te', 6: 'da', 7: 'de', 8: 'de', 9: 'da',
                10: 'da', 11: 'de', 12: 'de', 13: 'te', 14: 'te', 15: 'te', 16: 'da', 17: 'de', 18: 'de',
                19: 'da', 20: 'de', 21: 'de', 22: 'de', 23: 'te'
              };
              const suffix = suffixes[hourInt] || 'da';
              const formattedTime = `${hh}:${min}’${suffix}`;
              
              responseText = `Teyidinizi aldım. Hasta danışmanımızın sizi ${formattedDate} Türkiye saatiyle ${formattedTime} araması için notunuzu iletiyorum. 🙏`;
              isSuccess = true;
            }
            
            if (!isSuccess) {
              const lower = inboundText.toLowerCase();
              let period = 'sabah saatlerinde';
              if (lower.includes('akşam') || lower.includes('aksam') || lower.includes('gece')) {
                period = 'akşam saatlerinde';
              } else if (lower.includes('öğle') || lower.includes('ogle') || lower.includes('öğlen') || lower.includes('oglen') || lower.includes('öğleden sonra') || lower.includes('ogleden sonra')) {
                period = 'öğleden sonra saatlerinde';
              }
              responseText = `Teyidinizi aldım. Hasta danışmanımızın sizi ${period} araması için notunuzu iletiyorum. 🙏`;
            }
            
            if (isSuccess && shiftedDateStr && !sandbox) {
              try {
                const existing = await db.executeSafe({
                  text: `SELECT id FROM follow_up_tasks 
                         WHERE tenant_id = $1 
                           AND conversation_id = $2 
                           AND task_type = $3 
                           AND due_at = $4 
                           AND status IN ('pending', 'in_progress')`,
                  values: [tenantId, conversationId, 'callback_scheduled', shiftedDateStr]
                }) as any[];
                
                if (existing.length === 0) {
                  const { TaskService } = require('../task.service');
                  const taskService = new TaskService(db);
                  const opportunityId = unifiedContext?.opportunity?.id || null;
                  
                  const crypto = require('crypto');
                  const idempotencyKey = crypto.createHash('sha256')
                    .update(`${tenantId}:${channelId || 'whatsapp'}:${conversationId}:callback_scheduled:${shiftedDateStr}`)
                    .digest('hex');
                  
                  await taskService.create({
                    tenantId,
                    opportunityId: opportunityId || undefined,
                    conversationId: conversationId || undefined,
                    phoneNumber,
                    taskType: 'callback_scheduled',
                    title: '📞 Geri Arama',
                    description: 'Telefon görüşmesi planlandı.',
                    dueAt: shiftedDateStr,
                    isAutomated: true,
                    createdBy: 'system',
                    metadata: {
                      idempotency_key: idempotencyKey,
                      callback_time_tr: parsedSugg.suggested_time,
                      source: 'callback_time_answer'
                    }
                  });
                }
              } catch (taskErr) {
                console.error('[AIResponseOrchestrator] Failed to create callback follow-up task for callback_time_answer in fallback:', taskErr);
              }
            }
            
            text = responseText;
            isCallbackTimeAnswerPath = true; // flag to skip last_callback_offer writing
          }
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

      // 11. WhatsApp formatting policy applied
      text = ResponseFormattingPolicy.format(text);

      // P0.27: Save last_callback_offer to conversation metadata if the bot response proposes a date/time
      if (!sandbox && conversationId && text && !isCallbackTimeAnswerPath && effectiveIntent !== 'arrival_date_answer') {
        try {
          const { parseDeterministicSuggestion } = require('../../utils/date-parser');
          const parsedSugg = parseDeterministicSuggestion(text, new Date(), null, null);
          if (parsedSugg.suggested_date && parsedSugg.suggested_time && parsedSugg.proposed_date) {
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
        } catch (err) {
          console.error('[AIResponseOrchestrator] Failed to save last_callback_offer metadata:', err);
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
