import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeSubscription } from "./use-realtime-subscription";
import { ProjectionEvent, ChatMessageCreatedEvent, ChatMessageStatusUpdatedEvent, ConversationMemoryUpdatedEvent } from "@/lib/realtime/contracts";
import { useInboxStore } from "@/store/inbox-store";

// Production-safe logging (stripped in prod via dead-code elimination)
const IS_DEV = process.env.NODE_ENV === "development";

const logReconciliation = (
  action: "ignored_duplicate" | "optimistic_reconciled" | "stale_event_dropped" | "cache_updated" | "cache_miss" | "status_ignored",
  details: any
) => {
  if (IS_DEV) {
    console.log(`[CACHE_MUTATED] [Reconciliation:${action}]`, details);
  }
};

// Status ranking to prevent downgrades
const STATUS_RANK = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: -1,
};

// Unified Projection Mapper to ensure identical logic across Message and Conversation caches
const mapRealtimeMessageToUIProjection = (payload: any) => {
  const date = new Date(payload.createdAt || payload.updatedAt || Date.now());
  const fmtDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
  const now = new Date();
  const diffMs = new Date(fmtDate(now) + "T00:00:00Z").getTime() - new Date(fmtDate(date) + "T00:00:00Z").getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  let formattedTime = '';
  if (diffDays === 0) {
    formattedTime = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
  } else if (diffDays === 1) {
    formattedTime = 'Dün';
  } else if (diffDays > 1 && diffDays < 7) {
    formattedTime = date.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
    formattedTime = formattedTime.charAt(0).toUpperCase() + formattedTime.slice(1);
  } else {
    formattedTime = date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' });
  }

  const status = payload.status || 'delivered';

  return {
    messageData: {
      id: payload.id,
      sender: payload.sender,
      text: payload.content,
      timeMs: date.getTime(),
      status: status
    },
    conversationData: {
      last_message: payload.content,
      lastMessageDirection: payload.sender === 'user' ? 'in' : 'out',
      lastMessageStatus: status,
      formattedTime
    }
  };
};

