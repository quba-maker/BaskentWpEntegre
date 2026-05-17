import { getTraceContext } from "../core/trace-context";
import { SecurityIsolationError } from "./tenant-firewall";

/**
 * QUBA AI - Runtime Security Assertions
 * Phase 0: Platform Lockdown
 * 
 * These assertions must be called at the boundary of every critical operation
 * (e.g. queue workers, webhooks, DB accesses). If an assertion fails,
 * it immediately throws a Fail-Closed exception.
 */

export function assertTenant(tenantId: string | undefined, resourceId?: string): void {
  if (!tenantId || tenantId.trim() === "") {
    throw new SecurityIsolationError(`MISSING_TENANT_CONTEXT: Action attempted without a valid tenantId. Resource: ${resourceId || 'unknown'}`);
  }
}

export function assertTrace(): string {
  const ctx = getTraceContext();
  if (!ctx || !ctx.traceId) {
    throw new SecurityIsolationError(`MISSING_TRACE_CONTEXT: Execution boundary crossed without a valid traceId.`);
  }
  return ctx.traceId;
}

export function assertNamespace(expectedTenantId: string, actualNamespace: string): void {
  // Enforce pattern: tenant:{tenantId}:...
  if (!actualNamespace.startsWith(`tenant:${expectedTenantId}:`)) {
    throw new SecurityIsolationError(`NAMESPACE_VIOLATION: Attempted to access namespace '${actualNamespace}' outside of tenant '${expectedTenantId}' boundaries.`);
  }
}

export function assertImmutable(obj: any, objectName: string): void {
  if (!Object.isFrozen(obj)) {
    throw new SecurityIsolationError(`IMMUTABILITY_VIOLATION: The object '${objectName}' is not deep-frozen and poses a memory corruption risk.`);
  }
}
