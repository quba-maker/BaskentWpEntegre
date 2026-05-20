import { neon } from '@neondatabase/serverless';

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
  private static getSql() {
    return neon(process.env.DATABASE_URL!);
  }

  /**
   * Append a new event to the pipeline event stream.
   * Instead of `UPDATE leads`, we `recordEvent('LeadImported', payload)`
   */
  static async recordEvent(data: PipelineEventPayload) {
    const sql = this.getSql();
    const result = await sql`
      INSERT INTO pipeline_events (
        tenant_id, 
        event_type, 
        source_id, 
        entity_id, 
        payload, 
        ai_confidence, 
        operator_id
      ) VALUES (
        ${data.tenantId},
        ${data.eventType},
        ${data.sourceId || null},
        ${data.entityId || null},
        ${JSON.stringify(data.payload)}::jsonb,
        ${data.aiConfidence || null},
        ${data.operatorId || null}
      )
      RETURNING *
    `;
    return result[0];
  }

  /**
   * Get the event history for a specific source to replay state or show Audit Trail.
   */
  static async getHistory(tenantId: string, sourceId: string) {
    const sql = this.getSql();
    return await sql`
      SELECT * FROM pipeline_events
      WHERE tenant_id = ${tenantId} AND source_id = ${sourceId}
      ORDER BY created_at ASC
    `;
  }
}
