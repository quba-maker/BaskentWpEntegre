import { TenantResolverService } from '../services/meta/tenant-resolver.service';
import { createTenantBrain, TenantBrain, TenantBrainSettings } from './tenant-brain';
import { withTenantDB } from '../core/tenant-db';
import { sql } from '../db';
import { SecurityIsolationError } from '../security/tenant-firewall';
import { logger } from '../core/logger';
import crypto from 'crypto';

const log = logger.withContext({ module: 'BrainResolver' });

/**
 * PHASE 2 - TENANT BRAIN RESOLVER
 * Resolves the tenant from the webhook payload and strictly builds
 * an isolated TenantBrain instance.
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

    // 2. Fetch Prompts + Runtime Settings strictly isolated by tenantId
    let rawSystemPrompt: string | null = null;
    let promptHash: string | null = null;
    let knowledgePrices = '';
    let knowledgeRules = '';

    let runtimeSettings: TenantBrainSettings = {
      aiModel: 'gemini-2.5-flash',
      maxMessages: 8,
      maxResponseTokens: 1000,
      workingHours: { enabled: false },
      aggressionLevel: 'medium'
    };

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
      
      // LAYER 3: PROMPT HASH VALIDATION
      if (rawSystemPrompt) {
        promptHash = crypto.createHash('sha256').update(rawSystemPrompt).digest('hex');
      }
    } catch (dbError) {
      log.warn(`DB settings fetch failed for tenant ${tenantId}. Falling back to registry.`, { tenantId });
    }

    // 2.5 SaaS Code-First Fallback (Strictly scoped by tenantSlug, not generic fallback)
    if (!rawSystemPrompt || rawSystemPrompt.trim() === '') {
      const { PromptRegistry } = await import('./prompts/registry');
      const tenantSlug = tenantConfig.raw?.slug;
      if (tenantSlug) {
        rawSystemPrompt = PromptRegistry.getFallbackPrompt(tenantSlug, channel);
        if (rawSystemPrompt) {
          promptHash = crypto.createHash('sha256').update(rawSystemPrompt).digest('hex');
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
}
