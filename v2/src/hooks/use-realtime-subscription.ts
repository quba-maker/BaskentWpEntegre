import { useEffect, useRef, useCallback } from "react";
import * as Ably from "ably";
import { BaseRealtimeEventSchema, ProjectionEvent } from "@/lib/realtime/contracts";
import { useDiagnosticsStore } from "@/lib/realtime/diagnostics-store";
import { ChaosEngine } from "@/lib/realtime/chaos-engine";
import { CrossTabSync } from "@/lib/realtime/cross-tab-sync";
import { isTabVisible, onVisibilityChange } from "@/lib/realtime/visibility";

// ─── Singleton Management ───
let sharedAblyClient: Ably.Realtime | null = null;
let currentTenantId: string | null = null;

// ─── Global Event ID Dedup Set (LRU-style, max 500 entries) ───
const processedEventIds = new Set<string>();
const DEDUP_MAX_SIZE = 500;

function trackEventId(eventId: string): boolean {
  if (processedEventIds.has(eventId)) return true; // Already processed
  processedEventIds.add(eventId);
  // LRU eviction: if set exceeds max, remove oldest
  if (processedEventIds.size > DEDUP_MAX_SIZE) {
    const first = processedEventIds.values().next().value;
    if (first) processedEventIds.delete(first);
  }
  return false;
}

// Initialize cross-tab sync once
if (typeof window !== "undefined") {
  CrossTabSync.init();
}

export const getSharedAblyClient = (tenantId: string) => {
  if (sharedAblyClient && currentTenantId === tenantId) {
    return sharedAblyClient;
  }

  if (typeof window === "undefined") return null;

  // Tenant switch: dispose old client completely
  if (sharedAblyClient && currentTenantId !== tenantId) {
    console.log("[ABLY_CLIENT_DISPOSED] Tenant changed. Disposing old client.");
    sharedAblyClient.close();
    sharedAblyClient = null;
  }

  currentTenantId = tenantId;

  console.log("[ABLY_CLIENT_CREATED]", {
    authMode: "authUrl (Token based)",
    authUrl: `/api/ably/auth?tenantId=${tenantId}`,
    tabId: CrossTabSync.tabId,
    isLeader: CrossTabSync.isLeaderTab(),
  });

  sharedAblyClient = new Ably.Realtime({
    authUrl: `/api/ably/auth?tenantId=${tenantId}`,
    // Ably SDK handles exponential backoff internally for reconnects
    // disconnectedRetryTimeout: starts at 1s, doubles up to 30s
    // suspendedRetryTimeout: starts at 30s
  });

  // Track detailed connection state
  sharedAblyClient.connection.on((stateChange) => {
    console.log(`[ABLY_CONNECTION_STATE] ${stateChange.current}`, stateChange.reason || "");
    
    if (["disconnected", "suspended", "failed", "closed"].includes(stateChange.current)) {
      useDiagnosticsStore.getState().setRealtimeDown(true);
    } else if (stateChange.current === "connected") {
      useDiagnosticsStore.getState().setRealtimeDown(false);
      if (stateChange.previous === "connecting" || stateChange.previous === "initialized") {
        console.log("[ABLY_CONNECTED]");
      } else {
        console.log("[ABLY_REATTACHED]");
      }
      useDiagnosticsStore.getState().incrementMetric("realtime.socket.reconnects");
    }
  });

  return sharedAblyClient;
};

/**
 * Client Subscription Engine
 * 
 * Production-hardened realtime subscription with:
 * - Cross-tab leader election (only leader subscribes to Ably)
 * - Global event deduplication via eventId
 * - Visibility-aware render throttling
 * - Automatic channel cleanup on unmount/tenant switch
 */
