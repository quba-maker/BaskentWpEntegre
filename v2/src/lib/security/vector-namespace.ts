import { SecurityIsolationError } from "./tenant-firewall";
import { SecurityTelemetry } from "./telemetry";

export interface VectorDocumentMetadata {
  tenant_id: string;
  namespace: string;
  source: string;
  visibility: "private" | "global_shared"; // Only allow global_shared in very specific approved system cases
}

export interface VectorRetrievalFilter {
  tenant_id: string;
  [key: string]: any;
}

export const VectorNamespace = {
  /**
   * Enforces that every document stored in the vector DB has mandatory tenant isolation metadata.
   */
  assertTenantSafeEmbedding: (metadata: any): VectorDocumentMetadata => {
    if (!metadata || !metadata.tenant_id || !metadata.namespace || !metadata.source || !metadata.visibility) {
      SecurityTelemetry.log("SECURITY_PANIC", metadata?.tenant_id || "UNKNOWN", "UNKNOWN", null, {
        reason: "Missing mandatory vector metadata fields",
        metadata
      });
      throw new SecurityIsolationError("Vector embedding metadata must contain tenant_id, namespace, source, and visibility.");
    }
    return metadata as VectorDocumentMetadata;
  },

  /**
   * Enforces that every retrieval query strictly filters by tenant_id.
   * If retrieval occurs without a tenant filter, throws a SECURITY ERROR.
   */
  assertTenantSafeRetrieval: (tenantId: string, filter: any): VectorRetrievalFilter => {
    if (!filter || typeof filter !== 'object') {
      filter = {};
    }

    if (filter.tenant_id && filter.tenant_id !== tenantId) {
      SecurityTelemetry.log("CROSS_TENANT_ATTEMPT", tenantId, "UNKNOWN", null, {
        reason: "Vector retrieval filter mismatch",
        targetTenantId: filter.tenant_id
      });
      throw new SecurityIsolationError(`Cross-tenant vector retrieval breach attempted. Brain tenant: ${tenantId}, Filter tenant: ${filter.tenant_id}`);
    }

    // Force the tenant_id into the filter
    const safeFilter: VectorRetrievalFilter = {
      ...filter,
      tenant_id: tenantId
    };

    SecurityTelemetry.log("VECTOR_NAMESPACE_APPLIED", tenantId, "UNKNOWN", null, {
      filter: safeFilter
    });

    return safeFilter;
  }
};
