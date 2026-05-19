import { create } from 'zustand';
import { StreamingState, StreamMetrics } from './types';

export interface ActiveStream {
  streamId: string;
  traceId: string;
  state: StreamingState;
  content: string;
  metrics: StreamMetrics;
  abortController: AbortController | null;
}

interface StreamMachineState {
  activeStreams: Record<string, ActiveStream>; // keyed by channelId
  
  // Actions
  startThinking: (channelId: string, streamId: string, traceId: string) => void;
  startStreaming: (channelId: string, streamId: string) => void;
  appendDelta: (channelId: string, streamId: string, chunk: string) => void;
  completeStream: (channelId: string, streamId: string) => void;
  interruptStream: (channelId: string, streamId: string, reason: string) => void;
  failStream: (channelId: string, streamId: string, error: string) => void;
  clearStream: (channelId: string) => void;
  
  getStream: (channelId: string) => ActiveStream | undefined;
}

export const useStreamMachine = create<StreamMachineState>((set, get) => ({
  activeStreams: {},

  startThinking: (channelId, streamId, traceId) => set((state) => {
    const current = state.activeStreams[channelId];
    if (current?.state === 'streaming' || current?.state === 'thinking') {
      // Clean up zombie stream
      current.abortController?.abort('new_stream_started');
    }
    
    return {
      activeStreams: {
        ...state.activeStreams,
        [channelId]: {
          streamId,
          traceId,
          state: 'thinking',
          content: '',
          metrics: {
            traceId,
            streamId,
            startedAt: Date.now(),
            firstTokenLatencyMs: null,
            completionLatencyMs: null,
            tokensPerSecond: 0,
            totalTokens: 0,
          },
          abortController: new AbortController()
        }
      }
    };
  }),

  startStreaming: (channelId, streamId) => set((state) => {
    const stream = state.activeStreams[channelId];
    // If we missed the 'thinking' state or reordered events, we gracefully transition
    if (!stream || stream.streamId !== streamId) return state;
    if (stream.state !== 'thinking' && stream.state !== 'idle') return state;

    return {
      activeStreams: {
        ...state.activeStreams,
        [channelId]: {
          ...stream,
          state: 'streaming',
          metrics: {
            ...stream.metrics,
            firstTokenLatencyMs: Date.now() - stream.metrics.startedAt
          }
        }
      }
    };
  }),

  appendDelta: (channelId, streamId, chunk) => set((state) => {
    const stream = state.activeStreams[channelId];
    if (!stream || stream.streamId !== streamId) return state;
    
    // Auto-transition to streaming if delta arrives before startStreaming
    const isTransitioning = stream.state === 'thinking';

    return {
      activeStreams: {
        ...state.activeStreams,
        [channelId]: {
          ...stream,
          state: 'streaming',
          content: stream.content + chunk,
          metrics: {
            ...stream.metrics,
            firstTokenLatencyMs: isTransitioning 
              ? Date.now() - stream.metrics.startedAt 
              : stream.metrics.firstTokenLatencyMs,
            totalTokens: stream.metrics.totalTokens + 1
          }
        }
      }
    };
  }),

  completeStream: (channelId, streamId) => set((state) => {
    const stream = state.activeStreams[channelId];
    if (!stream || stream.streamId !== streamId) return state;

    const completionLatencyMs = Date.now() - stream.metrics.startedAt;
    const durationSecs = completionLatencyMs / 1000;
    const tokensPerSecond = durationSecs > 0 ? stream.metrics.totalTokens / durationSecs : 0;

    return {
      activeStreams: {
        ...state.activeStreams,
        [channelId]: {
          ...stream,
          state: 'completed',
          metrics: {
            ...stream.metrics,
            completionLatencyMs,
            tokensPerSecond
          }
        }
      }
    };
  }),

  interruptStream: (channelId, streamId, reason) => set((state) => {
    const stream = state.activeStreams[channelId];
    if (!stream || stream.streamId !== streamId) return state;

    stream.abortController?.abort(reason);

    return {
      activeStreams: {
        ...state.activeStreams,
        [channelId]: {
          ...stream,
          state: 'interrupted',
          metrics: {
            ...stream.metrics,
            interruptedReason: reason
          }
        }
      }
    };
  }),

  failStream: (channelId, streamId, error) => set((state) => {
    const stream = state.activeStreams[channelId];
    if (!stream || stream.streamId !== streamId) return state;

    stream.abortController?.abort(error);

    return {
      activeStreams: {
        ...state.activeStreams,
        [channelId]: {
          ...stream,
          state: 'failed',
          metrics: {
            ...stream.metrics,
            interruptedReason: 'failed_with_error'
          }
        }
      }
    };
  }),
  
  clearStream: (channelId) => set((state) => {
    const newStreams = { ...state.activeStreams };
    delete newStreams[channelId];
    return { activeStreams: newStreams };
  }),

  getStream: (channelId) => get().activeStreams[channelId]
}));
