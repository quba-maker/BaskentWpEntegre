import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useRealtimeSubscription } from "./use-realtime-subscription";
import { 
  ProjectionEvent, 
  ChatMessageCreatedEvent, 
  ChatMessageStatusUpdatedEvent, 
  ConversationMemoryUpdatedEvent 
} from "@/lib/realtime/contracts";
import { useInboxStore } from "@/store/inbox-store";
import { markConversationRead } from "@/app/actions/inbox";
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

export function useRealtimeReconciliation(tenantId: string, userId?: string) {
  const queryClient = useQueryClient();

  const activeConvIdRef = useRef<string | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Read active fields from Zustand hook
  const activeContact = useInboxStore((state) => state.activeContact);
  const activePhone = useInboxStore((state) => state.activePhone);
  const activeContactId = activeContact?.conversation_id || activeContact?.conversationId || activePhone || null;

  useEffect(() => {
    // If active conversation changes, immediately clear any pending debounce timeout
    if (activeContactId !== activeConvIdRef.current) {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
      activeConvIdRef.current = activeContactId;
    }
  }, [activeContactId]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Helper to update the conversation list preview
  const updateConversationPreview = (conversationId: string, updates: any | ((conv: any) => any), reorderToTop: boolean = false) => {
    let matched = false;
    const queries = queryClient.getQueriesData({ queryKey: ["conversations"] });

    for (const [queryKey, oldData] of queries) {
      if (!oldData || !(oldData as any).pages) continue;

      const [_, search, primaryFilter, replyFilter, channelFilter, stageFilter] = queryKey as any;

      let queryMatched = false;
      const newPages = (oldData as any).pages.map((page: any[]) => {
        const updatedPage = page.map(conv => {
          const isMatch = conv.conversation_id === conversationId || conv.conversationId === conversationId || conv.id === conversationId;
          if (isMatch) {
            matched = true;
            queryMatched = true;
            const newFields = typeof updates === "function" ? updates(conv) : updates;
            return { ...conv, ...newFields };
          }
          return conv;
        });

        // Filter out items that no longer match the active query parameters
        return updatedPage.filter(c => {
          if (primaryFilter === "unread" && c.unread <= 0) return false;
          if (primaryFilter === "bot_active" && !(c.isBotActive || c.status === "bot")) return false;
          if (primaryFilter === "favorites" && !c.isFavorite) return false;

          const isArchivedFilter = stageFilter === "archived";
          if (isArchivedFilter && !c.isArchived) return false;
          if (!isArchivedFilter && c.isArchived) return false;

          return true;
        });
      });

      if (queryMatched) {
        // Flatten and sort pages based on pinning and time
        const flattened = newPages.flat();
        flattened.sort((a: any, b: any) => {
          const aPinned = !!a.isPinned;
          const bPinned = !!b.isPinned;
          if (aPinned && !bPinned) return -1;
          if (!aPinned && bPinned) return 1;
          
          const aTime = new Date(a.last_message_at || a.lastMessageAt || 0).getTime();
          const bTime = new Date(b.last_message_at || b.lastMessageAt || 0).getTime();
          return bTime - aTime;
        });

        const pageSize = 30; // Matches pagination limit of 30 in getConversations
        const sortedPages = [];
        for (let i = 0; i < flattened.length; i += pageSize) {
          sortedPages.push(flattened.slice(i, i + pageSize));
        }

        queryClient.setQueryData(queryKey, { ...oldData as any, pages: sortedPages });
      }
    }

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
        logReconciliation("cache_miss", { eventId, id: payload.id });
        isAppend = true;
        return appendToInfiniteData(oldData, projection.messageData);
      }

      let existingMsgIndex = allMessages.findIndex((m: any) => {
        const matchId = m.id === payload.id;
        const matchProviderId = payload.providerMessageId && m.providerMessageId === payload.providerMessageId;
        return matchId || matchProviderId;
      });

      if (existingMsgIndex === -1 && payload.sender === 'agent') {
        const payloadTimeMs = new Date(payload.createdAt || Date.now()).getTime();
        existingMsgIndex = allMessages.findIndex((m: any) => {
          const isTemp = String(m.id).startsWith("temp-") || String(m.id).startsWith("temp-media-");
          if (!isTemp || m.sender !== payload.sender) return false;
          if (payload.mediaUrl && m.mediaUrl && payload.mediaUrl === m.mediaUrl) return true;
          return m.text === payload.content && Math.abs((m.timeMs || 0) - payloadTimeMs) < 60000;
        });
      }

      if (existingMsgIndex !== -1) {
        isDuplicate = true;
        const existing = allMessages[existingMsgIndex];
        const currentRank = STATUS_RANK[existing.status as keyof typeof STATUS_RANK] ?? 0;
        const newRank = STATUS_RANK[payload.status as keyof typeof STATUS_RANK] ?? 0;

        if (newRank < currentRank && payload.status !== "failed") {
          logReconciliation("stale_event_dropped", { eventId, reason: "Status downgrade attempted", current: existing.status, incoming: payload.status });
          return normalizeInfiniteData(oldData);
        }

        logReconciliation("optimistic_reconciled", { eventId, id: payload.id });
        allMessages[existingMsgIndex] = { ...existing, ...projection.messageData };
        return replaceInfiniteDataItems(oldData, stableSortMessages(allMessages));
      }

      logReconciliation("cache_updated", { eventId, id: payload.id, type: "append" });
      isAppend = true;
      return replaceInfiniteDataItems(oldData, stableSortMessages([...allMessages, projection.messageData]));
    });

    const appendDuration = performance.now() - startTime;

    const store = useInboxStore.getState();
    const currentActivePhone = store.activePhone;
    const currentActiveContact = store.activeContact;
    const currentActiveContactId = currentActiveContact?.conversation_id || currentActiveContact?.conversationId || currentActivePhone || null;
    const isFocused = 
      currentActiveContact?.conversation_id === payload.conversationId ||
      currentActiveContact?.conversationId === payload.conversationId ||
      currentActivePhone === payload.conversationId ||
      currentActivePhone === payload.phoneNumber;

    const conversationIdPrefix = payload.conversationId ? payload.conversationId.substring(0, 8) : "none";
    if (typeof window !== "undefined") {
      console.log(`[REALTIME_APPEND_TRACE] conversationIdPrefix=${conversationIdPrefix} isFocused=${isFocused} appended=${isAppend} duplicate=${isDuplicate} updatedList=true durationMs=${appendDuration.toFixed(2)}`);
    }

    const isReaction = payload.sender === 'system' ||
      payload.mediaMetadata?.native?.message_type === 'reaction' ||
      !!payload.mediaMetadata?.native?.reaction_payload;

    if (!isReaction) {
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

      if (payload.sender === "user" && !isFocused && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
      }

      if (isFocused && payload.sender === "user" && currentActiveContactId) {
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
        debounceTimeoutRef.current = setTimeout(() => {
          markConversationRead(currentActiveContactId).then((res) => {
            if (res?.success) {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
              }
            }
          });
        }, 1000);
      }
    }
  };

  // Internal handler for status updates
  const handleStatusUpdated = (event: ChatMessageStatusUpdatedEvent) => {
    const { payload, eventId } = event;
    const queryKey = ["messages", payload.conversationId];
    
    queryClient.setQueryData(queryKey, (oldData: unknown) => {
      const allMessages = flattenInfiniteData<any>(oldData);
      if (allMessages.length === 0) return normalizeInfiniteData(oldData);

      const existingMsgIndex = allMessages.findIndex((m: any) => m.id === payload.id);
      if (existingMsgIndex === -1) {
        logReconciliation("cache_miss", { eventId, id: payload.id, type: "status_update" });
        return normalizeInfiniteData(oldData);
      }

      const existing = allMessages[existingMsgIndex];
      const currentRank = STATUS_RANK[existing.status as keyof typeof STATUS_RANK] ?? 0;
      const newRank = STATUS_RANK[payload.status as keyof typeof STATUS_RANK] ?? 0;

      if (newRank < currentRank && payload.status !== "failed") {
        logReconciliation("status_ignored", { eventId, id: payload.id, current: existing.status, new: payload.status });
        return normalizeInfiniteData(oldData);
      }

      logReconciliation("cache_updated", { eventId, id: payload.id, type: "status_update", status: payload.status });
      return updateInfiniteDataItem(
        oldData,
        (m: any) => m.id === payload.id,
        (m: any) => ({ ...m, status: payload.status, updatedAt: payload.updatedAt })
      );
    });

    updateConversationPreview(payload.conversationId, {
      lastMessageStatus: payload.status
    }, false);
  };

  // Internal handler for memory updates
  const handleMemoryUpdated = (event: ConversationMemoryUpdatedEvent) => {
    const { payload, eventId } = event;
    logReconciliation("cache_updated", { eventId, id: payload.conversationId, type: "memory_update" });

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

    updateConversationPreview(payload.conversationId, {
      autopilot_enabled: payload.enabled,
      status: payload.status,
      isBotActive: payload.enabled
    }, false);

    const store = useInboxStore.getState();
    const isThisContact = store.activePhone === payload.phone || 
                         store.activeContact?.conversation_id === payload.conversationId ||
                         store.activeContact?.conversationId === payload.conversationId ||
                         store.activePhone === payload.conversationId;
    if (isThisContact && store.activeContact) {
      store.setActiveContact(store.activePhone!, {
        ...store.activeContact,
        isBotActive: payload.enabled
      });
    }
  };

  // Internal handler for metadata updates
  const handleMetadataUpdated = (event: any) => {
    const { payload, eventId } = event;
    const { conversationId, userId: eventUserId } = payload;
    
    const isCurrentUserEvent = !eventUserId || eventUserId === userId;

    logReconciliation("cache_updated", { eventId, id: conversationId, type: "metadata_update" });

    updateConversationPreview(conversationId, (conv: any) => {
      const updates: any = {};
      
      const isBotActive = payload.isBotActive !== undefined ? payload.isBotActive : payload.autopilotEnabled;
      if (isBotActive !== undefined) {
        updates.autopilot_enabled = isBotActive;
        updates.isBotActive = isBotActive;
      }
      if (payload.status !== undefined) updates.status = payload.status;
      if (payload.lastMessageContent !== undefined) {
        updates.last_message = payload.lastMessageContent;
        updates.lastMessageContent = payload.lastMessageContent;
      }
      if (payload.lastMessageDirection !== undefined) {
        updates.lastMessageDirection = payload.lastMessageDirection;
      }
      if (payload.lastMessageStatus !== undefined) {
        updates.lastMessageStatus = payload.lastMessageStatus;
      }
      if (payload.lastMessageAt !== undefined) {
        updates.last_message_at = payload.lastMessageAt;
        updates.lastMessageAt = payload.lastMessageAt;
      }

      if (isCurrentUserEvent) {
        if (payload.unreadCount !== undefined) {
          updates.unread = payload.unreadCount;
          updates.unreadCount = payload.unreadCount;
        }
        if (payload.isPinned !== undefined) updates.isPinned = payload.isPinned;
        if (payload.isFavorite !== undefined) updates.isFavorite = payload.isFavorite;
        if (payload.isArchived !== undefined) updates.isArchived = payload.isArchived;
      }

      return { ...conv, ...updates };
    }, true);

    const store = useInboxStore.getState();
    const isThisContact = store.activeContact?.conversation_id === conversationId ||
                         store.activeContact?.conversationId === conversationId ||
                         store.activePhone === conversationId;
    if (isThisContact && store.activeContact) {
      const updates: any = {};
      const isBotActive = payload.isBotActive !== undefined ? payload.isBotActive : payload.autopilotEnabled;
      if (isBotActive !== undefined) updates.isBotActive = isBotActive;
      if (payload.status !== undefined) updates.status = payload.status;
      
      if (isCurrentUserEvent) {
        if (payload.unreadCount !== undefined) updates.unread = payload.unreadCount;
        if (payload.isPinned !== undefined) updates.isPinned = payload.isPinned;
        if (payload.isFavorite !== undefined) updates.isFavorite = payload.isFavorite;
        if (payload.isArchived !== undefined) updates.isArchived = payload.isArchived;
      }

      if (Object.keys(updates).length > 0) {
        store.setActiveContact(store.activePhone!, {
          ...store.activeContact,
          ...updates
        });
      }
    }

    if (isCurrentUserEvent && payload.unreadCount !== undefined && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
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
      case "conversation.metadata_updated":
        handleMetadataUpdated(event);
        break;
      default:
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
