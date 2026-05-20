import { SemanticAnalysisService } from '../engines/semantic-analysis.service';
import { DuplicateResolutionService } from '../engines/duplicate-resolution.service';
import { SafetyGuardrailsService } from '../safety/guardrails.service';
import { AIProvider } from '../../ai/providers/ai-provider.interface';

/**
 * Pipeline Orchestrator (State Machine)
 * Coordinates the flow of raw data through the AI, Duplicate, and Safety engines.
 */
export class PipelineOrchestrator {
  private semanticService: SemanticAnalysisService;
  private duplicateService: DuplicateResolutionService;

  constructor(aiProvider: AIProvider) {
    this.semanticService = new SemanticAnalysisService(aiProvider);
    this.duplicateService = new DuplicateResolutionService(aiProvider);
  }

  async runPipeline(tenantId: string, rawData: string, expectedSchema: any[]) {
    // Stage 1: Semantic Analysis
    const semanticResult = await this.semanticService.processRow(tenantId, 'source_temp', rawData, expectedSchema);
    if (semanticResult.status === 'queued_for_review') {
      return { status: 'paused', reason: 'human_review_required' };
    }

    // Stage 2: Transformation (mocked here for brevity, usually injected)
    // Stage 3: Duplicate Check
    const duplicates = await this.duplicateService.detectDuplicates(
      { name: 'Test' }, // mock parsed lead
      [] // existing CRM records
    );

    // Stage 4: Safety Check
    const risk = SafetyGuardrailsService.analyzeSyncRisk(100, 1);
    if (risk === 'critical_approval_required') {
      return { status: 'paused', reason: 'mass_overwrite_prevention' };
    }

    return { status: 'completed' };
  }
}
