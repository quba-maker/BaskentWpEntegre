import { sql } from '@/lib/db';
import { logger } from '@/lib/core/logger';

/**
 * 📡 AI Event Emitter — Phase 6 Observability Core
 * 
 * Merkezi event logging servisi. Tüm AI pipeline bileşenleri
 * bu servisi çağırarak her kararı, değişikliği ve hatayı
 * izlenebilir hale getirir.
 * 
 * Stripe / OpenAI seviyesinde audit trail.
 * Non-blocking, async — pipeline'ı yavaşlatmaz.
 */

export type AIEventType = 
  | 'identity_resolved'
  | 'identity_merge'
  | 'form_matched'
  | 'conversation_linked'
  | 'memory_updated'
  | 'memory_failed'
  | 'tool_executed'
  | 'tool_failed'
  | 'crm_extraction_completed'
  | 'crm_extraction_failed'
  | 'human_escalation'
  | 'policy_blocked'
  | 'sentiment_updated'
  | 'ai_response_generated'
  | 'ai_response_failed'
  | 'ai_timeout'
  | 'working_hours_blocked'
  | 'max_messages_reached'
  | 'duplicate_message_dropped'
  | 'prompt_version_created'
  | 'brain_resolved'
  | 'message_status_updated';

export type AIEventCategory = 
  | 'identity'
  | 'memory'
  | 'tool'
  | 'crm'
  | 'escalation'
  | 'policy'
  | 'pipeline'
  | 'system';

export type AIEventSeverity = 'info' | 'warning' | 'error';

export interface AIEventPayload {
  tenantId: string;
  conversationId?: string;
  customerId?: string;
  type: AIEventType;
  category: AIEventCategory;
  payload?: Record<string, any>;
  severity?: AIEventSeverity;
}

const log = logger.withContext({ module: 'AIEventEmitter' });

export class AIEventEmitter {
  /**
   * Emit an AI event to the timeline.
   * Non-blocking: uses setImmediate to avoid blocking the pipeline.
   */
  static emit(event: AIEventPayload): void {
    // Fire-and-forget pattern — never block the caller
    setImmediate(async () => {
      try {
        await sql`
          INSERT INTO ai_events (
            tenant_id, conversation_id, customer_id,
            event_type, event_category, payload, severity
          ) VALUES (
            ${event.tenantId},
            ${event.conversationId || null},
            ${event.customerId || null},
            ${event.type},
            ${event.category},
            ${JSON.stringify(event.payload || {})}::jsonb,
            ${event.severity || 'info'}
          )
        `;
      } catch (err) {
        // HARDENING: Never lose audit events — fallback to structured console log
        log.error('[EVENT_EMIT_FAILED] Non-fatal event write failure', 
          err instanceof Error ? err : new Error(String(err)),
          { eventType: event.type, tenantId: event.tenantId }
        );
        // Structured fallback audit — ensures events are recoverable from log aggregator
        console.error(JSON.stringify({
          _audit_fallback: true,
          timestamp: new Date().toISOString(),
          tenant_id: event.tenantId,
          event_type: event.type,
          event_category: event.category,
          severity: event.severity || 'info',
          conversation_id: event.conversationId || null,
          customer_id: event.customerId || null,
          payload: event.payload || {},
        }));
      }
    });
  }

  /**
   * Emit a critical event synchronously — waits for DB write.
   * Use only for events that MUST NOT be lost (policy blocks, escalations).
   */
  static async emitSync(event: AIEventPayload): Promise<void> {
    try {
      await sql`
        INSERT INTO ai_events (
          tenant_id, conversation_id, customer_id,
          event_type, event_category, payload, severity
        ) VALUES (
          ${event.tenantId},
          ${event.conversationId || null},
          ${event.customerId || null},
          ${event.type},
          ${event.category},
          ${JSON.stringify(event.payload || {})}::jsonb,
          ${event.severity || 'info'}
        )
      `;
    } catch (err) {
      log.error('[SYNC_EVENT_FAILED] Critical event write failure',
        err instanceof Error ? err : new Error(String(err)),
        { eventType: event.type, tenantId: event.tenantId }
      );
      // Structured fallback for critical events
      console.error(JSON.stringify({
        _audit_critical_fallback: true,
        timestamp: new Date().toISOString(),
        ...event,
        payload: event.payload || {},
      }));
    }
  }