export function useRealtimeSubscription(
  tenantId: string,
  onEvent: (event: ProjectionEvent) => void
) {
  // Stabilize the callback reference to prevent re-subscriptions
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Visibility-aware: queue events when tab is hidden, flush on visible
  const pendingEventsRef = useRef<ProjectionEvent[]>([]);
  const isVisibleRef = useRef(isTabVisible());

  useEffect(() => {
    const cleanup = onVisibilityChange((state) => {
      isVisibleRef.current = state === "visible";
      // Flush pending events when tab becomes visible
      if (state === "visible" && pendingEventsRef.current.length > 0) {
        console.log(`[ABLY_VISIBILITY_FLUSH] Flushing ${pendingEventsRef.current.length} queued events`);
        for (const evt of pendingEventsRef.current) {
          onEventRef.current(evt);
        }
        pendingEventsRef.current = [];
      }
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!tenantId) return;

    const client = getSharedAblyClient(tenantId);
    if (!client) return;

    const channelName = `private:tenant:${tenantId}`;
    const channel = client.channels.get(channelName);

    // Track Memory Leak Safety
    useDiagnosticsStore.getState().registerSubscription(channelName);
    
    // Debug injection (dev only)
    if (typeof window !== "undefined") {
      (window as any).testAbly = channel;
    }

    console.log(`[ABLY_CHANNEL_ATTACHING] Channel: "${channelName}"`);
    channel.attach().then(() => {
      console.log("[ABLY_CHANNEL_ATTACHED]", { channelName });
    }).catch((err: any) => {
      console.error("[ABLY_CHANNEL_ATTACH_ERROR]", { channelName, err: err?.message });
    });

    // Event processing pipeline
    const processEvent = async (eventData: any, source: "ably" | "cross-tab") => {
      try {
        const validatedEvent = BaseRealtimeEventSchema.parse(eventData);
        
        // ─── Global Dedup Gate ───
        const isDuplicate = trackEventId(validatedEvent.eventId);
        if (isDuplicate) {
          console.log("[ABLY_EVENT_DEDUPED]", { eventId: validatedEvent.eventId, source });
          return;
        }

        // Metric: Event Latency
        const latency = Date.now() - validatedEvent.timestamp;
        useDiagnosticsStore.getState().setMetric("realtime.event.latency", latency);

        // Chaos Interception (dev only)
        const eventsToProcess = await ChaosEngine.processIncomingEvents(validatedEvent);
        
        for (const evt of eventsToProcess) {
          const startTime = performance.now();
          
          // Visibility throttle: queue if tab is hidden
          if (!isVisibleRef.current) {
            pendingEventsRef.current.push(evt as ProjectionEvent);
            // Cap pending queue to prevent memory leak
            if (pendingEventsRef.current.length > 50) {
              pendingEventsRef.current = pendingEventsRef.current.slice(-25);
            }
          } else {
            onEventRef.current(evt as ProjectionEvent);
          }
          
          const reconcileMs = performance.now() - startTime;
          useDiagnosticsStore.getState().setMetric("realtime.projection.reconcile_ms", Math.round(reconcileMs));
        }

        // Leader broadcasts to follower tabs
        if (source === "ably") {
          CrossTabSync.broadcastEvent(eventData);
        }

      } catch (error) {
        console.error(`[Realtime Sync Error] Invalid event payload received on ${channelName}:`, error);
      }
    };

    // Ably subscription
    const ablyHandler = async (message: Ably.Message) => {
      console.log("[ABLY_EVENT_RECEIVED]", { id: message.id, name: message.name });
      await processEvent(message.data, "ably");
    };
    channel.subscribe(ablyHandler);

    // Cross-tab listener (for follower tabs)
    const crossTabCleanup = CrossTabSync.onEvent((event) => {
      if (event._type === "cache_invalidation") return; // Handled elsewhere
      processEvent(event, "cross-tab");
    });

    return () => {
      // Memory Safety: deterministic cleanup
      useDiagnosticsStore.getState().unregisterSubscription(channelName);
      
      console.log(`[ABLY_CHANNEL_DISPOSED] Unsubscribing and detaching channel: ${channelName}`);
      channel.unsubscribe(ablyHandler);
      channel.detach();
      crossTabCleanup();
      pendingEventsRef.current = [];
    };
  }, [tenantId]); // Removed onEvent from deps — using ref instead
}
