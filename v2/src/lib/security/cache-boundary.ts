import { SecurityIsolationError } from "./tenant-firewall";
import { SecurityTelemetry } from "./telemetry";

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
         SecurityTelemetry.log("SECURITY_PANIC", tenantId, "UNKNOWN", null, {
          reason: "Invalid KB namespace format",
          key
        });
        throw new SecurityIsolationError(`Cache key [${key}] does not match mandatory KB namespace format.`);
      }
    }

    if (!key.startsWith(expectedPrefix)) {
      SecurityTelemetry.log("SECURITY_PANIC", tenantId, "UNKNOWN", null, {
        reason: "Invalid cache namespace format",
        key,
        expectedPrefix
      });
      throw new SecurityIsolationError(`Cache key [${key}] violates namespace isolation. Expected prefix: ${expectedPrefix}`);
    }

    SecurityTelemetry.log("CACHE_NAMESPACE_APPLIED", tenantId, "UNKNOWN", null, {
      key
    });

    return key;
  }
};
