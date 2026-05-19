/**
 * Cross-Tab Synchronization Engine
 * 
 * Uses BroadcastChannel API to sync realtime events across browser tabs.
 * Prevents duplicate Ably subscriptions — only the "leader" tab subscribes,
 * other tabs receive events via BroadcastChannel relay.
 * 
 * Architecture:
 * - Tab 1 (Leader): Subscribes to Ably → relays events to BroadcastChannel
 * - Tab 2+: Listen on BroadcastChannel → apply to local React Query cache
 */

const IS_DEV = process.env.NODE_ENV === "development";

type CrossTabMessage =
  | { type: "REALTIME_EVENT"; event: any }
  | { type: "LEADER_HEARTBEAT"; tabId: string; timestamp: number }
  | { type: "LEADER_CLAIM"; tabId: string }
  | { type: "CACHE_INVALIDATION"; queryKey: string[] };

const TAB_ID = typeof crypto !== "undefined"
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2);

let channel: BroadcastChannel | null = null;
let isLeader = false;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let monitorInterval: ReturnType<typeof setInterval> | null = null;
let lastLeaderHeartbeat = 0;
const HEARTBEAT_INTERVAL = 2000;
const LEADER_TIMEOUT = 5000;

// Listeners
type EventListener = (event: any) => void;
const listeners: EventListener[] = [];

export const CrossTabSync = {
  tabId: TAB_ID,

  init() {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) {
      // Fallback: every tab is its own leader (no cross-tab sync)
      isLeader = true;
      return;
    }

    try {
      channel = new BroadcastChannel("quba-realtime-sync");
    } catch {
      isLeader = true;
      return;
    }

    channel.onmessage = (e: MessageEvent<CrossTabMessage>) => {
      const msg = e.data;

      switch (msg.type) {
        case "LEADER_HEARTBEAT":
          if (msg.tabId !== TAB_ID) {
            lastLeaderHeartbeat = msg.timestamp;
            // Another tab is leader, we are follower
            if (isLeader) {
              if (IS_DEV) console.log("[CROSS_TAB] Yielding leadership to", msg.tabId);
              isLeader = false;
            }
          }
          break;

        case "LEADER_CLAIM":
          if (msg.tabId !== TAB_ID && isLeader) {
            // Race: compare tab IDs lexicographically
            if (msg.tabId < TAB_ID) {
              if (IS_DEV) console.log("[CROSS_TAB] Lost leader election to", msg.tabId);
              isLeader = false;
            }
          }
          break;

        case "REALTIME_EVENT":
          if (!isLeader) {
            // Follower tab: relay to local listeners
            for (const fn of listeners) {
              fn(msg.event);
            }
          }
          break;

        case "CACHE_INVALIDATION":
          // All tabs process this
          for (const fn of listeners) {
            fn({ _type: "cache_invalidation", queryKey: msg.queryKey });
          }
          break;
      }
    };

    // Try to claim leadership
    this.claimLeadership();

    // Monitor leader liveness (tracked for cleanup)
    if (monitorInterval) clearInterval(monitorInterval);
    monitorInterval = setInterval(() => {
      if (!isLeader && Date.now() - lastLeaderHeartbeat > LEADER_TIMEOUT) {
        if (IS_DEV) console.log("[CROSS_TAB] Leader timeout. Claiming leadership.");
        this.claimLeadership();
      }
    }, LEADER_TIMEOUT / 2);

    // Handle tab close: relinquish leadership
    const onUnload = () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (monitorInterval) clearInterval(monitorInterval);
    };
    window.addEventListener("pagehide", onUnload);
    // Legacy fallback
    window.addEventListener("beforeunload", onUnload);
  },

  claimLeadership() {
    isLeader = true;
    if (IS_DEV) console.log("[CROSS_TAB] Claimed leadership:", TAB_ID);
    channel?.postMessage({ type: "LEADER_CLAIM", tabId: TAB_ID } as CrossTabMessage);

    // Start heartbeat
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (isLeader) {
        channel?.postMessage({
          type: "LEADER_HEARTBEAT",
          tabId: TAB_ID,
          timestamp: Date.now(),
        } as CrossTabMessage);
      }
    }, HEARTBEAT_INTERVAL);
  },

  isLeaderTab(): boolean {
    return isLeader;
  },

  /** Leader tab broadcasts event to followers */
  broadcastEvent(event: any) {
    if (isLeader && channel) {
      channel.postMessage({ type: "REALTIME_EVENT", event } as CrossTabMessage);
    }
  },

  /** Any tab can broadcast cache invalidation */
  broadcastCacheInvalidation(queryKey: string[]) {
    channel?.postMessage({ type: "CACHE_INVALIDATION", queryKey } as CrossTabMessage);
  },

  /** Register a follower listener */
  onEvent(fn: EventListener) {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  },

  destroy() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
    channel?.close();
    channel = null;
    isLeader = false;
    listeners.length = 0;
  }
};
