import { SemanticAnalysisService } from '../engines/semantic-analysis.service';
import { DuplicateResolutionService } from '../engines/duplicate-resolution.service';
import { SafetyGuardrailsService } from '../safety/guardrails.service';
import { AIProvider } from '../../ai/providers/ai-provider.interface';
import { PipelineRealtimeEvent, PipelineState } from '@/lib/core/events/pipeline-events';

/**
 * Pipeline Orchestrator (State Machine)
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
    onProgress?: (event: PipelineRealtimeEvent) => void
  ) {
    const pipelineRunId = crypto.randomUUID();
    const emit = (event: PipelineRealtimeEvent) => {
      if (onProgress) onProgress(event);
    };

    const baseEvent = {
      version: 1 as const,
      pipelineRunId,
      tenantId,
      timestamp: new Date().toISOString()
    };

    try {
      if (signal?.aborted) throw new Error('Pipeline canceled before start');

      emit({
        ...baseEvent,
        type: 'pipeline.started',
        state: 'discovery',
        payload: { source: 'api', totalRows: 1 }
      });

      // Stage 1: Semantic Analysis
      if (signal?.aborted) throw new Error('Canceled');
      emit({ ...baseEvent, type: 'pipeline.semantic_analysis.started', state: 'semantic_analysis' });
      
      const startSemantic = Date.now();
      const semanticResult = await this.semanticService.processRow(tenantId, 'source_temp', rawData, expectedSchema);
      
      const mappedFields = semanticResult.entities.reduce((acc: any, entity: any) => {
        acc[entity.field] = entity.value;
        return acc;
      }, {});
      
      const minConfidence = semanticResult.entities.length 
        ? Math.min(...semanticResult.entities.map((e: any) => e.confidence)) 
        : 100;

      if (semanticResult.status === 'queued_for_review') {
        emit({
          ...baseEvent,
          type: 'pipeline.human_review.required',
          state: 'human_review',
          payload: {
            reason: 'Low Confidence in Mapping',
            aiReasoning: 'AI detected low confidence score below threshold',
            confidenceScore: minConfidence,
            suggestedResolution: mappedFields,
            sessionId: crypto.randomUUID() // Will be inserted to human_review_sessions
          }
        });
        return { status: 'paused', reason: 'human_review_required', payload: semanticResult };
      }

      emit({
        ...baseEvent,
        type: 'pipeline.semantic_analysis.completed',
        state: 'semantic_analysis',
        payload: {
          latencyMs: Date.now() - startSemantic,
          confidenceScore: minConfidence,
          mappedFields: mappedFields
        }
      });

      // Stage 2: Transformation (mocked here)
      if (signal?.aborted) throw new Error('Canceled');
      emit({ ...baseEvent, type: 'pipeline.progress.updated', state: 'transformation', payload: { step: 2, totalSteps: 4, message: 'Normalizing Data' } });
      
      // Stage 3: Duplicate Check
      if (signal?.aborted) throw new Error('Canceled');
      const startDuplicate = Date.now();
      const duplicates = await this.duplicateService.detectDuplicates(
        { name: 'Test' }, // mock parsed lead
        [] // existing CRM records
      );
      emit({
        ...baseEvent,
        type: 'pipeline.duplicate_resolution.completed',
        state: 'duplicate_resolution',
        payload: {
          latencyMs: Date.now() - startDuplicate,
          duplicatesFound: 0,
          resolutionStrategy: 'insert_new'
        }
      });

      // Stage 4: Safety Check
      if (signal?.aborted) throw new Error('Canceled');
      emit({ ...baseEvent, type: 'pipeline.progress.updated', state: 'sync', payload: { step: 4, totalSteps: 4, message: 'Executing Safety Guardrails' } });
      const risk = SafetyGuardrailsService.analyzeSyncRisk(100, 1);
      if (risk === 'critical_approval_required') {
        emit({
          ...baseEvent,
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
        ...baseEvent,
        type: 'pipeline.completed',
        state: 'completed',
        payload: {
          totalProcessed: 1,
          totalInserted: 1,
          totalMerged: 0,
          totalDurationMs: Date.now() - new Date(baseEvent.timestamp).getTime()
        }
      });
      return { status: 'completed', payload: semanticResult };
    } catch (error: any) {
      if (error.message.includes('Canceled')) {
        emit({
          ...baseEvent,
          type: 'pipeline.canceled',
          state: 'canceled',
          payload: { reason: 'User Aborted' }
        });
        return { status: 'canceled', reason: 'User Aborted' };
      }
      
      emit({ ...baseEvent, type: 'pipeline.progress.updated', state: 'failed', payload: { step: -1, totalSteps: 4, message: error.message } });
      return { status: 'error', reason: error.message };
    }
  }
}
