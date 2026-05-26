"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Paperclip, User, MessageCircle, ChevronLeft, ChevronRight, ChevronDown, ArrowDown, Info, ShieldAlert, Sparkles, Zap, Check, CheckCheck, Clock, FileText, Play, Mic, MapPin, X, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { getMessages, sendMessage, sendMediaMessage, toggleBotStatus } from "@/app/actions/inbox";
import { useInboxStore } from "@/store/inbox-store";
import { AiRuntimeTimeline } from "@/components/features/ai-observability/AiRuntimeTimeline";
import { getAiStatusForConversation } from "@/app/actions/ai-observability";
import { useParams } from "next/navigation";
import { usePresence } from "@/hooks/use-presence";
import { TypingIndicator } from "@/components/features/realtime/typing-indicator";
import { useBufferedStream } from "@/hooks/use-buffered-stream";
import { AblyStreamTransport } from "@/lib/ai/streaming/stream-transport";
import { StreamBubble } from "@/components/components/../features/realtime/stream-bubble";
import { getCountryFromPhone, normalizeCountryName, getCountryFlag } from "@/lib/utils/country";

import { useRealtimeTenant } from "@/components/providers/realtime-provider";
import { useDiagnosticsStore } from "@/lib/realtime/diagnostics-store";

// ==========================================
// CONVERSATION VIEWPORT — Central chat surface
// Architecture: Communication surface with High-Fidelity Custom Virtualization
// Authority: Messages, viewport sliding windowing, dynamic heights resize observer
// Governance: Token-native, skeleton-first, display-performance optimization
// ==========================================

// -- Skeleton --
function MessageSkeleton({ align }: { align: "left" | "right" }) {
  return (
    <div className={`flex w-full ${align === "left" ? "justify-start" : "justify-end"} mb-6`}>
      <div className={`max-w-[65%] flex flex-col gap-1.5 ${align === "left" ? "items-start" : "items-end"}`}>
        <div className={`h-14 w-48 q-skeleton ${align === "left" ? "rounded-2xl rounded-bl-sm" : "rounded-2xl rounded-br-sm"}`} />
        <div className="h-3 w-16 q-skeleton rounded" />
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex-1 flex flex-col-reverse p-6 space-y-6">
      <MessageSkeleton align="right" />
      <MessageSkeleton align="left" />
      <MessageSkeleton align="right" />
      <MessageSkeleton align="left" />
    </div>
  );
}

// -- Media Gallery Lightbox (WhatsApp-quality fullscreen gallery viewer) --
function MediaGalleryLightbox({ 
  images, 
  currentIndex, 
  onClose, 
  onNavigate 
}: { 
  images: Array<{ src: string; caption?: string; timeMs?: number }>;
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const thumbStripRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchDeltaX = useRef<number>(0);
  const current = images[currentIndex];

  const goNext = useCallback(() => {
    if (currentIndex < images.length - 1) onNavigate(currentIndex + 1);
  }, [currentIndex, images.length, onNavigate]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  }, [currentIndex, onNavigate]);

  // Keyboard + scroll lock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    document.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, goNext, goPrev]);

  // Auto-scroll thumbnail strip to active
  useEffect(() => {
    if (thumbStripRef.current) {
      const activeThumb = thumbStripRef.current.children[currentIndex] as HTMLElement;
      if (activeThumb) {
        activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [currentIndex]);

  // Touch handlers for swipe
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };
  const onTouchEnd = () => {
    if (touchDeltaX.current > 60) goPrev();
    else if (touchDeltaX.current < -60) goNext();
    touchDeltaX.current = 0;
  };

  if (!current) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ background: "rgba(0,0,0,0.95)" }}
      onClick={onClose}
    >
      {/* Top bar */}
      <div 
        className="flex items-center justify-between px-4 py-3 z-20 flex-shrink-0"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Counter */}
        <span className="text-white/80 text-sm font-semibold tabular-nums">
          {currentIndex + 1} / {images.length}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={current.src}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors"
            title="İndir"
          >
            <Download className="w-5 h-5 text-white" />
          </a>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>

      {/* Main image area with swipe + arrows */}
      <div
        className="flex-1 flex items-center justify-center relative px-4 min-h-0"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Left arrow */}
        {currentIndex > 0 && (
          <button
            onClick={goPrev}
            className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors z-10"
          >
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
        )}

        {/* Image */}
        <AnimatePresence mode="wait">
          <motion.img
            key={current.src}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            src={current.src}
            alt={current.caption || 'Media'}
            className="max-w-full max-h-[70vh] rounded-lg shadow-2xl select-none"
            style={{ objectFit: 'contain' }}
            draggable={false}
          />
        </AnimatePresence>

        {/* Right arrow */}
        {currentIndex < images.length - 1 && (
          <button
            onClick={goNext}
            className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors z-10"
          >
            <ChevronRight className="w-6 h-6 text-white" />
          </button>
        )}
      </div>

      {/* Caption */}
      {current.caption && (
        <div 
          className="text-center px-6 py-2 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-white/90 text-sm font-medium max-w-lg mx-auto leading-relaxed">
            {current.caption}
          </p>
        </div>
      )}

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div 
          className="flex-shrink-0 px-4 py-3 z-20"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div 
            ref={thumbStripRef}
            className="flex gap-2 overflow-x-auto scrollbar-hide justify-center"
            style={{ scrollBehavior: 'smooth' }}
          >
            {images.map((img, idx) => (
              <button
                key={idx}
                onClick={() => onNavigate(idx)}
                className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden transition-all duration-200 ${
                  idx === currentIndex 
                    ? 'ring-2 ring-white ring-offset-1 ring-offset-black/50 opacity-100 scale-105' 
                    : 'opacity-50 hover:opacity-75'
                }`}
              >
                <img
                  src={img.src}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// -- Media Bubble Renderer --
function MediaBubbleContent({ message, onGalleryOpen }: { message: any; onGalleryOpen: (src: string) => void }) {
  const mt = message.mediaType;
  const url = message.mediaUrl;
  const meta = message.mediaMetadata;

  if (!mt || !url) return null;

  switch (mt) {
    case 'image':
    case 'sticker':
      return (
        <img
          src={url}
          alt={meta?.caption || 'Görsel'}
          className="rounded-lg max-w-full max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity mb-1"
          loading="lazy"
          onClick={() => onGalleryOpen(url)}
        />
      );
    case 'video':
      return (
        <div className="relative cursor-pointer mb-1" onClick={() => onGalleryOpen(url)}>
          <video src={url} className="rounded-lg max-w-full max-h-64 object-cover" preload="metadata" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center">
              <Play className="w-6 h-6 text-white ml-0.5" />
            </div>
          </div>
        </div>
      );
    case 'audio':
      return (
        <div className="flex items-center gap-2 mb-1 min-w-[200px]">
          <Mic className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--q-green)' }} />
          <audio src={url} controls className="w-full h-8" style={{ maxWidth: '250px' }} />
        </div>
      );
    case 'document':
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg mb-1 transition-colors hover:opacity-80"
          style={{ background: 'rgba(0,0,0,0.05)', border: '1px solid var(--q-border-default)' }}
        >
          <FileText className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--q-blue)' }} />
          <span className="text-[13px] font-semibold truncate max-w-[180px]">
            {meta?.filename || 'Belge'}
          </span>
          <Download className="w-4 h-4 flex-shrink-0 ml-auto" style={{ color: 'var(--q-text-secondary)' }} />
        </a>
      );
    case 'location':
      return (
        <a
          href={`https://www.google.com/maps?q=${meta?.latitude},${meta?.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg mb-1 transition-colors hover:opacity-80"
          style={{ background: 'rgba(0,0,0,0.05)', border: '1px solid var(--q-border-default)' }}
        >
          <MapPin className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--q-red)' }} />
          <span className="text-[13px] font-semibold">
            {meta?.name || `${meta?.latitude?.toFixed(4)}, ${meta?.longitude?.toFixed(4)}`}
          </span>
        </a>
      );
    default:
      return null;
  }
}



