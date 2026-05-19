import { useEffect, useState, useRef, useCallback } from "react";
import * as Ably from "ably";
import { getSharedAblyClient } from "./use-realtime-subscription";
import { usePresenceStore, AgentType } from "@/lib/realtime/presence-store";

export interface PresenceMember {
  clientId: string;
  data: any;
  action: "present" | "enter" | "leave" | "update";
}

export function usePresence(tenantId: string, channelName: string) {
  const [members, setMembers] = useState<PresenceMember[]>([]);

  const setTyping = usePresenceStore((state) => state.setTyping);
  const getTypingClients = usePresenceStore((state) => state.getTypingClients);
  
  // Re-render when typing state changes for this specific channel
  const typingClients = usePresenceStore((state) => {
    const channelState = state.typingStates[channelName] || {};
    return Object.entries(channelState).map(([clientId, data]) => ({
      clientId,
      agentType: data.agentType,
    }));
  });

  const localTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPublishRef = useRef<number>(0);

  useEffect(() => {
    if (!tenantId || !channelName || typeof window === "undefined") return;

    const client = getSharedAblyClient(tenantId);
    if (!client) return;

    const channel = client.channels.get(channelName);

    const onPresence = (message: Ably.PresenceMessage) => {
      // Update global members list
      setMembers((prev) => {
        const otherMembers = prev.filter((m) => m.clientId !== message.clientId);
        if (message.action === "leave") return otherMembers;

        return [...otherMembers, {
          clientId: message.clientId,
          data: message.data,
          action: message.action as any,
        }];
      });

      // Handle structured typing state
      if (message.data?.typing !== undefined) {
        setTyping(
          channelName, 
          message.clientId, 
          message.data.typing, 
          message.data.agentType || "human"
        );
      }
      
      // Cleanup ghost typing immediately if user explicitly leaves
      if (message.action === "leave") {
        setTyping(channelName, message.clientId, false);
      }
    };

    // Subscribe to presence events
    channel.presence.subscribe(["enter", "present", "leave", "update"], onPresence);

    // Initial fetch of present members
    channel.presence.get().then((presenceSet) => {
      if (presenceSet) {
        setMembers(presenceSet.map(msg => ({
          clientId: msg.clientId,
          data: msg.data,
          action: msg.action as any
        })));
      }
    }).catch((err) => console.error("Ably presence get error:", err));

    return () => {
      channel.presence.unsubscribe(["enter", "present", "leave", "update"], onPresence);
    };
  }, [tenantId, channelName, setTyping]);

  const updatePresence = async (data: any) => {
    const client = getSharedAblyClient(tenantId);
    if (!client) return;
    const channel = client.channels.get(channelName);
    await channel.presence.update(data);
  };

  // Coalesced & Throttled Typing Publisher
  const setTypingStatus = useCallback(async (isTyping: boolean, agentType: AgentType = "human") => {
    const client = getSharedAblyClient(tenantId);
    if (!client) return;
    const channel = client.channels.get(channelName);

    // 1. Optimistic Local Render (Zero latency UI)
    setTyping(channelName, client.auth.clientId, isTyping, agentType);

    const now = Date.now();

    // 2. Throttled Network Publish
    if (isTyping) {
      if (now - lastPublishRef.current > 1000) {
        lastPublishRef.current = now;
        await channel.presence.update({ typing: true, agentType }).catch(console.error);
      }
      
      // 3. Debounce: Auto-stop after 3s of silence
      if (localTypingTimeoutRef.current) clearTimeout(localTypingTimeoutRef.current);
      localTypingTimeoutRef.current = setTimeout(() => {
        setTypingStatus(false, agentType);
      }, 3000);
      
    } else {
      // Immediate flush when typing stops
      lastPublishRef.current = now;
      if (localTypingTimeoutRef.current) {
        clearTimeout(localTypingTimeoutRef.current);
        localTypingTimeoutRef.current = null;
      }
      await channel.presence.update({ typing: false, agentType }).catch(console.error);
    }
  }, [tenantId, channelName, setTyping]);

  return { members, typingClients, setTypingStatus, updatePresence };
}
