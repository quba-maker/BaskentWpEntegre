import { useEffect } from "react";
import * as Ably from "ably";
import { BaseRealtimeEventSchema, ProjectionEvent } from "@/lib/realtime/contracts";
import { useDiagnosticsStore } from "@/lib/realtime/diagnostics-store";
import { ChaosEngine } from "@/lib/realtime/chaos-engine";

let sharedAblyClient: Ably.Realtime | null = null;

export const getSharedAblyClient = (tenantId: string) => {
  if (sharedAblyClient) return sharedAblyClient;
  if (typeof window === "undefined") return null;

  sharedAblyClient = new Ably.Realtime({
    authUrl: `/api/ably/auth?tenantId=${tenantId}`,
  });

  // Track global socket reconnects
  sharedAblyClient.connection.on("connected", () => {
    useDiagnosticsStore.getState().incrementMetric("realtime.socket.reconnects");
  });

  return sharedAblyClient;
};

/**
 * Client Subscription Engine
 * 
 * Securely connects to the Ably private channel using the Vercel Auth Endpoint.
 * Validates incoming events via Zod before passing them to the UI/State.
 */
export function useRealtimeSubscription(
  tenantId: string,
  onEvent: (event: ProjectionEvent) => void
) {
  useEffect(() => {
    if (!tenantId) return;

    const client = getSharedAblyClient(tenantId);
    if (!client) return;

    const channelName = `private:tenant:${tenantId}`;
    const channel = client.channels.get(channelName);

    // Track Memory Leak Safety (registering subscription)
    useDiagnosticsStore.getState().registerSubscription(channelName);

    channel.subscribe(async (message) => {
      try {
        const validatedEvent = BaseRealtimeEventSchema.parse(message.data);
        
        // Metric: Event Latency (Ably publish to client receive)
        const latency = Date.now() - validatedEvent.timestamp;
        useDiagnosticsStore.getState().setMetric("realtime.event.latency", latency);

        // Chaos Interception Layer
        const eventsToProcess = await ChaosEngine.processIncomingEvents(validatedEvent);
        
        // Pass to Reconciliation Engine
        for (const evt of eventsToProcess) {
          const startTime = performance.now();
          onEvent(evt as ProjectionEvent);
          const reconcileMs = performance.now() - startTime;
          
          useDiagnosticsStore.getState().setMetric("realtime.projection.reconcile_ms", Math.round(reconcileMs));
        }

      } catch (error) {
        console.error(`[Realtime Sync Error] Invalid event payload received on ${channelName}:`, error);
      }
    });

    return () => {
      // Memory Safety: Clean up subscriptions and listeners
      useDiagnosticsStore.getState().unregisterSubscription(channelName);
      channel.unsubscribe();
      // We don't close the shared client here to allow other channels to persist,
      // but if active subscriptions hit 0, we could potentially disconnect.
    };
  }, [tenantId, onEvent]);
}
