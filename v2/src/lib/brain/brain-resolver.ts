import { TenantResolverService } from '../services/meta/tenant-resolver.service';
import { createTenantBrain, TenantBrain } from './tenant-brain';
import { neon } from "@neondatabase/serverless";

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
    const tenantConfig = await resolver.resolve(payload);

    if (!tenantConfig || !tenantConfig.tenantId) {
      throw new Error(`[SECURITY] Could not resolve tenant for payload`);
    }

    const tenantId = tenantConfig.tenantId;

    // 2. Fetch Prompts strictly isolated by tenantId
    const dbUrl = process.env.DATABASE_URL || "postgres://dummy:dummy@dummy.com/dummy";
    let rawSystemPrompt: string | null = null;

    try {
      // Use fallback db check to prevent build crashes
      if (!dbUrl.includes("dummy.com")) {
        const sql = neon(dbUrl);
        const promptsResult = await sql`
          SELECT prompt_text 
          FROM bot_prompts 
          WHERE tenant_id = ${tenantId} AND channel = ${channel} 
          LIMIT 1
        `;
        if (promptsResult.length > 0) {
          rawSystemPrompt = promptsResult[0].prompt_text;
        }
      }
    } catch (dbError) {
      console.warn(`[BRAIN_RESOLVER] DB prompt fetch failed, relying on registry fallback.`, dbError);
    }

    // 2.5 SaaS Code-First Fallback
    // If DB has no prompt configured, we use the hardcoded/file-based registry
    if (!rawSystemPrompt || rawSystemPrompt.trim() === '') {
      const { PromptRegistry } = await import('./prompts/registry');
      // Using the slug (e.g. 'baskent') to resolve the file-based prompt
      const tenantSlug = tenantConfig.raw?.slug;
      if (tenantSlug) {
        rawSystemPrompt = PromptRegistry.getFallbackPrompt(tenantSlug, channel);
      }
    }

    // 3. Create the immutable brain
    const brain = createTenantBrain(
      tenantId,
      channel,
      webhookPayloadId,
      rawSystemPrompt,
      tenantConfig // <-- PASS THE CONFIG HERE
    );

    console.log(`[TENANT_BRAIN_CREATED] Brain ${brain.id} initialized for Tenant ${tenantId} on ${channel}`);
    
    return brain;
  }
}
