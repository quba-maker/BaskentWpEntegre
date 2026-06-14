import { TenantResolverService } from '../services/meta/tenant-resolver.service';
import { createTenantBrain, TenantBrain, TenantBrainSettings } from './tenant-brain';
import { withTenantDB } from '../core/tenant-db';
import { sql } from '../db';
import { SecurityIsolationError } from '../security/tenant-firewall';
import { logger } from '../core/logger';
import crypto from 'crypto';

const log = logger.withContext({ module: 'BrainResolver' });

// ═══════════════════════════════════════════════════════════
//  FEATURE FLAGS
// ═══════════════════════════════════════════════════════════

/** V2 brain resolution via channel_prompts + channel_ai_profiles */
function isV2BrainEnabled(): boolean {
  return process.env.USE_V2_BRAIN_RESOLUTION === 'true';
}

/** V1 settings table fallback. Default: false (disabled). Set USE_V1_FALLBACK=true to re-enable. */
function isV1FallbackEnabled(): boolean {
  return process.env.USE_V1_FALLBACK === 'true';
}

/** Strict V2 mode. When true, missing prompts/bindings throw hard errors instead of warnings. */
function isStrictV2(): boolean {
  return process.env.USE_STRICT_V2 === 'true';
}

// ═══════════════════════════════════════════════════════════
//  V2 RESOLUTION RESULT (internal type for dual-read)
// ═══════════════════════════════════════════════════════════
interface V2ResolutionResult {
  systemPrompt: string | null;
  knowledgePrices: string;
  knowledgeRules: string;
  settings: TenantBrainSettings;
  source: 'v2_channel_prompts';
  promptName: string | null;
  channelId: string | null;
  profileId: string | null;
  metadata?: any;
}

/**
 * PHASE 2B - TENANT BRAIN RESOLVER (Dual-Read Architecture)
 * 
 * Resolution Chain:
 *   FLAG=false → V1 settings (EXACT legacy behavior)
 *   FLAG=true  → V2 channel_prompt_bindings → channel_prompts → channel_ai_profiles
 *                ↳ Fallback to V1 if V2 is incomplete/missing
 * 
 * SECURITY: All DB access goes through TenantDB with RLS enforcement.
 * Raw neon() client is NEVER used here.
 */
export class BrainResolver {
  
