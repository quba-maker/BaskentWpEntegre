import { create } from 'zustand';
import { PipelineRealtimeEvent, PipelineState } from '@/lib/core/events/pipeline-events';
import * as idb from 'idb-keyval';

interface PipelineStoreState {
  // Connection state
  isConnected: boolean;
  isReconnecting: boolean;
  lastEventId: string | null;

  // Realtime Data
  currentState: PipelineState;
  events: PipelineRealtimeEvent[];
  mappedFields: Record<string, string>;
  
  // Human Review State
  reviewSession: {
    required: boolean;
    reason: string | null;
    sessionId: string | null;
    suggestedResolution: any;
  };

  // Metrics
  totalDurationMs: number;
  totalDuplicates: number;
  aiLatencyMs: number;

  // Actions
  addEvent: (event: PipelineRealtimeEvent) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
  setLastEventId: (id: string) => void;
  resolveReview: (decision: any) => void;
  resetPipeline: () => void;
}

export const usePipelineStore = create<PipelineStoreState>((set, get) => ({
  isConnected: false,
  isReconnecting: false,
  lastEventId: null,

  currentState: 'idle',
  events: [],
  mappedFields: {},
  
  reviewSession: {
    required: false,
    reason: null,
    sessionId: null,
    suggestedResolution: null
  },

  totalDurationMs: 0,
  totalDuplicates: 0,
  aiLatencyMs: 0,

  addEvent: (event) => {
    set((state) => {
      const newEvents = [...state.events, event];
      
      // Compute aggregated metrics based on the event type
      let aiLatencyMs = state.aiLatencyMs;
      let totalDuplicates = state.totalDuplicates;
      let reviewSession = { ...state.reviewSession };
      let mappedFields = { ...state.mappedFields };

      if (event.type === 'pipeline.semantic_analysis.completed') {
        aiLatencyMs += event.payload.latencyMs;
        mappedFields = { ...mappedFields, ...event.payload.mappedFields };
      }
      
      if (event.type === 'pipeline.duplicate_resolution.completed') {
        totalDuplicates += event.payload.duplicatesFound;
      }

      if (event.type === 'pipeline.human_review.required') {
        reviewSession = {
          required: true,
          reason: event.payload.reason,
          sessionId: event.payload.sessionId,
          suggestedResolution: event.payload.suggestedResolution,
        };
      }

      const newState = {
        events: newEvents,
        currentState: event.state,
        aiLatencyMs,
        totalDuplicates,
        reviewSession,
        mappedFields
      };

      // Background persist to IDB
      idb.set('pipeline_draft_snapshot', newState).catch(console.error);

      return newState;
    });
  },

  setConnectionStatus: (status) => set({ 
    isConnected: status === 'connected',
    isReconnecting: status === 'reconnecting'
  }),

  setLastEventId: (id) => set({ lastEventId: id }),

  resolveReview: (decision) => set({
    reviewSession: {
      required: false,
      reason: null,
      sessionId: null,
      suggestedResolution: null
    }
    // Also we would typically fire an API call here to submit the decision to backend
  }),

  resetPipeline: () => {
    idb.del('pipeline_draft_snapshot').catch(console.error);
    set({
      currentState: 'idle',
      events: [],
      mappedFields: {},
      lastEventId: null,
      reviewSession: { required: false, reason: null, sessionId: null, suggestedResolution: null },
      totalDurationMs: 0,
      totalDuplicates: 0,
      aiLatencyMs: 0,
    });
  }
}));

// Function to hydrate store on mount
export async function hydratePipelineStore() {
  const state = await idb.get('pipeline_draft_snapshot');
  if (state) {
    usePipelineStore.setState(state);
  }
}
