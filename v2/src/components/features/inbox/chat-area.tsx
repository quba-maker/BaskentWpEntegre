"use client";

import React, { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Paperclip, User, MessageCircle, ChevronLeft, ChevronDown, Info, ShieldAlert, Sparkles, Zap, Check, CheckCheck, Clock } from "lucide-react";
import { getMessages, sendMessage, toggleBotStatus } from "@/app/actions/inbox";
import { useInboxStore } from "@/store/inbox-store";
import { AiRuntimeTimeline } from "@/components/features/ai-observability/AiRuntimeTimeline";
import { getAiStatusForConversation } from "@/app/actions/ai-observability";
import { useParams } from "next/navigation";
import { usePresence } from "@/hooks/use-presence";
import { TypingIndicator } from "@/components/features/realtime/typing-indicator";
import { useBufferedStream } from "@/hooks/use-buffered-stream";
import { AblyStreamTransport } from "@/lib/ai/streaming/stream-transport";
import { StreamBubble } from "@/components/features/realtime/stream-bubble";

// ==========================================
// CONVERSATION VIEWPORT — Central chat surface
// Architecture: Communication surface (not display component)
// Authority: Messages, sending, bot toggle
// Governance: Token-native, skeleton-first, q-glass
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

// -- Country flag (shared utility) --
function countryFlag(country: string | undefined): string {
  if (!country) return "";
  const map: Record<string, string> = {
    "Türkiye": "🇹🇷", "Almanya": "🇩🇪", "İngiltere": "🇬🇧", "Fransa": "🇫🇷",
    "Hollanda": "🇳🇱", "Belçika": "🇧🇪", "Özbekistan": "🇺🇿", "Azerbaycan": "🇦🇿",
    "Rusya": "🇷🇺", "ABD": "🇺🇸",
  };
  return map[country] || "🌍";
}