  /**
   * Builds an isolated brain for a specific webhook payload.
   * Ensures that the Brain gets the correct DB-driven prompts AND runtime settings.
   */
  public static async resolveTenantBrain(
    payload: any,
    channel: string, // e.g., 'whatsapp'
    webhookPayloadId: string,
    preResolvedChannelId?: string
  ): Promise<TenantBrain> {
    
    // 1. Resolve Tenant Config safely
    const resolver = new TenantResolverService();
    let tenantConfig;
    try {
      tenantConfig = await resolver.resolve(payload, preResolvedChannelId);
    } catch (e) {
      // Intentionally suppressing to throw the structured error below
    }

    // LAYER 4: HARD FAIL-CLOSED MODE
    if (!tenantConfig || !tenantConfig.tenantId) {
      throw new SecurityIsolationError(`TENANT_RESOLUTION_FAILED`);
    }

    const tenantId = tenantConfig.tenantId;
    const channelId = tenantConfig.channelId;
    const groupId = tenantConfig.groupId;

    // 2. Fetch Prompts + Runtime Settings
    let rawSystemPrompt: string | null = null;
    let promptHash: string | null = null;
    let knowledgePrices = '';
    let knowledgeRules = '';
    let brainSource: 'v1_settings' | 'v2_channel_prompts' = 'v1_settings';

    let promptMetadata: any = null;

    let runtimeSettings: TenantBrainSettings = {
      aiModel: 'gemini-2.5-flash',
      maxMessages: 20,
      maxResponseTokens: 2000,
      workingHours: { enabled: false },
      aggressionLevel: 'medium',
      responseDelaySeconds: 5,
      responseStyle: 'balanced'
    };

    // ═══════════════════════════════════════════════════════════
    //  V2 PATH — Primary resolution via channel_prompts
    // ═══════════════════════════════════════════════════════════
    if (isV2BrainEnabled() && channelId && channelId !== 'legacy_unmapped') {
      try {
        const v2Result = await this.resolveFromV2(tenantId, channelId, groupId, channel);
        const promptLen = v2Result?.systemPrompt?.trim().length || 0;

        if (v2Result && v2Result.systemPrompt && promptLen > 50) {
          rawSystemPrompt = v2Result.systemPrompt;
          knowledgePrices = v2Result.knowledgePrices;
          knowledgeRules = v2Result.knowledgeRules;
          runtimeSettings = v2Result.settings;
          brainSource = 'v2_channel_prompts';
          promptMetadata = v2Result.metadata;

          log.info('[BRAIN_SOURCE] v2_channel_prompts', {
            tenantId, channelId, channel,
            promptName: v2Result.promptName,
            promptLength: rawSystemPrompt.length,
            profileId: v2Result.profileId
          });
        } else if (v2Result === null) {
          // No binding found
          const msg = `PROMPT_MISSING: No active prompt binding for channel ${channelId}`;
          if (isStrictV2()) {
            throw new Error(msg);
          }
          log.warn('[PROMPT_MISSING] ' + msg, { tenantId, channelId, channel });
        } else {
          // Prompt exists but too short
          const msg = `PROMPT_INVALID: Prompt too short (${promptLen} chars, min 100)`;
          if (isStrictV2()) {
            throw new Error(msg);
          }
          log.warn('[PROMPT_INVALID] ' + msg, { tenantId, channelId, channel, promptLen });
        }
      } catch (v2Error) {
        // If strict mode caused the throw, propagate it
        if (v2Error instanceof Error && (v2Error.message.startsWith('PROMPT_MISSING') || v2Error.message.startsWith('PROMPT_INVALID'))) {
          throw v2Error;
        }
        // V2 query/runtime error — log and fall through
        log.error('[BRAIN_V2_ERROR] V2 resolution failed', v2Error instanceof Error ? v2Error : new Error(String(v2Error)), {
          tenantId, channelId, channel
        });
      }
    } else if (!isV2BrainEnabled()) {
      log.info('[BRAIN_V2_DISABLED] V2 brain not enabled, using V1 path', { tenantId });
    } else {
      // channelId missing or legacy_unmapped
      const msg = `CHANNEL_UNMAPPED: channelId=${channelId || 'NULL'}`;
      if (isStrictV2()) {
        throw new SecurityIsolationError(msg);
      }
      log.warn('[CHANNEL_UNMAPPED] ' + msg, { tenantId, channelId });
    }

    // ═══════════════════════════════════════════════════════════
    //  V1 PATH — Legacy fallback (disabled by default)
    //  Gate: USE_V1_FALLBACK=true to re-enable
    // ═══════════════════════════════════════════════════════════
    if (brainSource === 'v1_settings' && isV1FallbackEnabled()) {
      log.warn('[V1_FALLBACK_USED] Falling back to V1 settings table', { tenantId, channel });
      try {
        let promptKey = 'system_prompt_whatsapp';
        if (channel === 'instagram') promptKey = 'system_prompt_tr';
        if (channel === 'foreign') promptKey = 'system_prompt_foreign';

        const keysToFetch = [
          promptKey, 
          'bot_knowledge_prices', 'bot_knowledge_rules',
          'ai_model', 'bot_max_messages', 'bot_max_response_tokens', 'working_hours', 'bot_aggression_level',
          'response_delay_seconds', 'response_style'
        ];
        const db = withTenantDB(tenantId, false);
        const settingsResult = await db.executeSafe(sql`
          SELECT key, value 
          FROM settings 
          WHERE tenant_id = ${tenantId} AND key = ANY(${keysToFetch})
        `);

        const rows = Array.isArray(settingsResult) ? settingsResult : (settingsResult as any)?.rows || [];
        
        for (const row of rows) {
          if (row.key === promptKey) rawSystemPrompt = row.value;
          if (row.key === 'bot_knowledge_prices') knowledgePrices = row.value;
          if (row.key === 'bot_knowledge_rules') knowledgeRules = row.value;
          if (row.key === 'ai_model') runtimeSettings.aiModel = row.value || 'gemini-2.5-flash';
          if (row.key === 'bot_max_messages') {
            const parsed = parseInt(row.value);
            runtimeSettings.maxMessages = isNaN(parsed) ? 20 : parsed;
          }
          if (row.key === 'working_hours') {
            try { runtimeSettings.workingHours = JSON.parse(row.value); } catch(e) {}
          }
          if (row.key === 'bot_aggression_level') runtimeSettings.aggressionLevel = row.value || 'medium';
          if (row.key === 'bot_max_response_tokens') {
            const parsed = parseInt(row.value);
            runtimeSettings.maxResponseTokens = isNaN(parsed) ? 2000 : Math.min(parsed, 8000);
          }
          if (row.key === 'response_delay_seconds') {
            const parsed = parseInt(row.value);
            runtimeSettings.responseDelaySeconds = isNaN(parsed) ? 5 : Math.max(2, Math.min(30, parsed));
          }
          if (row.key === 'response_style') {
            runtimeSettings.responseStyle = ['short', 'balanced', 'detailed'].includes(row.value) ? row.value : 'balanced';
          }
        }

        log.info('[BRAIN_SOURCE] v1_settings', { tenantId, channel, promptLength: rawSystemPrompt?.length || 0 });
      } catch (dbError) {
        log.warn('[V1_FALLBACK_FAILED] DB settings fetch failed', { tenantId });
      }
    } else if (brainSource === 'v1_settings') {
      // V1 fallback disabled — no prompt resolved
      log.warn('[V1_FALLBACK_DISABLED] V1 fallback not enabled, no prompt resolved', { tenantId, channel });
    }

    // ═══════════════════════════════════════════════════════════
    //  PROMPT HASH + FINAL VALIDATION
    // ═══════════════════════════════════════════════════════════
    if (rawSystemPrompt) {
      promptHash = crypto.createHash('sha256').update(rawSystemPrompt).digest('hex');
    }

    // 3. Create the immutable brain
    const brain = createTenantBrain(
      tenantId,
      channel,
      webhookPayloadId,
      rawSystemPrompt,
      tenantConfig,
      promptHash,
      { prices: knowledgePrices, rules: knowledgeRules },
      runtimeSettings,
      brainSource,
      promptMetadata
    );

    return brain;
  }

