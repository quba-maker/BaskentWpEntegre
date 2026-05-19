import { useEffect } from "react";
import * as Ably from "ably";
import { BaseRealtimeEventSchema, ProjectionEvent } from "@/lib/realtime/contracts";

let sharedAblyClient: Ably.Realtime | null = null;

export const getSharedAblyClient = (tenantId: string) => {
  if (sharedAblyClient) return sharedAblyClient;
  if (typeof window === "undefined") return null;

  sharedAblyClient = new Ably.Realtime({
    authUrl: `/api/ably/auth?tenantId=${tenantId}`,
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

    // 1. Initialize Ably Client with Auth Callback
    // This calls our Edge Route which securely returns a bounded token
    const client = getSharedAblyClient(tenantId);
    if (!client) return;

    const channelName = `private:tenant:${tenantId}`;
    const channel = client.channels.get(channelName);

    // 2. Subscribe to all events on this channel
    channel.subscribe((message) => {
      try {
        // 3. Strict Runtime Validation (Idempotency and Contract enforcement)
        // Ensure malicious or malformed events do not crash the UI
        const validatedEvent = BaseRealtimeEventSchema.parse(message.data);
        
        // 4. Pass the strictly typed event to the consumer (Zustand/React Query)
        onEvent(validatedEvent as ProjectionEvent);

      } catch (error) {
        console.error(`[Realtime Sync Error] Invalid event payload received on ${channelName}:`, error);
        // Sentry/Observability integration for corrupted payloads
      }
    });

    return () => {
      channel.unsubscribe();
      client.close();
    };
  }, [tenantId, onEvent]);
}
