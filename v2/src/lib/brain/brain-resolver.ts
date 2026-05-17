import { TenantResolverService } from '../services/meta/tenant-resolver.service';
import { createTenantBrain, TenantBrain } from './tenant-brain';
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
   * Ensures that the Brain gets the correct DB-driven prompts.
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
    // If tenant context cannot be resolved, NO default tenant/brain is loaded. DROP.
    if (!tenantConfig || !tenantConfig.tenantId) {
      throw new SecurityIsolationError(`TENANT_RESOLUTION_FAILED`);
    }

    const tenantId = tenantConfig.tenantId;

    // 2. Fetch Prompts strictly isolated by tenantId
    // SECURITY FIX: Uses TenantDB with RLS enforcement instead of raw neon() client.
    // This ensures set_config('quba.current_tenant', tenantId) is called before every query,
    // preventing cross-tenant prompt leakage.
    let rawSystemPrompt: string | null = null;
    let promptHash: string | null = null;

    try {
      let promptKey = 'system_prompt_whatsapp';
      if (channel === 'instagram') promptKey = 'system_prompt_tr';
      if (channel === 'foreign') promptKey = 'system_prompt_foreign';

      const db = withTenantDB(tenantId, false);
      const promptsResult = await db.executeSafe(sql`
        SELECT value 
        FROM settings 
        WHERE tenant_id = ${tenantId} AND key = ${promptKey}
        LIMIT 1
      `);
      if (promptsResult.length > 0) {
        rawSystemPrompt = promptsResult[0].value;
        
        // LAYER 3: PROMPT HASH VALIDATION
        // Calculate SHA256 of the prompt at retrieval time
        if (rawSystemPrompt) {
          promptHash = crypto.createHash('sha256').update(rawSystemPrompt).digest('hex');
        }
      }
    } catch (dbError) {
      log.warn(`DB prompt fetch failed for tenant ${tenantId}. Falling back to registry.`, { tenantId });
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
      promptHash // Pass prompt hash for validation
    );

    return brain;
  }
}
