/**
 * Chaos Engine — Dev-Only Network Fault Simulator
 * 
 * In production builds, this is a complete no-op.
 * Next.js dead-code elimination removes the entire dev block.
 */

const IS_DEV = process.env.NODE_ENV === "development";

// Production no-op (zero overhead, tree-shaken)
const NoOpChaosEngine = {
  processIncomingEvents: async <T>(event: T): Promise<T[]> => [event],
};

// Dev-only implementation (lazy-loaded to avoid bundle impact)
const DevChaosEngine = {
  processIncomingEvents: async <T>(event: T): Promise<T[]> => {
    // Dynamic import prevents diagnostics-store from being bundled in production
    const { useDiagnosticsStore } = await import("./diagnostics-store");
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

export const ChaosEngine = IS_DEV ? DevChaosEngine : NoOpChaosEngine;
