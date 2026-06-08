import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeSubscription } from "./use-realtime-subscription";
import { ProjectionEvent, ChatMessageCreatedEvent, ChatMessageStatusUpdatedEvent, ConversationMemoryUpdatedEvent } from "@/lib/realtime/contracts";
import { useInboxStore } from "@/store/inbox-store";
import {
  normalizeInfiniteData,
  appendToInfiniteData,
  updateInfiniteDataItem,
  replaceInfiniteDataItems,
  flattenInfiniteData,
} from "@/lib/utils/infinite-query-cache";

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

  let dateLabel = '';
  if (diffDays === 0) {
    dateLabel = 'Bugün';
  } else if (diffDays === 1) {
    dateLabel = 'Dün';
  } else if (diffDays > 1 && diffDays < 7) {
    dateLabel = date.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
    dateLabel = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
  } else {
    dateLabel = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
  }

  const status = payload.status || 'delivered';

  return {
    messageData: {
      id: payload.id,
      sender: payload.sender,
      text: payload.content,
      timeMs: date.getTime(),
      status: status,
      dateLabel,
      // Media fields
      mediaType: payload.mediaType || null,
      mediaUrl: payload.mediaUrl || null,
      mediaMetadata: payload.mediaMetadata || null,
      providerMessageId: payload.providerMessageId || null,
      modelUsed: payload.modelUsed || null,
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
    let matched = false;
    queryClient.setQueriesData({ queryKey: ["conversations"] }, (oldData: any) => {
      if (!oldData || !oldData.pages) return oldData; // React Query infinite query structure

      if (reorderToTop) {
        let targetConv: any = null;
        const newPages = oldData.pages.map((page: any[]) => {
          return page.filter(conv => {
            const isMatch = conv.conversation_id === conversationId || conv.conversationId === conversationId;
            if (isMatch) {
              matched = true;
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
            const isMatch = conv.conversation_id === conversationId || conv.conversationId === conversationId;
            if (isMatch) {
              matched = true;
              const newFields = typeof updates === "function" ? updates(conv) : updates;
              return { ...conv, ...newFields };
            }
            return conv;
          })
        );
        return { ...oldData, pages: newPages };
      }
    });

    if (!matched) {
      if (typeof window !== "undefined") {
        console.log(`[REALTIME_RECONCILIATION_MISS] conversationId=${conversationId} not found in conversation cache, invalidating conversations.`);
      }
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  };

  // Internal handler for newly created messages
  const handleMessageCreated = (event: ChatMessageCreatedEvent) => {
    const { payload, eventId } = event;
    const queryKey = ["messages", payload.conversationId];
    const projection = mapRealtimeMessageToUIProjection(payload);

    const startTime = performance.now();
    let isAppend = false;
    let isDuplicate = false;

    queryClient.setQueryData(queryKey, (oldData: unknown) => {
      const allMessages = flattenInfiniteData<any>(oldData);

      if (allMessages.length === 0) {
        // Cache miss — create new InfiniteData with single message
        logReconciliation("cache_miss", { eventId, id: payload.id });
        isAppend = true;
        return appendToInfiniteData(oldData, projection.messageData);
      }

      // 1. Deduplication (Optimistic ID, Canonical ID, or ProviderMessageID)
      let existingMsgIndex = allMessages.findIndex((m: any) => {
        const matchId = m.id === payload.id;
        const matchProviderId = payload.providerMessageId && m.providerMessageId === payload.providerMessageId;
        return matchId || matchProviderId;
      });

      // Fallback for optimistic UI matching: match 'temp-' / 'temp-media-' ids by mediaUrl or text/sender within 60s window
      if (existingMsgIndex === -1 && payload.sender === 'agent') {
        const payloadTimeMs = new Date(payload.createdAt || Date.now()).getTime();
        existingMsgIndex = allMessages.findIndex((m: any) => {
          const isTemp = String(m.id).startsWith("temp-") || String(m.id).startsWith("temp-media-");
          if (!isTemp || m.sender !== payload.sender) return false;

          // If both have mediaUrl, match them directly (unique blob urls never collide)
          if (payload.mediaUrl && m.mediaUrl && payload.mediaUrl === m.mediaUrl) {
            return true;
          }

          // Text-based fallback
          return m.text === payload.content && Math.abs((m.timeMs || 0) - payloadTimeMs) < 60000;
        });
      }

      if (existingMsgIndex !== -1) {
        isDuplicate = true;
        const existing = allMessages[existingMsgIndex];
        
        // Protect against status downgrade or stale update
        const currentRank = STATUS_RANK[existing.status as keyof typeof STATUS_RANK] ?? 0;
        const newRank = STATUS_RANK[payload.status as keyof typeof STATUS_RANK] ?? 0;

        if (newRank < currentRank && payload.status !== "failed") {
          logReconciliation("stale_event_dropped", { eventId, reason: "Status downgrade attempted", current: existing.status, incoming: payload.status });
          return normalizeInfiniteData(oldData); // Return normalized shape without changes
        }

        logReconciliation("optimistic_reconciled", { eventId, id: payload.id });
        
        // Deterministic merge: canonical (server) data wins over optimistic
        allMessages[existingMsgIndex] = { ...existing, ...projection.messageData };
        
        // Stable sort and rebuild InfiniteData (collapses to single page)
        return replaceInfiniteDataItems(oldData, stableSortMessages(allMessages));
      }

      // 2. Append new message (from another client or external source)
      logReconciliation("cache_updated", { eventId, id: payload.id, type: "append" });
      isAppend = true;
      
      // Insert with stable sort — collapses to single page; pagination re-established on next fetch
      return replaceInfiniteDataItems(oldData, stableSortMessages([...allMessages, projection.messageData]));
    });

    const appendDuration = performance.now() - startTime;

    // Read the active phone directly from the store to prevent unread count bumps on focused conversation
    const store = useInboxStore.getState();
    const activePhone = store.activePhone;
    const activeContact = store.activeContact;
    const isFocused = 
      activeContact?.conversation_id === payload.conversationId ||
      activeContact?.conversationId === payload.conversationId ||
      activePhone === payload.conversationId ||
      activePhone === payload.phoneNumber;

    const conversationIdPrefix = payload.conversationId ? payload.conversationId.substring(0, 8) : "none";
    if (typeof window !== "undefined") {
      console.log(`[REALTIME_APPEND_TRACE] conversationIdPrefix=${conversationIdPrefix} isFocused=${isFocused} appended=${isAppend} duplicate=${isDuplicate} updatedList=true durationMs=${appendDuration.toFixed(2)}`);
    }

    const isReaction = payload.sender === 'system' ||
      payload.mediaMetadata?.native?.message_type === 'reaction' ||
      !!payload.mediaMetadata?.native?.reaction_payload;

    if (!isReaction) {
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

      // Dispatch unread refresh event for global sidebar badge
      if (payload.sender === "user" && !isFocused && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
      }
    }
  };

  // Internal handler for status updates
  const handleStatusUpdated = (event: ChatMessageStatusUpdatedEvent) => {
    const { payload, eventId } = event;
    const queryKey = ["messages", payload.conversationId];
    
    // 1. Deduplication check via providerMessageId or id
    queryClient.setQueryData(queryKey, (oldData: unknown) => {
      const allMessages = flattenInfiniteData<any>(oldData);
      if (allMessages.length === 0) return normalizeInfiniteData(oldData);

      const existingMsgIndex = allMessages.findIndex((m: any) => m.id === payload.id);

      if (existingMsgIndex === -1) {
        logReconciliation("cache_miss", { eventId, id: payload.id, type: "status_update" });
        return normalizeInfiniteData(oldData);
      }

      const existing = allMessages[existingMsgIndex];

      // 2. Status ranking protection (don't downgrade read -> delivered)
      const currentRank = STATUS_RANK[existing.status as keyof typeof STATUS_RANK] ?? 0;
      const newRank = STATUS_RANK[payload.status as keyof typeof STATUS_RANK] ?? 0;

      if (newRank < currentRank && payload.status !== "failed") {
        logReconciliation("status_ignored", { eventId, id: payload.id, current: existing.status, new: payload.status });
        return normalizeInfiniteData(oldData);
      }

      logReconciliation("cache_updated", { eventId, id: payload.id, type: "status_update", status: payload.status });

      // Update in-place using the helper to preserve InfiniteData shape
      return updateInfiniteDataItem(
        oldData,
        (m: any) => m.id === payload.id,
        (m: any) => ({ ...m, status: payload.status, updatedAt: payload.updatedAt })
      );
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
    // CRITICAL: DO NOT set `notes` here — notes is the coordinator's manual notes field.
    // AI summary must only update ai_summary / aiSummary / legacy_ai_summary fields.
    // Setting notes here would overwrite coordinator's manual notes with AI-generated text (P1.4-HF1).
    updateConversationPreview(payload.conversationId, {
      ai_summary: payload.aiSummary,
      ai_buying_intent: payload.aiBuyingIntent,
      ai_sentiment: payload.aiSentiment,
      legacy_ai_summary: payload.aiSummary,
      aiSummary: payload.aiSummary ? {
        text: payload.aiSummary,
        buying_intent: payload.aiBuyingIntent,
        sentiment: payload.aiSentiment
      } : null
    }, false);
  };

  // Internal handler for autopilot updates
  const handleAutopilotUpdated = (event: any) => {
    const { payload, eventId } = event;
    logReconciliation("cache_updated", { eventId, id: payload.conversationId, type: "autopilot_update" });

    // Update conversation in query cache
    updateConversationPreview(payload.conversationId, {
      autopilot_enabled: payload.enabled,
      status: payload.status,
      isBotActive: payload.enabled
    }, false);

    // If this is the active contact, also update store state to sync UI
    const store = useInboxStore.getState();
    const isThisContact = store.activePhone === payload.phone || 
                         store.activeContact?.conversation_id === payload.conversationId ||
                         store.activeContact?.conversationId === payload.conversationId ||
                         store.activePhone === payload.conversationId;
    if (isThisContact) {
      if (store.activeContact) {
        store.setActiveContact(store.activePhone!, {
          ...store.activeContact,
          isBotActive: payload.enabled
        });
      }
    }
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
      case "conversation.autopilot_updated":
        handleAutopilotUpdated(event);
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
