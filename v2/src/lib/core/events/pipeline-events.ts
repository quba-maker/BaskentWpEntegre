import { DomainEvent } from './domain-event';

// Strongly typed event schemas for Pipeline FSM

export type PipelineState = 
  | 'idle'
  | 'discovery'
  | 'semantic_analysis'
  | 'duplicate_resolution'
  | 'transformation'
  | 'human_review'
  | 'sync'
  | 'completed'
  | 'failed'
  | 'rollback_available'
  | 'canceled';

export interface BasePipelineEvent {
  version: 1; // Strict versioning for future-proofing
  pipelineRunId: string;
  tenantId: string;
  timestamp: string;
  state: PipelineState;
}

export interface PipelineStartedEvent extends BasePipelineEvent {
  type: 'pipeline.started';
  payload: {
    source: string;
    totalRows: number;
  };
}

export interface SemanticAnalysisStartedEvent extends BasePipelineEvent {
  type: 'pipeline.semantic_analysis.started';
}

export interface SemanticAnalysisCompletedEvent extends BasePipelineEvent {
  type: 'pipeline.semantic_analysis.completed';
  payload: {
    latencyMs: number;
    confidenceScore: number;
    mappedFields: Record<string, string>;
  };
}

export interface DuplicateResolutionEvent extends BasePipelineEvent {
  type: 'pipeline.duplicate_resolution.completed';
  payload: {
    latencyMs: number;
    duplicatesFound: number;
    resolutionStrategy: string;
  };
}

export interface HumanReviewRequiredEvent extends BasePipelineEvent {
  type: 'pipeline.human_review.required';
  payload: {
    reason: string;
    aiReasoning: string;
    confidenceScore: number;
    suggestedResolution: any;
    sessionId: string; // Links to human_review_sessions table
  };
}

export interface PipelineProgressEvent extends BasePipelineEvent {
  type: 'pipeline.progress.updated';
  payload: {
    step: number;
    totalSteps: number;
    message: string;
  };
}

export interface PipelineCompletedEvent extends BasePipelineEvent {
  type: 'pipeline.completed';
  payload: {
    totalProcessed: number;
    totalInserted: number;
    totalMerged: number;
    totalDurationMs: number;
  };
}

export interface PipelineCanceledEvent extends BasePipelineEvent {
  type: 'pipeline.canceled';
  payload: {
    reason: string;
    operatorId?: string;
  };
}

export type PipelineRealtimeEvent = 
  | PipelineStartedEvent
  | SemanticAnalysisStartedEvent
  | SemanticAnalysisCompletedEvent
  | DuplicateResolutionEvent
  | HumanReviewRequiredEvent
  | PipelineProgressEvent
  | PipelineCompletedEvent
  | PipelineCanceledEvent;
