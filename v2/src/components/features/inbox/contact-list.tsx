"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Check, CheckCheck, Clock, WifiOff, MessageCircle } from "lucide-react";
import { getConversations, togglePin, markConversationRead } from "@/app/actions/inbox";
import { useInboxStore } from "@/store/inbox-store";
import { useDiagnosticsStore } from "@/lib/realtime/diagnostics-store";
import { getCountryFromPhone, normalizeCountryName, getCountryFlag } from "@/lib/utils/country";

function getInitialsColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 35%)`; // Premium elegant color
}

function getInitials(name: string) {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return "Q";
  const parts = clean.split(' ');
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

interface InitialsAvatarProps {
  name: string;
  channel: string;
  unread: number;
}

function InitialsAvatar({ name, channel, unread }: InitialsAvatarProps) {
  const initials = getInitials(name);
  const bgColor = getInitialsColor(name);

  // Overlay channel color badge
  const channelColors: Record<string, string> = {
    whatsapp: "#25D366", // WhatsApp Green
    instagram: "#E1306C", // Instagram Pink/Purple
    messenger: "#1877F2", // Messenger Blue
  };
  const badgeColor = channelColors[channel] || "#8E8E93";

  return (
    <div className="relative mt-1 shrink-0 select-none">
      <div 
        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[13px] font-bold shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
        style={{ backgroundColor: bgColor }}
      >
        {initials}
      </div>
      
      {/* Channel overlay badge */}
      <span 
        className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white shadow-sm flex items-center justify-center text-[7px] font-black text-white uppercase"
        style={{ backgroundColor: badgeColor }}
      >
        {channel === 'whatsapp' && 'w'}
        {channel === 'instagram' && 'i'}
        {channel === 'messenger' && 'f'}
      </span>

      {unread > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 text-white text-[9px] font-bold px-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full border-2 border-white shadow-sm"
          style={{ background: "var(--q-red, #FF3B30)" }}
        >
          {unread}
        </span>
      )}
    </div>
  );
}

function formatMessagePreview(text: string | null) {
  if (!text) return "";
  
  if (text.startsWith("📷 Fotoğraf") || text.includes("Fotoğraf")) return "📷 Fotoğraf";
  if (text.startsWith("🎬 Video") || text.includes("Video")) return "🎬 Video";
  if (text.startsWith("🎵 Ses kaydı") || text.startsWith("🎤 Sesli mesaj") || text.includes("Ses kaydı") || text.includes("Sesli mesaj")) return "🎵 Ses kaydı";
  if (text.startsWith("📎 Belge") || text.startsWith("📄 Belge") || text.includes("Belge") || text.includes("pdf") || text.includes("doc")) return "📄 Belge";
  if (text.startsWith("📍 Konum") || text.includes("Konum")) return "📍 Konum";
  if (text.startsWith("🏷️ Sticker") || text.includes("Sticker")) return "🏷️ Sticker";
  
  return text;
}

// ==========================================
// CONTACT RAIL — Left navigation panel
// Architecture: Navigation system (not display component)
// Authority: Contact list, filtering, search
// Governance: Token-native, skeleton-first, q-glass
// ==========================================

// -- Skeleton --
function ContactSkeleton() {
  return (
    <div className="p-3.5 rounded-2xl flex items-start gap-3.5">
      <div className="w-8 h-8 rounded-full q-skeleton shrink-0 mt-1" />
      <div className="flex-1 space-y-2">
        <div className="flex justify-between">
          <div className="h-3.5 w-24 q-skeleton rounded" />
          <div className="h-3 w-10 q-skeleton rounded" />
        </div>
        <div className="h-3 w-36 q-skeleton rounded" />
        <div className="h-4 w-16 q-skeleton rounded" />
      </div>
    </div>
  );
}

// -- Channel filter chips --
const CHANNEL_FILTERS = [
  { id: "all", label: "Tümü", color: "var(--q-blue)", shadow: "rgba(0,122,255,0.3)" },
  { id: "whatsapp", label: "WhatsApp", color: "var(--q-whatsapp)", shadow: "rgba(37,211,102,0.3)" },
  { id: "instagram", label: "Instagram", color: "var(--q-instagram)", shadow: "rgba(225,48,108,0.3)" },
  { id: "messenger", label: "Facebook", color: "var(--q-blue)", shadow: "rgba(24,119,242,0.3)" },
] as const;

// -- Channel icon by type --
function ChannelIcon({ channel }: { channel: string }) {
  const colorMap: Record<string, string> = {
    whatsapp: "var(--q-whatsapp)",
    instagram: "var(--q-instagram)",
    messenger: "var(--q-blue)",
  };
  const color = colorMap[channel] || "var(--q-text-secondary)";

  if (channel === "whatsapp") {
    return <MessageCircle className="w-8 h-8 opacity-80" style={{ color }} />;
  }
  if (channel === "instagram") {
    return (
      <svg className="w-8 h-8 opacity-80" style={{ color }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    );
  }
  if (channel === "messenger") {
    return (
      <svg className="w-8 h-8 opacity-80" style={{ color }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
    );
  }
  return <MessageCircle className="w-8 h-8 opacity-80" style={{ color }} />;
}



// -- Stage label map (covers both lead-system and opportunity-system stages) --
function stageLabel(stage: string | undefined): string {
  const map: Record<string, string> = {
    // Lead system stages
    new: "Yeni Lead", contacted: "İletişime Geçildi", responded: "Yanıt Alındı",
    discovery: "Keşif / Bilgi", qualified: "Nitelikli", appointed: "Randevu Aldı", lost: "Kaybedildi",
    // Opportunity system stages (fallback — should not appear if mirror is correct)
    new_lead: "Yeni Lead", first_contact: "İlk İletişim", engaged: "Yanıt Alındı",
    report_waiting: "Rapor Bekleniyor", report_received: "Rapor Geldi",
    doctor_review: "Doktor İncelemesi", offer_sent: "Teklif Gönderildi",
    appointment_planning: "Randevu Planlanıyor", appointment_booked: "Randevu Alındı",
    arrived: "Geldi", not_qualified: "Uygun Değil",
  };
  return map[stage || "new"] || stage || "Yeni Lead";
}

export function ContactRail() {
  const { activePhone, activeContact, setActiveContact, mobileView } = useInboxStore();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const deepLinkContact = searchParams.get('contact');
  const [filter, setFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const isRealtimeDown = useDiagnosticsStore((state) => state.isRealtimeDown);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  useEffect(() => {
    if (errorToast) {
      const timer = setTimeout(() => setErrorToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [errorToast]);

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["conversations", debouncedSearch, stageFilter],
    queryFn: ({ pageParam = 1 }) => getConversations(pageParam, debouncedSearch, stageFilter),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage) || !Array.isArray(allPages)) return undefined;
      return lastPage.length === 50 ? allPages.length + 1 : undefined;
    },
    // Realtime operates now, fallback polling if disconnected
    refetchInterval: isRealtimeDown ? 10000 : false,
    staleTime: Infinity,
    // GC: evict stale conversation pages after 10 minutes
    gcTime: 10 * 60 * 1000,
  });

  const contacts = data?.pages ? data.pages.flat() : [];
  const isLoadingMore = isFetchingNextPage || isLoading;
  const isReachingEnd = !hasNextPage;

  // Deep link: auto-select contact from notification click
  useEffect(() => {
    if (deepLinkContact && contacts.length > 0 && !activePhone) {
      const target = contacts.find((c: any) => c.id === deepLinkContact);
      if (target) {
        setActiveContact(target.id, { ...target, unread: 0 });
        // Clean up URL
        const currentPath = window.location.pathname;
        router.replace(currentPath, { scroll: false });
      }
    }
  }, [deepLinkContact, contacts, activePhone, setActiveContact, router]);

  // Reactively sync updated CRM data/messages to the active contact
  useEffect(() => {
    if (activePhone && contacts.length > 0) {
      const updatedContact = contacts.find((c: any) => c.id === activePhone);
      if (updatedContact) {
        // Compare important fields or just deep compare to avoid infinite loops
        // Easiest is to stringify, though we only care if tags, stage, department, country or messages changed.
        const currentDataStr = JSON.stringify({
          stage: activeContact?.stage,
          department: activeContact?.department,
          country: activeContact?.country,
          tags: activeContact?.tags,
          score: activeContact?.score,
          last_message: activeContact?.last_message,
          unread: activeContact?.unread,
          ai_summary: activeContact?.ai_summary,
          aiSummary: activeContact?.aiSummary,
          name: activeContact?.name,
          opp_requester_name: activeContact?.opp_requester_name,
          opp_patient_name: activeContact?.opp_patient_name
        });
        
        const updatedDataStr = JSON.stringify({
          stage: updatedContact.stage,
          department: updatedContact.department,
          country: updatedContact.country,
          tags: updatedContact.tags,
          score: updatedContact.score,
          last_message: updatedContact.last_message,
          unread: updatedContact.unread,
          ai_summary: updatedContact.ai_summary,
          aiSummary: updatedContact.aiSummary,
          name: updatedContact.name,
          opp_requester_name: updatedContact.opp_requester_name,
          opp_patient_name: updatedContact.opp_patient_name
        });

        if (currentDataStr !== updatedDataStr) {
          useInboxStore.getState().updateActiveContact(updatedContact);
        }
      }
    }
  }, [contacts, activePhone, activeContact]);

  // Reset unread count for the active conversation in the cache
  useEffect(() => {
    if (activePhone && contacts.length > 0) {
      const activeConv = contacts.find((c: any) => c.id === activePhone);
      if (activeConv && activeConv.unread > 0) {
        queryClient.setQueriesData({ queryKey: ["conversations"] }, (oldData: any) => {
          if (!oldData || !oldData.pages) return oldData;
          const newPages = oldData.pages.map((page: any[]) =>
            page.map(conv => {
              if (conv.id === activePhone) {
                return { ...conv, unread: 0 };
              }
              return conv;
            })
          );
          return { ...oldData, pages: newPages };
        });
      }
    }
  }, [activePhone, contacts, queryClient]);

  // Mark conversation read in database when active conversation is selected
  useEffect(() => {
    if (activePhone) {
      markConversationRead(activePhone).then((res) => {
        if (res?.success) {
          // Trigger local refresh event for the sidebar global count
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
          }
        }
      });
    }
  }, [activePhone]);

  const handleTogglePin = async (phone: string) => {
    try {
      const res = await togglePin(phone) as any;
      if (res.success) {
        // Mutate the query cache instantly
        queryClient.setQueriesData({ queryKey: ["conversations"] }, (oldData: any) => {
          if (!oldData || !oldData.pages) return oldData;
          
          const newPages = oldData.pages.map((page: any[]) =>
            page.map(conv => {
              if (conv.id === phone) {
                return { ...conv, isPinned: res.isPinned };
              }
              return conv;
            })
          );

          // Re-sort the cache pages in-place instantly
          const flattened = newPages.flat();
          flattened.sort((a: any, b: any) => {
            const aPinned = !!a.isPinned;
            const bPinned = !!b.isPinned;
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime();
          });

          const pageSize = 50;
          const sortedPages = [];
          for (let i = 0; i < flattened.length; i += pageSize) {
            sortedPages.push(flattened.slice(i, i + pageSize));
          }
          return { ...oldData, pages: sortedPages };
        });
      } else {
        setErrorToast(res.error || "Sabitleme işlemi başarısız.");
      }
    } catch (err) {
      console.error("Pin toggle error:", err);
    }
  };

  return (
    <div className={`w-full md:w-80 border-r flex-col h-full z-10 q-glass shadow-sm ${mobileView === "list" ? "flex" : "hidden md:flex"}`}
      style={{ borderColor: "var(--q-border-default)" }}
    >
      {/* ── Header ── */}
      <div className="p-5 pb-3">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight" style={{ color: "var(--q-text-primary)" }}>Mesajlar</h2>
            {isRealtimeDown && (
              <div
                id="offline-sync-status"
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase transition-all duration-300 animate-pulse cursor-help"
                style={{
                  background: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                  color: "#ef4444",
                }}
                title="Canlı bağlantı kesildi. Polling moduna geçildi (veriler 10 saniyede bir güncelleniyor)."
              >
                <WifiOff className="w-2.5 h-2.5" />
                <span>Çevrimdışı</span>
              </div>
            )}
          </div>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="bg-transparent text-xs font-semibold outline-none cursor-pointer appearance-none text-right pr-2"
            style={{ color: "var(--q-blue)" }}
          >
            <option value="all">Tüm Aşamalar</option>
            <option value="new">Yeni Lead</option>
            <option value="contacted">İletişime Geçildi</option>
            <option value="responded">Yanıt Alındı</option>
            <option value="discovery">Keşif / Bilgi</option>
            <option value="appointed">Randevu Aldı</option>
            <option value="lost">Kaybedildi</option>
          </select>
        </div>

        {/* Search */}
        <div className="relative group">
          <Search className="absolute left-3 top-3 h-4 w-4 transition-colors" style={{ color: "var(--q-text-secondary)" }} />
          <input
            type="text"
            placeholder="İsim veya numara ara..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none transition-all"
            style={{
              background: "rgba(255,255,255,0.5)",
              border: "1px solid var(--q-border-default)",
              color: "var(--q-text-primary)",
            }}
          />
        </div>
      </div>

      {/* ── Channel Chips ── */}
      <div className="flex px-5 py-2 space-x-2 overflow-x-auto pb-4 no-scrollbar">
        {CHANNEL_FILTERS.map((ch) => (
          <button
            key={ch.id}
            onClick={() => setFilter(ch.id)}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap transition-all duration-200 q-press"
            style={
              filter === ch.id
                ? { background: ch.color, color: "white", boxShadow: `0 2px 8px ${ch.shadow}` }
                : { background: "rgba(255,255,255,0.5)", color: "var(--q-text-secondary)", border: "1px solid var(--q-border-default)" }
            }
          >
            {ch.label}
          </button>
        ))}
      </div>

      {/* ── Contact List ── */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5">
        {isLoading ? (
          <div className="flex flex-col gap-3 p-2">
            {[1, 2, 3, 4, 5].map((i) => <ContactSkeleton key={i} />)}
          </div>
        ) : (
          <div className="q-stagger">
            {(contacts || [])
              .filter((c: any) => filter === "all" || c.channel === filter)
              .map((c: any) => {
                let senderPrefix = "";
                if (c.lastMessageDirection === 'out') {
                  if (c.lastMessageModel) {
                    senderPrefix = "AI: ";
                  } else {
                    senderPrefix = "Sen: ";
                  }
                }
                
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveContact(c.id, { ...c, unread: 0 })}
                    className="w-full text-left p-3.5 rounded-2xl transition-all duration-200 flex items-start gap-3.5 border q-list-item group"
                    style={{
                      backgroundColor: activePhone === c.id ? "var(--q-bg-primary)" : "transparent",
                      borderColor: activePhone === c.id ? "var(--q-border-default)" : "transparent",
                      boxShadow: activePhone === c.id ? "var(--q-shadow-sm)" : "none",
                    }}
                  >
                    {/* Initials Avatar */}
                    <InitialsAvatar name={c.name || c.id} channel={c.channel} unread={c.unread} />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <div className="flex items-center min-w-0 flex-1 mr-2">
                          <span className="font-bold text-[14px] truncate" style={{ color: "var(--q-text-primary)" }}>
                            {c.name || c.id}
                          </span>
                          {(() => {
                            // Country priority: DB (AI-extracted) > phone prefix (deterministic guess)
                            // Medical tourism: patient may have +90 phone but live in Germany
                            const cn = c.country ? normalizeCountryName(c.country) : '';
                            const country = (c.country ? { flag: getCountryFlag(cn), name: cn, code: '' } : null) || getCountryFromPhone(c.id);
                            return country ? (
                              <span className="ml-1.5 inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-black/[0.04] text-[10px] font-semibold flex-shrink-0" style={{ color: 'var(--q-text-secondary)' }}>
                                {country.flag} {country.name}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </div>
                      <p
                        className={`text-[13px] truncate flex items-center gap-1.5 ${c.unread > 0 ? "font-bold" : "font-medium"}`}
                        style={{ color: c.unread > 0 ? "var(--q-text-primary)" : "var(--q-text-secondary)" }}
                      >
                        {(c.lastMessageDirection === 'out' || c.lastMessageDirection === 'system') && (
                          <span className="flex-shrink-0 opacity-70">
                            {(!c.lastMessageStatus || c.lastMessageStatus === 'pending') && <Clock className="w-3.5 h-3.5" />}
                            {c.lastMessageStatus === 'sent' && <Check className="w-4 h-4" />}
                            {c.lastMessageStatus === 'delivered' && <CheckCheck className="w-4 h-4" />}
                            {c.lastMessageStatus === 'read' && <CheckCheck className="w-4 h-4" style={{ color: "var(--q-blue)" }} />}
                          </span>
                        )}
                        <span className="truncate">{senderPrefix}{formatMessagePreview(c.last_message)}</span>
                      </p>
                      <div className="flex gap-2 mt-2">
                        <span
                          className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded shadow-sm"
                          style={{ background: "var(--q-bg-primary)", border: "1px solid var(--q-border-default)", color: "var(--q-text-secondary)" }}
                        >
                          {stageLabel(c.stage)}
                        </span>
                        {!c.isBotActive && (
                          <span
                            className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded shadow-sm"
                            style={{ background: "var(--q-blue-bg)", color: "var(--q-blue)", border: "1px solid rgba(0,122,255,0.2)" }}
                          >
                            Sen
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Date and Pin Toggle */}
                    <div className="flex flex-col items-end justify-between self-stretch shrink-0 min-h-[44px]">
                      <span className="text-[10px] font-semibold tracking-wide whitespace-nowrap" style={{ color: "var(--q-text-secondary)" }}>
                        {c.formattedTime}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePin(c.id);
                        }}
                        className={`p-1 rounded-lg hover:bg-black/5 transition-all text-xs ${
                          c.isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-60 hover:opacity-100"
                        }`}
                        title={c.isPinned ? "Sabitlemeyi Kaldır" : "Sabitle"}
                      >
                        📌
                      </button>
                    </div>
                  </button>
                );
              })}
          </div>
        )}

        {/* Load More */}
        {!isLoading && !isReachingEnd && contacts.length > 0 && (
          <button
            onClick={() => fetchNextPage()}
            disabled={isLoadingMore}
            className="w-full py-3 mt-2 text-sm font-semibold rounded-xl transition-all disabled:opacity-50 q-press"
            style={{ color: "var(--q-blue)", background: "rgba(255,255,255,0.5)", border: "1px solid var(--q-border-default)" }}
          >
            {isLoadingMore ? "Yükleniyor..." : "Daha Fazla Yükle"}
          </button>
        )}
      </div>
      {errorToast && (
        <div className="fixed bottom-5 left-5 z-[9999] px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold animate-in fade-in slide-in-from-bottom-5 duration-300"
             style={{ background: "var(--q-red)", color: "white", borderColor: "rgba(255,255,255,0.1)" }}>
          {errorToast}
        </div>
      )}
    </div>
  );
}
