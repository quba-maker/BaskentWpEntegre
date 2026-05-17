import { TenantBrain } from './tenant-brain';

/**
 * PHASE 4 - MEMORY NAMESPACE ISOLATION
 * All memory keys (Redis, Upstash, conversational states) MUST pass through this
 * firewall to ensure they are strictly prefixed by the tenant ID.
 */
export class MemoryNamespace {
  /**
   * Generates a mathematically secure, tenant-isolated memory key.
   */
  public static getConversationKey(brain: TenantBrain, conversationId: string): string {
    return brain.namespaces.memory(`conversation:${conversationId}`);
  }

  public static getFsmStateKey(brain: TenantBrain, conversationId: string): string {
    return brain.namespaces.memory(`fsm_state:${conversationId}`);
  }

  public static getLeadContextKey(brain: TenantBrain, phoneNumberId: string): string {
    return brain.namespaces.memory(`lead_context:${phoneNumberId}`);
  }

  public static getCacheKey(brain: TenantBrain, resourceType: string, identifier: string): string {
    return brain.namespaces.cache(`${resourceType}:${identifier}`);
  }
}