export function useRealtimeReconciliation(tenantId: string) {
  const queryClient = useQueryClient();

  // Helper to update the conversation list preview
  const updateConversationPreview = (conversationId: string, updates: any | ((conv: any) => any), reorderToTop: boolean = false) => {
    queryClient.setQueriesData({ queryKey: ["conversations"] }, (oldData: any) => {
      if (!oldData || !oldData.pages) return oldData; // React Query infinite query structure

      if (reorderToTop) {
        let targetConv: any = null;
        const newPages = oldData.pages.map((page: any[]) => {
          return page.filter(conv => {
            if (conv.id === conversationId) {
              const newFields = typeof updates === "function" ? updates(conv) : updates;
              targetConv = { ...conv, ...newFields };
              return false; // Remove from current position
            }
            return true;
          });
        });

        if (targetConv && newPages.length > 0) {
          newPages[0].unshift(targetConv); // Prepend to top of first page
        }
        return { ...oldData, pages: newPages };
      } else {
        // Just update in place without reordering
        const newPages = oldData.pages.map((page: any[]) => 
          page.map(conv => {
            if (conv.id === conversationId) {
              const newFields = typeof updates === "function" ? updates(conv) : updates;
              return { ...conv, ...newFields };
            }
            return conv;
          })
        );
        return { ...oldData, pages: newPages };
      }
    });
  };

  // Internal handler for newly created messages
  const handleMessageCreated = (event: ChatMessageCreatedEvent) => {
    const { payload, eventId, entityVersion } = event;
    const queryKey = ["messages", payload.conversationId];
    const projection = mapRealtimeMessageToUIProjection(payload);

    queryClient.setQueryData(queryKey, (oldData: any[]) => {
      if (!oldData) return [projection.messageData]; // Cache miss

      // 1. Deduplication (Optimistic ID or ProviderMessageID)
      let existingMsgIndex = oldData.findIndex((m) => m.id === payload.id);

      // Fallback for optimistic UI matching: match 'temp-' ids by text and sender within 60s window
      if (existingMsgIndex === -1 && payload.sender === 'agent') {
        const payloadTimeMs = new Date(payload.createdAt || Date.now()).getTime();
        existingMsgIndex = oldData.findIndex((m) => 
          String(m.id).startsWith("temp-") && 
          m.sender === payload.sender && 
          m.text === payload.content &&
          Math.abs((m.timeMs || 0) - payloadTimeMs) < 60000
        );
      }

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
        
        // Deterministic merge: canonical (server) data wins over optimistic
        // but preserve any fields the optimistic has that canonical doesn't
        const newData = [...oldData];
        newData[existingMsgIndex] = { ...existing, ...projection.messageData };
        
        // Stable sort: guarantee monotonic ordering by timeMs
        return stableSortMessages(newData);
      }

      // 2. Append new message (from another client or external source)
      logReconciliation("cache_updated", { eventId, id: payload.id, type: "append" });
      
      // Insert with stable sort to handle out-of-order delivery
      return stableSortMessages([...oldData, projection.messageData]);
    });

    // Read the active phone directly from the store to prevent unread count bumps on focused conversation
    const activePhone = useInboxStore.getState().activePhone;
    const isFocused = activePhone === payload.conversationId;

    // Update conversation list preview AND REORDER TO TOP
    updateConversationPreview(payload.conversationId, (conv: any) => {
      let nextUnread = conv.unread || 0;
      if (isFocused) {
        nextUnread = 0;
      } else if (payload.sender === "user") {
        nextUnread = nextUnread + 1;
      }
      return {
        ...projection.conversationData,
        unread: nextUnread
      };
    }, true);
  };

  // Internal handler for status updates
  const handleStatusUpdated = (event: ChatMessageStatusUpdatedEvent) => {
    const { payload, eventId } = event;
    const queryKey = ["messages", payload.conversationId];
    
    // 1. Deduplication check via providerMessageId or id
    queryClient.setQueryData(queryKey, (oldData: any[]) => {
      if (!oldData) return oldData;

      const existingMsgIndex = oldData.findIndex((m) => m.id === payload.id);

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

    // Update conversation list preview (WITHOUT reordering to top, status update doesn't bump the thread)
    updateConversationPreview(payload.conversationId, {
      lastMessageStatus: payload.status
    }, false);
  };

  // Internal handler for memory updates
  const handleMemoryUpdated = (event: ConversationMemoryUpdatedEvent) => {
    const { payload, eventId } = event;
    logReconciliation("cache_updated", { eventId, id: payload.conversationId, type: "memory_update" });

    // Update conversation list preview with new AI summary fields (both snake_case and camelCase objects for strict UI compatibility)
    updateConversationPreview(payload.conversationId, {
      notes: payload.aiSummary, // Instantly sync to CRM notes field per user request
      ai_summary: payload.aiSummary,
      ai_buying_intent: payload.aiBuyingIntent,
      ai_sentiment: payload.aiSentiment,
      aiSummary: payload.aiSummary ? {
        text: payload.aiSummary,
        buying_intent: payload.aiBuyingIntent,
        sentiment: payload.aiSentiment
      } : null
    }, false);
  };

  // Subscribe to Ably events
  useRealtimeSubscription(tenantId, (event: ProjectionEvent) => {
    if (IS_DEV) {
      console.log(`[CLIENT_EVENT_RECEIVED] Received ${event.type} event. [Trace: ${event.traceId}]`, event);
    }
    
    switch (event.type) {
      case "chat.message.created":
        handleMessageCreated(event as ChatMessageCreatedEvent);
        break;
      case "chat.message.status_updated":
        handleStatusUpdated(event as ChatMessageStatusUpdatedEvent);
        break;
      case "conversation.memory_updated":
        handleMemoryUpdated(event as ConversationMemoryUpdatedEvent);
        break;
      default:
        // Future extensions (ai.stream.delta, etc.)
        break;
    }
  });
}

// ─── Stable Sort ───
// Guarantees deterministic message ordering regardless of event arrival order.
// Uses timeMs as primary sort, id as tiebreaker to prevent position jitter.
function stableSortMessages(messages: any[]): any[] {
  return messages.sort((a, b) => {
    const timeDiff = (a.timeMs || 0) - (b.timeMs || 0);
    if (timeDiff !== 0) return timeDiff;
    // Tiebreaker: lexicographic ID comparison for absolute determinism
    return (a.id || "").localeCompare(b.id || "");
  });
}
