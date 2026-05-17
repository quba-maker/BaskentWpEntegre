"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Send, Paperclip, User, MessageCircle, ChevronLeft, Info, ShieldAlert, Sparkles } from "lucide-react";
import { getMessages, sendMessage, toggleBotStatus } from "@/app/actions/inbox";
import { useInboxStore } from "@/store/inbox-store";

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

export function ConversationViewport() {
  const { activePhone, activeContact, mobileView, setMobileView } = useInboxStore();
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const [sendError, setSendError] = useState("");
  const { mutate } = useSWRConfig();

  const { data: messages, isLoading } = useSWR(
    activePhone ? ["messages", activePhone] : null,
    () => getMessages(activePhone!),
    { refreshInterval: 2000 }
  );

  const handleSend = async () => {
    if (!inputText.trim() || !activePhone || isSending) return;
    const textToSend = inputText.trim();
    setInputText("");
    setIsSending(true);
    setSendError("");

    // Optimistic update
    const optimisticMsg = {
      id: Date.now(),
      sender: "user",
      text: textToSend,
      time: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }),
      dateLabel: new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long" }),
    };

    const currentMessages = messages || [];
    mutate(["messages", activePhone], [...currentMessages, optimisticMsg], false);

    const res = await sendMessage(activePhone, textToSend);
    if (!res.success) {
      setSendError("Mesaj gönderilemedi: " + res.error);
      setTimeout(() => setSendError(""), 4000);
    }

    mutate(["messages", activePhone]);
    setIsSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
      mutate((key) => Array.isArray(key) && key[0] === "conversations");
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
            <p className="text-xs font-medium mt-0.5" style={{ color: "var(--q-text-secondary)" }}>
              {activeContact.id}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 md:gap-3">
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
      <div className="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col-reverse">
        {isLoading ? (
          <ChatSkeleton />
        ) : (
          [...(messages || [])].reverse().map((msg: any, idx: number, arr: any[]) => {
            const showDateLabel = msg.dateLabel && (idx === arr.length - 1 || arr[idx + 1].dateLabel !== msg.dateLabel);
            return (
              <div key={msg.id} className="flex flex-col q-bubble-in">
                {showDateLabel && (
                  <div className="flex justify-center my-4">
                    <span
                      className="text-xs font-medium px-3 py-1 rounded-full"
                      style={{ background: "var(--q-bg-secondary)", color: "var(--q-text-secondary)", border: "1px solid var(--q-border-default)" }}
                    >
                      {msg.dateLabel}
                    </span>
                  </div>
                )}

                {msg.sender === "system" ? (
                  <div className="flex w-full justify-center mb-6">
                    <div
                      className="rounded-full px-4 py-1.5 flex items-center gap-2 shadow-sm max-w-[90%] md:max-w-[70%] text-center q-glass-strong"
                      style={{ border: "1px solid var(--q-orange-bg)", color: "var(--q-orange)" }}
                    >
                      <ShieldAlert className="w-4 h-4 flex-shrink-0" style={{ color: "var(--q-orange)" }} />
                      <p className="text-[13px] font-semibold tracking-tight leading-tight">{msg.text}</p>
                      <span className="text-[10px] font-bold opacity-60 ml-2 whitespace-nowrap">{msg.time}</span>
                    </div>
                  </div>
                ) : (
                  <div className={`flex w-full ${msg.sender === "user" ? "justify-start" : "justify-end"} mb-6 group`}>
                    <div className={`max-w-[85%] md:max-w-[65%] flex flex-col gap-1.5 ${msg.sender === "user" ? "items-start" : "items-end"}`}>
                      {/* Bubble */}
                      <div
                        className={`px-4 py-3 md:px-5 md:py-3.5 rounded-2xl shadow-sm transition-all duration-200 hover:shadow-md ${msg.sender === "user" ? "rounded-bl-sm" : "rounded-br-sm"}`}
                        style={
                          msg.sender === "user"
                            ? { background: "var(--q-bg-primary)", border: "1px solid var(--q-border-default)", color: "var(--q-text-primary)" }
                            : { background: `linear-gradient(135deg, var(--q-blue), var(--q-blue-hover))`, color: "white", border: "1px solid rgba(0,122,255,0.2)" }
                        }
                      >
                        <p className="text-[15px] leading-relaxed font-medium whitespace-pre-wrap">{msg.text}</p>
                      </div>
                      {/* Info */}
                      <div className="flex items-center gap-1.5 px-2 opacity-50 group-hover:opacity-100 transition-opacity duration-300">
                        {msg.sender === "bot" ? (
                          <Sparkles className="w-3 h-3" style={{ color: "var(--q-blue)" }} />
                        ) : (
                          <User className="w-3 h-3" />
                        )}
                        <span className="text-[11px] font-semibold tracking-wide" style={{ color: "var(--q-text-secondary)" }}>
                          {msg.time}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
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
            onChange={(e) => setInputText(e.target.value)}
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