// -- AI Status Badge --
const AI_EVENT_LABELS: Record<string, string> = {
  'memory_updated': 'Hafıza Eşlendi',
  'memory_failed': 'Hafıza Hatası',
  'policy_blocked': 'Kural Engeli',
  'human_escalation': 'Ekibe Aktarıldı',
  'ai_timeout': 'Bağlantı Koptu',
  'working_hours_blocked': 'Mesai Dışı',
  'brain_resolved': 'AI Hazır',
  'brain_started': 'Analiz Ediliyor',
  'brain_error': 'Analiz Hatası',
};

function AiStatusBadge({ phoneNumber }: { phoneNumber: string }) {
  const { data: status } = useQuery({
    queryKey: ['ai-status', phoneNumber],
    queryFn: () => getAiStatusForConversation(phoneNumber),
    enabled: !!phoneNumber,
    refetchInterval: 8000
  });

  if (!status) return null;

  const label = AI_EVENT_LABELS[status.lastEvent] || status.lastEvent;
  const severityColor = status.severity === 'error' 
    ? 'var(--q-red)' 
    : status.severity === 'warning' 
      ? 'var(--q-orange)' 
      : 'var(--q-green)';

  const timeAgo = status.timestamp 
    ? (() => {
        const diff = Math.round((Date.now() - new Date(status.timestamp).getTime()) / 1000);
        if (diff < 60) return `${diff}s`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m`;
        return `${Math.floor(diff / 3600)}h`;
      })()
    : '';

  return (
    <div 
      className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-full transition-all"
      style={{ 
        background: status.isRecent ? `color-mix(in srgb, ${severityColor} 8%, transparent)` : 'var(--q-bg-secondary)',
        border: `1px solid ${status.isRecent ? `color-mix(in srgb, ${severityColor} 15%, transparent)` : 'var(--q-border-default)'}`,
      }}
      title={`Son AI işlem: ${status.lastEvent} — ${status.timestamp}`}
    >
      {status.isRecent && (
        <span 
          className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" 
          style={{ background: severityColor }} 
        />
      )}
      <Zap className="w-3 h-3 flex-shrink-0" style={{ color: severityColor }} />
      <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: severityColor }}>
        {label}
      </span>
      {timeAgo && (
        <span className="text-[8px] font-mono" style={{ color: 'var(--q-text-secondary)' }}>
          {timeAgo}
        </span>
      )}
    </div>
  );
}

// -- Virtualization Helper Component --
interface VirtualItemWrapperProps {
  id: string;
  children: React.ReactNode;
  onMeasure: (id: string, height: number) => void;
  cachedHeight: number;
  shouldRender: boolean;
}

const VirtualItemWrapper = React.memo(function VirtualItemWrapper({
  id,
  children,
  onMeasure,
  cachedHeight,
  shouldRender,
}: VirtualItemWrapperProps) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shouldRender || !elementRef.current) return;

    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        const height = entries[0].borderBoxSize?.[0]?.blockSize || entries[0].contentRect.height;
        if (height > 0 && height !== cachedHeight) {
          onMeasure(id, height);
        }
      }
    });

    observer.observe(elementRef.current);
    return () => observer.disconnect();
  }, [id, shouldRender, cachedHeight, onMeasure]);

  if (!shouldRender) {
    return (
      <div 
        style={{ 
          height: `${cachedHeight}px`, 
          width: "100%",
          contentVisibility: "auto",
        }} 
      />
    );
  }

  return (
    <div ref={elementRef} className="w-full">
      {children}
    </div>
  );
});

interface FlatItem {
  id: string;
  type: "header" | "message" | "media_group";
  dateLabel?: string;
  message?: any;
  messages?: any[]; // For media_group: array of consecutive image messages
}

export function ConversationViewport() {
  const { activePhone, activeContact, mobileView, setMobileView } = useInboxStore();
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const [sendError, setSendError] = useState("");
  const [gallery, setGallery] = useState<{
    images: Array<{ src: string; caption?: string; timeMs?: number }>;
    currentIndex: number;
  } | null>(null);
  // File upload state (multi-file)
  const fileInputRef = useRef<HTMLInputElement>(null);
  type UploadFileItem = { file: File; preview?: string; mediaType: 'image' | 'document' | 'audio' | 'video' };
  const [uploadFiles, setUploadFiles] = useState<UploadFileItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const queryClient = useQueryClient();
  const params = useParams();
  const tenantSlug = params?.tenant_slug as string;
  const tenantId = useRealtimeTenant();
  const isRealtimeDown = useDiagnosticsStore((state) => state.isRealtimeDown);

  // CRITICAL: We must use the REAL tenantId (UUID) for Ably, not the slug!
  const channelName = tenantId ? `presence:tenant:${tenantId}` : "";
  const { typingClients, setTypingStatus } = usePresence(tenantId || "", channelName);

  const [streamTransport, setStreamTransport] = useState<AblyStreamTransport | null>(null);

  useEffect(() => {
    if (tenantId) {
      setStreamTransport(new AblyStreamTransport(tenantId));
    }
  }, [tenantId]);

  const aiStream = useBufferedStream(
    tenantId || "",
    channelName,
    streamTransport
  );

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [unreadBadgeCount, setUnreadBadgeCount] = useState(0);
  const isScrolledUp = useRef(false);

  // Virtualization Scroll & Viewport State
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [measureTrigger, setMeasureTrigger] = useState(0);
  const itemHeights = useRef<Record<string, number>>({});

  useEffect(() => {
    itemHeights.current = {};
    setScrollTop(0);
  }, [activePhone]);

  useEffect(() => {
    if (chatContainerRef.current) {
      setViewportHeight(chatContainerRef.current.clientHeight);
    }
    
    const handleResize = () => {
      if (chatContainerRef.current) {
        setViewportHeight(chatContainerRef.current.clientHeight);
      }
    };
    
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // Expanded threshold (150px) for a more forgiving bottom detection
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 150;
    
    if (isAtBottom) {
      isScrolledUp.current = false;
      setShowScrollDown(false);
      if (unreadBadgeCount > 0) setUnreadBadgeCount(0);
    } else {
      isScrolledUp.current = true;
      setShowScrollDown(true);
    }

    const currentScrollTop = target.scrollTop;
    const currentViewportHeight = target.clientHeight;

    window.requestAnimationFrame(() => {
      setScrollTop(currentScrollTop);
      setViewportHeight(currentViewportHeight);
    });
  };

  const scrollToBottom = (behavior: "auto" | "smooth" = "smooth") => {
    if (chatContainerRef.current) {
      requestAnimationFrame(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior,
          });
        }
      });
    }
    setUnreadBadgeCount(0);
    isScrolledUp.current = false;
    setShowScrollDown(false);
  };

  const { data: messages, isLoading } = useQuery({
    queryKey: ["messages", activePhone],
    queryFn: () => getMessages(activePhone!),
    enabled: !!activePhone,
    // Realtime operates now, fallback polling if disconnected
    refetchInterval: isRealtimeDown ? 5000 : false,
    staleTime: Infinity,
    // GC: evict cache for conversations not visited in 5 minutes
    gcTime: 5 * 60 * 1000,
  });

  // Auto-scroll on new messages ONLY — status updates must NOT trigger scroll
  const prevMessageCount = useRef(0);
  const prevLastMsgId = useRef<string | null>(null);
  
  useEffect(() => {
    if (messages && messages.length > 0) {
      const currentCount = messages.length;
      const currentLastId = messages[messages.length - 1]?.id;
      const isFirstLoad = prevMessageCount.current === 0;
      const hasNewMessages = currentCount > prevMessageCount.current || currentLastId !== prevLastMsgId.current;
      
      // Only scroll/badge when actual NEW messages appear, not status mutations
      if (hasNewMessages) {
        if (!isScrolledUp.current || isFirstLoad) {
          scrollToBottom(isFirstLoad ? "auto" : "smooth");
        } else {
          const newCount = currentCount - prevMessageCount.current;
          if (newCount > 0 && !isFirstLoad) {
            setUnreadBadgeCount(prev => prev + newCount);
          }
        }
      }
      
      prevMessageCount.current = currentCount;
      prevLastMsgId.current = currentLastId;
    }
  }, [messages]);

  useEffect(() => {
    prevMessageCount.current = 0;
    prevLastMsgId.current = null;
    isScrolledUp.current = false;
    setShowScrollDown(false);
    setUnreadBadgeCount(0);
  }, [activePhone]);

  // Handle stream initialization smoothly without per-token jitter
  const prevStreamState = useRef(aiStream.state);
  useEffect(() => {
    if (aiStream.state === 'streaming' && prevStreamState.current !== 'streaming') {
      if (!isScrolledUp.current) scrollToBottom("smooth");
    }
    prevStreamState.current = aiStream.state;
  }, [aiStream.state]);

  const handleSend = async () => {
    if (!inputText.trim() || !activePhone || isSending) return;
    const textToSend = inputText.trim();
    setInputText("");
    setIsSending(true);
    setSendError("");
    
    // Force scroll to bottom upon user action
    scrollToBottom("smooth");

    const optimisticId = `temp-${Date.now()}`;
    const optimisticMsg = {
      id: optimisticId,
      sender: "agent",
      text: textToSend,
      timeMs: Date.now(),
      dateLabel: new Date().toLocaleDateString("tr-TR"),
      status: "pending"
    };

    // Snapshot the previous value
    const previousMessages = queryClient.getQueryData(["messages", activePhone]);

    // Optimistically update to the new value
    queryClient.setQueryData(["messages", activePhone], (oldData: any[]) => {
      return [...(oldData || []), optimisticMsg];
    });

    // Eğer bot aktifse, manuel mesaj atıldığı için botu otomatik kapat (Optimistic UI Update)
    if (activeContact.isBotActive) {
      useInboxStore.getState().setActiveContact(activePhone, {
        ...activeContact,
        isBotActive: false,
      });
      // Arka planda veritabanını güncelle
      toggleBotStatus(activePhone, false).then(res => {
        if (res.success) {
          queryClient.invalidateQueries({ queryKey: ["conversations"] });
        }
      });
    }

    try {
      const res = await sendMessage(activePhone, textToSend);
      if (!res.success) {
        throw new Error(res.error || "Bilinmeyen hata");
      }
    } catch (err: any) {
      // Rollback on failure
      queryClient.setQueryData(["messages", activePhone], previousMessages);
      setSendError("Mesaj gönderilemedi: " + err.message);
      setTimeout(() => setSendError(""), 4000);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      if (activePhone) setTypingStatus(false, "human");
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    
    // Broadcast typing status (throttled and debounced automatically by the hook)
    if (activePhone) {
      setTypingStatus(true, "human");
    }
  };

  // ── File Upload Handlers ──
  const ALLOWED_MIMES = [
    // Images
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
    // Documents  
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // doc, docx
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xls, xlsx
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', // ppt, pptx
    'text/plain', 'text/csv',
    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    // Audio
    'audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/amr', 'audio/mp4', 'audio/wav',
    // Video
    'video/mp4', 'video/3gpp', 'video/quicktime',
  ];
  const MAX_FILE_SIZE_MB = 16; // WhatsApp limit

  const isAllowedMime = (mime: string): boolean => {
    if (ALLOWED_MIMES.includes(mime)) return true;
    // Fallback: allow all image/*, audio/*, video/* prefixes
    if (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')) return true;
    return false;
  };

  const getMediaTypeFromMime = (mime: string): 'image' | 'document' | 'audio' | 'video' => {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'document';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    // CRITICAL: FileList is a LIVE reference — snapshot into Array BEFORE clearing input
    const files = Array.from(fileList);

    // Reset input so same file(s) can be selected again
    e.target.value = '';

    const newItems: UploadFileItem[] = [];
    for (const file of files) {
      if (!isAllowedMime(file.type)) {
        setSendError(`Desteklenmeyen dosya türü: ${file.type || file.name}`);
        setTimeout(() => setSendError(''), 4000);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setSendError(`Dosya çok büyük: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB). Maks: ${MAX_FILE_SIZE_MB}MB`);
        setTimeout(() => setSendError(''), 4000);
        continue;
      }

      const mediaType = getMediaTypeFromMime(file.type);
      let preview: string | undefined;
      if (mediaType === 'image' || mediaType === 'video') {
        preview = URL.createObjectURL(file);
      }
      newItems.push({ file, preview, mediaType });
    }

    if (newItems.length > 0) {
      setUploadFiles(prev => [...prev, ...newItems]);
    }
  };

  const handleCancelUpload = (index?: number) => {
    if (index !== undefined) {
      // Remove single file by index
      setUploadFiles(prev => {
        const removed = prev[index];
        if (removed?.preview) URL.revokeObjectURL(removed.preview);
        return prev.filter((_, i) => i !== index);
      });
    } else {
      // Remove all
      uploadFiles.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); });
      setUploadFiles([]);
    }
  };

  const handleFileUploadAndSend = async () => {
    if (uploadFiles.length === 0 || !activePhone || isUploading) return;
    setIsUploading(true);
    setSendError('');

    const captionText = inputText.trim();
    let sentCount = 0;
    
    try {
      // Process files one by one, removing each from state after success
      while (true) {
        // Read current state — files may have been removed as we go
        const remaining = uploadFiles;
        if (sentCount >= remaining.length) break;
        
        const currentFile = remaining[sentCount];
        
        // 1. Upload to Vercel Blob
        const formData = new FormData();
        formData.append('file', currentFile.file);

        const uploadRes = await fetch('/api/panel/upload', {
          method: 'POST',
          body: formData,
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json().catch(() => ({ error: 'Yükleme başarısız' }));
          throw new Error(`${currentFile.file.name}: ${errData.error || 'Yükleme başarısız'}`);
        }

        const { url: blobUrl, filename, mimeType, size } = await uploadRes.json();

        // 3. Send via server action (caption only on first file)
        const fileCaption = sentCount === 0 ? captionText || undefined : undefined;

        // 2. Optimistic UI
        const optimisticId = `temp-media-${Date.now()}-${sentCount}`;
        let contentText = '';
        if (fileCaption) {
          contentText = fileCaption;
        } else {
          contentText = currentFile.mediaType === 'image' ? '📷 Fotoğraf' 
            : currentFile.mediaType === 'video' ? '🎬 Video'
            : currentFile.mediaType === 'audio' ? '🎵 Ses kaydı' 
            : `📎 Belge — ${filename}`;
        }
        
        queryClient.setQueryData(["messages", activePhone], (oldData: any[]) => {
          return [...(oldData || []), {
            id: optimisticId,
            sender: "agent",
            text: contentText,
            timeMs: Date.now(),
            dateLabel: 'Bugün',
            status: "pending",
            mediaType: currentFile.mediaType,
            mediaUrl: blobUrl,
            mediaMetadata: { filename, mime_type: mimeType },
          }];
        });

        scrollToBottom("smooth");

        const res = await sendMediaMessage(
          activePhone,
          blobUrl,
          currentFile.mediaType,
          filename,
          mimeType,
          size,
          fileCaption
        );

        if (!res.success) {
          throw new Error(res.error || `${currentFile.file.name} gönderilemedi`);
        }

        sentCount++;
      }

      // All sent — clear
      uploadFiles.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); });
      setUploadFiles([]);
      setInputText('');
    } catch (err: any) {
      // Remove successfully sent files from preview, keep remaining
      if (sentCount > 0) {
        setUploadFiles(prev => {
          prev.slice(0, sentCount).forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); });
          return prev.slice(sentCount);
        });
        setInputText(''); // Caption was sent with first file
      }
      setSendError('Dosya gönderilemedi: ' + err.message);
      setTimeout(() => setSendError(''), 5000);
    } finally {
      setIsUploading(false);
    }
  };

  const handleToggleBot = async () => {
    if (!activePhone || isTogglingBot) return;
    setIsTogglingBot(true);
    const newBotState = !activeContact.isBotActive;

    useInboxStore.getState().setActiveContact(activePhone, {
      ...activeContact,
      isBotActive: newBotState,
    });

    const res = await toggleBotStatus(activePhone, newBotState);
    if (res.success) {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } else {
      useInboxStore.getState().setActiveContact(activePhone, {
        ...activeContact,
        isBotActive: !newBotState,
      });
      setSendError("Bot durumu değiştirilirken hata oluştu.");
      setTimeout(() => setSendError(""), 4000);
    }
    setIsTogglingBot(false);
  };

  // Collect all conversation images for gallery navigation (inbound + outbound)
  const allConversationImages = useMemo(() => {
    if (!messages || messages.length === 0) return [];
    return messages
      .filter((m: any) => (m.mediaType === 'image' || m.mediaType === 'sticker') && m.mediaUrl)
      .map((m: any) => ({
        src: m.mediaUrl,
        caption: m.mediaMetadata?.caption || undefined,
        timeMs: m.timeMs,
      }));
  }, [messages]);

  // Flatten date-grouped messages into a dynamic virtualization feed
  const flatItems = useMemo<FlatItem[]>(() => {
    if (!messages || messages.length === 0) return [];
    
    const items: FlatItem[] = [];
    const groups = messages.reduce((acc: Record<string, any[]>, msg: any) => {
      let dateKey = msg.dateLabel;
      if (msg.timeMs) {
        const date = new Date(msg.timeMs);
        const fmtDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
        const now = new Date();
        const msgDateStr = fmtDate(date);
        const nowDateStr = fmtDate(now);
        const diffMs = new Date(nowDateStr + "T00:00:00Z").getTime() - new Date(msgDateStr + "T00:00:00Z").getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
          dateKey = 'Bugün';
        } else if (diffDays === 1) {
          dateKey = 'Dün';
        } else if (diffDays > 1 && diffDays < 7) {
          let lbl = date.toLocaleDateString('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' });
          dateKey = lbl.charAt(0).toUpperCase() + lbl.slice(1);
        } else {
          dateKey = date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
        }
      }
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(msg);
      return acc;
    }, {} as Record<string, any[]>);

    Object.entries(groups as Record<string, any[]>).forEach(([dateLabel, groupMsgs]) => {
      items.push({
        id: `header-${dateLabel}`,
        type: "header",
        dateLabel,
      });
      // Smart image grouping — groups same-sender images within 2min window
      // Skips interleaved bot messages (which shouldn't happen after batch fix, but handles legacy data)
      // User text messages break the group
      let i = 0;
      while (i < groupMsgs.length) {
        const msg = groupMsgs[i];
        const isImage = (msg.mediaType === 'image' || msg.mediaType === 'sticker') && msg.mediaUrl;
        
        if (isImage) {
          const group: any[] = [msg];
          let j = i + 1;
          
          while (j < groupMsgs.length) {
            const next = groupMsgs[j];
            const nextIsImage = (next.mediaType === 'image' || next.mediaType === 'sticker') && next.mediaUrl;
            const sameSender = next.sender === msg.sender;
            
            // Skip bot auto-replies between user images (interleaved bot messages)
            const isBotInterleave = next.sender !== msg.sender && next.sender !== 'user' && !nextIsImage;
            if (isBotInterleave && msg.sender === 'user') {
              // Check if there's another user image after this bot message
              let k = j + 1;
              let foundNextImage = false;
              while (k < groupMsgs.length && k - j <= 3) { // Look ahead max 3 messages
                const peek = groupMsgs[k];
                if (peek.sender === msg.sender && (peek.mediaType === 'image' || peek.mediaType === 'sticker') && peek.mediaUrl) {
                  const timeDiff = peek.timeMs && group[group.length - 1].timeMs 
                    ? Math.abs(peek.timeMs - group[group.length - 1].timeMs) : 0;
                  if (timeDiff < 120000) { foundNextImage = true; }
                }
                k++;
              }
              if (foundNextImage) {
                j++; // Skip bot message, continue looking
                continue;
              } else {
                break; // No more user images after bot message
              }
            }
            
            // User TEXT message from same sender breaks the group
            if (sameSender && !nextIsImage && next.content?.trim()) {
              break;
            }
            
            // Non-image from different sender — break
            if (!nextIsImage && !isBotInterleave) {
              break;
            }
            
            // Same sender image within 2min window
            if (nextIsImage && sameSender) {
              const timeDiff = next.timeMs && group[group.length - 1].timeMs 
                ? Math.abs(next.timeMs - group[group.length - 1].timeMs) : 0;
              const withinWindow = timeDiff < 120000;
              if (withinWindow) {
                group.push(next);
                j++;
              } else {
                break;
              }
            } else {
              break;
            }
          }
          
          if (group.length > 1) {
            items.push({
              id: `media-group-${group[0].id}`,
              type: "media_group",
              messages: group,
              message: group[0],
            });
          } else {
            items.push({
              id: String(msg.id),
              type: "message",
              message: msg,
            });
          }
          i = j;
        } else {
          items.push({
            id: String(msg.id),
            type: "message",
            message: msg,
          });
          i++;
        }
      }
    });
    
    return items;
  }, [messages]);

  // Calculate top offsets for zero-layout-shift spacer sizing
  const { itemOffsets, totalHeight } = useMemo(() => {
    const offsets: number[] = [];
    let currentOffset = 0;
    
    flatItems.forEach((item) => {
      offsets.push(currentOffset);
      const height = itemHeights.current[item.id] || (item.type === 'header' ? 48 : 85);
      currentOffset += height;
    });
    
    return { itemOffsets: offsets, totalHeight: currentOffset };
  }, [flatItems, measureTrigger]);

  // Perform highly efficient O(N) slicing of the visible viewport window
  const { startIndex, endIndex } = useMemo(() => {
    let start = 0;
    let end = flatItems.length - 1;
    
    for (let i = 0; i < flatItems.length; i++) {
      const offset = itemOffsets[i];
      const height = itemHeights.current[flatItems[i].id] || (flatItems[i].type === 'header' ? 48 : 85);
      if (offset + height >= scrollTop) {
        start = i;
        break;
      }
    }
    
    for (let i = start; i < flatItems.length; i++) {
      const offset = itemOffsets[i];
      if (offset > scrollTop + viewportHeight) {
        end = i;
        break;
      }
    }
    
    // Proactive rendering buffer (25 items) to prevent any white-screen flashes when scrolling fast
    const buffer = 25;
    const startWithBuffer = Math.max(0, start - buffer);
    const endWithBuffer = Math.min(flatItems.length - 1, end + buffer);
    
    return { startIndex: startWithBuffer, endIndex: endWithBuffer };
  }, [itemOffsets, flatItems, scrollTop, viewportHeight]);

  // Spacers for windowed virtualization
  const { topSpacerHeight, bottomSpacerHeight } = useMemo(() => {
    if (flatItems.length === 0) return { topSpacerHeight: 0, bottomSpacerHeight: 0 };
    
    const topSpacer = itemOffsets[startIndex] || 0;
    const lastVisibleItemOffset = itemOffsets[endIndex] || 0;
    const lastVisibleItemHeight = itemHeights.current[flatItems[endIndex]?.id] || (flatItems[endIndex]?.type === 'header' ? 48 : 85);
    const bottomSpacer = Math.max(0, totalHeight - (lastVisibleItemOffset + lastVisibleItemHeight));
    
    return { topSpacerHeight: topSpacer, bottomSpacerHeight: bottomSpacer };
  }, [startIndex, endIndex, itemOffsets, flatItems, totalHeight]);

  const handleItemMeasure = useCallback((id: string, height: number) => {
    if (itemHeights.current[id] !== height) {
      itemHeights.current[id] = height;
      setMeasureTrigger(prev => prev + 1);
    }
  }, []);

  // -- Empty state --
  if (!activePhone || !activeContact) {
    return (
      <div className={`w-full md:flex-1 md:flex flex-col items-center justify-center h-full relative z-0 ${mobileView === "chat" ? "flex" : "hidden md:flex"}`}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center shadow-sm mb-4" style={{ background: "rgba(255,255,255,0.6)" }}>
          <MessageCircle className="w-8 h-8 opacity-50" style={{ color: "var(--q-text-secondary)" }} />
        </div>
        <p className="font-medium" style={{ color: "var(--q-text-secondary)" }}>
          Görüntülemek için sol taraftan bir kişi seçin.
        </p>
      </div>
    );
  }

  return (
    <div className={`w-full md:flex-1 md:flex flex-col bg-transparent h-full relative z-0 ${mobileView === "chat" ? "flex" : "hidden md:flex"}`}>
      
      {/* ── Media Gallery Lightbox (Portal to body — escapes z-0 stacking context) ── */}
      {gallery && createPortal(
        <MediaGalleryLightbox 
          images={gallery.images} 
          currentIndex={gallery.currentIndex} 
          onClose={() => setGallery(null)} 
          onNavigate={(idx) => setGallery(prev => prev ? { ...prev, currentIndex: idx } : null)}
        />,
        document.body
      )}
      {/* ── Header ── */}
      <div
        className="h-[72px] px-4 md:px-8 flex items-center justify-between q-glass-strong sticky top-0 z-10"
        style={{ borderBottom: "1px solid var(--q-border-default)", boxShadow: "var(--q-shadow-sm)" }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileView("list")}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-full shadow-sm q-press"
            style={{ background: "rgba(255,255,255,0.5)", border: "1px solid var(--q-border-default)" }}
          >
            <ChevronLeft className="w-5 h-5" style={{ color: "var(--q-text-primary)" }} />
          </button>
          <div>
            <div className="flex items-center">
              <h3 className="font-bold text-lg tracking-tight truncate max-w-[130px] md:max-w-[300px]" style={{ color: "var(--q-text-primary)" }}>
                {activeContact.name || activeContact.id}
              </h3>
              {(() => {
                const normalizedName = activeContact.country ? normalizeCountryName(activeContact.country) : '';
                const country = (activeContact.country ? { flag: getCountryFlag(normalizedName), name: normalizedName, code: '' } : null) || getCountryFromPhone(activeContact.id);
                return country ? (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-semibold flex-shrink-0" style={{ background: 'rgba(0,0,0,0.04)', color: 'var(--q-text-secondary)' }}>
                    {country.flag} {country.name}
                  </span>
                ) : null;
              })()}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs font-medium" style={{ color: "var(--q-text-secondary)" }}>
                {activeContact.id}
              </p>
              {typingClients.length > 0 && (
                <span className="text-[11px] font-semibold text-emerald-500 animate-pulse flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  {typingClients.some(c => c.agentType === 'ai') ? 'AI üretiyor...' : 'Birisi yazıyor...'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* AI Status Badge */}
          <AiStatusBadge phoneNumber={activePhone} />
          {/* Bot toggle chip */}
          <div className="flex items-center gap-2 px-2.5 md:px-3.5 py-1.5 rounded-full q-glass-strong" style={{ border: "1px solid var(--q-border-default)", boxShadow: "var(--q-shadow-sm)" }}>
            {activeContact.isBotActive ? (
              <Sparkles className="w-3.5 h-3.5 animate-pulse" style={{ color: "var(--q-blue)" }} />
            ) : (
              <User className="w-3.5 h-3.5" style={{ color: "var(--q-text-secondary)" }} />
            )}
            <span
              className="hidden md:inline text-[11px] font-bold uppercase tracking-wider"
              style={{ color: activeContact.isBotActive ? "var(--q-blue)" : "var(--q-text-secondary)" }}
            >
              AI Otopilot
            </span>
            <span
              className="md:hidden text-[10px] font-bold uppercase tracking-wider px-0.5"
              style={{ color: activeContact.isBotActive ? "var(--q-blue)" : "var(--q-text-secondary)" }}
            >
              AI
            </span>
            <div className="h-3 w-[1px] mx-1" style={{ background: "var(--q-border-strong)" }} />
            <button
              onClick={handleToggleBot}
              disabled={isTogglingBot}
              className="w-9 h-5 rounded-full relative transition-all duration-300 flex items-center shadow-inner hover:opacity-90 cursor-pointer"
              style={{ background: activeContact.isBotActive ? "var(--q-blue)" : "var(--q-bg-tertiary)", opacity: isTogglingBot ? 0.5 : 1 }}
            >
              <span className={`absolute w-4 h-4 bg-white rounded-full shadow-md transition-transform duration-300 ${activeContact.isBotActive ? "left-[2px] translate-x-4" : "left-[2px]"}`} />
            </button>
          </div>
          {/* Mobile CRM button */}
          <button
            onClick={() => setMobileView("crm")}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-full q-press"
            style={{ background: "var(--q-blue-bg)", border: "1px solid rgba(0,122,255,0.2)", color: "var(--q-blue)" }}
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Messages Area ── */}
      <div className="flex-1 relative flex flex-col min-h-0">
        <div 
          ref={chatContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 md:p-6 block"
          style={{ background: "var(--q-bg-secondary)" }}
        >
        {isLoading ? (
          <ChatSkeleton />
        ) : (
          <>
            {/* Top Virtual Spacer */}
            {topSpacerHeight > 0 && (
              <div 
                style={{ 
                  height: `${topSpacerHeight}px`, 
                  width: "100%",
                  pointerEvents: "none"
                }} 
              />
            )}

            {/* Sliced Visible Items */}
            {flatItems.slice(startIndex, endIndex + 1).map((item) => {
              const cachedHeight = itemHeights.current[item.id] || (item.type === 'header' ? 48 : 85);
              
              return (
                <VirtualItemWrapper
                  key={item.id}
                  id={item.id}
                  cachedHeight={cachedHeight}
                  shouldRender={true}
                  onMeasure={handleItemMeasure}
                >
                  {item.type === "header" ? (
                    <div className="sticky top-2 z-10 flex justify-center w-full my-4 pointer-events-none">
                      <span
                        className="text-[11px] font-bold px-3 py-1 rounded-md shadow-sm pointer-events-auto"
                        style={{ 
                          background: "var(--q-bg-primary)", 
                          color: "var(--q-text-secondary)", 
                          border: "1px solid var(--q-border-default)" 
                        }}
                      >
                        {item.dateLabel}
                      </span>
                    </div>
                  ) : item.type === "media_group" ? (() => {
                    /* ── WhatsApp-style Image Grid with +N overlay ── */
                    const allGroupImages = item.messages || [];
                    const totalCount = allGroupImages.length;
                    const displayImages = allGroupImages.slice(0, Math.min(4, totalCount));
                    const overflow = totalCount - 4;
                    const cols = displayImages.length === 1 ? 1 : 2;
                    // For 3 images: first image spans full width
                    const isThreeLayout = displayImages.length === 3;

                    return (
                    <div className={`flex w-full ${item.message.sender === "user" ? "justify-start" : "justify-end"} pb-4`}>
                      <div 
                        className={`relative max-w-[85%] md:max-w-[65%] overflow-hidden shadow-sm transition-all duration-200 hover:shadow-md ${
                          item.message.sender === "user" 
                            ? "rounded-2xl rounded-tl-sm" 
                            : "rounded-2xl rounded-tr-sm"
                        }`}
                        style={
                          item.message.sender === "user"
                            ? { background: "var(--q-chat-in)" }
                            : { background: "var(--q-chat-out)" }
                        }
                      >
                        <div 
                          className="grid gap-[2px]"
                          style={{ 
                            gridTemplateColumns: cols === 1 ? '1fr' : 'repeat(2, 1fr)',
                          }}
                        >
                          {displayImages.map((imgMsg: any, idx: number) => {
                            const isLastWithOverflow = idx === 3 && overflow > 0;
                            // 3-image layout: first image spans 2 columns
                            const spanTwo = isThreeLayout && idx === 0;
                            
                            return (
                              <div 
                                key={imgMsg.id} 
                                className="relative cursor-pointer overflow-hidden"
                                style={{ 
                                  gridColumn: spanTwo ? 'span 2' : undefined,
                                  aspectRatio: spanTwo ? '2/1' : (displayImages.length <= 2 ? '4/3' : '1/1'),
                                  minHeight: '80px',
                                  maxHeight: spanTwo ? '200px' : '180px',
                                }}
                                onClick={() => {
                                  // Find this image's index in allConversationImages
                                  const globalIdx = allConversationImages.findIndex(
                                    (ci: any) => ci.src === imgMsg.mediaUrl
                                  );
                                  setGallery({
                                    images: allConversationImages,
                                    currentIndex: globalIdx >= 0 ? globalIdx : 0,
                                  });
                                }}
                              >
                                <img
                                  src={imgMsg.mediaUrl}
                                  alt={imgMsg.mediaMetadata?.caption || `Görsel ${idx + 1}`}
                                  className="w-full h-full object-cover hover:opacity-90 transition-opacity"
                                  loading="lazy"
                                  draggable={false}
                                />
                                {isLastWithOverflow && (
                                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                    <span className="text-white text-2xl font-bold">+{overflow}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* Timestamp on last image */}
                        <div className="absolute bottom-1 right-2 flex items-center gap-1 text-[10px] font-semibold tracking-wide" style={{ color: "rgba(255,255,255,0.85)", textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>
                          <span>
                            {allGroupImages[allGroupImages.length - 1]?.timeMs 
                              ? new Date(allGroupImages[allGroupImages.length - 1].timeMs).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) 
                              : ''}
                          </span>
                          <span className="ml-0.5">
                            {item.message.sender !== "user" && <CheckCheck className="w-3.5 h-3.5" />}
                          </span>
                        </div>
                      </div>
                    </div>
                    );
                  })() : (
                    <div className="flex flex-col q-bubble-in w-full pb-4">
                      {item.message.sender === "system" ? (
                        <div className="flex w-full justify-center">
                          <div
                            className="rounded-full px-4 py-1.5 flex items-center gap-2 shadow-sm max-w-[90%] md:max-w-[70%] text-center q-glass-strong"
                            style={{ border: "1px solid var(--q-orange-bg)", color: "var(--q-orange)" }}
                          >
                            <ShieldAlert className="w-4 h-4 flex-shrink-0" style={{ color: "var(--q-orange)" }} />
                            <p className="text-[13px] font-semibold tracking-tight leading-tight">{item.message.text}</p>
                            <span className="text-[10px] font-bold opacity-60 ml-2 whitespace-nowrap flex items-center gap-1">
                              <span>{item.message.timeMs ? new Date(item.message.timeMs).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : item.message.time}</span>
                              <span className="ml-0.5">
                                {item.message.status === 'pending' && <Clock className="w-3 h-3" />}
                                {(item.message.status === 'sent' || !item.message.status) && <Check className="w-3.5 h-3.5" />}
                                {item.message.status === 'delivered' && <CheckCheck className="w-3.5 h-3.5" />}
                                {item.message.status === 'read' && <CheckCheck className="w-3.5 h-3.5" style={{ color: "#53bdeb", opacity: 1 }} />}
                              </span>
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className={`flex w-full ${item.message.sender === "user" ? "justify-start" : "justify-end"} group`}>
                          <div
                            className={`relative max-w-[85%] md:max-w-[65%] px-3 py-2 md:px-4 md:py-2.5 shadow-sm transition-all duration-200 hover:shadow-md ${
                              item.message.sender === "user" 
                                ? "rounded-2xl rounded-tl-sm" 
                                : "rounded-2xl rounded-tr-sm"
                            }`}
                            style={
                              item.message.sender === "user"
                                ? { background: "var(--q-chat-in)", color: "var(--q-text-primary)" }
                                : { background: "var(--q-chat-out)", color: "var(--q-text-primary)" }
                            }
                          >
                            {item.message.sender !== "user" && (
                              <div className="flex items-center gap-1 mb-1 opacity-70">
                                {item.message.sender === "bot" ? (
                                  <Sparkles className="w-3 h-3" style={{ color: "var(--q-purple)" }} />
                                ) : (
                                  <User className="w-3 h-3" style={{ color: "var(--q-text-secondary)" }} />
                                )}
                                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: item.message.sender === "bot" ? "var(--q-purple)" : "var(--q-text-secondary)" }}>
                                  {item.message.sender === "bot" ? "AI" : "SEN"}
                                </span>
                              </div>
                            )}
                            {/* ── MEDIA CONTENT ── */}
                            {item.message.mediaType && item.message.mediaUrl && (
                              <MediaBubbleContent
                                message={item.message}
                                onGalleryOpen={(src) => {
                                  const idx = allConversationImages.findIndex((ci: any) => ci.src === src);
                                  setGallery({
                                    images: allConversationImages,
                                    currentIndex: idx >= 0 ? idx : 0,
                                  });
                                }}
                              />
                            )}

                            {/* ── TEXT CONTENT (caption only, no emoji prefix) ── */}
                            {(() => {
                              const text = item.message.text;
                              const mt = item.message.mediaType;
                              if (!text) return <div className="pb-4" />;
                              
                              // If media is rendered, extract clean caption (strip "📷 Fotoğraf: " prefix)
                              if (mt && item.message.mediaUrl) {
                                const placeholders = ['📷 Fotoğraf', '📎 Belge', '🎵 Ses kaydı', '🎬 Video', '📍 Konum', '🏷️ Sticker'];
                                const emojiPrefixes = ['📷', '📎', '🎵', '🎬', '📍', '🏷️', '📦'];
                                
                                // Pure placeholder — hide text entirely
                                if (placeholders.includes(text) || emojiPrefixes.includes(text)) {
                                  return <div className="pb-4" />;
                                }
                                
                                // "📷 Fotoğraf: caption" → show only caption
                                const colonIdx = text.indexOf(': ');
                                if (colonIdx !== -1) {
                                  const before = text.substring(0, colonIdx);
                                  if (emojiPrefixes.some(p => before.startsWith(p))) {
                                    const caption = text.substring(colonIdx + 2).trim();
                                    if (caption) {
                                      return (
                                        <p className="text-[15px] leading-[1.4] font-medium whitespace-pre-wrap pb-4">
                                          {caption}
                                        </p>
                                      );
                                    }
                                    return <div className="pb-4" />;
                                  }
                                }
                              }
                              
                              // Non-media message or no prefix — show full text
                              return (
                                <p className="text-[15px] leading-[1.4] font-medium whitespace-pre-wrap pb-4">
                                  {text}
                                </p>
                              );
                            })()}
                            
                            <div className="absolute bottom-1 right-2 flex items-center gap-1 text-[10px] font-semibold tracking-wide" style={{ color: "var(--q-text-secondary)" }}>
                              <span className="opacity-50">{item.message.timeMs ? new Date(item.message.timeMs).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : item.message.time}</span>
                              {item.message.sender !== "user" && (
                                <span className="ml-0.5 opacity-80">
                                  {item.message.status === 'pending' && <Clock className="w-3 h-3 opacity-50" />}
                                  {(item.message.status === 'sent' || (!item.message.status && item.message.sender === 'agent')) && <Check className="w-3.5 h-3.5 opacity-70" />}
                                  {item.message.status === 'delivered' && <CheckCheck className="w-3.5 h-3.5 opacity-70" />}
                                  {item.message.status === 'read' && <CheckCheck className="w-3.5 h-3.5" style={{ color: "#53bdeb", opacity: 1 }} />}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </VirtualItemWrapper>
              );
            })}

            {/* Bottom Virtual Spacer */}
            {bottomSpacerHeight > 0 && (
              <div 
                style={{ 
                  height: `${bottomSpacerHeight}px`, 
                  width: "100%",
                  pointerEvents: "none"
                }} 
              />
            )}
          </>
        )}
          
          {/* AI Stream Bubble */}
          <StreamBubble 
            isStreaming={aiStream.isStreaming}
            state={aiStream.state}
            content={aiStream.content}
            metrics={aiStream.metrics}
            showMetrics={true} 
          />
          
          {/* AI Observability Timeline */}
          {activeContact.isBotActive && <AiRuntimeTimeline conversationId={activePhone!} />}
          
          {/* Zero-Layout-Shift Typing Indicator at the bottom */}
          <TypingIndicator 
            typingClients={typingClients.filter(c => 
              c.agentType === 'human' || (c.agentType === 'ai' && aiStream.state === 'idle')
            )} 
          />
          
          {/* Invisible anchor for native CSS overflow pinning */}
          <div style={{ height: "1px", width: "100%", overflowAnchor: "auto" }} />
        </div>

        {/* Scroll to Bottom Button & New Message Badge */}
        <AnimatePresence>
          {showScrollDown && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.9 }}
              className="absolute bottom-4 right-4 z-20 flex flex-col items-center gap-2"
            >
              {unreadBadgeCount > 0 ? (
                <button
                  onClick={() => scrollToBottom("smooth")}
                  className="px-4 py-2.5 rounded-full text-[13px] font-bold shadow-[0_8px_16px_rgba(0,122,255,0.25)] transition-all cursor-pointer flex items-center gap-1.5 q-press hover:scale-105"
                  style={{ 
                    background: "rgba(0, 122, 255, 0.9)", 
                    color: "white", 
                    backdropFilter: "blur(12px)", 
                    border: "1px solid rgba(255,255,255,0.1)" 
                  }}
                >
                  <ArrowDown className="w-4 h-4" />
                  {unreadBadgeCount} Yeni Mesaj
                </button>
              ) : (
                <button
                  onClick={() => scrollToBottom("smooth")}
                  className="w-11 h-11 rounded-full flex items-center justify-center shadow-[0_8px_16px_rgba(0,0,0,0.1)] transition-all duration-300 q-press hover:scale-105"
                  style={{ 
                    background: "rgba(255,255,255,0.8)", 
                    backdropFilter: "blur(16px)", 
                    border: "1px solid rgba(0,0,0,0.05)", 
                    color: "var(--q-text-primary)" 
                  }}
                  aria-label="En alta kaydır"
                >
                  <ChevronDown className="w-6 h-6" />
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Inline error ── */}
      {sendError && (
        <div className="mx-6 mb-2 px-4 py-2 rounded-xl text-[13px] font-medium q-bubble-in" style={{ background: "var(--q-red-bg)", color: "var(--q-red)", border: "1px solid rgba(255,59,48,0.2)" }}>
          {sendError}
        </div>
      )}

      {/* ── Input Area ── */}
      <div className="p-6 q-glass-strong z-10" style={{ borderTop: "1px solid var(--q-border-default)", boxShadow: "0 -1px 10px rgba(0,0,0,0.02)" }}>
        {/* Upload Preview Bar (multi-file) */}
        {uploadFiles.length > 0 && (
          <div 
            className="mb-3 px-3 py-2.5 rounded-xl"
            style={{ background: "var(--q-bg-secondary)", border: "1px solid var(--q-border-default)" }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--q-text-secondary)" }}>
                {uploadFiles.length} dosya seçildi
              </span>
              <button
                onClick={() => handleCancelUpload()}
                className="text-xs font-medium px-2 py-0.5 rounded-md hover:bg-[--q-bg-hover] transition-colors"
                style={{ color: "var(--q-red)" }}
              >
                Tümünü Kaldır
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {uploadFiles.map((uf, idx) => (
                <div key={idx} className="relative flex-shrink-0 group">
                  {uf.preview ? (
                    <img src={uf.preview} alt="" className="w-14 h-14 rounded-lg object-cover" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg flex flex-col items-center justify-center gap-0.5" style={{ background: "var(--q-bg-hover)" }}>
                      {uf.mediaType === 'audio' ? (
                        <Mic className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
                      ) : (
                        <FileText className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
                      )}
                      <span className="text-[8px] font-medium truncate max-w-[48px]" style={{ color: "var(--q-text-secondary)" }}>
                        {uf.file.name.split('.').pop()?.toUpperCase()}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => handleCancelUpload(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "var(--q-red)", color: "white" }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {/* Add more button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0 border-2 border-dashed hover:bg-[--q-bg-hover] transition-colors"
                style={{ borderColor: "var(--q-border-default)" }}
                title="Daha fazla dosya ekle"
              >
                <span className="text-xl font-light" style={{ color: "var(--q-text-secondary)" }}>+</span>
              </button>
            </div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z"
          className="hidden"
          multiple
          onChange={handleFileSelect}
        />

        <div
          className="flex items-end gap-3 p-2 rounded-2xl transition-all focus-within:ring-4"
          style={{ background: "rgba(255,255,255,0.8)", border: "1px solid var(--q-border-default)", boxShadow: "var(--q-shadow-sm)" }}
        >
          <button 
            className="p-2.5 rounded-xl transition-all duration-200 cursor-pointer hover:bg-[--q-bg-hover]" 
            style={{ color: "var(--q-text-secondary)" }}
            onClick={() => fileInputRef.current?.click()}
            title="Dosya ekle (Görsel, PDF, Ses)"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <textarea
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (uploadFiles.length > 0) {
                  handleFileUploadAndSend();
                } else {
                  handleSend();
                }
                if (activePhone) setTypingStatus(false, "human");
              }
            }}
            placeholder={uploadFiles.length > 0 ? "Açıklama ekleyin (opsiyonel)..." : "Mesajınızı yazın..."}
            className="flex-1 max-h-32 min-h-[44px] bg-transparent resize-none outline-none py-2.5 text-[15px] font-medium"
            style={{ color: "var(--q-text-primary)" }}
            rows={1}
            disabled={isSending || isUploading}
          />

          <button
            onClick={uploadFiles.length > 0 ? handleFileUploadAndSend : handleSend}
            disabled={(isSending || isUploading) || (uploadFiles.length === 0 && !inputText.trim())}
            className="p-2.5 text-white rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer q-press"
            style={{
              background: (uploadFiles.length > 0 || inputText.trim()) && !isSending && !isUploading ? "var(--q-blue)" : "rgba(134,134,139,0.5)",
              boxShadow: (uploadFiles.length > 0 || inputText.trim()) && !isSending && !isUploading ? "0 4px 10px rgba(0,122,255,0.3)" : "none",
            }}
          >
            {isSending || isUploading ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin ml-0.5" />
            ) : (
              <Send className="w-5 h-5 ml-0.5" />
            )}
          </button>
        </div>
        <p className="text-center text-[11px] font-medium mt-3" style={{ color: "var(--q-text-secondary)" }}>
          Göndermek için <kbd className="font-mono px-1.5 py-0.5 rounded shadow-sm mx-1" style={{ background: "var(--q-bg-primary)", border: "1px solid var(--q-border-default)" }}>Enter</kbd>
          (Alt satır için <kbd className="font-mono px-1.5 py-0.5 rounded shadow-sm mx-1" style={{ background: "var(--q-bg-primary)", border: "1px solid var(--q-border-default)" }}>Shift + Enter</kbd>)
        </p>
      </div>
    </div>
  );
}
