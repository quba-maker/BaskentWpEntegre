import { SecurityIsolationError } from "./tenant-firewall";
import { telemetry } from "../observability/telemetry";

export const CacheBoundary = {
  /**
   * Enforces strict cache namespace boundaries.
   * Required format: tenant:{tenantId}:{resourceType}:{resourceId}
   * Example: tenant:baskent:conversation:1234
   */
  assertTenantScopedCacheKey: (
    tenantId: string,
    key: string,
    resourceType: "conversation" | "prompt" | "fsm" | "memory" | "cache" | "kb"
  ) => {
    const expectedPrefix = `tenant:${tenantId}:${resourceType}:`;
    
    // Future RAG standardization (PHASE 9)
    if (resourceType === "kb") {
      // Must be tenant:{tenantId}:kb:{collection}
      if (!key.startsWith(`tenant:${tenantId}:kb:`)) {
         telemetry.track("SECURITY_PANIC", "failure", {
          reason: "Invalid KB namespace format",
          key
        });
        throw new SecurityIsolationError(`Cache key [${key}] does not match mandatory KB namespace format.`);
      }
    }

    if (!key.startsWith(expectedPrefix)) {
      telemetry.track("SECURITY_PANIC", "failure", {
        reason: "Invalid cache namespace format",
        key,
        expectedPrefix
      });
      throw new SecurityIsolationError(`Cache key [${key}] violates namespace isolation. Expected prefix: ${expectedPrefix}`);
    }

    telemetry.track("SECURITY_NAMESPACE_APPLIED", "info", {
      key
    });

    return key;
  }
};
