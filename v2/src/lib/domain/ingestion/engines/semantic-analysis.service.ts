import { AIProvider, SchemaField } from '../../ai/providers/ai-provider.interface';
import { EventBus } from '../../../core/events/event-bus';
import { SemanticAnalysisCompletedEvent, HumanReviewQueuedEvent } from '../../../core/events/domain-event';

export class SemanticAnalysisService {
  constructor(private aiProvider: AIProvider) {}

  /**
   * Processes a raw payload, extracts entities, and publishes domain events.
   */
  async processRow(tenantId: string, sourceId: string, rawRowData: string, expectedSchema: SchemaField[]) {
    // 1. AI extracts entities from raw data
    const entities = await this.aiProvider.extractEntities(rawRowData, expectedSchema);

    // 2. Check confidence scores
    const lowConfidenceEntities = entities.filter(e => e.confidence < 0.85);

    if (lowConfidenceEntities.length > 0) {
      // Confidence is low, queue for human review
      const reviewEvent = new HumanReviewQueuedEvent(tenantId, {
        sourceId,
        reason: 'Low confidence score on ' + lowConfidenceEntities.map(e => e.field).join(', ')
      });
      await EventBus.publish(reviewEvent);
      return { status: 'queued_for_review', entities };
    }

    // 3. Confidence is high, proceed with pipeline
    const successEvent = new SemanticAnalysisCompletedEvent(tenantId, {
      sourceId,
      entities,
      confidence: Math.min(...entities.map(e => e.confidence))
    });
    
    await EventBus.publish(successEvent);
    return { status: 'success', entities };
  }
}
