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
    const sql = neon(process.env.DATABASE_URL!);
    
    const promptsResult = await sql`
      SELECT prompt_text 
      FROM bot_prompts 
      WHERE tenant_id = ${tenantId} AND channel = ${channel} 
      LIMIT 1
    `;

    const rawSystemPrompt = promptsResult.length > 0 ? promptsResult[0].prompt_text : null;

    // 3. Create the immutable brain
    const brain = createTenantBrain(
      tenantId,
      channel,
      webhookPayloadId,
      rawSystemPrompt
    );

    console.log(`[TENANT_BRAIN_CREATED] Brain ${brain.id} initialized for Tenant ${tenantId} on ${channel}`);
    
    return brain;
  }
}