  // ═══════════════════════════════════════════════════════════
  //  V2 RESOLUTION ENGINE
  //  Reads: channel_prompt_bindings → channel_prompts
  //         channel_ai_profiles (via groupId)
  //  Returns null if data is missing or invalid
  // ═══════════════════════════════════════════════════════════
  private static async resolveFromV2(
    tenantId: string,
    channelId: string,
    groupId: string,
    channel: string
  ): Promise<V2ResolutionResult | null> {
    const db = withTenantDB(tenantId, false);

    // ── STEP 1: Resolve system prompt via binding ──
    const bindingRows = await db.executeSafe({
      text: `
        SELECT cp.id as prompt_id, cp.name as prompt_name, cp.prompt_text, cp.prompt_type,
               cp.tenant_id as prompt_tenant_id, cp.version,
               cp.knowledge_prices, cp.knowledge_rules, cp.metadata as prompt_metadata,
               cpb.is_active as binding_active
        FROM channel_prompt_bindings cpb
        JOIN channel_prompts cp ON cpb.prompt_id = cp.id
        WHERE cpb.channel_id = $1
          AND cpb.is_active = true
          AND cp.prompt_type = 'system'
          AND cp.tenant_id = $2
        ORDER BY cpb.priority ASC
        LIMIT 1
      `,
      values: [channelId, tenantId]
    }) as any[];

    if (!bindingRows || bindingRows.length === 0) {
      log.warn('[BRAIN_FALLBACK] No active V2 prompt binding found', {
        tenantId, channelId, channel, reason: 'no_binding'
      });
      return null;
    }

    const binding = bindingRows[0];

    // ── SAFETY: Cross-tenant validation ──
    if (binding.prompt_tenant_id && binding.prompt_tenant_id !== tenantId) {
      log.error('[BRAIN_FALLBACK] Cross-tenant prompt mismatch detected — BLOCKING V2 resolution', undefined, {
        tenantId, channelId, promptTenantId: binding.prompt_tenant_id, reason: 'cross_tenant_mismatch'
      });
      return null;
    }

    const systemPrompt = binding.prompt_text || null;
    const rawMetadata = binding.prompt_metadata || {};
    const promptMetadata = typeof rawMetadata === 'object'
      ? { ...rawMetadata, version: binding.version }
      : { version: binding.version };

    log.info('[BRAIN_V2_PROMPT_RESOLVED]', {
      tenantId, channelId,
      promptName: binding.prompt_name,
      promptLength: systemPrompt?.length || 0,
      promptVersion: binding.version
    });

    // ── STEP 2: Resolve knowledge from prompt columns ──
    const knowledgePrices = binding.knowledge_prices || '';
    const knowledgeRules = binding.knowledge_rules || '';

    if (knowledgePrices || knowledgeRules) {
      log.info('[BRAIN_V2_KNOWLEDGE_RESOLVED]', {
        tenantId, channelId,
        hasPrices: !!knowledgePrices,
        hasRules: !!knowledgeRules,
        pricesLen: knowledgePrices.length,
        rulesLen: knowledgeRules.length
      });
    }

    // ── STEP 3: Resolve AI profile from channel_ai_profiles ──
    let runtimeSettings: TenantBrainSettings = {
      aiModel: 'gemini-2.5-flash',
      maxMessages: 20,
      maxResponseTokens: 2000,
      workingHours: { enabled: false },
      aggressionLevel: 'medium',
      responseDelaySeconds: 5,
      responseStyle: 'balanced'
    };

    let profileId: string | null = null;

    try {
      const profileRows = await db.executeSafe({
        text: `
          SELECT cap.id, cap.ai_model, cap.temperature, cap.aggression_level, cap.business_hours_json,
                 cap.max_messages, cap.max_response_tokens, cap.response_delay_seconds, cap.response_style
          FROM channel_ai_profiles cap
          JOIN channel_groups cg ON cap.group_id = cg.id
          WHERE cap.group_id = $1
            AND cg.tenant_id = $2
          LIMIT 1
        `,
        values: [groupId, tenantId]
      }) as any[];

      if (profileRows && profileRows.length > 0) {
        const p = profileRows[0];
        profileId = p.id;
        runtimeSettings.aiModel = p.ai_model || 'gemini-2.5-flash';
        runtimeSettings.aggressionLevel = p.aggression_level || 'medium';

        if (p.max_messages !== null && p.max_messages !== undefined) {
          const parsed = parseInt(String(p.max_messages));
          runtimeSettings.maxMessages = isNaN(parsed) ? 20 : parsed;
        }
        if (p.max_response_tokens !== null && p.max_response_tokens !== undefined) {
          const parsed = parseInt(String(p.max_response_tokens));
          runtimeSettings.maxResponseTokens = isNaN(parsed) ? 2000 : Math.min(parsed, 8000);
        }
        if (p.business_hours_json && typeof p.business_hours_json === 'object') {
          runtimeSettings.workingHours = p.business_hours_json;
        }
        if (p.response_delay_seconds !== null && p.response_delay_seconds !== undefined) {
          const parsed = parseInt(String(p.response_delay_seconds));
          runtimeSettings.responseDelaySeconds = isNaN(parsed) ? 5 : Math.max(2, Math.min(30, parsed));
        } else {
          runtimeSettings.responseDelaySeconds = 5;
        }
        if (p.response_style) {
          const style = String(p.response_style);
          runtimeSettings.responseStyle = ['short', 'balanced', 'detailed'].includes(style) ? style : 'balanced';
        } else {
          runtimeSettings.responseStyle = 'balanced';
        }

        log.info('[BRAIN_V2_PROFILE_RESOLVED]', {
          tenantId, groupId, profileId,
          aiModel: runtimeSettings.aiModel,
          aggressionLevel: runtimeSettings.aggressionLevel
        });
      } else {
        log.warn('[BRAIN_V2_PROFILE_MISSING] No channel_ai_profiles for group, using defaults', {
          tenantId, groupId, channel
        });
      }
    } catch (profErr) {
      log.warn('[BRAIN_V2_PROFILE] Profile fetch failed, using defaults', {
        tenantId, groupId, error: profErr instanceof Error ? profErr.message : String(profErr)
      });
    }

    return {
      systemPrompt,
      knowledgePrices,
      knowledgeRules,
      settings: runtimeSettings,
      source: 'v2_channel_prompts',
      promptName: binding.prompt_name,
      channelId,
      profileId,
      metadata: promptMetadata
    };
  }
}
