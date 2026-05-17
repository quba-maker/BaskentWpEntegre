import { TenantBrain } from '../brain/tenant-brain';
import { logger } from '../core/logger';

/**
 * PHASE 6 - TENANT ASSERTION FIREWALL
 * The absolute last line of defense before any cross-boundary operation 
 * (DB Write, AI Call, Vector Search).
 */
export class TenantFirewall {
  private static log = logger.withContext({ module: 'TenantFirewall' });

  /**
   * Asserts that a given entity strictly belongs to the executing Brain.
   * If any mismatch is found, it throws a fatal security error to prevent contamination.
   */
  public static assertTenantIsolation(
    brain: TenantBrain,
    entityTenantId: string,
    operationContext: string
  ): void {
    if (brain.context.tenantId !== entityTenantId) {
      
      const errorMsg = `[TENANT_FIREWALL_BLOCK] Cross-Tenant Violation Detected in ${operationContext}`;
      
      this.log.error(errorMsg, undefined, {
        brainTenantId: brain.context.tenantId,
        entityTenantId,
        operationContext,
        webhookPayloadId: brain.context.webhookPayloadId
      });

      // Move to DLQ or take protective action here ideally.
      // For now, throw and crash the worker safely.
      throw new Error(errorMsg);
    }

    this.log.debug(`[TENANT_FIREWALL_PASS] Isolation verified for ${operationContext}`);
  }

  /**
   * Ensures that a webhook source truly matches the expected tenant.
   */
  public static assertWebhookSource(
    brain: TenantBrain,
    expectedPhoneNumberId: string,
    actualPhoneNumberId: string
  ): void {
    if (expectedPhoneNumberId !== actualPhoneNumberId) {
      const errorMsg = `[TENANT_FIREWALL_BLOCK] Webhook Spoofing / Crossover Detected. Expected: ${expectedPhoneNumberId}, Actual: ${actualPhoneNumberId}`;
      this.log.error(errorMsg, undefined, {
        tenantId: brain.context.tenantId,
        webhookPayloadId: brain.context.webhookPayloadId
      });
      throw new Error(errorMsg);
    }
  }
}
