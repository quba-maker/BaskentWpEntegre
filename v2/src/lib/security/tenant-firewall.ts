import { TenantBrain } from "../brain/tenant-brain";
import { telemetry } from "../observability/telemetry";

export class SecurityIsolationError extends Error {
  constructor(message: string) {
    super(`[TENANT_ISOLATION_FAULT] ${message}`);
    this.name = "SecurityIsolationError";
  }
}

export interface ResourceContext {
  resourceType: "prompt" | "cache" | "vector" | "webhook" | "conversation" | "lead" | "memory_namespace" | "fsm";
  resourceTenantId: string;
  resourceId?: string;
}

export const TenantFirewall = {
  /**
   * Enforces strict tenant isolation between the execution brain and the accessed resource.
   * Fails closed: If any mismatch is detected, execution is immediately blocked.
   */
  assertTenantIsolation: (
    brain: TenantBrain,
    resource: ResourceContext
  ) => {
    if (!brain || !brain.context || !brain.context.tenantId) {
      telemetry.track("SECURITY_PANIC", "failure", {
        reason: "TenantBrain is missing or invalid in firewall check",
        resource
      });
      throw new SecurityIsolationError("Execution brain is invalid or missing tenant context.");
    }

    if (!resource || !resource.resourceTenantId) {
      telemetry.track("SECURITY_PANIC", "failure", {
        reason: "Target resource is missing tenant association",
        resourceType: resource?.resourceType
      });
      throw new SecurityIsolationError(`Target resource [${resource?.resourceType || 'UNKNOWN'}] lacks tenant association. Access denied.`);
    }

    if (brain.context.tenantId !== resource.resourceTenantId) {
      telemetry.track("SECURITY_CROSS_TENANT_BLOCKED", "failure", {
        resourceType: resource.resourceType,
        targetTenantId: resource.resourceTenantId,
        resourceId: resource.resourceId
      });
      
      // Moving event to DLQ is handled by the upstream error handler catching this SecurityIsolationError.
      throw new SecurityIsolationError(`Cross-tenant breach attempted. Brain tenant: ${brain.context.tenantId}, Resource tenant: ${resource.resourceTenantId}`);
    }

    // Success
    telemetry.track("TENANT_FIREWALL_PASS", "info", {
      resourceType: resource.resourceType,
      resourceId: resource.resourceId
    });
  }
};
