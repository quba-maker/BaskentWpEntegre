"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Check, CheckCheck, Clock, WifiOff, MessageCircle, MoreVertical, Loader2, Sparkles, AlertCircle, X, ChevronLeft, ChevronRight, UserCheck, UserX, Trash2, Sliders, ChevronDown, Bot, User } from "lucide-react";
import { 
  getConversations, 
  togglePin, 
  markConversationRead, 
  markConversationsRead, 
  markConversationsUnread, 
  bulkSetBotMode, 
  prepareBulkFollowUpDrafts,
  sendApprovedFollowUp,
  toggleConversationFavorite,
  archiveConversation,
  unarchiveConversation,
  bulkToggleFavorite,
  bulkArchiveConversations,
  bulkUnarchiveConversations
} from "@/app/actions/inbox";
import { useInboxStore } from "@/store/inbox-store";
import { useDiagnosticsStore } from "@/lib/realtime/diagnostics-store";
import { getCountryFromPhone, normalizeCountryName, getCountryFlag } from "@/lib/utils/country";
import NoReplyAutomationModal from "./no-reply-automation-modal";

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
  lastMessageDirection?: string | null;
  lastMessageModel?: string | null;
}

function InitialsAvatar({ name, channel, unread, lastMessageDirection, lastMessageModel }: InitialsAvatarProps) {
  const initials = getInitials(name);
  const bgColor = getInitialsColor(name);

  // Check if bot is active (only bot overlay, no "sen/user" overlay)
  const isBotActiveMessage = lastMessageDirection === 'out' && !!lastMessageModel;

  // Real WhatsApp, Instagram, Messenger SVG overlays
  const renderChannelBadge = () => {
    if (channel === 'whatsapp') {
      return (
        <span 
          className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border border-white shadow-sm flex items-center justify-center bg-[#25D366]"
          title="WhatsApp"
        >
          <svg className="w-3 h-3 text-white fill-current" viewBox="0 0 24 24">
            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.457L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.42 9.864-9.858.002-2.634-1.023-5.11-2.885-6.974C16.59 1.908 14.11 1.887 11.5 1.887c-5.44 0-9.866 4.418-9.87 9.856 0 1.702.449 3.366 1.305 4.82l-.995 3.637 3.707-.972zm12.338-7.07c-.093-.156-.343-.248-.717-.435-.373-.186-2.208-1.09-2.55-1.214-.343-.124-.593-.186-.843.186-.25.373-.966 1.214-1.184 1.462-.218.248-.435.279-.809.093-.373-.186-1.577-.58-3.003-1.853-1.11-1-.186-2.2-1.186-2.483.373-.093.25-.373.373-.559.124-.186.062-.373-.03-.559-.093-.186-.843-2.03-.966-2.33-.124-.31-.248-.279-.343-.279-.093-.001-.218-.001-.343-.001-.124 0-.343.047-.528.248-.186.202-.715.7-.715 1.707 0 1.007.73 1.984.83 2.122.1.138 1.44 2.214 3.49 3.093.488.209.868.335 1.164.429.49.156.937.134 1.29.08.393-.06 1.214-.496 1.385-.95.17-.456.17-.846.12-.927-.05-.081-.2-.13-.574-.316z"/>
          </svg>
        </span>
      );
    }
    if (channel === 'instagram') {
      return (
        <span 
          className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border border-white shadow-sm flex items-center justify-center bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]"
          title="Instagram"
        >
          <svg className="w-3 h-3 text-white fill-current" viewBox="0 0 24 24">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.051.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
          </svg>
        </span>
      );
    }
    if (channel === 'messenger') {
      return (
        <span 
          className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full border border-white shadow-sm flex items-center justify-center bg-[#0084FF]"
          title="Messenger"
        >
          <svg className="w-3 h-3 text-white fill-current" viewBox="0 0 24 24">
            <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.654V24l4.088-2.254c1.077.3 2.215.465 3.443.465 6.627 0 12-4.975 12-11.111C24 4.974 18.627 0 12 0zm1.293 14.333L10.3 11.23l-3.88 3.103 4.268-4.542 2.993 3.103 3.88-3.103-4.268 4.542z"/>
          </svg>
        </span>
      );
    }
    return null;
  };

  return (
    <div className="relative mt-0.5 shrink-0 select-none">
      <div 
        className="w-12 h-12 rounded-full flex items-center justify-center text-white text-[14px] font-bold shadow-[0_2px_8px_rgba(0,0,0,0.08)] relative"
        style={{ backgroundColor: bgColor }}
      >
        {initials}
        
        {/* Bot overlay icon - only if last message was by bot */}
        {isBotActiveMessage && (
          <span className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-gradient-to-tr from-violet-600 to-indigo-600 border border-white flex items-center justify-center text-[10px] shadow-sm animate-pulse" title="Bot Aktif">
            🤖
          </span>
        )}
      </div>
      
      {/* Channel overlay badge */}
      {renderChannelBadge()}

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

function formatMessagePreview(text: string | null, mediaType?: string | null) {
  if (mediaType) {
    const cleanText = text ? text.replace(/^(📷 Fotoğraf|🎬 Video|🎵 Ses kaydı|🎤 Sesli mesaj|📎 Belge|📄 Belge|📍 Konum|🏷️ Sticker):\s*/i, "").trim() : "";
    if (mediaType.startsWith("image")) return "📷 Fotoğraf" + (cleanText ? `: ${cleanText}` : "");
    if (mediaType.startsWith("video")) return "🎬 Video" + (cleanText ? `: ${cleanText}` : "");
    if (mediaType.startsWith("audio")) return "🎵 Ses kaydı";
    if (mediaType.startsWith("document") || mediaType.startsWith("application")) return "📄 Belge" + (cleanText ? `: ${cleanText}` : "");
    if (mediaType.startsWith("sticker")) return "🏷️ Sticker";
  }

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
  const { 
    activePhone, 
    activeContact, 
    setActiveContact, 
    mobileView,
    isSelectionMode,
    selectedIds,
    setSelectionMode,
    toggleSelected,
    setSelectedIds,
    clearSelection
  } = useInboxStore();
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
  const [isAutomationOpen, setIsAutomationOpen] = useState(false);

  // Bulk UI local states
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    conversationId: string;
    phone: string;
    patientName: string;
    isBotActive: boolean;
    unread: number;
  } | null>(null);

  const [bulkDraftsModal, setBulkDraftsModal] = useState<{
    isOpen: boolean;
    results: any[];
  } | null>(null);
  const [isLoadingBulkDrafts, setIsLoadingBulkDrafts] = useState(false);
  const [bulkActionError, setBulkActionError] = useState<string | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Close context menu on global click
  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

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

  // Selection & Bulk Action Helpers
  const visibleContacts = (contacts || []).filter((c: any) => filter === "all" || c.channel === filter);
  const visibleContactIds = visibleContacts.map((c: any) => c.conversation_id).filter(Boolean);
  const isAllVisibleSelected = visibleContactIds.length > 0 && visibleContactIds.every(id => selectedIds.includes(id));

  const handleToggleSelectAll = () => {
    if (isAllVisibleSelected) {
      const next = selectedIds.filter(id => !visibleContactIds.includes(id));
      setSelectedIds(next);
    } else {
      const uniqueNew = visibleContactIds.filter(id => !selectedIds.includes(id));
      setSelectedIds([...selectedIds, ...uniqueNew]);
    }
  };

  const handleBulkAction = async (action: 'read' | 'unread' | 'bot' | 'manual', ids: string[]) => {
    setBulkActionLoading(true);
    setBulkActionError(null);
    try {
      let res: any;
      if (action === 'read') {
        res = await markConversationsRead(ids);
      } else if (action === 'unread') {
        res = await markConversationsUnread(ids);
      } else if (action === 'bot') {
        res = await bulkSetBotMode(ids, 'bot');
      } else if (action === 'manual') {
        res = await bulkSetBotMode(ids, 'human');
      }

      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
        }
        clearSelection();
      } else {
        setBulkActionError(res.error || "İşlem başarısız.");
        setTimeout(() => setBulkActionError(null), 4000);
      }
    } catch (err: any) {
      setBulkActionError("Sistem hatası. Lütfen tekrar deneyin.");
      setTimeout(() => setBulkActionError(null), 4000);
    }
    setBulkActionLoading(false);
  };

const handleBulkFavorite = async (favorite: boolean) => {
    setBulkActionLoading(true);
    setBulkActionError(null);
    try {
      const res = await bulkToggleFavorite(selectedIds, favorite);
      if (res && res.success) {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        clearSelection();
      } else {
        setBulkActionError((res && res.error) || "İşlem başarısız.");
        setTimeout(() => setBulkActionError(null), 4000);
      }
    } catch (err: any) {
      setBulkActionError("Sistem hatası. Lütfen tekrar deneyin.");
      setTimeout(() => setBulkActionError(null), 4000);
    }
    setBulkActionLoading(false);
  };

const handleBulkArchive = async (archive: boolean) => {
    setBulkActionLoading(true);
    setBulkActionError(null);
    try {
      const res = archive
        ? await bulkArchiveConversations(selectedIds)
        : await bulkUnarchiveConversations(selectedIds);
      if (res && res.success) {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        clearSelection();
      } else {
        setBulkActionError((res && res.error) || "İşlem başarısız.");
        setTimeout(() => setBulkActionError(null), 4000);
      }
    } catch (err: any) {
      setBulkActionError("Sistem hatası. Lütfen tekrar deneyin.");
      setTimeout(() => setBulkActionError(null), 4000);
    }
    setBulkActionLoading(false);
  };

  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [sendingDrafts, setSendingDrafts] = useState<Record<string, boolean>>({});
  const [sentStatus, setSentStatus] = useState<Record<string, 'success' | 'error' | null>>({});

  // Reset edits when bulk modal closes/opens
  useEffect(() => {
    if (bulkDraftsModal?.isOpen) {
      const initialEdits: Record<string, string> = {};
      const initialStatus: Record<string, 'success' | 'error' | null> = {};
      bulkDraftsModal.results.forEach(item => {
        initialEdits[item.conversationId] = item.draft || "";
        initialStatus[item.conversationId] = null;
      });
      setDraftEdits(initialEdits);
      setSentStatus(initialStatus);
      setSendingDrafts({});
    }
  }, [bulkDraftsModal]);

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
    <div className={`w-full md:w-[350px] lg:w-[380px] shrink-0 border-r flex flex-col h-full z-10 q-glass shadow-sm ${mobileView === "list" ? "flex" : "hidden md:flex"}`}
      style={{ borderColor: "var(--q-border-default)" }}
    >
      {/* ── Header ── */}
      <div className="p-5 pb-3">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight" style={{ color: "var(--q-text-primary)" }}>Mesajlar</h2>
            <button
              onClick={() => {
                if (isSelectionMode) {
                  clearSelection();
                } else {
                  setSelectionMode(true);
                }
              }}
              className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all cursor-pointer hover:bg-black/5 active:scale-95"
              style={{
                color: isSelectionMode ? "var(--q-text-secondary)" : "var(--q-blue)",
                borderColor: "var(--q-border-default)",
                background: isSelectionMode ? "rgba(0,0,0,0.02)" : "rgba(0,122,255,0.05)"
              }}
            >
              {isSelectionMode ? "İptal" : "Seç"}
            </button>
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
          <div className="flex items-center gap-1.5">
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="bg-transparent text-xs font-semibold outline-none cursor-pointer appearance-none text-right pr-2"
              style={{ color: "var(--q-blue)" }}
            >
              <option value="all">Tüm Aşamalar</option>
              <option value="unread">Okunmamış</option>
              <option value="noReply">⏳ Cevap Bekleyenler (Tümü)</option>
              <option value="noReply_3h">⏳ Cevap Bekleyenler (3s+)</option>
              <option value="noReply_6h">⏳ Cevap Bekleyenler (6s+)</option>
              <option value="noReply_9h">⏳ Cevap Bekleyenler (9s+)</option>
              <option value="noReply_24h">⏳ Cevap Bekleyenler (24s+)</option>
              <option value="new">Yeni Lead</option>
              <option value="contacted">İletişime Geçildi</option>
              <option value="responded">Yanıt Alındı</option>
              <option value="discovery">Keşif / Bilgi</option>
              <option value="appointed">Randevu Aldı</option>
              <option value="lost">Kaybedildi</option>
            </select>
            <button
              onClick={() => setIsAutomationOpen(true)}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-black/5 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
              title="No-Reply Otomasyon Ayarları"
            >
              <Sliders className="w-3.5 h-3.5" style={{ color: "var(--q-text-secondary)" }} />
            </button>
          </div>
        </div>

        {/* Selection Sub-Header */}
        {isSelectionMode && (
          <div className="px-5 py-2.5 flex justify-between items-center border-b transition-all duration-200" style={{ borderColor: "var(--q-border-default)", background: "rgba(0,122,255,0.02)" }}>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer select-none" style={{ color: "var(--q-text-primary)" }}>
              <input
                type="checkbox"
                checked={isAllVisibleSelected}
                onChange={handleToggleSelectAll}
                className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <span>Tümünü Seç ({visibleContactIds.length})</span>
            </label>
            <span className="text-xs font-bold text-indigo-600">
              {selectedIds.length} Seçildi
            </span>
          </div>
        )}

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

        {/* Segment Quick Filters */}
        <div className="flex p-0.5 mt-2.5 rounded-xl bg-black/[0.04] p-1 gap-1">
          {[
            { id: "all", label: "Tümü" },
            { id: "unread", label: "Okunmamış" },
            { id: "favorites", label: "⭐ Favoriler" },
            { id: "archived", label: "📁 Arşiv" }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setStageFilter(tab.id);
              }}
              className="flex-1 py-1 text-[11px] font-bold rounded-lg transition-all text-center whitespace-nowrap cursor-pointer select-none"
              style={{
                background: stageFilter === tab.id ? "white" : "transparent",
                color: stageFilter === tab.id ? "var(--q-blue)" : "var(--q-text-secondary)",
                boxShadow: stageFilter === tab.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none"
              }}
            >
              {tab.label}
            </button>
          ))}
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
                let senderPrefixNode = null;
                if (c.lastMessageDirection === 'out') {
                  if (c.lastMessageModel) {
                    senderPrefixNode = (
                      <span className="inline-flex items-center gap-0.5 mr-1 text-indigo-600 font-bold select-none align-middle">
                        <Bot className="w-3.5 h-3.5 inline animate-pulse" /> Bot:
                      </span>
                    );
                  } else {
                    senderPrefixNode = (
                      <span className="inline-flex items-center gap-0.5 mr-1 text-gray-500 font-bold select-none align-middle">
                        <User className="w-3.5 h-3.5 inline" /> Sen:
                      </span>
                    );
                  }
                }

                const cn = c.country ? normalizeCountryName(c.country) : '';
                const country = (c.country ? { flag: getCountryFlag(cn), name: cn, code: '' } : null) || getCountryFromPhone(c.id);
                const isEstimated = !c.country || c.country_source === 'phone_prefix';

                const isMenuOpen = contextMenu?.conversationId === c.conversation_id;

                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    aria-selected={activePhone === c.id}
                    onClick={() => {
                      if (isSelectionMode) {
                        toggleSelected(c.conversation_id);
                      } else {
                        setActiveContact(c.id, { ...c, unread: 0 });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (isSelectionMode) {
                          toggleSelected(c.conversation_id);
                        } else {
                          setActiveContact(c.id, { ...c, unread: 0 });
                        }
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        conversationId: c.conversation_id,
                        phone: c.id,
                        patientName: c.name || c.id,
                        isBotActive: !!c.isBotActive,
                        unread: c.unread
                      });
                    }}
                    className={`w-full text-left p-4 rounded-2xl transition-all duration-200 flex items-start gap-3.5 border q-list-item group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF] focus-visible:ring-offset-2 ${
                      isMenuOpen ? "bg-black/[0.03] border-gray-300" : ""
                    }`}
                    style={{
                      backgroundColor: activePhone === c.id ? "var(--q-bg-primary)" : isMenuOpen ? "rgba(0,0,0,0.03)" : "transparent",
                      borderColor: activePhone === c.id ? "var(--q-border-default)" : isMenuOpen ? "var(--q-border-default)" : "transparent",
                      boxShadow: activePhone === c.id ? "var(--q-shadow-sm)" : "none",
                    }}
                  >
                    {/* Checkbox for bulk select */}
                    {isSelectionMode && (
                      <div className="flex items-center pr-1 shrink-0 self-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(c.conversation_id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelected(c.conversation_id);
                          }}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </div>
                    )}

                    {/* Left Column: Avatar + Channel overlay */}
                    <InitialsAvatar 
                      name={c.name || c.id} 
                      channel={c.channel} 
                      unread={0} 
                      lastMessageDirection={c.lastMessageDirection}
                      lastMessageModel={c.lastMessageModel}
                    />

                    {/* Middle Column: Content */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch py-0.5">
                      {/* Name & Indicators Row */}
                      <div className="flex items-center min-w-0 w-full mb-0.5">
                        <span className="font-bold text-[15px] truncate flex-shrink min-w-0" style={{ color: "var(--q-text-primary)" }}>
                          {c.name || c.id}
                        </span>
                        {c.isFavorite && (
                          <span className="ml-1.5 text-[11px] select-none flex-shrink-0" title="Favori">⭐</span>
                        )}
                        {c.isArchived && (
                          <span className="ml-1.5 text-[11px] select-none flex-shrink-0" title="Arşivlenmiş">📁</span>
                        )}
                        {/* Country Flag & Full Name */}
                        {country && (
                          <span 
                            className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 flex-shrink-0 max-w-[120px] truncate"
                            title={`${country.name}${isEstimated ? ' (Tahmini)' : ''}`}
                          >
                            <span>{country.flag}</span>
                            <span className="truncate">{country.name}</span>
                          </span>
                        )}
                      </div>

                      {/* Message Preview Row */}
                      <p
                        className={`text-[13px] truncate flex items-center gap-1.5 ${c.unread > 0 ? "font-bold text-gray-900" : "font-medium text-gray-500"}`}
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
                        <span className="truncate">
                          {senderPrefixNode}
                          {formatMessagePreview(c.last_message, c.lastMessageMediaType)}
                        </span>
                      </p>

                      {/* Status Badges Row (No reply, Bot status, Pipeline Stage) */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2 w-full select-none">
                        {/* No Reply / Follow up alerts */}
                        {c.is_no_reply_eligible && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-50 text-[#FF3B30] border border-red-100 shadow-sm flex-shrink-0">
                            ⏳ {c.no_reply_hours}s cevap yok
                          </span>
                        )}
                        {c.active_task_type && (() => {
                          let label = "Cevap bekliyor";
                          let colorClass = "bg-blue-50 text-[#007AFF] border-blue-100";
                          if (c.active_task_type === 'no_reply_followup' || c.active_task_type === 'bot_handoff_followup') {
                            label = "Takip taslağı";
                            colorClass = "bg-amber-50 text-[#FF9500] border-amber-100";
                          } else if (c.active_task_type === 'template_required_task') {
                            label = "Template gerekli";
                            colorClass = "bg-purple-50 text-[#AF52DE] border-purple-100";
                          }
                          return (
                            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shadow-sm flex-shrink-0 ${colorClass}`}>
                              📋 {label}
                            </span>
                          );
                        })()}

                        {/* Bot Mode */}
                        {c.isBotActive ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-50 text-[#34C759] border border-green-100 shadow-sm flex-shrink-0">
                            <Bot className="w-3 h-3" /> Botta
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-[#007AFF] border border-blue-100 shadow-sm flex-shrink-0">
                            <User className="w-3 h-3" /> Manuel
                          </span>
                        )}

                        {/* Pipeline Stage */}
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-50 text-gray-600 border border-gray-200 shadow-sm flex-shrink-0">
                          {stageLabel(c.stage)}
                        </span>
                      </div>
                    </div>

                    {/* Right Column: Time, Unread, Pin & Chevron Dropdown */}
                    <div className="relative flex flex-col items-end justify-between self-stretch shrink-0 w-16 select-none min-h-[60px] text-right">
                      {/* Top: Time */}
                      <span 
                        className={`text-[10px] tracking-wide whitespace-nowrap transition-all duration-150 pr-7 md:pr-0 md:group-hover:opacity-0 md:group-focus-within:opacity-0 ${
                          c.unread > 0 ? "font-bold text-[#007AFF]" : "font-semibold text-gray-500"
                        }`}
                        style={{ color: c.unread > 0 ? "var(--q-blue, #007AFF)" : "var(--q-text-secondary)" }}
                      >
                        {c.formattedTime}
                      </span>
                      
                      {/* Middle: Chevron Dropdown Trigger */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const rect = e.currentTarget.getBoundingClientRect();
                          
                          // Position guard against screen edges
                          const menuHeight = 220;
                          const menuWidth = 192;
                          const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
                          const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
                          
                          let calculatedX = rect.left;
                          let calculatedY = rect.bottom;
                          
                          if (calculatedX + menuWidth > windowWidth) {
                            calculatedX = windowWidth - menuWidth - 8;
                          }
                          if (calculatedY + menuHeight > windowHeight) {
                            calculatedY = rect.top - menuHeight;
                          }

                          calculatedX = Math.max(8, calculatedX);
                          calculatedY = Math.max(8, calculatedY);

                          setContextMenu({
                            x: calculatedX,
                            y: calculatedY,
                            conversationId: c.conversation_id,
                            phone: c.id,
                            patientName: c.name || c.id,
                            isBotActive: !!c.isBotActive,
                            unread: c.unread
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                          }
                        }}
                        className={`absolute top-0 right-0 p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-black/5 active:scale-95 transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 group-focus-within:opacity-100 cursor-pointer flex items-center justify-center ${
                          activePhone === c.id ? "md:opacity-100" : ""
                        }`}
                        title="Seçenekler"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>

                      {/* Bottom indicators: Pinned or Unread */}
                      <div className="flex items-center gap-1.5 mt-auto">
                        {c.isPinned && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              handleTogglePin(c.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                              }
                            }}
                            className="p-0.5 rounded hover:bg-black/5 text-xs opacity-60 hover:opacity-100 transition-all cursor-pointer flex-shrink-0"
                            title="Sabitlemeyi Kaldır"
                          >
                            📌
                          </button>
                        )}
                        {!c.isPinned && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              handleTogglePin(c.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                              }
                            }}
                            className="p-0.5 rounded hover:bg-black/5 text-xs opacity-0 group-hover:opacity-60 hover:opacity-100 transition-all cursor-pointer flex-shrink-0"
                            title="Sabitle"
                          >
                            📌
                          </button>
                        )}
                        {c.unread > 0 && (
                          <span
                            className="text-white text-[9px] font-bold px-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full border border-white shadow-sm flex-shrink-0"
                            style={{ background: "var(--q-blue, #007AFF)" }}
                          >
                            {c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
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
      {/* ── Floating Bulk Actions Bar ── */}
      {isSelectionMode && selectedIds.length > 0 && (() => {
        const isAnyFavorite = selectedIds.some(id => {
          const c = contacts.find((x: any) => x.conversation_id === id);
          return !!c?.isFavorite;
        });
        const isAnyArchived = selectedIds.some(id => {
          const c = contacts.find((x: any) => x.conversation_id === id);
          return !!c?.isArchived;
        });

        return (
          <div 
            className="absolute bottom-4 left-4 right-4 z-20 p-3 rounded-2xl border flex flex-col gap-2 shadow-xl animate-fade-in"
            style={{ 
              borderColor: "rgba(0,122,255,0.15)",
              background: "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(12px)"
            }}
          >
            <div className="flex justify-between items-center px-1">
              <span className="text-[11px] font-bold text-indigo-600">{selectedIds.length} sohbet seçildi</span>
              <button 
                onClick={() => clearSelection()}
                className="text-[10px] font-semibold text-gray-500 hover:text-black transition-colors cursor-pointer"
              >
                Vazgeç
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => handleBulkAction('read', selectedIds)}
                disabled={bulkActionLoading}
                className="py-1.5 px-2 bg-gray-50 hover:bg-gray-100 border rounded-xl text-[10px] font-bold text-gray-800 transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                Okundu Yap
              </button>
              <button
                onClick={() => handleBulkAction('unread', selectedIds)}
                disabled={bulkActionLoading}
                className="py-1.5 px-2 bg-gray-50 hover:bg-gray-100 border rounded-xl text-[10px] font-bold text-gray-800 transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                Okunmadı Yap
              </button>
              <button
                onClick={() => handleBulkFavorite(!isAnyFavorite)}
                disabled={bulkActionLoading}
                className="py-1.5 px-2 bg-gray-50 hover:bg-gray-100 border rounded-xl text-[10px] font-bold text-gray-800 transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {isAnyFavorite ? "⭐ Yıldız Kaldır" : "⭐ Yıldızla"}
              </button>
              <button
                onClick={() => handleBulkAction('bot', selectedIds)}
                disabled={bulkActionLoading}
                className="py-1.5 px-2 bg-gray-50 hover:bg-gray-100 border rounded-xl text-[10px] font-bold text-indigo-700 transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                Bota Devret
              </button>
              <button
                onClick={() => handleBulkAction('manual', selectedIds)}
                disabled={bulkActionLoading}
                className="py-1.5 px-2 bg-gray-50 hover:bg-gray-100 border rounded-xl text-[10px] font-bold text-amber-700 transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                Manuele Al
              </button>
              <button
                onClick={() => handleBulkArchive(!isAnyArchived)}
                disabled={bulkActionLoading}
                className="py-1.5 px-2 bg-gray-50 hover:bg-gray-100 border rounded-xl text-[10px] font-bold text-gray-800 transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
              >
                {isAnyArchived ? "📁 Arşiv Kaldır" : "📁 Arşivle"}
              </button>
            </div>

            <button
              onClick={async () => {
                if (selectedIds.length > 10) {
                  setBulkActionError("En fazla 10 sohbet için aynı anda taslak hazırlanabilir.");
                  setTimeout(() => setBulkActionError(null), 4000);
                  return;
                }
                setIsLoadingBulkDrafts(true);
                setBulkActionError(null);
                try {
                  const res = await prepareBulkFollowUpDrafts(selectedIds);
                  if (res.success && 'results' in res) {
                    setBulkDraftsModal({ isOpen: true, results: res.results });
                  } else {
                    setBulkActionError((res as any).error || "Taslaklar hazırlanamadı.");
                    setTimeout(() => setBulkActionError(null), 4000);
                  }
                } catch (e) {
                  setBulkActionError("Bir sistem hatası oluştu.");
                  setTimeout(() => setBulkActionError(null), 4000);
                }
                setIsLoadingBulkDrafts(false);
              }}
              disabled={bulkActionLoading || isLoadingBulkDrafts}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isLoadingBulkDrafts ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Hazırlanıyor...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  <span>Taslakları Önizle</span>
                </>
              )}
            </button>

            {bulkActionError && (
              <div className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg p-1.5 text-center mt-1 leading-snug">
                ⚠️ {bulkActionError}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Context Menu (Sağ Tık) ── */}
      {contextMenu && (
        <div
          className="fixed z-50 py-1.5 w-48 rounded-xl border bg-white/95 backdrop-blur-md shadow-xl text-left scale-in-center overflow-hidden"
          style={{
            top: Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 220),
            left: Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 192),
            borderColor: "var(--q-border-default)",
            boxShadow: "0 10px 30px -10px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.05)"
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={async () => {
              setContextMenu(null);
              await handleBulkAction('read', [contextMenu.conversationId]);
            }}
            className="w-full px-3.5 py-2 text-xs font-semibold hover:bg-black/5 flex items-center gap-2 cursor-pointer transition-colors text-left"
            style={{ color: "var(--q-text-primary)" }}
          >
            <CheckCheck className="w-3.5 h-3.5 text-green-600" />
            <span>Okundu yap</span>
          </button>
          <button
            onClick={async () => {
              setContextMenu(null);
              await handleBulkAction('unread', [contextMenu.conversationId]);
            }}
            className="w-full px-3.5 py-2 text-xs font-semibold hover:bg-black/5 flex items-center gap-2 cursor-pointer transition-colors text-left"
            style={{ color: "var(--q-text-primary)" }}
          >
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            <span>Okunmadı yap</span>
          </button>
          
          <div className="h-[1px] my-1 bg-gray-100" />

          <button
            onClick={async () => {
              setContextMenu(null);
              await handleBulkAction(contextMenu.isBotActive ? 'manual' : 'bot', [contextMenu.conversationId]);
            }}
            className="w-full px-3.5 py-2 text-xs font-semibold hover:bg-black/5 flex items-center gap-2 cursor-pointer transition-colors text-left"
            style={{ color: "var(--q-text-primary)" }}
          >
            {contextMenu.isBotActive ? (
              <>
                <UserX className="w-3.5 h-3.5 text-amber-600" />
                <span>Manuele al</span>
              </>
            ) : (
              <>
                <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
                <span>Bota devret</span>
              </>
            )}
          </button>

          <button
            onClick={async () => {
              setContextMenu(null);
              setIsLoadingBulkDrafts(true);
              setBulkActionError(null);
              try {
                const res = await prepareBulkFollowUpDrafts([contextMenu.conversationId]);
                if (res.success && 'results' in res) {
                  setBulkDraftsModal({ isOpen: true, results: res.results });
                } else {
                  setErrorToast((res as any).error || "Taslak hazırlanamadı.");
                }
              } catch (e) {
                setErrorToast("Bir sistem hatası oluştu.");
              }
              setIsLoadingBulkDrafts(false);
            }}
            className="w-full px-3.5 py-2 text-xs font-semibold hover:bg-black/5 flex items-center gap-2 cursor-pointer transition-colors text-left"
            style={{ color: "var(--q-text-primary)" }}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
            <span>Taslak Hazırla</span>
          </button>

          <div className="h-[1px] my-1 bg-gray-100" />

          <button
            onClick={async () => {
              const convId = contextMenu.conversationId;
              setContextMenu(null);
              try {
                const res = await toggleConversationFavorite(convId);
                if (res && res.success) {
                   queryClient.invalidateQueries({ queryKey: ["conversations"] });
                } else {
                  setErrorToast((res && res.error) || "İşlem başarısız.");
                }
              } catch (e) {
                setErrorToast("Bir hata oluştu.");
              }
            }}
            className="w-full px-3.5 py-2 text-xs font-semibold hover:bg-black/5 flex items-center gap-2 cursor-pointer transition-colors text-left"
            style={{ color: "var(--q-text-primary)" }}
          >
            <span>⭐</span>
            <span>{contacts.find((x: any) => x.conversation_id === contextMenu.conversationId)?.isFavorite ? "Favoriden çıkar" : "Favoriye ekle"}</span>
          </button>

          <button
            onClick={async () => {
              const convId = contextMenu.conversationId;
              setContextMenu(null);
              try {
                const isArch = !!contacts.find((x: any) => x.conversation_id === contextMenu.conversationId)?.isArchived;
                const res = isArch 
                  ? await unarchiveConversation(convId)
                  : await archiveConversation(convId);
                if (res && res.success) {
                   queryClient.invalidateQueries({ queryKey: ["conversations"] });
                } else {
                  setErrorToast((res && res.error) || "İşlem başarısız.");
                }
              } catch (e) {
                setErrorToast("Bir hata oluştu.");
              }
            }}
            className="w-full px-3.5 py-2 text-xs font-semibold hover:bg-black/5 flex items-center gap-2 cursor-pointer transition-colors text-left"
            style={{ color: "var(--q-text-primary)" }}
          >
            <span>📁</span>
            <span>{contacts.find((x: any) => x.conversation_id === contextMenu.conversationId)?.isArchived ? "Arşivden çıkar" : "Arşivle"}</span>
          </button>

          <button
            disabled
            className="w-full px-3.5 py-2 text-xs font-semibold opacity-40 flex items-center gap-2 cursor-not-allowed text-left text-red-600"
            title="Yönetici onayı gereklidir."
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Sohbeti temizle <span className="text-[10px] text-gray-400 font-normal">(Kilitli)</span></span>
          </button>
        </div>
      )}

      {/* ── Bulk Drafts Preview Modal ── */}
      {bulkDraftsModal && bulkDraftsModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-fade-in">
          <div 
            className="w-full max-w-xl bg-white rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[80vh] scale-in-center"
            style={{ borderColor: "var(--q-border-default)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b flex justify-between items-center" style={{ borderColor: "var(--q-border-default)" }}>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Takip Taslakları Önizleme</h3>
                <p className="text-[10px] text-gray-500 font-semibold mt-0.5">Taslakları kontrol edip tek tek onaylayarak gönderebilirsiniz.</p>
              </div>
              <button 
                onClick={() => setBulkDraftsModal(null)}
                className="p-1.5 rounded-lg hover:bg-black/5 text-gray-400 hover:text-black transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-gray-50/50">
              {bulkDraftsModal.results.map((item) => {
                const isPrepared = item.status === 'prepared';
                const isTemplateRequired = item.status === 'template_required';
                const isBlocked = item.status === 'blocked';
                const isSkipped = item.status === 'skipped';
                
                const currentDraftText = draftEdits[item.conversationId] !== undefined ? draftEdits[item.conversationId] : (item.draft || "");
                const isSending = !!sendingDrafts[item.conversationId];
                const statusIcon = sentStatus[item.conversationId];

                return (
                  <div 
                    key={item.conversationId}
                    className="p-4 rounded-2xl border bg-white shadow-sm flex flex-col gap-3 text-left"
                    style={{ borderColor: "var(--q-border-default)" }}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-bold text-[12px] text-gray-950">{item.patientName}</span>
                        <span className="text-[9px] text-gray-400 font-semibold ml-2">ID: {item.conversationId.slice(0, 8)}...</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        {isPrepared && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-50 text-green-700 border border-green-100">
                            24s Açık
                          </span>
                        )}
                        {isTemplateRequired && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-100">
                            24s Kapalı
                          </span>
                        )}
                        {isBlocked && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-50 text-red-700 border border-red-100">
                            Engellendi
                          </span>
                        )}
                        {isSkipped && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                            Geçildi
                          </span>
                        )}

                        {statusIcon === 'success' && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-800 flex items-center gap-0.5">
                            <Check className="w-3 h-3" /> Gönderildi
                          </span>
                        )}
                        {statusIcon === 'error' && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-800 flex items-center gap-0.5">
                            <AlertCircle className="w-3 h-3" /> Hata
                          </span>
                        )}
                      </div>
                    </div>

                    {isPrepared && (
                      <>
                        <textarea
                          disabled={isSending || statusIcon === 'success'}
                          value={currentDraftText}
                          onChange={(e) => setDraftEdits(prev => ({ ...prev, [item.conversationId]: e.target.value }))}
                          className="w-full text-[11px] p-3 rounded-xl border outline-none font-medium leading-relaxed bg-white resize-none h-16 disabled:opacity-80 disabled:bg-gray-50 focus:ring-1 focus:ring-indigo-500"
                          style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-primary)" }}
                        />
                        {statusIcon !== 'success' && (
                          <div className="flex justify-end">
                            <button
                              onClick={async () => {
                                setSendingDrafts(prev => ({ ...prev, [item.conversationId]: true }));
                                try {
                                  const res = await sendApprovedFollowUp(item.conversationId, currentDraftText);
                                  if (res.success) {
                                    setSentStatus(prev => ({ ...prev, [item.conversationId]: 'success' }));
                                    queryClient.invalidateQueries({ queryKey: ["conversations"] });
                                    if (typeof window !== 'undefined') {
                                      window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
                                    }
                                  } else {
                                    setSentStatus(prev => ({ ...prev, [item.conversationId]: 'error' }));
                                  }
                                } catch (e) {
                                  setSentStatus(prev => ({ ...prev, [item.conversationId]: 'error' }));
                                }
                                setSendingDrafts(prev => ({ ...prev, [item.conversationId]: false }));
                              }}
                              disabled={isSending}
                              className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-[10px] font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1 hover:scale-[1.01]"
                            >
                              {isSending ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  <span>Gönderiliyor...</span>
                                </>
                              ) : (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Taslağı Gönder</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </>
                    )}

                    {isTemplateRequired && (
                      <div className="text-[10px] font-semibold text-amber-800 bg-amber-50/50 border border-amber-200 rounded-xl p-3 leading-snug">
                        ⚠️ 24 saatlik WhatsApp penceresi kapandığı için serbest mesaj gönderilemez. Şablon gönderimi A1.7a kapsamında devre dışıdır.
                      </div>
                    )}

                    {(isBlocked || isSkipped) && (
                      <div className="text-[10px] font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-xl p-3 leading-snug">
                        🚫 {item.reason || "Bu sohbet için taslak oluşturulması durduruldu."}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p-4 border-t bg-gray-50 flex justify-end" style={{ borderColor: "var(--q-border-default)" }}>
              <button
                onClick={() => setBulkDraftsModal(null)}
                className="py-2 px-6 bg-white hover:bg-gray-50 border text-gray-800 text-[11px] font-bold rounded-xl cursor-pointer transition-all shadow-sm"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {errorToast && (
        <div className="fixed bottom-5 left-5 z-[9999] px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold animate-in fade-in slide-in-from-bottom-5 duration-300"
             style={{ background: "var(--q-red)", color: "white", borderColor: "rgba(255,255,255,0.1)" }}>
          {errorToast}
        </div>
      )}

      <NoReplyAutomationModal isOpen={isAutomationOpen} onClose={() => setIsAutomationOpen(false)} />
    </div>
  );
}
