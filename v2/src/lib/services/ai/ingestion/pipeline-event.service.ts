import { withTenantDB } from '@/lib/core/tenant-db';

export type PipelineEventType = 
  | 'LeadImported' 
  | 'TransformationApplied' 
  | 'DuplicateMerged' 
  | 'OperatorApproved' 
  | 'RollbackExecuted';

export interface PipelineEventPayload {
  tenantId: string;
  eventType: PipelineEventType;
  sourceId?: string;
  entityId?: string;
  payload: Record<string, any>;
  aiConfidence?: number;
  operatorId?: string;
}

/**
 * Event-Sourced Ingestion Pipeline Service
 * Ensures every change in the customer ingestion pipeline is recorded as an immutable event.
 */
export class PipelineEventService {
  /**
   * Append a new event to the pipeline event stream.
   * Instead of `UPDATE leads`, we `recordEvent('LeadImported', payload)`
   */
  static async recordEvent(data: PipelineEventPayload) {
    const db = withTenantDB(data.tenantId);
    const result = await db.executeSafe({
      text: `
        INSERT INTO pipeline_events (
          tenant_id, 
          event_type, 
          source_id, 
          entity_id, 
          payload, 
          ai_confidence, 
          operator_id
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6, $7
        )
        RETURNING *
      `,
      values: [
        data.tenantId,
        data.eventType,
        data.sourceId || null,
        data.entityId || null,
        JSON.stringify(data.payload),
        data.aiConfidence || null,
        data.operatorId || null
      ]
    }) as any[];
    return result[0];
  }

  /**
   * Get the event history for a specific source to replay state or show Audit Trail.
   */
  static async getHistory(tenantId: string, sourceId: string) {
    const db = withTenantDB(tenantId);
    return await db.executeSafe({
      text: `
        SELECT * FROM pipeline_events
        WHERE tenant_id = $1 AND source_id = $2
        ORDER BY created_at ASC
      `,
      values: [tenantId, sourceId]
    }) as any[];
  }
}
