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

const STORAGE_KEY = 'pipeline_draft_snapshot_v2';
const SCHEMA_VERSION = 2;

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
      // Idempotency Guard: prevent duplicate events from SSE replays
      if (state.events.some(e => e.eventId === event.eventId)) {
        return state; // No-op
      }

      const newEvents = [...state.events, event];
      
      // Compute aggregated metrics based on the event type
      let aiLatencyMs = state.aiLatencyMs;
      let totalDuplicates = state.totalDuplicates;
      let reviewSession = { ...state.reviewSession };
      let mappedFields = { ...state.mappedFields };

      if (event.type === 'pipeline.semantic_analysis.completed') {
        // Safe access payload properties knowing the event type
        const payload = (event as any).payload;
        aiLatencyMs += payload.latencyMs || 0;
        mappedFields = { ...mappedFields, ...(payload.mappedFields || {}) };
      }
      
      if (event.type === 'pipeline.duplicate_resolution.completed') {
        const payload = (event as any).payload;
        totalDuplicates += payload.duplicatesFound || 0;
      }

      if (event.type === 'pipeline.human_review.required') {
        const payload = (event as any).payload;
        reviewSession = {
          required: true,
          reason: payload.reason,
          sessionId: payload.sessionId,
          suggestedResolution: payload.suggestedResolution,
        };
      }

      const newState = {
        events: newEvents,
        currentState: (event as any).state || state.currentState,
        aiLatencyMs,
        totalDuplicates,
        reviewSession,
        mappedFields,
        lastEventId: event.eventId,
        _schemaVersion: SCHEMA_VERSION
      };

      // Background persist to IDB
      idb.set(STORAGE_KEY, newState).catch(console.error);

      return newState as Partial<PipelineStoreState>;
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
  }),

  resetPipeline: () => {
    idb.del(STORAGE_KEY).catch(console.error);
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
  try {
    const state: any = await idb.get(STORAGE_KEY);
    if (state) {
      if (state._schemaVersion === SCHEMA_VERSION) {
        usePipelineStore.setState(state);
      } else {
        console.warn(`[IDB] Schema version mismatch. Expected ${SCHEMA_VERSION}, found ${state._schemaVersion}. Discarding cache.`);
        await idb.del(STORAGE_KEY);
      }
    }
  } catch (err) {
    console.error('[IDB] Failed to hydrate pipeline store, cache may be corrupted.', err);
    await idb.del(STORAGE_KEY).catch(() => {});
  }
}
