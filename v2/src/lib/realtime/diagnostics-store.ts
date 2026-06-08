import { create } from 'zustand';

type RealtimeMetric = 
  | "realtime.event.latency"
  | "realtime.projection.reconcile_ms"
  | "realtime.socket.reconnects"
  | "realtime.presence.ttl_expired"
  | "realtime.event.dropped"
  | "realtime.event.coalesced"
  | "realtime.queue.backpressure_size"
  | "realtime.duplicate_event_rate"
  | "realtime.polling_fallback_activation_count"
  | "realtime.dropped_event_count"
  | "realtime.cache_mutation_duration"
  | "realtime.processed_events_count"
  | "realtime.duplicate_events_count";

interface DiagnosticsState {
  metrics: Record<RealtimeMetric, number>;
  logs: { id: string; timestamp: number; message: string; data?: any }[];
  activeSubscriptions: Set<string>;
  
  // High Availability
  isRealtimeDown: boolean;
  
  // Chaos Flags
  chaosModeEnabled: boolean;
  chaosSettings: {
    delayMs: number;
    dropRate: number;
    duplicateBurst: boolean;
  };

  incrementMetric: (metric: RealtimeMetric, amount?: number) => void;
  setMetric: (metric: RealtimeMetric, value: number) => void;
  addLog: (message: string, data?: any) => void;
  registerSubscription: (channel: string) => void;
  unregisterSubscription: (channel: string) => void;
  setRealtimeDown: (isDown: boolean) => void;
  setChaosMode: (enabled: boolean) => void;
  updateChaosSettings: (settings: Partial<DiagnosticsState['chaosSettings']>) => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  metrics: {
    "realtime.event.latency": 0,
    "realtime.projection.reconcile_ms": 0,
    "realtime.socket.reconnects": 0,
    "realtime.presence.ttl_expired": 0,
    "realtime.event.dropped": 0,
    "realtime.event.coalesced": 0,
    "realtime.queue.backpressure_size": 0,
    "realtime.duplicate_event_rate": 0,
    "realtime.polling_fallback_activation_count": 0,
    "realtime.dropped_event_count": 0,
    "realtime.cache_mutation_duration": 0,
    "realtime.processed_events_count": 0,
    "realtime.duplicate_events_count": 0,
  },
  logs: [],
  activeSubscriptions: new Set(),
  isRealtimeDown: true,
  chaosModeEnabled: false,
  chaosSettings: {
    delayMs: 0,
    dropRate: 0,
    duplicateBurst: false,
  },

  incrementMetric: (metric, amount = 1) => set((state) => {
    const nextValue = state.metrics[metric] + amount;
    const nextMetrics = { ...state.metrics, [metric]: nextValue };
    
    // Automatically recalculate duplicate event rate if processed or duplicate count changes
    if (metric === "realtime.processed_events_count" || metric === "realtime.duplicate_events_count") {
      const processed = nextMetrics["realtime.processed_events_count"] || 0;
      const duplicates = nextMetrics["realtime.duplicate_events_count"] || 0;
      nextMetrics["realtime.duplicate_event_rate"] = processed > 0 
        ? Math.round((duplicates / processed) * 10000) / 100 // keep 2 decimal points percentage
        : 0;
    }
    
    return { metrics: nextMetrics };
  }),
  setMetric: (metric, value) => set((state) => {
    const nextMetrics = { ...state.metrics, [metric]: value };
    return { metrics: nextMetrics };
  }),
  addLog: (message, data) => set((state) => {
    const newLogs = [
      { id: Math.random().toString(36).slice(2), timestamp: Date.now(), message, data },
      ...state.logs
    ].slice(0, 50); // Keep last 50 logs
    return { logs: newLogs };
  }),
  registerSubscription: (channel) => set((state) => {
    const newSet = new Set(state.activeSubscriptions);
    newSet.add(channel);
    return { activeSubscriptions: newSet };
  }),
  unregisterSubscription: (channel) => set((state) => {
    const newSet = new Set(state.activeSubscriptions);
    newSet.delete(channel);
    return { activeSubscriptions: newSet };
  }),
  setRealtimeDown: (isDown) => set((state) => {
    const changes: Partial<DiagnosticsState> = { isRealtimeDown: isDown };
    if (isDown) {
      // Increment fallback activation count when falling back to polling/offline mode
      const nextFallback = state.metrics["realtime.polling_fallback_activation_count"] + 1;
      changes.metrics = {
        ...state.metrics,
        "realtime.polling_fallback_activation_count": nextFallback
      };
    }
    return changes;
  }),
  setChaosMode: (enabled) => set({ chaosModeEnabled: enabled }),
  updateChaosSettings: (settings) => set((state) => ({
    chaosSettings: { ...state.chaosSettings, ...settings }
  }))
}));
