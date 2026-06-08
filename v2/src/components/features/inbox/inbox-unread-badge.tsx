"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { useInboxStore, lastMutationTimes, setLastLocalUnreadBadgeCount, lastLocalUnreadBadgeCount } from "@/store/inbox-store";
import { getGlobalUnreadCount } from "@/app/actions/inbox";

export default function InboxUnreadBadge() {
  const { data: unreadCount, mutate } = useSWR(
    "inbox-global-unread-count",
    () => getGlobalUnreadCount().then(res => {
      const serverCount = res.data || 0;
      const hasRecentMutation = Object.values(lastMutationTimes).some(
        t => Date.now() - t < 4000
      );
      if (hasRecentMutation) {
        console.log(`[READ_STATE_RECONCILE_SKIP_STALE] Skipping unread badge overwrite with stale server count: ${serverCount}`);
        return lastLocalUnreadBadgeCount;
      }
      return serverCount;
    }),
    {
      refreshInterval: 15000, // Fallback revalidation every 15 seconds
      revalidateOnFocus: true,
      dedupingInterval: 2000
    }
  );

  useEffect(() => {
    const handleRefresh = (e: Event) => {
      const customEvent = e as CustomEvent;
      // Deduplicate event processing across multiple instances of the badge component
      if ((customEvent as any)._processed) {
        return;
      }
      (customEvent as any)._processed = true;

      if (customEvent.detail && typeof customEvent.detail.delta === 'number') {
        const delta = customEvent.detail.delta;
        mutate((currentCount?: number) => {
          const before = typeof currentCount === 'number' ? currentCount : 0;
          const after = Math.max(0, before + delta);
          console.log(`[UNREAD_BADGE_PATCH] before=${before} after=${after} delta=${delta} source=${customEvent.detail?.source} conv=${customEvent.detail?.conversationId}`);
          return after;
        }, { revalidate: true });
      } else {
        mutate();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('inbox-unread-refresh', handleRefresh);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('inbox-unread-refresh', handleRefresh);
      }
    };
  }, [mutate]);

  const count = typeof unreadCount === 'number' ? unreadCount : 0;

  useEffect(() => {
    setLastLocalUnreadBadgeCount(count);
  }, [count]);

  if (count <= 0) return null;

  return (
    <span 
      data-testid="sidebar-inbox-unread-badge"
      className="bg-[--q-red] text-white text-[10px] font-bold min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center shadow-sm select-none"
      style={{
        backgroundColor: "var(--q-red, #FF3B30)",
        color: "white"
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
