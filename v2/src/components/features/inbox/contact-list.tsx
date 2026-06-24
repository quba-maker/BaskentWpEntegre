"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Check, CheckCheck, Clock, WifiOff, MessageCircle, MoreVertical, Loader2, Sparkles, AlertCircle, X, ChevronLeft, ChevronRight, UserCheck, UserX, Trash2, Sliders, ChevronDown, Bot, User, Pin, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { InboxBotControlBar } from "./InboxBotControlBar";
import { 
  getConversations, 
  togglePin, 
  markConversationRead, 
  markConversationUnread, 
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
  bulkUnarchiveConversations,
  getMessages,
  toggleBotStatus,
  clearConversation,
  deleteConversationAction
} from "@/app/actions/inbox";
import { useInboxStore, lastMutationTimes, registerUnreadMutation, clearUnreadMutation } from "@/store/inbox-store";
import { useDiagnosticsStore } from "@/lib/realtime/diagnostics-store";
import { getCountryFromPhone, normalizeCountryName, getCountryFlag } from "@/lib/utils/country";
import NoReplyAutomationModal from "./no-reply-automation-modal";
import { useConfirm } from "@/components/ui/confirm-dialog";

function getInitialsColor(name: string) {
  const colors = [
    "#51A5FA", // Soft Blue
    "#17E17E", // Soft Green
    "#FFAF1A", // Soft Yellow-Orange
    "#FF6C5F", // Soft Red/Coral
    "#B085FF", // Soft Purple
    "#FF7BB0", // Soft Pink
    "#00D0C6", // Soft Teal
    "#8B9CA9", // Soft Slate/Grey
    "#59C3FF", // Soft Light Blue
    "#8AD75A", // Soft Lime-Green
    "#FFA159", // Soft Peach
    "#E289F2", // Soft Violet
    "#22D3EE", // Soft Cyan
    "#F43F5E", // Soft Rose
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

function getInitials(name: string) {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return "Q";
  const parts = clean.split(' ');
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function formatNoReplyBadge(hours?: number | null) {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return "Süre";
  if (hours < 1 / 60) return "az önce";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}dk`;
  if (hours < 24) return `${Math.round(hours)}s`;
  return `${Math.round(hours / 24)}g`;
}

interface InitialsAvatarProps {
  name: string;
  channel: string;
  unread: number;
  isBotActive: boolean;
}

function InitialsAvatar({ name, channel, unread, isBotActive }: InitialsAvatarProps) {
  const bgColor = getInitialsColor(name);

  // Check if bot is active (only bot overlay, no "sen/user" overlay)
  const isBotActiveMessage = isBotActive;

  // Real WhatsApp, Instagram, Messenger SVG overlays
  const renderChannelBadge = () => {
    if (channel === 'whatsapp') {
      return (
        <span 
          className="absolute -bottom-1 -right-1 w-[22px] h-[22px] rounded-full border-2 border-white shadow-md flex items-center justify-center bg-[#25D366] select-none"
          title="WhatsApp"
        >
          <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
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
          <svg className="w-3.5 h-3.5 text-white fill-current" viewBox="0 0 24 24">
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
        className="w-12 h-12 rounded-full flex items-center justify-center text-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] relative"
        style={{ backgroundColor: bgColor }}
      >
        <svg className="w-6.5 h-6.5 text-white/90" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm-7 9a7 7 0 0 1 14 0c0 .55-.45 1-1 1H6c-.55 0-1-.45-1-1z" />
        </svg>
        
        {/* Bot overlay icon - only if bot is active */}
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

type InboxPrimaryFilter =
  | 'all'
  | 'unread'
  | 'bot_active'
  | 'needs_response'
  | 'favorites';

type InboxReplyFilter =
  | 'all_reply'
  | 'waiting_inbox_reply'
  | 'no_reply_3h'
  | 'no_reply_6h'
  | 'no_reply_24h';

type InboxChannelFilter =
  | 'all'
  | 'whatsapp'
  | 'instagram'
  | 'messenger';

type InboxStageFilter = string | 'all';

export function ContactRail() {
  const activePhone = useInboxStore((state) => state.activePhone);
  const setActiveContact = useInboxStore((state) => state.setActiveContact);
  const mobileView = useInboxStore((state) => state.mobileView);
  const isSelectionMode = useInboxStore((state) => state.isSelectionMode);
  const selectedIds = useInboxStore((state) => state.selectedIds);
  const setSelectionMode = useInboxStore((state) => state.setSelectionMode);
  const toggleSelected = useInboxStore((state) => state.toggleSelected);
  const setSelectedIds = useInboxStore((state) => state.setSelectedIds);
  const clearSelection = useInboxStore((state) => state.clearSelection);
  const isSidebarCollapsed = useInboxStore((state) => state.isSidebarCollapsed);
  const toggleSidebar = useInboxStore((state) => state.toggleSidebar);
  const setActiveModal = useInboxStore((state) => state.setActiveModal);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const hoverTimeoutRef = useRef<any>(null);

  const handleSetBotModeBulk = async (enabled: boolean) => {
    try {
      const mode = enabled ? 'bot' : 'human';
      const res = await bulkSetBotMode(selectedIds, mode) as any;
      if (res && res.success) {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        queryClient.refetchQueries({ queryKey: ["conversations"] });
        return {
          success: true,
          summary: res.summary
        };
      } else {
        return {
          success: false,
          error: res.error || "Güncelleme başarısız."
        };
      }
    } catch (err) {
      return {
        success: false,
        error: "Toplu işlem başarısız."
      };
    }
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const searchParams = useSearchParams();
  const router = useRouter();
  const deepLinkContact = searchParams.get('contact');
  const deepLinkConversationId = searchParams.get('conversation_id');

  // Initialize state from URL search params or defaults
  const initialPrimary = (searchParams.get('primary') as InboxPrimaryFilter) || "all";
  const initialReply = (searchParams.get('reply') as InboxReplyFilter) || "all_reply";
  const initialChannel = (searchParams.get('channel') as InboxChannelFilter) || "all";
  const initialStage = searchParams.get('stage') || "all";

  const [primaryFilter, setPrimaryFilter] = useState<InboxPrimaryFilter>(initialPrimary);
  const [replyFilter, setReplyFilter] = useState<InboxReplyFilter>(initialReply);
  const [channelFilter, setChannelFilter] = useState<InboxChannelFilter>(initialChannel);
  const [stageFilter, setStageFilter] = useState<InboxStageFilter>(initialStage);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const isRealtimeDown = useDiagnosticsStore((state) => state.isRealtimeDown);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [isAutomationOpen, setIsAutomationOpen] = useState(false);
  const [isNoReplyDropdownOpen, setIsNoReplyDropdownOpen] = useState(false);

  // Sync state when URL params change (e.g. back/forward navigation)
  useEffect(() => {
    const currentPrimary = (searchParams.get('primary') as InboxPrimaryFilter) || "all";
    const currentReply = (searchParams.get('reply') as InboxReplyFilter) || "all_reply";
    const currentChannel = (searchParams.get('channel') as InboxChannelFilter) || "all";
    const currentStage = searchParams.get('stage') || "all";

    setPrimaryFilter(currentPrimary);
    setReplyFilter(currentReply);
    setChannelFilter(currentChannel);
    setStageFilter(currentStage);
  }, [searchParams]);

  const updateUrl = (
    primary: InboxPrimaryFilter,
    reply: InboxReplyFilter,
    channel: InboxChannelFilter,
    stage: InboxStageFilter
  ) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (primary !== 'all') params.set('primary', primary); else params.delete('primary');
    if (reply !== 'all_reply') params.set('reply', reply); else params.delete('reply');
    if (channel !== 'all') params.set('channel', channel); else params.delete('channel');
    if (stage !== 'all') params.set('stage', stage); else params.delete('stage');
    
    // Keep the active contact link parameter if present
    const contactParam = searchParams.get('contact');
    if (contactParam) {
      params.set('contact', contactParam);
    }
    
    const newSearch = params.toString();
    router.replace(`${window.location.pathname}${newSearch ? '?' + newSearch : ''}`, { scroll: false });
  };

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
    queryKey: ["conversations", debouncedSearch, primaryFilter, replyFilter, channelFilter, stageFilter],
    queryFn: async ({ pageParam = 1 }) => {
      const res = await getConversations(
        pageParam as number, 
        debouncedSearch, 
        stageFilter, 
        primaryFilter, 
        replyFilter, 
        channelFilter
      );
      if (Array.isArray(res)) {
        return res.map(conv => {
          const conversationId = conv.id || conv.conversation_id || conv.conversationId;
          const lastMutation = lastMutationTimes[conversationId];
          if (lastMutation && Date.now() - lastMutation < 4000) {
            const activeLocks = useInboxStore.getState().manualUnreadLocks;
            const isUnreadLocked = !!(activeLocks[conversationId] || (conv.phone && activeLocks[conv.phone]));
            const targetUnread = isUnreadLocked ? Math.max(conv.unread || 0, 1) : 0;
            if (conv.unread !== targetUnread) {
              console.log(`[READ_STATE_RECONCILE_SKIP_STALE] Skipping unread count overwrite for conversationId=${conversationId} from ${conv.unread} to target=${targetUnread}`);
              return {
                ...conv,
                unread: targetUnread
              };
            }
          }
          return conv;
        });
      }
      return res;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage) || !Array.isArray(allPages)) return undefined;
      return lastPage.length === 30 ? allPages.length + 1 : undefined;
    },
    // Realtime operates now, fallback polling if disconnected
    refetchInterval: isRealtimeDown ? 10000 : false,
    refetchIntervalInBackground: true,
    staleTime: Infinity,
    // GC: evict stale conversation pages after 10 minutes
    gcTime: 10 * 60 * 1000,
  });

  const contacts = data?.pages ? data.pages.flat() : [];

  // Low priority prefetch for the first 10 contacts to improve load speed (Production auto-prefetch disabled)
  useEffect(() => {
    const enableTop10Prefetch = false; // Disabled to optimize Vercel backend load
    if (!enableTop10Prefetch) return;
    
    if (!contacts || contacts.length === 0) return;

    // Prefetch first 10 contacts with a 1-second delay to prioritize active UI mount
    const firstTen = contacts.slice(0, 10);
    const delayPrefetch = setTimeout(() => {
      firstTen.forEach((c: any) => {
        const conversationId = c.conversation_id || c.conversationId;
        if (!conversationId) return;

        const cacheKey = ["messages", conversationId];
        const existingData = queryClient.getQueryData(cacheKey);

        if (!existingData) {
          if (typeof window !== "undefined") {
            console.log(`[PREFETCH_LIST_TRACE] Prefetching conversation: conversationId=${conversationId}`);
          }
          queryClient.prefetchInfiniteQuery({
            queryKey: cacheKey,
            queryFn: ({ pageParam = null }) => getMessages(conversationId, pageParam as { timestampMs: number; id: string } | null, 30),
            initialPageParam: null,
            staleTime: 30000,
          }).catch(err => {
            console.error("[PREFETCH_LIST_ERROR]", err);
          });
        }
      });
    }, 1000);

    return () => clearTimeout(delayPrefetch);
  }, [contacts, queryClient]);
  const isLoadingMore = isFetchingNextPage || isLoading;
  const isReachingEnd = !hasNextPage;

  // Selection & Bulk Action Helpers
  const visibleContacts = contacts || [];
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

  const applyOptimisticConversationUpdate = (
    ids: string[], 
    fieldUpdates: any
  ) => {
    const queries = queryClient.getQueriesData({ queryKey: ["conversations"] });
    const rollbacks: { queryKey: any; oldData: any }[] = [];

    // Save previous active contact state
    const store = useInboxStore.getState();
    const prevActiveContact = store.activeContact ? { ...store.activeContact } : null;
    const prevSelectedIds = [...store.selectedIds];

    for (const [queryKey, oldData] of queries) {
      if (!oldData || !(oldData as any).pages) continue;
      
      // Save oldData for rollback
      rollbacks.push({ queryKey, oldData });

      const [_, search, primaryFilter, replyFilter, channelFilter, stageFilter] = queryKey as any;

      const newPages = (oldData as any).pages.map((page: any[]) => {
        const updatedPage = page.map(conv => {
          const isMatch = ids.includes(conv.id) || ids.includes(conv.conversation_id) || ids.includes(conv.conversationId);
          if (isMatch) {
            return { ...conv, ...fieldUpdates };
          }
          return conv;
        });

        // Filter out items that no longer match the active query parameters
        return updatedPage.filter(c => {
          // Check Primary Filter
          if (primaryFilter === "unread" && c.unread <= 0) return false;
          if (primaryFilter === "bot_active" && !(c.isBotActive || c.status === "bot")) return false;
          if (primaryFilter === "favorites" && !c.isFavorite) return false;

          // Check Stage / Archive Filter
          const isArchivedFilter = stageFilter === "archived";
          if (isArchivedFilter && !c.isArchived) return false;
          if (!isArchivedFilter && c.isArchived) return false;

          return true;
        });
      });

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

    // Update Zustand activeContact if active contact is modified
    const activeContact = store.activeContact;
    const activeId = activeContact?.conversation_id || activeContact?.conversationId || activePhone;
    if (activeId && ids.includes(activeId)) {
      store.updateActiveContact({
        ...activeContact,
        ...fieldUpdates
      });
    }

    // Calculate total unread count delta and dispatch detailed refresh event
    if (typeof fieldUpdates.unread === 'number') {
      const firstQuery = queries.find(([_, oldData]) => oldData && (oldData as any).pages);
      if (firstQuery) {
        const oldData = firstQuery[1] as any;
        for (const id of ids) {
          let currentUnread = 0;
          for (const page of oldData.pages) {
            const match = page.find((conv: any) => conv.id === id || conv.conversation_id === id || conv.conversationId === id);
            if (match) {
              currentUnread = match.unread || 0;
              break;
            }
          }
          const newUnread = fieldUpdates.unread;
          const delta = newUnread - currentUnread;

          if (typeof window !== "undefined" && delta !== 0) {
            window.dispatchEvent(new CustomEvent('inbox-unread-refresh', {
              detail: {
                delta,
                conversationId: id,
                unreadCount: newUnread,
                source: 'manual_read_state'
              }
            }));
          }
        }
      }
    } else {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
      }
    }

    // Return rollback function
    return () => {
      console.log("[OPTIMISTIC_ROLLBACK] Restoring previous states due to failure.");
      for (const r of rollbacks) {
        queryClient.setQueryData(r.queryKey, r.oldData);
      }
      if (prevActiveContact) {
        store.updateActiveContact(prevActiveContact);
      }
      store.setSelectedIds(prevSelectedIds);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
      }
    };
  };

  const handleBulkAction = async (action: 'read' | 'unread' | 'bot' | 'manual', ids: string[]) => {
    setBulkActionLoading(true);
    setBulkActionError(null);

    // Cancel outgoing queries to avoid race conditions
    await queryClient.cancelQueries({ queryKey: ["conversations"] });

    let fieldUpdates: any = {};
    if (action === 'read') {
      fieldUpdates = { unread: 0 };
    } else if (action === 'unread') {
      fieldUpdates = { unread: 1 };
    } else if (action === 'bot') {
      fieldUpdates = { isBotActive: true, autopilot_enabled: true, status: 'bot' };
    } else if (action === 'manual') {
      fieldUpdates = { isBotActive: false, autopilot_enabled: false, status: 'human' };
    }

    if (action === 'unread') {
      ids.forEach(id => {
        useInboxStore.getState().addManualUnreadLock(id);
        registerUnreadMutation(id);
        const match = contacts.find((c: any) => c.conversation_id === id || c.conversationId === id || c.id === id);
        if (match) {
          useInboxStore.getState().addManualUnreadLock(match.id);
          registerUnreadMutation(match.id);
        }
      });
    } else if (action === 'read') {
      ids.forEach(id => {
        useInboxStore.getState().clearManualUnreadLock(id);
        registerUnreadMutation(id);
        const match = contacts.find((c: any) => c.conversation_id === id || c.conversationId === id || c.id === id);
        if (match) {
          useInboxStore.getState().clearManualUnreadLock(match.id);
          registerUnreadMutation(match.id);
        }
      });
    }

    const rollback = applyOptimisticConversationUpdate(ids, fieldUpdates);

    try {
      let res: any;
      if (action === 'read') {
        res = await markConversationsRead(ids);
      } else if (action === 'unread') {
        if (ids.length === 1) {
          res = await markConversationUnread(ids[0]);
        } else {
          res = await markConversationsUnread(ids);
        }
      } else if (action === 'bot') {
        res = await bulkSetBotMode(ids, 'bot');
      } else if (action === 'manual') {
        res = await bulkSetBotMode(ids, 'human');
      }

      if (res.success) {
        // If there are skipped conversations, we rollback those specific ones and show a warning toast
        if (res.skipped && res.skipped.length > 0) {
          const skippedIds = res.skipped.map((s: any) => s.conversationId);
          skippedIds.forEach((id: string) => {
            useInboxStore.getState().clearManualUnreadLock(id);
          });

          // Revert optimistic update for skipped ones by setting unread back to 0
          queryClient.setQueriesData({ queryKey: ["conversations"] }, (oldData: any) => {
            if (!oldData || !oldData.pages) return oldData;
            const newPages = oldData.pages.map((page: any[]) =>
              page.map(conv => {
                if (skippedIds.includes(conv.id)) {
                  return {
                    ...conv,
                    unread: 0,
                  };
                }
                return conv;
              })
            );
            return { ...oldData, pages: newPages };
          });

          // Also check if active contact is one of the skipped ones
          const activeContact = useInboxStore.getState().activeContact;
          const activeId = activeContact?.conversation_id || activeContact?.conversationId || activeContact?.id;
          if (activeId && skippedIds.includes(activeId)) {
            useInboxStore.getState().updateActiveContact({
              ...activeContact,
              unread: 0
            });
          }

          // Show specific skipped warning toast
          if (skippedIds.length === 1) {
            setErrorToast("Bu görüşme için okunmadı yapılamadı: hasta mesajı bulunamadı.");
          } else {
            setErrorToast("Okunmadı yapılamadı: hasta mesajı bulunamadı.");
          }
        }

        // Apply updated counts to conversations cache from canonical response
        if (res.updated && Array.isArray(res.updated) && res.updated.length > 0) {
          queryClient.setQueriesData({ queryKey: ["conversations"] }, (oldData: any) => {
            if (!oldData || !oldData.pages) return oldData;
            const newPages = oldData.pages.map((page: any[]) =>
              page.map(conv => {
                const match = res.updated.find((r: any) => r.conversationId === conv.id || r.conversationId === conv.conversation_id || r.conversationId === conv.conversationId);
                if (match) {
                  return {
                    ...conv,
                    unread: match.unreadCount,
                  };
                }
                return conv;
              })
            );
            return { ...oldData, pages: newPages };
          });

          // Apply updated counts to activeContact Zustand state if it matches
          const activeContact = useInboxStore.getState().activeContact;
          const activeId = activeContact?.conversation_id || activeContact?.conversationId || activeContact?.id;
          if (activeId) {
            const activeMatch = res.updated.find((r: any) => r.conversationId === activeId);
            if (activeMatch) {
              useInboxStore.getState().updateActiveContact({
                ...activeContact,
                unread: activeMatch.unreadCount
              });
            }
          }
        }

        // Refresh global unread counter in sidebar instantly!
        window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));

        ids.forEach(id => {
          clearUnreadMutation(id);
          const match = contacts.find((c: any) => c.conversation_id === id || c.conversationId === id || c.id === id);
          if (match) clearUnreadMutation(match.id);
        });
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        clearSelection();
      } else {
        if (action === 'unread') {
          ids.forEach(id => useInboxStore.getState().clearManualUnreadLock(id));
        }
        ids.forEach(id => {
          clearUnreadMutation(id);
          const match = contacts.find((c: any) => c.conversation_id === id || c.conversationId === id || c.id === id);
          if (match) clearUnreadMutation(match.id);
        });
        rollback();
        setBulkActionError(res.error || "Okunmadı yapılamadı. Lütfen tekrar deneyin.");
        setTimeout(() => setBulkActionError(null), 4000);
        setErrorToast(res.error || "Okunmadı yapılamadı. Lütfen tekrar deneyin.");
      }
    } catch (err: any) {
      if (action === 'unread') {
        ids.forEach(id => useInboxStore.getState().clearManualUnreadLock(id));
      }
      ids.forEach(id => {
        clearUnreadMutation(id);
        const match = contacts.find((c: any) => c.conversation_id === id || c.conversationId === id || c.id === id);
        if (match) clearUnreadMutation(match.id);
      });
      rollback();
      setBulkActionError("Okunmadı yapılamadı. Lütfen tekrar deneyin.");
      setTimeout(() => setBulkActionError(null), 4000);
      setErrorToast("Okunmadı yapılamadı. Lütfen tekrar deneyin.");
    }
    setBulkActionLoading(false);
  };

  const handleBulkFavorite = async (favorite: boolean) => {
    setBulkActionLoading(true);
    setBulkActionError(null);
    const ids = [...selectedIds];
    const rollback = applyOptimisticConversationUpdate(ids, { isFavorite: favorite });
    try {
      const res = await bulkToggleFavorite(ids, favorite);
      if (res && res.success) {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        clearSelection();
      } else {
        rollback();
        setBulkActionError((res && res.error) || "İşlem başarısız.");
        setTimeout(() => setBulkActionError(null), 4000);
      }
    } catch (err: any) {
      rollback();
      setBulkActionError("Sistem hatası. Lütfen tekrar deneyin.");
      setTimeout(() => setBulkActionError(null), 4000);
    }
    setBulkActionLoading(false);
  };

  const handleBulkArchive = async (archive: boolean) => {
    setBulkActionLoading(true);
    setBulkActionError(null);
    const ids = [...selectedIds];
    const rollback = applyOptimisticConversationUpdate(ids, { isArchived: archive });
    try {
      const res = archive
        ? await bulkArchiveConversations(ids)
        : await bulkUnarchiveConversations(ids);
      if (res && res.success) {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        clearSelection();
      } else {
        rollback();
        setBulkActionError((res && res.error) || "İşlem başarısız.");
        setTimeout(() => setBulkActionError(null), 4000);
      }
    } catch (err: any) {
      rollback();
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
    if ((deepLinkContact || deepLinkConversationId) && contacts.length > 0 && !activePhone) {
      const target = contacts.find((c: any) => 
        (deepLinkConversationId && (c.conversation_id === deepLinkConversationId || c.conversationId === deepLinkConversationId)) ||
        (deepLinkContact && c.id === deepLinkContact)
      );
      if (target) {
        setActiveContact(target.id, { ...target, unread: 0 });
        // Clean up URL
        const currentPath = window.location.pathname;
        router.replace(currentPath, { scroll: false });
      }
    }
  }, [deepLinkContact, deepLinkConversationId, contacts, activePhone, setActiveContact, router]);

  // Sync updated CRM data/messages to the active contact non-reactively to prevent left-rail re-renders
  useEffect(() => {
    if (activePhone && contacts.length > 0) {
      const updatedContact = contacts.find((c: any) => c.id === activePhone);
      if (updatedContact) {
        const activeContact = useInboxStore.getState().activeContact;
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
          opp_patient_name: activeContact?.opp_patient_name,
          isBotActive: activeContact?.isBotActive,
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
          opp_patient_name: updatedContact.opp_patient_name,
          isBotActive: updatedContact.isBotActive,
        });

        if (currentDataStr !== updatedDataStr) {
          useInboxStore.getState().updateActiveContact(updatedContact);
        }
      }
    }
  }, [contacts, activePhone]);

  // Reset unread count for the active conversation in the cache
  useEffect(() => {
    if (activePhone && contacts.length > 0) {
      const activeConv = contacts.find((c: any) => c.id === activePhone);
      if (activeConv && activeConv.unread > 0) {
        // Check manual unread lock to avoid resetting manual unread actions
        const activeConvId = activeConv.conversation_id || activeConv.conversationId || activePhone;
        const lock = useInboxStore.getState().manualUnreadLocks[activePhone] || useInboxStore.getState().manualUnreadLocks[activeConvId];
        if (lock && lock > Date.now()) {
          console.log(`[READ_STATE_AUTO_SKIP_CACHE] conversationId=${activeConvId} reason=manual_unread_lock`);
          return;
        }

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
      const activeConv = contacts.find((c: any) => c.id === activePhone);
      if (activeConv && (activeConv.unread || 0) > 0) {
        // Check manual unread lock
        const activeConvId = activeConv.conversation_id || activeConv.conversationId || activePhone;
        const lock = useInboxStore.getState().manualUnreadLocks[activePhone] || useInboxStore.getState().manualUnreadLocks[activeConvId];
        if (lock && lock > Date.now()) {
          console.log(`[READ_STATE_AUTO_SKIP] conversationId=${activeConvId} reason=manual_unread_lock`);
          return;
        }

        console.log(`[READ_STATE_AUTO_MARK] conversationId=${activePhone} reason=active_conversation_visible`);
        markConversationRead(activePhone).then((res) => {
          if (res?.success) {
            // Trigger local refresh event for the sidebar global count
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('inbox-unread-refresh', {
                detail: {
                  delta: -activeConv.unread,
                  conversationId: activePhone,
                  unreadCount: 0,
                  source: 'auto_read_state'
                }
              }));
            }
          }
        });
      }
    }
  }, [activePhone, contacts]);

  // Reset modal state on switching active patient
  useEffect(() => {
    setActiveModal(null);
  }, [activePhone, setActiveModal]);

  const handleTogglePin = async (phone: string) => {
    let currentIsPinned = false;
    const match = contacts.find((c: any) => c.id === phone || c.conversation_id === phone || c.conversationId === phone);
    if (match) {
      currentIsPinned = !!match.isPinned;
    }
    const nextIsPinned = !currentIsPinned;
    const rollback = applyOptimisticConversationUpdate([phone], { isPinned: nextIsPinned });

    try {
      const res = await togglePin(phone) as any;
      if (res.success) {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
      } else {
        rollback();
        setErrorToast(res.error || "Sabitleme işlemi başarısız.");
      }
    } catch (err) {
      console.error("Pin toggle error:", err);
      rollback();
      setErrorToast("Sistem hatası. Lütfen tekrar deneyin.");
    }
  };

  return (
    <div className={`w-full md:w-[390px] lg:w-[420px] shrink-0 border-r flex flex-col h-full z-10 q-glass shadow-sm ${mobileView === "list" ? "flex" : "hidden md:flex"}`}
      style={{ borderColor: "var(--q-border-default)" }}
    >
      {/* ── Header ── */}
      <div className="p-5 pb-3">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSidebar}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-black/5 active:scale-95 transition-all cursor-pointer flex items-center justify-center mr-1"
              title={isSidebarCollapsed ? "Menüyü Göster" : "Menüyü Gizle"}
            >
              {isSidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
            <h2 className="text-xl font-bold tracking-tight" style={{ color: "var(--q-text-primary)" }}>Mesajlar</h2>
            <button
              onClick={() => {
                if (isSelectionMode) {
                  clearSelection();
                } else {
                  setSelectionMode(true);
                }
              }}
              className={isSelectionMode 
                ? "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all cursor-pointer hover:bg-black/5 active:scale-95"
                : "p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-black/5 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
              }
              style={isSelectionMode ? {
                color: "var(--q-text-secondary)",
                borderColor: "var(--q-border-default)",
                background: "rgba(0,0,0,0.02)"
              } : undefined}
              title={isSelectionMode ? "Seçimi İptal Et" : "Seçenekler"}
            >
              {isSelectionMode ? "İptal" : <MoreVertical className="w-4 h-4" />}
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
              onChange={(e) => {
                const val = e.target.value;
                setStageFilter(val);
                updateUrl(primaryFilter, replyFilter, channelFilter, val);
              }}
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
              <option value="archived">📁 Arşiv</option>
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
        <div className="flex p-0.5 mt-2.5 rounded-xl bg-black/[0.04] p-1 gap-1 relative">
          {[
            { id: "all", label: "Tümü" },
            { id: "unread", label: "Okunmamış" },
            { id: "bot_active", label: "🤖 Botta" }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                const nextPrimary = tab.id as InboxPrimaryFilter;
                setPrimaryFilter(nextPrimary);
                setReplyFilter("all_reply");
                updateUrl(nextPrimary, "all_reply", channelFilter, stageFilter);
              }}
              className="flex-1 py-1 text-[11px] font-bold rounded-lg transition-all text-center whitespace-nowrap cursor-pointer select-none px-1"
              style={{
                background: primaryFilter === tab.id ? "white" : "transparent",
                color: primaryFilter === tab.id ? "var(--q-blue)" : "var(--q-text-secondary)",
                boxShadow: primaryFilter === tab.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none"
              }}
            >
              {tab.label}
            </button>
          ))}

          {/* Cevap Bekleyenler Dropdown Tab */}
          {(() => {
            const isNoReplyActive = primaryFilter === "needs_response";
            const getNoReplyLabel = () => {
              if (replyFilter === "no_reply_3h") return "⏳ 3s+";
              if (replyFilter === "no_reply_6h") return "⏳ 6s+";
              if (replyFilter === "no_reply_24h") return "⏳ 24s+";
              if (replyFilter === "waiting_inbox_reply") return "⏳ Karşılama";
              return "⏳ Cevap";
            };

            return (
              <div className="relative flex-1 flex">
                <button
                  onClick={() => {
                    if (!isNoReplyActive) {
                      setPrimaryFilter("needs_response");
                      setReplyFilter("all_reply");
                      updateUrl("needs_response", "all_reply", channelFilter, stageFilter);
                    }
                    setIsNoReplyDropdownOpen((prev) => !prev);
                  }}
                  className="w-full py-1 text-[11px] font-bold rounded-lg transition-all text-center whitespace-nowrap cursor-pointer select-none flex items-center justify-center gap-0.5 px-1"
                  style={{
                    background: isNoReplyActive ? "white" : "transparent",
                    color: isNoReplyActive ? "var(--q-blue)" : "var(--q-text-secondary)",
                    boxShadow: isNoReplyActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none"
                  }}
                >
                  <span>{getNoReplyLabel()}</span>
                  <ChevronDown className="w-2.5 h-2.5 shrink-0 opacity-75" />
                </button>

                {isNoReplyDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setIsNoReplyDropdownOpen(false)} />
                    <div 
                      className="absolute top-full left-0 mt-1.5 w-44 rounded-xl border bg-white shadow-xl py-1 z-30 animate-fade-in text-left"
                      style={{ borderColor: "var(--q-border-default)" }}
                    >
                      {[
                        { id: "all_reply", label: "⏳ Cevap Bekleyenler" },
                        { id: "no_reply_3h", label: "⏳ 3s+" },
                        { id: "no_reply_6h", label: "⏳ 6s+" },
                        { id: "no_reply_24h", label: "⏳ 24s+" },
                        { id: "waiting_inbox_reply", label: "⏳ Karşılama Cevabı Bekleyenler" },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => {
                            setPrimaryFilter("needs_response");
                            setReplyFilter(opt.id as InboxReplyFilter);
                            setIsNoReplyDropdownOpen(false);
                            updateUrl("needs_response", opt.id as InboxReplyFilter, channelFilter, stageFilter);
                          }}
                          className="w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-black/5 transition-all text-gray-700 flex items-center justify-between cursor-pointer"
                        >
                          <span>{opt.label}</span>
                          {replyFilter === opt.id && <Check className="w-3.5 h-3.5 text-[#007AFF]" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Favoriler Tab */}
          {[
            { id: "favorites", label: "⭐ Favoriler" }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setPrimaryFilter("favorites");
                setReplyFilter("all_reply");
                updateUrl("favorites", "all_reply", channelFilter, stageFilter);
              }}
              className="flex-1 py-1 text-[11px] font-bold rounded-lg transition-all text-center whitespace-nowrap cursor-pointer select-none px-1"
              style={{
                background: primaryFilter === tab.id ? "white" : "transparent",
                color: primaryFilter === tab.id ? "var(--q-blue)" : "var(--q-text-secondary)",
                boxShadow: primaryFilter === tab.id ? "0 1px 3px rgba(0,0,0,0.08)" : "none"
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
            onClick={() => {
              setChannelFilter(ch.id as InboxChannelFilter);
              updateUrl(primaryFilter, replyFilter, ch.id as InboxChannelFilter, stageFilter);
            }}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap transition-all duration-200 q-press"
            style={
              channelFilter === ch.id
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
              .map((c: any) => {
                let senderPrefixNode = null;
                if (c.lastMessageDirection === 'out') {
                  if (c.lastMessageModel) {
                    senderPrefixNode = (
                      <span className="font-semibold text-gray-600 mr-1 select-none">
                        Bot:
                      </span>
                    );
                  } else {
                    senderPrefixNode = (
                      <span className="font-semibold text-gray-500 mr-1 select-none">
                        Sen:
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
                    data-conversation-id={c.conversation_id || c.conversationId || c.id}
                    tabIndex={0}
                    aria-selected={activePhone === c.id}
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        console.log(`[DOM_CONTACT_CLICK] phone=${c.id} time=${window.performance.now().toFixed(2)}`);
                      }
                      const conversationId = c.conversation_id || c.conversationId;
                      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId);
                      if (!conversationId || !isUuid) {
                        if (typeof window !== "undefined") {
                          console.error(`[CONTACT_SELECT_TRACE] Blocked selection: invalid or missing conversation UUID for phone=${c.id}`);
                        }
                        return;
                      }
                      if (isSelectionMode) {
                        toggleSelected(c.conversation_id);
                      } else {
                        setActiveContact(c.id, { ...c, unread: 0 });
                      }
                    }}
                    onMouseEnter={() => {
                      const conversationId = c.conversation_id || c.conversationId;
                      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId);
                      if (!conversationId || !isUuid) return;
                      
                      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                      
                      hoverTimeoutRef.current = setTimeout(() => {
                        const cacheKey = ["messages", conversationId];
                        const existingData = queryClient.getQueryData(cacheKey);
                        if (!existingData) {
                          if (typeof window !== "undefined") {
                            console.log(`[PREFETCH_HOVER_TRACE] Hovered contact row: conversationId=${conversationId}`);
                          }
                          queryClient.prefetchInfiniteQuery({
                            queryKey: cacheKey,
                            queryFn: ({ pageParam = null }) => getMessages(conversationId, pageParam as { timestampMs: number; id: string } | null, 30),
                            initialPageParam: null,
                            staleTime: 30000,
                          }).catch(err => {
                            console.error("[PREFETCH_HOVER_ERROR]", err);
                          });
                        }
                      }, 500);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const conversationId = c.conversation_id || c.conversationId;
                        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId);
                        if (!conversationId || !isUuid) {
                          if (typeof window !== "undefined") {
                            console.error(`[CONTACT_SELECT_TRACE] Blocked selection on keydown: invalid or missing conversation UUID for phone=${c.id}`);
                          }
                          return;
                        }
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
                      if (isSelectionMode) {
                        toggleSelected(c.conversation_id);
                        return;
                      }
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
                      isBotActive={c.isBotActive}
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
                            Cevap Bekliyor · {formatNoReplyBadge(c.no_reply_hours)}
                          </span>
                        )}
                        {c.active_task_type && (() => {
                          if (c.active_task_type !== 'no_reply_followup' && 
                              c.active_task_type !== 'bot_handoff_followup' && 
                              c.active_task_type !== 'template_required_task') {
                            return null;
                          }
                          let label = "Takip taslağı";
                          let colorClass = "bg-amber-50 text-[#FF9500] border-amber-100";
                          if (c.active_task_type === 'template_required_task') {
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
                    <div className="relative flex flex-col justify-between self-stretch shrink-0 w-[84px] select-none py-0.5 text-right">
                      {/* Row 1: Time & Option dropdown */}
                      <div className="relative flex items-center justify-end h-5 mb-0.5 overflow-hidden">
                        <span 
                          className={`text-[10px] tracking-wide whitespace-nowrap transition-all duration-150 ${
                            c.unread > 0 ? "font-bold text-[#007AFF]" : "font-semibold text-gray-500"
                          }`}
                          style={{ color: c.unread > 0 ? "var(--q-blue, #007AFF)" : "var(--q-text-secondary)" }}
                        >
                          {c.formattedTime}
                        </span>
                        
                        {/* Chevron Dropdown Trigger */}
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
                          className={`p-0.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-black/5 active:scale-95 transition-all duration-150 cursor-pointer flex items-center justify-center shrink-0 ml-1 ${
                            activePhone === c.id 
                              ? "w-5 opacity-100 scale-100" 
                              : "w-5 md:w-0 opacity-100 md:opacity-0 scale-90 md:scale-90 overflow-hidden md:group-hover:w-5 md:group-hover:opacity-100 md:group-hover:scale-100 group-focus-within:w-5 group-focus-within:opacity-100 group-focus-within:scale-100"
                          }`}
                          title="Seçenekler"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Row 2: Pinned or Unread (Aligned with Message Preview) */}
                      <div className="flex items-center justify-end gap-1.5 h-5">
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
                            className="p-1 rounded hover:bg-black/5 opacity-60 hover:opacity-100 transition-all cursor-pointer flex-shrink-0"
                            title="Sabitlemeyi Kaldır"
                          >
                            <Pin className="w-3.5 h-3.5 rotate-45 text-gray-500 fill-gray-500" />
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
                            className="p-1 rounded hover:bg-black/5 opacity-0 group-hover:opacity-60 hover:opacity-100 transition-all cursor-pointer flex-shrink-0"
                            title="Sabitle"
                          >
                            <Pin className="w-3.5 h-3.5 rotate-45 text-gray-400" />
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

                      {/* Row 3: Spacer matching Status Badges Row height */}
                      <div className="h-5 mt-2 flex-shrink-0" />
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
              if (contextMenu.isBotActive) {
                // Manuele al
                const convId = contextMenu.conversationId;
                setContextMenu(null);
                const rollback = applyOptimisticConversationUpdate([convId], { isBotActive: false, autopilot_enabled: false, status: 'human' });

                try {
                  const res = await toggleBotStatus(convId, false);
                  if (res.success) {
                    queryClient.invalidateQueries({ queryKey: ["conversations"] });
                  } else {
                    rollback();
                    setErrorToast(res.error || "İşlem başarısız.");
                  }
                } catch (e) {
                  rollback();
                  setErrorToast("Bir hata oluştu.");
                }
              } else {
                // Bota devret
                const convId = contextMenu.conversationId;
                setContextMenu(null);
                setActiveModal({
                  modalType: 'bot_handoff',
                  conversationId: convId,
                  patientName: contacts.find((x: any) => x.conversation_id === convId || x.id === convId)?.name || ""
                });
              }
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
            onClick={() => {
              const convId = contextMenu.conversationId;
              setContextMenu(null);
              setActiveModal({
                modalType: 'draft_preview',
                conversationId: convId,
                patientName: contacts.find((x: any) => x.conversation_id === convId || x.id === convId)?.name || ""
              });
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
              const currentFavorite = !!contacts.find((x: any) => x.conversation_id === convId || x.conversationId === convId || x.id === convId)?.isFavorite;
              const nextFavorite = !currentFavorite;
              const rollback = applyOptimisticConversationUpdate([convId], { isFavorite: nextFavorite });
              try {
                const res = await toggleConversationFavorite(convId);
                if (res && res.success) {
                   queryClient.invalidateQueries({ queryKey: ["conversations"] });
                } else {
                  rollback();
                  setErrorToast((res && res.error) || "İşlem başarısız.");
                }
              } catch (e) {
                rollback();
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
              const currentArchived = !!contacts.find((x: any) => x.conversation_id === convId || x.conversationId === convId || x.id === convId)?.isArchived;
              const nextArchived = !currentArchived;
              const rollback = applyOptimisticConversationUpdate([convId], { isArchived: nextArchived });
              try {
                const res = nextArchived 
                  ? await archiveConversation(convId)
                  : await unarchiveConversation(convId);
                if (res && res.success) {
                   queryClient.invalidateQueries({ queryKey: ["conversations"] });
                } else {
                  rollback();
                  setErrorToast((res && res.error) || "İşlem başarısız.");
                }
              } catch (e) {
                rollback();
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
            onClick={async () => {
              const convId = contextMenu.conversationId;
              const patientName = contextMenu.patientName || 'Bu kişi';
              // eslint-disable-next-line quba/no-native-dialog
              const confirmed = window.confirm(
                `"${patientName}" adlı kişiye ait sohbet mesajları temizlenecek.\n\nForm, CRM ve hasta takip bilgileri korunacak. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?`
              );
              if (!confirmed) return;
              setContextMenu(null);
              try {
                const res = await clearConversation(convId);
                if (res.success) {
                  queryClient.invalidateQueries({ queryKey: ['conversations'] });
                  queryClient.invalidateQueries({ queryKey: ['messages', convId] });
                  queryClient.removeQueries({ queryKey: ['messages', convId] });
                  // Sağ panel (özet, etiketler, CRM) yenilenmesi için
                  queryClient.invalidateQueries({ queryKey: ['crm-panel', convId] });
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
                  }
                } else {
                  setErrorToast(res.error || 'Sohbet temizlenemedi.');
                }
              } catch (e) {
                setErrorToast('Bir hata oluştu.');
              }
            }}
            className="w-full px-3.5 py-2 text-xs font-semibold hover:bg-red-50 flex items-center gap-2 cursor-pointer transition-colors text-left text-red-600"
            title="Sohbet mesajlarını temizle; form ve CRM bilgilerini koru"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Sohbeti temizle</span>
          </button>

          <button
            onClick={async () => {
              const convId = contextMenu.conversationId;
              const patientName = contextMenu.patientName || 'Bu kişi';
              setContextMenu(null);

              const isConfirmed = await confirm({
                title: "Sohbeti Sil",
                message: "Bu sohbet inbox listesinden kaldırılacak. Form kayıtları korunur; mesaj geçmişi ve kayıtlar güvenlik amacıyla sistemde arşivli kalabilir. Aynı kişi tekrar yazarsa yeni sohbet olarak açılır. Devam edilsin mi?",
                variant: "danger",
                confirmLabel: "Sohbeti Sil",
                cancelLabel: "Vazgeç"
              });

              if (!isConfirmed) return;

              try {
                const res = await deleteConversationAction(convId);
                if (res.success) {
                  queryClient.invalidateQueries({ queryKey: ['conversations'] });
                  queryClient.invalidateQueries({ queryKey: ['messages', convId] });
                  queryClient.removeQueries({ queryKey: ['messages', convId] });
                  queryClient.invalidateQueries({ queryKey: ['crm-panel', convId] });
                  
                  const activeContactId = contacts.find((x: any) => x.conversation_id === convId)?.id;
                  if (activePhone === convId || activePhone === activeContactId) {
                    useInboxStore.setState({ activePhone: null, activeContact: null, mobileView: 'list' });
                  }

                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
                  }
                } else {
                  setErrorToast(res.error || 'Sohbet silinemedi.');
                }
              } catch (e) {
                setErrorToast('Bir hata oluştu.');
              }
            }}
            className="w-full px-3.5 py-2 text-xs font-semibold hover:bg-red-50 flex items-center gap-2 cursor-pointer transition-colors text-left text-red-600 border-t"
            style={{ borderColor: "var(--q-border-default)" }}
            title="Sohbeti tamamen sil"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Sohbeti sil</span>
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

      {isSelectionMode && selectedIds.length > 0 && (
        <InboxBotControlBar
          selectedCount={selectedIds.length}
          selectedConversations={selectedIds.map(id => contacts.find((c: any) => c.conversation_id === id || c.id === id)).filter(Boolean)}
          onSetBotMode={handleSetBotModeBulk}
          onClearSelection={() => clearSelection()}
          onMarkRead={async () => {
            await handleBulkAction('read', selectedIds);
          }}
        />
      )}

      <NoReplyAutomationModal isOpen={isAutomationOpen} onClose={() => setIsAutomationOpen(false)} />
    </div>
  );
}
