import { create } from 'zustand';

type RealtimeMetric = 
  | "realtime.event.latency"
  | "realtime.projection.reconcile_ms"
  | "realtime.socket.reconnects"
  | "realtime.presence.ttl_expired"
  | "realtime.event.dropped"
  | "realtime.event.coalesced"
  | "realtime.queue.backpressure_size";

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
  },
  logs: [],
  activeSubscriptions: new Set(),
  isRealtimeDown: false,
  chaosModeEnabled: false,
  chaosSettings: {
    delayMs: 0,
    dropRate: 0,
    duplicateBurst: false,
  },

  incrementMetric: (metric, amount = 1) => set((state) => ({
    metrics: { ...state.metrics, [metric]: state.metrics[metric] + amount }
  })),
  setMetric: (metric, value) => set((state) => ({
    metrics: { ...state.metrics, [metric]: value }
  })),
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
  setRealtimeDown: (isDown) => set({ isRealtimeDown: isDown }),
  setChaosMode: (enabled) => set({ chaosModeEnabled: enabled }),
  updateChaosSettings: (settings) => set((state) => ({
    chaosSettings: { ...state.chaosSettings, ...settings }
  }))
}));
