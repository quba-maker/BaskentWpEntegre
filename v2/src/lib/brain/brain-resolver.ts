import { TenantResolverService } from '../services/meta/tenant-resolver.service';
import { createTenantBrain, TenantBrain } from './tenant-brain';
import { neon } from "@neondatabase/serverless";
import { SecurityIsolationError } from '../security/tenant-firewall';
import crypto from 'crypto';

/**
 * PHASE 2 - TENANT BRAIN RESOLVER
 * Resolves the tenant from the webhook payload and strictly builds
 * an isolated TenantBrain instance.
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
    const dbUrl = process.env.DATABASE_URL || "postgres://dummy:dummy@dummy.com/dummy";
    let rawSystemPrompt: string | null = null;
    let promptHash: string | null = null;

    try {
      // Use fallback db check to prevent build crashes
      if (!dbUrl.includes("dummy.com")) {
        const sql = neon(dbUrl);
        // Using TenantQueryGuard is implicitly applied inside TenantDB, but here we use raw neon client.
        // For security, parameterization via neon tagged template is used.
        const promptsResult = await sql`
          SELECT prompt_text 
          FROM bot_prompts 
          WHERE tenant_id = ${tenantId} AND channel = ${channel} 
          LIMIT 1
        `;
        if (promptsResult.length > 0) {
          rawSystemPrompt = promptsResult[0].prompt_text;
          
          // LAYER 3: PROMPT HASH VALIDATION
          // Calculate SHA256 of the prompt at retrieval time
          if (rawSystemPrompt) {
            promptHash = crypto.createHash('sha256').update(rawSystemPrompt).digest('hex');
          }
        }
      }
    } catch (dbError) {
      console.warn(`[BRAIN_RESOLVER] DB prompt fetch failed.`, dbError);
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
