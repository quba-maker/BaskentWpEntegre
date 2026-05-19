import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeSubscription } from "./use-realtime-subscription";
import { ProjectionEvent, ChatMessageCreatedEvent, ChatMessageStatusUpdatedEvent } from "@/lib/realtime/contracts";

// Structured logging helper
const logReconciliation = (
  action: "ignored_duplicate" | "optimistic_reconciled" | "stale_event_dropped" | "cache_updated" | "cache_miss" | "status_ignored",
  details: any
) => {
  console.log(`[Reconciliation:${action}]`, details);
};

// Status ranking to prevent downgrades
const STATUS_RANK = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: -1,
};

export function useRealtimeReconciliation(tenantId: string) {
  const queryClient = useQueryClient();

  // Internal handler for newly created messages
  const handleMessageCreated = (event: ChatMessageCreatedEvent) => {
    const { payload, eventId, entityVersion } = event;
    const queryKey = ["messages", payload.conversationId];

    queryClient.setQueryData(queryKey, (oldData: any[]) => {
      if (!oldData) return [payload]; // Cache miss, could optionally trigger a refetch instead.

      // 1. Deduplication (Optimistic ID or ProviderMessageID)
      // Check if we already have this message (via event payload ID, e.g. optimistic insert)
      const existingMsgIndex = oldData.findIndex((m) => m.id === payload.id);

      if (existingMsgIndex !== -1) {
        const existing = oldData[existingMsgIndex];
        
        // Protect against status downgrade or stale update
        const currentRank = STATUS_RANK[existing.status as keyof typeof STATUS_RANK] ?? 0;
        const newRank = STATUS_RANK[payload.status as keyof typeof STATUS_RANK] ?? 0;

        if (newRank < currentRank && payload.status !== "failed") {
          logReconciliation("stale_event_dropped", { eventId, reason: "Status downgrade attempted", current: existing.status, incoming: payload.status });
          return oldData; // Ignore
        }

        logReconciliation("optimistic_reconciled", { eventId, id: payload.id });
        
        // Merge the canonical data over the optimistic data
        const newData = [...oldData];
        newData[existingMsgIndex] = { ...existing, ...payload };
        return newData;
      }

      // 2. Append new message (from another client or external source)
      logReconciliation("cache_updated", { eventId, id: payload.id, type: "append" });
      return [...oldData, payload];
    });

    // Update conversation list preview
    updateConversationPreview(payload.conversationId, (conv: any) => ({
      last_message_body: payload.content,
      last_message_at: payload.createdAt,
      last_message_direction: payload.sender,
      unread_count: payload.sender === "user" ? (conv.unread_count || 0) + 1 : conv.unread_count
    }));
  };

  // Internal handler for status updates
  const handleStatusUpdated = (event: ChatMessageStatusUpdatedEvent) => {
    const { payload, eventId } = event;
    // 1. Deduplication check via providerMessageId or id
    // Status updates usually match by ID or providerMessageId
    queryClient.setQueryData(["messages", payload.conversationId], (oldData: any[]) => {
      if (!oldData) return oldData;

      const existingMsgIndex = oldData.findIndex(
        (m) => m.id === payload.id
      );

      if (existingMsgIndex === -1) {
        logReconciliation("cache_miss", { eventId, id: payload.id, type: "status_update" });
        return oldData;
      }

      const existing = oldData[existingMsgIndex];

      // 2. Status ranking protection (don't downgrade read -> delivered)
      const currentRank = STATUS_RANK[existing.status as keyof typeof STATUS_RANK] ?? 0;
      const newRank = STATUS_RANK[payload.status as keyof typeof STATUS_RANK] ?? 0;

      if (newRank < currentRank && payload.status !== "failed") {
        logReconciliation("status_ignored", { eventId, id: payload.id, current: existing.status, new: payload.status });
        return oldData;
      }

      logReconciliation("cache_updated", { eventId, id: payload.id, type: "status_update", status: payload.status });

      const newData = [...oldData];
      newData[existingMsgIndex] = { ...existing, status: payload.status, updatedAt: payload.updatedAt };
      return newData;
    });

    // Update conversation list preview
    updateConversationPreview(payload.conversationId, {
      last_message_status: payload.status
    });
  };

  // Helper to update the conversation list preview
  const updateConversationPreview = (conversationId: string, updates: any | ((conv: any) => any)) => {
    queryClient.setQueriesData({ queryKey: ["conversations"] }, (oldData: any) => {
      if (!oldData || !oldData.pages) return oldData; // React Query infinite query structure
      return {
        ...oldData,
        pages: oldData.pages.map((page: any[]) => 
          page.map(conv => {
            if (conv.id === conversationId) {
              const newFields = typeof updates === "function" ? updates(conv) : updates;
              return { ...conv, ...newFields };
            }
            return conv;
          })
        )
      };
    });
  };

  // Subscribe to Ably events
  useRealtimeSubscription(tenantId, (event: ProjectionEvent) => {
    switch (event.type) {
      case "chat.message.created":
        handleMessageCreated(event as ChatMessageCreatedEvent);
        break;
      case "chat.message.status_updated":
        handleStatusUpdated(event as ChatMessageStatusUpdatedEvent);
        break;
      default:
        // Future extensions (ai.stream.delta, etc.)
        break;
    }
  });
}
