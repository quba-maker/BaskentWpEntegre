"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import useSWR from "swr";
import { Bell, Check, CheckCheck, X, ExternalLink } from "lucide-react";
import { getUnreadNotifications, getNotificationCount, markNotificationRead, markAllNotificationsRead } from "@/app/actions/notifications";
import { useRouter, useParams } from "next/navigation";

// ═══════════════════════════════════════════════════════════
// NOTIFICATION CATEGORY CONFIG
// ═══════════════════════════════════════════════════════════

const CATEGORY_CONFIG: Record<string, { icon: string; color: string }> = {
  hot_lead: { icon: '🔥', color: '#FF3B30' },
  appointment_request: { icon: '📅', color: '#5856D6' },
  report_received: { icon: '📄', color: '#30B0C7' },
  appointment_approaching: { icon: '⏰', color: '#FF9500' },
  overdue_task: { icon: '⚠️', color: '#FF3B30' },
  no_response: { icon: '🔕', color: '#8E8E93' },
  bot_error: { icon: '🤖', color: '#FF3B30' },
  coordinator_action: { icon: '👤', color: '#007AFF' },
  callback_requested: { icon: '📞', color: '#5856D6' },
  human_escalation: { icon: '🆘', color: '#FF3B30' },
  system_alert: { icon: '⚡', color: '#FF9500' },
};

const timeAgo = (dateString: string) => {
  if (!dateString) return "";
  const diff = Math.round((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diff < 60) return "Az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
  return `${Math.floor(diff / 86400)} gün önce`;
};

// ═══════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const params = useParams();
  const tenantSlug = typeof params.tenant_slug === 'string' ? params.tenant_slug : '';

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // ── Data ──
  const { data: count, mutate: mutateCount } = useSWR(
    'notification-count',
    () => getNotificationCount(),
    { refreshInterval: 10000 }
  );

  const { data: notifications, mutate: mutateNotifs } = useSWR(
    isOpen ? 'unread-notifications' : null,
    () => getUnreadNotifications(10),
    { refreshInterval: 10000 }
  );

  // ── Actions ──
  const handleRead = useCallback(async (notifId: string) => {
    await markNotificationRead(notifId);
    mutateCount();
    mutateNotifs();
  }, [mutateCount, mutateNotifs]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllNotificationsRead();
    mutateCount();
    mutateNotifs();
  }, [mutateCount, mutateNotifs]);

  const handleClick = useCallback((notif: any) => {
    handleRead(notif.id);

    // Deep link to specific record
    if (notif.opportunity_id) {
      router.push(`/${tenantSlug}/takip?opp=${notif.opportunity_id}`);
    } else if (notif.conversation_id || notif.phone_number) {
      router.push(`/${tenantSlug}/inbox?contact=${encodeURIComponent(notif.phone_number || notif.conversation_id)}`);
    }
    
    setIsOpen(false);
  }, [handleRead, router, tenantSlug]);

  const unreadCount = typeof count === 'number' ? count : 0;
  const items = notifications || [];

  return (
    <div ref={ref} className="relative">
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-black/5 transition-colors"
        aria-label="Bildirimler"
      >
        <Bell className="w-5 h-5 text-[#86868B]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-[#FF3B30] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shadow-md animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <>
        {/* Mobile backdrop */}
        <div className="fixed inset-0 bg-black/20 z-40 md:hidden" onClick={() => setIsOpen(false)} />
        <div className="fixed inset-x-3 top-[60px] max-h-[calc(100vh-80px)] md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[380px] md:max-h-[480px] bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-black/5 flex flex-col z-50 overflow-hidden">
          
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-black/5">
            <h3 className="text-sm font-bold text-[#1D1D1F]">Bildirimler</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-[11px] font-semibold text-[#5856D6] hover:text-[#4A48C4] transition-colors flex items-center gap-1"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Tümünü oku
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors"
              >
                <X className="w-4 h-4 text-[#86868B]" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {items.length > 0 ? (
              items.map((notif: any) => {
                const catConfig = CATEGORY_CONFIG[notif.category] || { icon: '📌', color: '#86868B' };
                return (
                  <div
                    key={notif.id}
                    onClick={() => handleClick(notif)}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02] cursor-pointer transition-colors border-b border-black/[0.03] last:border-b-0"
                  >
                    {/* Icon */}
                    <div 
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 mt-0.5"
                      style={{ backgroundColor: `${catConfig.color}12` }}
                    >
                      {catConfig.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[12px] font-bold text-[#1D1D1F] truncate">{notif.title}</p>
                        {notif.priority === 'high' || notif.priority === 'critical' ? (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-[#FF3B30]/10 text-[#FF3B30]">
                            {notif.priority === 'critical' ? 'KRİTİK' : 'ÖNEMLİ'}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-[#86868B] mt-0.5 line-clamp-2">{notif.body}</p>
                      <p className="text-[10px] text-[#C7C7CC] mt-1">{timeAgo(notif.created_at)}</p>
                    </div>

                    {/* Unread dot */}
                    {!notif.is_read && (
                      <div className="w-2.5 h-2.5 rounded-full bg-[#007AFF] shrink-0 mt-1.5" />
                    )}
                  </div>
                );
              })
            ) : (
              <div className="py-12 text-center">
                <Bell className="w-10 h-10 text-[#C7C7CC] mx-auto mb-2" />
                <p className="text-[#86868B] text-sm font-semibold">Bildirim yok</p>
                <p className="text-[#C7C7CC] text-xs mt-0.5">Tüm bildirimler okunmuş</p>
              </div>
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="border-t border-black/5 px-4 py-2.5">
              <button
                onClick={() => { router.push(`/${tenantSlug}/takip`); setIsOpen(false); }}
                className="w-full text-center text-[12px] font-semibold text-[#5856D6] hover:text-[#4A48C4] transition-colors flex items-center justify-center gap-1"
              >
                Tüm bildirimleri gör
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
