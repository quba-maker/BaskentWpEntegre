import { TenantResolverService } from '../services/meta/tenant-resolver.service';
import { createTenantBrain, TenantBrain, TenantBrainSettings } from './tenant-brain';
import { withTenantDB } from '../core/tenant-db';
import { sql } from '../db';
import { SecurityIsolationError } from '../security/tenant-firewall';
import { logger } from '../core/logger';
import crypto from 'crypto';

const log = logger.withContext({ module: 'BrainResolver' });

/**
 * Returns true if V2 brain resolution is enabled.
 * Default: false (V1 settings path).
 * Set USE_V2_BRAIN_RESOLUTION=true to activate V2 channel-based resolution.
 */
function isV2BrainEnabled(): boolean {
  return process.env.USE_V2_BRAIN_RESOLUTION === 'true';
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
    webhookPayloadId: string
  ): Promise<TenantBrain> {
    
    // 1. Resolve Tenant Config safely
    const resolver = new TenantResolverService();
    let tenantConfig;
    try {
      tenantConfig = await resolver.resolve(payload);
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

    let runtimeSettings: TenantBrainSettings = {
      aiModel: 'gemini-2.5-flash',
      maxMessages: 8,
      maxResponseTokens: 1000,
      workingHours: { enabled: false },
      aggressionLevel: 'medium'
    };

    // ═══════════════════════════════════════════════════════════
    //  V2 PATH (feature-flag gated)
    // ═══════════════════════════════════════════════════════════
    if (isV2BrainEnabled() && channelId && channelId !== 'legacy_unmapped') {
      try {
        const v2Result = await this.resolveFromV2(tenantId, channelId, groupId, channel);
        
        if (v2Result && v2Result.systemPrompt && v2Result.systemPrompt.trim().length > 50) {
          // V2 resolution successful — use it
          rawSystemPrompt = v2Result.systemPrompt;
          knowledgePrices = v2Result.knowledgePrices;
          knowledgeRules = v2Result.knowledgeRules;
          runtimeSettings = v2Result.settings;
          brainSource = 'v2_channel_prompts';

          log.info('[BRAIN_SOURCE] v2_channel_prompts', {
            tenantId, channelId, channel,
            promptName: v2Result.promptName,
            promptLength: rawSystemPrompt.length,
            profileId: v2Result.profileId
          });
        } else {
          // V2 data exists but prompt is empty/too short — fallback to V1
          log.warn('[BRAIN_FALLBACK] V2 prompt empty or too short, falling back to V1 settings', {
            tenantId, channelId, channel,
            v2PromptLength: v2Result?.systemPrompt?.length || 0,
            reason: 'prompt_empty_or_short'
          });
        }
      } catch (v2Error) {
        // V2 resolution failed entirely — fallback to V1 silently
        log.warn('[BRAIN_FALLBACK] V2 resolution failed, falling back to V1 settings', {
          tenantId, channelId, channel,
          reason: 'v2_query_error',
          error: v2Error instanceof Error ? v2Error.message : String(v2Error)
        });
      }
    }

    // ═══════════════════════════════════════════════════════════
    //  V1 PATH (default, or fallback from V2)
    // ═══════════════════════════════════════════════════════════
    if (brainSource === 'v1_settings') {
      try {
        let promptKey = 'system_prompt_whatsapp';
        if (channel === 'instagram') promptKey = 'system_prompt_tr';
        if (channel === 'foreign') promptKey = 'system_prompt_foreign';

        const keysToFetch = [
          promptKey, 
          'bot_knowledge_prices', 'bot_knowledge_rules',
          'ai_model', 'bot_max_messages', 'bot_max_response_tokens', 'working_hours', 'bot_aggression_level'
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
          // Runtime pipeline settings
          if (row.key === 'ai_model') runtimeSettings.aiModel = row.value || 'gemini-2.5-flash';
          if (row.key === 'bot_max_messages') {
            const parsed = parseInt(row.value);
            runtimeSettings.maxMessages = isNaN(parsed) ? 8 : parsed;
          }
          if (row.key === 'working_hours') {
            try { runtimeSettings.workingHours = JSON.parse(row.value); } catch(e) {}
          }
          if (row.key === 'bot_aggression_level') runtimeSettings.aggressionLevel = row.value || 'medium';
          if (row.key === 'bot_max_response_tokens') {
            const parsed = parseInt(row.value);
            runtimeSettings.maxResponseTokens = isNaN(parsed) ? 1000 : Math.min(parsed, 8000);
          }
        }

        log.info('[BRAIN_SOURCE] v1_settings', {
          tenantId, channel,
          promptLength: rawSystemPrompt?.length || 0,
          v2Enabled: isV2BrainEnabled()
        });

      } catch (dbError) {
        log.warn(`DB settings fetch failed for tenant ${tenantId}. Falling back to registry.`, { tenantId });
      }
    }

    // LAYER 3: PROMPT HASH VALIDATION
    if (rawSystemPrompt) {
      promptHash = crypto.createHash('sha256').update(rawSystemPrompt).digest('hex');
    }

    // 2.5 SaaS Code-First Fallback (Strictly scoped by tenantSlug, not generic fallback)
    if (!rawSystemPrompt || rawSystemPrompt.trim() === '') {
      const { PromptRegistry } = await import('./prompts/registry');
      const tenantSlug = tenantConfig.raw?.slug;
      if (tenantSlug) {
        rawSystemPrompt = PromptRegistry.getFallbackPrompt(tenantSlug, channel);
        if (rawSystemPrompt) {
          promptHash = crypto.createHash('sha256').update(rawSystemPrompt).digest('hex');
          log.info('[BRAIN_FALLBACK] Using PromptRegistry code-first fallback', {
            tenantId, channel, tenantSlug, promptLength: rawSystemPrompt.length
          });
        }
      }
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
      runtimeSettings
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
               cpb.is_active as binding_active
        FROM channel_prompt_bindings cpb
        JOIN channel_prompts cp ON cpb.prompt_id = cp.id
        WHERE cpb.channel_id = $1
          AND cpb.is_active = true
          AND cp.prompt_type = 'system'
        ORDER BY cpb.priority ASC
        LIMIT 1
      `,
      values: [channelId]
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

    log.info('[BRAIN_V2_PROMPT_RESOLVED]', {
      tenantId, channelId,
      promptName: binding.prompt_name,
      promptLength: systemPrompt?.length || 0,
      promptVersion: binding.version
    });

    // ── STEP 2: Resolve knowledge prompts (if they exist) ──
    let knowledgePrices = '';
    let knowledgeRules = '';

    try {
      const knowledgeRows = await db.executeSafe({
        text: `
          SELECT prompt_type, prompt_text
          FROM channel_prompts
          WHERE tenant_id = $1
            AND prompt_type IN ('knowledge_prices', 'knowledge_rules')
        `,
        values: [tenantId]
      }) as any[];

      for (const kr of (knowledgeRows || [])) {
        if (kr.prompt_type === 'knowledge_prices') knowledgePrices = kr.prompt_text || '';
        if (kr.prompt_type === 'knowledge_rules') knowledgeRules = kr.prompt_text || '';
      }
    } catch (knErr) {
      log.warn('[BRAIN_V2_KNOWLEDGE] Knowledge prompt fetch failed, continuing without', {
        tenantId, error: knErr instanceof Error ? knErr.message : String(knErr)
      });
    }

    // ── STEP 3: Resolve AI profile from channel_ai_profiles ──
    let runtimeSettings: TenantBrainSettings = {
      aiModel: 'gemini-2.5-flash',
      maxMessages: 8,
      maxResponseTokens: 1000,
      workingHours: { enabled: false },
      aggressionLevel: 'medium'
    };

    let profileId: string | null = null;

    try {
      const profileRows = await db.executeSafe({
        text: `
          SELECT id, ai_model, temperature, aggression_level, business_hours_json,
                 max_messages, max_response_tokens
          FROM channel_ai_profiles
          WHERE group_id = $1
          LIMIT 1
        `,
        values: [groupId]
      }) as any[];

      if (profileRows && profileRows.length > 0) {
        const p = profileRows[0];
        profileId = p.id;
        runtimeSettings.aiModel = p.ai_model || 'gemini-2.5-flash';
        runtimeSettings.aggressionLevel = p.aggression_level || 'medium';

        if (p.max_messages !== null && p.max_messages !== undefined) {
          const parsed = parseInt(String(p.max_messages));
          runtimeSettings.maxMessages = isNaN(parsed) ? 8 : parsed;
        }
        if (p.max_response_tokens !== null && p.max_response_tokens !== undefined) {
          const parsed = parseInt(String(p.max_response_tokens));
          runtimeSettings.maxResponseTokens = isNaN(parsed) ? 1000 : Math.min(parsed, 8000);
        }
        if (p.business_hours_json && typeof p.business_hours_json === 'object') {
          runtimeSettings.workingHours = p.business_hours_json;
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
      profileId
    };
  }
}
