import { TenantBrain } from './tenant-brain';

export interface VectorMetadata {
  tenant_id: string;
  namespace: string;
  source: string;
  visibility: 'private' | 'shared'; // shared across tenant scopes, but never cross-tenant
}

/**
 * PHASE 5 - VECTOR DATABASE ISOLATION
 * Defines the strict format for embeddings to prevent cross-tenant RAG leakage.
 */
export class VectorNamespace {
  /**
   * Generates strictly formatted metadata that MUST be attached to every document inserted into the Vector DB.
   */
  public static createDocumentMetadata(brain: TenantBrain, source: string, visibility: 'private' | 'shared' = 'private'): VectorMetadata {
    return {
      tenant_id: brain.context.tenantId,
      namespace: brain.namespaces.vector(),
      source,
      visibility
    };
  }

  /**
   * Generates the hard-filter query required for any retrieval operation.
   * If this filter is not passed to the DB, it constitutes a security breach.
   */
  public static getRetrievalFilter(brain: TenantBrain): Record<string, any> {
    return {
      tenant_id: { $eq: brain.context.tenantId }
    };
  }
}
