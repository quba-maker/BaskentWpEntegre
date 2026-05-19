import { useDiagnosticsStore } from "./diagnostics-store";

export const ChaosEngine = {
  /**
   * Simulates network unpredictability and hostile production environments.
   * Intercepts events BEFORE they reach the reconciliation layer.
   */
  processIncomingEvents: async <T>(event: T): Promise<T[]> => {
    const state = useDiagnosticsStore.getState();
    if (!state.chaosModeEnabled) return [event];

    const { dropRate, delayMs, duplicateBurst } = state.chaosSettings;

    // 1. Simulate Network Drop (Blackholing)
    if (dropRate > 0 && Math.random() < dropRate) {
      state.incrementMetric("realtime.event.dropped");
      state.addLog("Chaos: Dropped incoming event");
      return []; // Event swallowed
    }

    // 2. Simulate Network Latency / Queue Lag
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      state.addLog(`Chaos: Delayed event by ${delayMs}ms`);
    }

    // 3. Simulate Duplicate Delivery Burst (At-least-once delivery anomalies)
    if (duplicateBurst) {
      state.addLog("Chaos: Bursted event (3 duplicates)");
      return [event, event, event];
    }

    return [event];
  }
};
