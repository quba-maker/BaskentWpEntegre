import { db } from '../../db/drizzle';
import { pipelineEvents } from '../../db/schema';
import { DomainEvent } from './domain-event';

/**
 * EventBus
 * The central nervous system of the Event-Sourced architecture.
 * It persists events to the database and can optionally trigger side effects.
 */
export class EventBus {
  /**
   * Publish an event to the Event Store (pipeline_events)
   */
  static async publish(event: DomainEvent) {
    try {
      const result = await db.insert(pipelineEvents).values({
        tenantId: event.tenantId,
        eventType: event.eventType,
        payload: event.payload,
        sourceId: event.payload.sourceId || null,
        entityId: event.payload.entityId || null,
      }).returning();

      // Future: Publish to Kafka/Redis/QStash here for async workers
      
      return result[0];
    } catch (error) {
      console.error('[EventBus] Failed to publish event:', error);
      throw new Error('EventBus Publisher Error');
    }
  }

  /**
   * Replay events for a specific source to reconstruct state
   */
  static async getEventStream(tenantId: string, sourceId: string) {
    // Return all events for a source in chronological order
    // This allows for state-reconstruction
    return []; // Implementation placeholder
  }
}
