import { useEffect, useState } from "react";
import * as Ably from "ably";
import { getSharedAblyClient } from "./use-realtime-subscription";

export interface PresenceMember {
  clientId: string;
  data: any;
  action: "present" | "enter" | "leave" | "update";
}

export function usePresence(tenantId: string, channelName: string) {
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [isTyping, setIsTyping] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!tenantId || !channelName || typeof window === "undefined") return;

    const client = getSharedAblyClient(tenantId);
    if (!client) return;

    const channel = client.channels.get(channelName);

    const onPresence = (message: Ably.PresenceMessage) => {
      setMembers((prev) => {
        const otherMembers = prev.filter((m) => m.clientId !== message.clientId);
        if (message.action === "leave") return otherMembers;

        return [...otherMembers, {
          clientId: message.clientId,
          data: message.data,
          action: message.action as any,
        }];
      });

      // Handle typing status specifically
      if (message.data?.typing !== undefined) {
        setIsTyping((prev) => ({
          ...prev,
          [message.clientId]: message.data.typing
        }));
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
  }, [tenantId, channelName]);

  const updatePresence = async (data: any) => {
    const client = getSharedAblyClient(tenantId);
    if (!client) return;
    const channel = client.channels.get(channelName);
    await channel.presence.update(data);
  };

  const setTypingStatus = async (typing: boolean) => {
    await updatePresence({ typing });
  };

  return { members, isTyping, setTypingStatus, updatePresence };
}