  /**
   * Batch emit multiple events in a single tick (pipeline optimization).
   */
  static batchEmit(events: AIEventPayload[]): void {
    if (events.length === 0) return;
    setImmediate(async () => {
      for (const event of events) {
        try {
          await sql`
            INSERT INTO ai_events (
              tenant_id, conversation_id, customer_id,
              event_type, event_category, payload, severity
            ) VALUES (
              ${event.tenantId},
              ${event.conversationId || null},
              ${event.customerId || null},
              ${event.type},
              ${event.category},
              ${JSON.stringify(event.payload || {})}::jsonb,
              ${event.severity || 'info'}
            )
          `;
        } catch (err) {
          log.error('[BATCH_EMIT_FAILED]', err instanceof Error ? err : new Error(String(err)),
            { eventType: event.type }
          );
        }
      }
    });
  }

  /**
   * Log a runtime health issue for monitoring dashboard.
   */
  static logHealth(tenantId: string, logType: string, context?: Record<string, any>): void {
    setImmediate(async () => {
      try {
        await sql`
          INSERT INTO ai_runtime_logs (tenant_id, log_type, context)
          VALUES (${tenantId}, ${logType}, ${JSON.stringify(context || {})}::jsonb)
        `;
      } catch (err) {
        log.error('[HEALTH_LOG_FAILED] Non-fatal health log failure',
          err instanceof Error ? err : new Error(String(err))
        );
      }
    });
  }

  /**
   * Get timeline events for a conversation.
   */
  static async getTimelineForConversation(
    tenantId: string, 
    conversationId: string, 
    limit = 50
  ): Promise<any[]> {
    return await sql`
      SELECT id, event_type, event_category, payload, severity, created_at
      FROM ai_events
      WHERE tenant_id = ${tenantId} AND conversation_id = ${conversationId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Get timeline events for a customer profile.
   */
  static async getTimelineForCustomer(
    tenantId: string,
    customerId: string,
    limit = 50
  ): Promise<any[]> {
    return await sql`
      SELECT id, event_type, event_category, payload, severity, conversation_id, created_at
      FROM ai_events
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Get health metrics summary for dashboard.
   */
  static async getHealthMetrics(tenantId: string, hoursBack = 24): Promise<{
    totalEvents: number;
    errorCount: number;
    toolFailures: number;
    policyBlocks: number;
    identityMisses: number;
    memoryFailures: number;
    timeouts: number;
  }> {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    
    const counts = await sql`
      SELECT 
        COUNT(*) FILTER (WHERE TRUE) as total_events,
        COUNT(*) FILTER (WHERE severity = 'error') as error_count,
        COUNT(*) FILTER (WHERE log_type = 'tool_failure') as tool_failures,
        COUNT(*) FILTER (WHERE log_type = 'policy_blocked') as policy_blocks,
        COUNT(*) FILTER (WHERE log_type = 'identity_miss') as identity_misses,
        COUNT(*) FILTER (WHERE log_type = 'memory_failure') as memory_failures,
        COUNT(*) FILTER (WHERE log_type = 'timeout') as timeouts
      FROM ai_runtime_logs
      WHERE tenant_id = ${tenantId} AND created_at >= ${since}::timestamptz
    `;

    const row = counts[0] || {};
    return {
      totalEvents: parseInt(row.total_events) || 0,
      errorCount: parseInt(row.error_count) || 0,
      toolFailures: parseInt(row.tool_failures) || 0,
      policyBlocks: parseInt(row.policy_blocks) || 0,
      identityMisses: parseInt(row.identity_misses) || 0,
      memoryFailures: parseInt(row.memory_failures) || 0,
      timeouts: parseInt(row.timeouts) || 0,
    };
  }
}
