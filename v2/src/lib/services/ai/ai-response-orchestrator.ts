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
      workerPath = 'unknown'
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
      let convMeta: any = {};

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
      let unifiedContext: any = null;
      if (conversationId && customerId && !sandbox) {
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
      // P0.19: Pass tenant-specific department override for topic_switch detection
      const _tenantDeptKw = TenantConfigResolver.getIntentDepartmentKeywords(brain) ?? undefined;
      const routedIntent = ConversationIntentRouter.route(inboundText, _tenantDeptKw);
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

      const isLlmBypassChallenge = isPromptChallenge || isBotAccusation || isAiAccusation || isAngryPromptChallenge || shouldBypassDoctorLookup || isRecallWithFacts || isNextStepRequest || isMultiIntentQuery || isDoctorNamesRequest
        || isThanksButContinueBypass || isOpenContinuationBypass || isCannotTravelObjection || isDistanceObjection || isPoliteClose; // P0.16-L

      let text = '';
      let bypassed = false;
      let modelUsed = 'gemini-2.5-flash';
      let inputTokens = 0;
      let outputTokens = 0;

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
        }
      }

      // 8. Quality Gate & Retry Loop
      const assistantHistory = history.filter((m: any) => m.role === 'assistant');
      const isFirstAssistantTurn = assistantHistory.length === 0;

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
          responseSource: bypassed ? 'bypass' : 'llm',
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
        // P0.16-M: responseSource captured from bypass path above (fallbackResult not in scope here)
        responseSource: bypassed ? (modelUsed === 'bypass' ? 'bypass' : 'bypass_unknown') : 'llm',
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