// -- AI Status Badge --
const AI_EVENT_LABELS: Record<string, string> = {
  'ai_response_generated': 'Response ✓',
  'identity_resolved': 'Identity ✓',
  'crm_extraction_completed': 'CRM Updated',
  'memory_updated': 'Memory Synced',
  'tool_executed': 'Tool OK',
  'policy_blocked': 'Policy Block',
  'human_escalation': 'Escalated',
  'ai_timeout': 'Timeout',
  'working_hours_blocked': 'Off-hours',
  'brain_resolved': 'Brain Ready',
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

export function ConversationViewport() {
  const { activePhone, activeContact, mobileView, setMobileView } = useInboxStore();
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const [sendError, setSendError] = useState("");
  const queryClient = useQueryClient();
  const params = useParams();
  const tenantSlug = params?.tenant_slug as string;

  const channelName = tenantSlug ? `presence:tenant:${tenantSlug}` : "";
  const { typingClients, setTypingStatus } = usePresence(tenantSlug, channelName);

  const [streamTransport, setStreamTransport] = useState<AblyStreamTransport | null>(null);

  useEffect(() => {
    if (tenantSlug) {
      setStreamTransport(new AblyStreamTransport(tenantSlug));
    }
  }, [tenantSlug]);

  const aiStream = useBufferedStream(
    tenantSlug,
    channelName,
    streamTransport
  );

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // Show scroll down button if we are not at the bottom
    const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;
    setShowScrollDown(!isAtBottom);
  };

  const scrollToBottom = (behavior: "auto" | "smooth" = "smooth") => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior,
      });
    }
  };

  const { data: messages, isLoading } = useQuery({
    queryKey: ["messages", activePhone],
    queryFn: () => getMessages(activePhone!),
    enabled: !!activePhone,
    // Realtime operates now, no polling needed
    staleTime: Infinity,
  });

  // Auto-scroll on messages load or change
  useEffect(() => {
    if (messages && messages.length > 0) {
      // Small delay to ensure DOM is updated
      setTimeout(() => scrollToBottom("auto"), 50);
    }
  }, [messages, activePhone]);

  const handleSend = async () => {
    if (!inputText.trim() || !activePhone || isSending) return;
    const textToSend = inputText.trim();
    setInputText("");
    setIsSending(true);
    setSendError("");

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
      // Note: Do not immediately invalidate here if relying on Realtime Event (Ably)
      // to resolve the optimistic message. If the event arrives, it handles reconciliation.
      // But we can silently invalidate in background just to be safe.
      // queryClient.invalidateQueries({ queryKey: ["messages", activePhone] });
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
              {activeContact.country && (
                <span className="ml-1.5 text-[14px] opacity-90 flex-shrink-0" title={activeContact.country}>
                  {countryFlag(activeContact.country)}
                </span>
              )}
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
          Object.entries(
            (messages || []).reduce((acc: any, msg: any) => {
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
            }, {})
          ).map(([dateLabel, groupMsgs]: [string, any]) => (
            <div 
              key={dateLabel} 
              className="block mb-6 relative"
              style={{ contentVisibility: "auto", containIntrinsicSize: "auto 500px" }}
            >
              <div className="sticky top-2 z-10 flex justify-center w-full my-4 pointer-events-none">
                <span
                  className="text-[11px] font-bold px-3 py-1 rounded-md shadow-sm pointer-events-auto"
                  style={{ 
                    background: "var(--q-bg-primary)", 
                    color: "var(--q-text-secondary)", 
                    border: "1px solid var(--q-border-default)" 
                  }}
                >
                  {dateLabel}
                </span>
              </div>
              <div className="flex flex-col gap-6">
                {groupMsgs.map((msg: any) => (
                  <div key={msg.id} className="flex flex-col q-bubble-in w-full">
                    {msg.sender === "system" ? (
                      <div className="flex w-full justify-center">
                        <div
                          className="rounded-full px-4 py-1.5 flex items-center gap-2 shadow-sm max-w-[90%] md:max-w-[70%] text-center q-glass-strong"
                          style={{ border: "1px solid var(--q-orange-bg)", color: "var(--q-orange)" }}
                        >
                          <ShieldAlert className="w-4 h-4 flex-shrink-0" style={{ color: "var(--q-orange)" }} />
                          <p className="text-[13px] font-semibold tracking-tight leading-tight">{msg.text}</p>
                          <span className="text-[10px] font-bold opacity-60 ml-2 whitespace-nowrap flex items-center gap-1">
                            <span>{msg.timeMs ? new Date(msg.timeMs).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : msg.time}</span>
                            <span className="ml-0.5">
                              {msg.status === 'pending' && <Clock className="w-3 h-3" />}
                              {(msg.status === 'sent' || !msg.status) && <Check className="w-3.5 h-3.5" />}
                              {msg.status === 'delivered' && <CheckCheck className="w-3.5 h-3.5" />}
                              {msg.status === 'read' && <CheckCheck className="w-3.5 h-3.5" style={{ color: "#53bdeb", opacity: 1 }} />}
                            </span>
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className={`flex w-full ${msg.sender === "user" ? "justify-start" : "justify-end"} group`}>
                        <div
                          className={`relative max-w-[85%] md:max-w-[65%] px-3 py-2 md:px-4 md:py-2.5 shadow-sm transition-all duration-200 hover:shadow-md ${
                            msg.sender === "user" 
                              ? "rounded-2xl rounded-tl-sm" 
                              : "rounded-2xl rounded-tr-sm"
                          }`}
                          style={
                            msg.sender === "user"
                              ? { background: "var(--q-chat-in)", color: "var(--q-text-primary)" }
                              : { background: "var(--q-chat-out)", color: "var(--q-text-primary)" }
                          }
                        >
                          {msg.sender !== "user" && (
                            <div className="flex items-center gap-1 mb-1 opacity-70">
                              {msg.sender === "bot" ? (
                                <Sparkles className="w-3 h-3" style={{ color: "var(--q-purple)" }} />
                              ) : (
                                <User className="w-3 h-3" style={{ color: "var(--q-text-secondary)" }} />
                              )}
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: msg.sender === "bot" ? "var(--q-purple)" : "var(--q-text-secondary)" }}>
                                {msg.sender === "bot" ? "AI" : "SEN"}
                              </span>
                            </div>
                          )}
                          
                          <p className="text-[15px] leading-[1.4] font-medium whitespace-pre-wrap pb-4">
                            {msg.text}
                          </p>
                          
                          <div className="absolute bottom-1 right-2 flex items-center gap-1 text-[10px] font-semibold tracking-wide" style={{ color: "var(--q-text-secondary)" }}>
                            <span className="opacity-50">{msg.timeMs ? new Date(msg.timeMs).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : msg.time}</span>
                            {msg.sender !== "user" && (
                              <span className="ml-0.5 opacity-80">
                                {msg.status === 'pending' && <Clock className="w-3 h-3 opacity-50" />}
                                {(msg.status === 'sent' || (!msg.status && msg.sender === 'agent')) && <Check className="w-3.5 h-3.5 opacity-70" />}
                                {msg.status === 'delivered' && <CheckCheck className="w-3.5 h-3.5 opacity-70" />}
                                {msg.status === 'read' && <CheckCheck className="w-3.5 h-3.5" style={{ color: "#53bdeb", opacity: 1 }} />}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
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
        </div>

        {/* Scroll to Bottom Button */}
        {showScrollDown && (
          <button
            onClick={() => scrollToBottom("smooth")}
            className="absolute bottom-4 right-4 w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 z-20 q-press hover:scale-105"
            style={{ background: "var(--q-bg-primary)", border: "1px solid var(--q-border-default)", color: "var(--q-text-primary)" }}
            aria-label="En alta kaydır"
          >
            <ChevronDown className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* ── Inline error ── */}
      {sendError && (
        <div className="mx-6 mb-2 px-4 py-2 rounded-xl text-[13px] font-medium q-bubble-in" style={{ background: "var(--q-red-bg)", color: "var(--q-red)", border: "1px solid rgba(255,59,48,0.2)" }}>
          {sendError}
        </div>
      )}

      {/* ── Input Area ── */}
      <div className="p-6 q-glass-strong z-10" style={{ borderTop: "1px solid var(--q-border-default)", boxShadow: "0 -1px 10px rgba(0,0,0,0.02)" }}>
        <div
          className="flex items-end gap-3 p-2 rounded-2xl transition-all focus-within:ring-4"
          style={{ background: "rgba(255,255,255,0.8)", border: "1px solid var(--q-border-default)", boxShadow: "var(--q-shadow-sm)" }}
        >
          <button className="p-2.5 rounded-xl transition-all duration-200 cursor-pointer hover:bg-[--q-bg-hover]" style={{ color: "var(--q-text-secondary)" }}>
            <Paperclip className="w-5 h-5" />
          </button>

          <textarea
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Mesajınızı yazın..."
            className="flex-1 max-h-32 min-h-[44px] bg-transparent resize-none outline-none py-2.5 text-[15px] font-medium"
            style={{ color: "var(--q-text-primary)" }}
            rows={1}
            disabled={isSending}
          />

          <button
            onClick={handleSend}
            disabled={isSending || !inputText.trim()}
            className="p-2.5 text-white rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer q-press"
            style={{
              background: inputText.trim() && !isSending ? "var(--q-blue)" : "rgba(134,134,139,0.5)",
              boxShadow: inputText.trim() && !isSending ? "0 4px 10px rgba(0,122,255,0.3)" : "none",
            }}
          >
            {isSending ? (
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
