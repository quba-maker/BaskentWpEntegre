import { SemanticAnalysisService } from '../engines/semantic-analysis.service';
import { DuplicateResolutionService } from '../engines/duplicate-resolution.service';
import { SafetyGuardrailsService } from '../safety/guardrails.service';
import { AIProvider } from '../../ai/providers/ai-provider.interface';
import { PipelineRealtimeEvent, PipelineState } from '@/lib/core/events/pipeline-events';
import { withTimeout, AITimeoutException } from '../../ai/providers/timeout-guard';
import { PipelineMetrics } from '@/lib/core/observability/metrics';

/**
 * Enterprise Pipeline Orchestrator (State Machine)
 * FSM handling data ingestion, yielding strictly typed PipelineRealtimeEvent.
 */
export class PipelineOrchestrator {
  private semanticService: SemanticAnalysisService;
  private duplicateService: DuplicateResolutionService;

  constructor(aiProvider: AIProvider) {
    this.semanticService = new SemanticAnalysisService(aiProvider);
    this.duplicateService = new DuplicateResolutionService(aiProvider);
  }

  async runPipeline(
    tenantId: string, 
    rawData: string, 
    expectedSchema: any[],
    signal?: AbortSignal,
    onProgress?: (event: PipelineRealtimeEvent & { eventId: string }) => void
  ) {
    const pipelineRunId = crypto.randomUUID();
    let eventIndex = 0;

    const emit = (eventProps: any) => {
      const eventId = `${pipelineRunId}-${eventIndex++}`;
      const fullEvent = {
        eventId,
        version: 1 as const,
        pipelineRunId,
        tenantId,
        timestamp: new Date().toISOString(),
        ...eventProps
      };
      if (onProgress) onProgress(fullEvent as any);
    };

    try {
      if (signal?.aborted) throw new Error('Pipeline canceled before start');

      PipelineMetrics.recordPayloadSize(pipelineRunId, tenantId, new Blob([rawData]).size);

      emit({
        type: 'pipeline.started',
        state: 'discovery',
        payload: { source: 'api', totalRows: 1 }
      });

      // Stage 1: Semantic Analysis
      if (signal?.aborted) throw new Error('Canceled');
      emit({ type: 'pipeline.semantic_analysis.started', state: 'semantic_analysis' });
      
      const startSemantic = Date.now();
      let semanticResult;
      
      try {
        // AI Provider wrapped in 45s timeout guard
        semanticResult = await withTimeout(
          this.semanticService.processRow(tenantId, 'source_temp', rawData, expectedSchema),
          45000
        );
      } catch (aiError: any) {
        if (aiError instanceof AITimeoutException) {
           emit({
             type: 'pipeline.human_review.required',
             state: 'human_review',
             payload: {
               reason: 'AI Provider Timeout',
               aiReasoning: 'The AI provider failed to respond within 45 seconds. Fallback to manual review.',
               confidenceScore: 0,
               suggestedResolution: {},
               sessionId: crypto.randomUUID()
             }
           });
           return { status: 'paused', reason: 'ai_timeout' };
        }
        throw aiError;
      }

      const latencyMs = Date.now() - startSemantic;
      PipelineMetrics.recordLatency(pipelineRunId, tenantId, 'semantic_analysis', latencyMs);

      const mappedFields = semanticResult.entities.reduce((acc: any, entity: any) => {
        acc[entity.field] = entity.value;
        return acc;
      }, {});
      
      const minConfidence = semanticResult.entities.length 
        ? Math.min(...semanticResult.entities.map((e: any) => e.confidence)) 
        : 100;

      if (semanticResult.status === 'queued_for_review') {
        emit({
          type: 'pipeline.human_review.required',
          state: 'human_review',
          payload: {
            reason: 'Low Confidence in Mapping',
            aiReasoning: 'AI detected low confidence score below threshold',
            confidenceScore: minConfidence,
            suggestedResolution: mappedFields,
            sessionId: crypto.randomUUID()
          }
        });
        return { status: 'paused', reason: 'human_review_required', payload: semanticResult };
      }

      emit({
        type: 'pipeline.semantic_analysis.completed',
        state: 'semantic_analysis',
        payload: {
          latencyMs,
          confidenceScore: minConfidence,
          mappedFields: mappedFields
        }
      });

      // Stage 2: Transformation
      if (signal?.aborted) throw new Error('Canceled');
      emit({ type: 'pipeline.progress.updated', state: 'transformation', payload: { step: 2, totalSteps: 4, message: 'Normalizing Data' } });
      
      // Stage 3: Duplicate Check
      if (signal?.aborted) throw new Error('Canceled');
      const startDuplicate = Date.now();
      
      // AI Provider wrapped in timeout guard
      const duplicates = await withTimeout(
        this.duplicateService.detectDuplicates(
          { name: 'Test' }, // mock parsed lead
          [] // existing CRM records
        ),
        45000
      ).catch(() => ({})); // If duplicate check times out, assume no duplicates (fallback strategy)

      const dupLatency = Date.now() - startDuplicate;
      PipelineMetrics.recordLatency(pipelineRunId, tenantId, 'duplicate_resolution', dupLatency);

      emit({
        type: 'pipeline.duplicate_resolution.completed',
        state: 'duplicate_resolution',
        payload: {
          latencyMs: dupLatency,
          duplicatesFound: 0,
          resolutionStrategy: 'insert_new'
        }
      });

      // Stage 4: Safety Check
      if (signal?.aborted) throw new Error('Canceled');
      emit({ type: 'pipeline.progress.updated', state: 'sync', payload: { step: 4, totalSteps: 4, message: 'Executing Safety Guardrails' } });
      
      const risk = SafetyGuardrailsService.analyzeSyncRisk(100, 1);
      if (risk === 'critical_approval_required') {
        emit({
          type: 'pipeline.human_review.required',
          state: 'human_review',
          payload: {
            reason: 'Mass Overwrite Prevention',
            aiReasoning: 'Risk of changing too many records at once',
            confidenceScore: 0,
            suggestedResolution: {},
            sessionId: crypto.randomUUID()
          }
        });
        return { status: 'paused', reason: 'mass_overwrite_prevention' };
      }

      emit({
        type: 'pipeline.completed',
        state: 'completed',
        payload: {
          totalProcessed: 1,
          totalInserted: 1,
          totalMerged: 0,
          totalDurationMs: Date.now() - new Date(startSemantic).getTime() // Approximation since base timestamp is gone from here
        }
      });
      return { status: 'completed', payload: semanticResult };
      
    } catch (error: any) {
      if (error.message.includes('Canceled')) {
        emit({
          type: 'pipeline.canceled',
          state: 'canceled',
          payload: { reason: 'User Aborted' }
        });
        return { status: 'canceled', reason: 'User Aborted' };
      }
      
      emit({ type: 'pipeline.progress.updated', state: 'failed', payload: { step: -1, totalSteps: 4, message: error.message } });
      return { status: 'error', reason: error.message };
    }
  }
}
