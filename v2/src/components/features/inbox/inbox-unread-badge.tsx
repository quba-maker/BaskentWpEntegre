"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { getGlobalUnreadCount } from "@/app/actions/inbox";

export default function InboxUnreadBadge() {
  const { data: unreadCount, mutate } = useSWR(
    "inbox-global-unread-count",
    () => getGlobalUnreadCount().then(res => res.data || 0),
    {
      refreshInterval: 15000, // Fallback revalidation every 15 seconds
      revalidateOnFocus: true,
      dedupingInterval: 2000
    }
  );

  useEffect(() => {
    const handleRefresh = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && typeof customEvent.detail.delta === 'number') {
        const delta = customEvent.detail.delta;
        mutate((currentCount?: number) => {
          const before = typeof currentCount === 'number' ? currentCount : 0;
          const after = Math.max(0, before + delta);
          console.log(`[UNREAD_BADGE_PATCH] before=${before} after=${after} delta=${delta}`);
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

  if (count <= 0) return null;

  return (
    <span 
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
