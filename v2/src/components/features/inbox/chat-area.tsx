"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Send, Paperclip, Bot, User, MessageCircle, ChevronLeft, Info, ShieldAlert, Sparkles } from "lucide-react";
import { getMessages, sendMessage, toggleBotStatus } from "@/app/actions/inbox";
import { useInboxStore } from "@/store/inbox-store";

export function ChatArea() {
  const { activePhone, activeContact, mobileView, setMobileView } = useInboxStore();
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const { mutate } = useSWRConfig();
  
  const { data: messages, isLoading } = useSWR(
    activePhone ? ["messages", activePhone] : null, 
    () => getMessages(activePhone!), 
    { refreshInterval: 2000 } // Gerçek zamanlı hissi için süreyi kısalttık (Sekme aktif değilken SWR otomatik durur)
  );

  const handleSend = async () => {
    if (!inputText.trim() || !activePhone || isSending) return;
    
    const textToSend = inputText.trim();
    setInputText("");
    setIsSending(true);

    // Optimistic Update
    const optimisticMsg = {
      id: Date.now(),
      sender: "user",
      text: textToSend,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      dateLabel: new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
    };

    const currentMessages = messages || [];
    mutate(["messages", activePhone], [...currentMessages, optimisticMsg], false);

    // Actually Send to Server
    const res = await sendMessage(activePhone, textToSend);
    if (!res.success) {
      alert("Mesaj gönderilemedi: " + res.error);
    }
    
    // Refresh to get actual DB state
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
    
    // Toggle the state
    const newBotState = !activeContact.isBotActive;
    
    // Optimistic UI Update (Update Zustand Store Instantly)
    useInboxStore.getState().setActiveContact(activePhone, {
      ...activeContact,
      isBotActive: newBotState
    });

    const res = await toggleBotStatus(activePhone, newBotState);
    if (res.success) {
      mutate((key) => Array.isArray(key) && key[0] === "conversations");
    } else {
      // Revert on failure
      useInboxStore.getState().setActiveContact(activePhone, {
        ...activeContact,
        isBotActive: !newBotState
      });
      alert("Bot durumu değiştirilirken hata oluştu.");
    }
    setIsTogglingBot(false);
  };

  if (!activePhone || !activeContact) {
    return (
      <div className={`w-full md:flex-1 md:flex flex-col items-center justify-center bg-transparent h-full relative z-0 ${mobileView === 'chat' ? 'flex' : 'hidden md:flex'}`}>
        <div className="w-16 h-16 bg-white/60 rounded-full flex items-center justify-center shadow-sm mb-4">
          <MessageCircle className="w-8 h-8 text-[#86868B] opacity-50" />
        </div>
        <p className="text-[#86868B] font-medium">Görüntülemek için sol taraftan bir kişi seçin.</p>
      </div>
    );
  }

  return (
    <div className={`w-full md:flex-1 md:flex flex-col bg-transparent h-full relative z-0 ${mobileView === 'chat' ? 'flex' : 'hidden md:flex'}`}>
      {/* Header */}
      <div className="h-[72px] px-4 md:px-8 border-b border-white/50 flex items-center justify-between bg-white/40 backdrop-blur-[40px] sticky top-0 z-10 shadow-[0_1px_10px_rgba(0,0,0,0.02)]">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setMobileView('list')}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-full bg-white/50 border border-white/60 shadow-sm"
          >
            <ChevronLeft className="w-5 h-5 text-[#1D1D1F]" />
          </button>
          <div>
            <div className="flex items-center">
              <h3 className="font-bold text-[#1D1D1F] text-lg tracking-tight truncate max-w-[130px] md:max-w-[300px]">
                {activeContact.name || activeContact.id}
              </h3>
              {activeContact.country && (
                <span className="ml-1.5 text-[14px] opacity-90 flex-shrink-0" title={activeContact.country}>
                  {activeContact.country === "Türkiye" ? "🇹🇷" : 
                   activeContact.country === "Almanya" ? "🇩🇪" : 
                   activeContact.country === "İngiltere" ? "🇬🇧" : 
                   activeContact.country === "Fransa" ? "🇫🇷" : 
                   activeContact.country === "Hollanda" ? "🇳🇱" : 
                   activeContact.country === "Belçika" ? "🇧🇪" : 
                   activeContact.country === "Özbekistan" ? "🇺🇿" : 
                   activeContact.country === "Azerbaycan" ? "🇦🇿" : 
                   activeContact.country === "Rusya" ? "🇷🇺" : 
                   activeContact.country === "ABD" ? "🇺🇸" : "🌍"}
                </span>
              )}
            </div>
            <p className="text-xs font-medium text-[#86868B] mt-0.5">{activeContact.id}</p>
          </div>
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-2 md:gap-3">
          <div className="flex items-center gap-2 bg-white/80 backdrop-blur-md px-2.5 md:px-3.5 py-1.5 rounded-full border border-black/5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            {activeContact.isBotActive ? (
              <Sparkles className="w-3.5 h-3.5 text-[#007AFF] animate-pulse" />
            ) : (
              <User className="w-3.5 h-3.5 text-[#86868B]" />
            )}
            <span className={`hidden md:inline text-[11px] font-bold uppercase tracking-wider ${activeContact.isBotActive ? "text-[#007AFF]" : "text-[#86868B]"}`}>
              AI Otopilot
            </span>
            <span className={`md:hidden text-[10px] font-bold uppercase tracking-wider ${activeContact.isBotActive ? "text-[#007AFF]" : "text-[#86868B]"} px-0.5`}>
              AI
            </span>
            <div className="h-3 w-[1px] bg-black/10 mx-1"></div>
            <button 
              onClick={handleToggleBot}
              disabled={isTogglingBot}
              className={`w-9 h-5 rounded-full relative transition-all duration-300 flex items-center shadow-inner hover:opacity-90 cursor-pointer ${activeContact.isBotActive ? "bg-[#007AFF]" : "bg-[#E5E5EA]"} ${isTogglingBot ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <span className={`absolute w-4 h-4 bg-white rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-transform duration-300 ease-spring ${activeContact.isBotActive ? "left-[2px] translate-x-4" : "left-[2px]"}`}></span>
            </button>
          </div>
          <button 
            onClick={() => setMobileView('crm')}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-full bg-[#007AFF]/10 border border-[#007AFF]/20 text-[#007AFF]"
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 flex flex-col-reverse">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="w-6 h-6 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin"></span>
          </div>
        ) : (
          [...(messages || [])].reverse().map((msg: any, idx: number, arr: any[]) => {
            const showDateLabel = msg.dateLabel && (idx === arr.length - 1 || arr[idx+1].dateLabel !== msg.dateLabel);
            
            return (
            <div key={msg.id} className="flex flex-col">
              {showDateLabel && (
                <div className="flex justify-center my-4">
                  <span className="text-xs font-medium px-3 py-1 bg-secondary text-secondary-foreground rounded-full border border-border/50">
                    {msg.dateLabel}
                  </span>
                </div>
              )}
              
              {msg.sender === "system" ? (
                <div className="flex w-full justify-center mb-6">
                  <div className="bg-[#FFF4E5]/80 backdrop-blur-md border border-[#FFE2B7] text-[#B86B00] rounded-full px-4 py-1.5 flex items-center gap-2 shadow-sm max-w-[90%] md:max-w-[70%] text-center">
                    <ShieldAlert className="w-4 h-4 flex-shrink-0 text-[#FF9500]" />
                    <p className="text-[13px] font-semibold tracking-tight leading-tight">{msg.text}</p>
                    <span className="text-[10px] font-bold opacity-60 ml-2 whitespace-nowrap">{msg.time}</span>
                  </div>
                </div>
              ) : (
                <div className={`flex w-full ${msg.sender === "user" ? "justify-start" : "justify-end"} mb-6 group`}>
                  <div className={`max-w-[85%] md:max-w-[65%] flex flex-col gap-1.5 ${msg.sender === "user" ? "items-start" : "items-end"}`}>
                    
                    {/* Bubble */}
                    <div className={`px-4 py-3 md:px-5 md:py-3.5 rounded-2xl shadow-sm transition-all duration-200 ${msg.sender === "user" ? "bg-white border border-black/5 text-[#1D1D1F] rounded-bl-sm hover:shadow-md" : "bg-gradient-to-br from-[#007AFF] to-[#0056b3] text-white rounded-br-sm border border-[#007AFF]/20 hover:shadow-md"}`}>
                      <p className="text-[15px] leading-relaxed font-medium whitespace-pre-wrap">{msg.text}</p>
                    </div>
                    
                    {/* Info */}
                    <div className="flex items-center gap-1.5 px-2 opacity-50 group-hover:opacity-100 transition-opacity duration-300">
                      {msg.sender === "bot" ? (
                        <Sparkles className="w-3 h-3 text-[#007AFF]" />
                      ) : (
                        <User className="w-3 h-3" />
                      )}
                      <span className="text-[11px] font-semibold tracking-wide text-[#86868B]">{msg.time}</span>
                    </div>
                    
                  </div>
                </div>
              )}
            </div>
            );
          })
        )}
      </div>

      {/* Input Area */}
      <div className="p-6 bg-white/40 backdrop-blur-[40px] border-t border-white/50 z-10 shadow-[0_-1px_10px_rgba(0,0,0,0.02)]">
        <div className="flex items-end gap-3 bg-white/80 border border-white rounded-2xl p-2 focus-within:ring-4 focus-within:ring-[#007AFF]/20 transition-all shadow-[0_2px_15px_rgba(0,0,0,0.03)]">
          <button className="p-2.5 text-[#86868B] hover:text-[#1D1D1F] hover:bg-black/5 rounded-xl transition-all duration-200 cursor-pointer">
            <Paperclip className="w-5 h-5" />
          </button>
          
          <textarea 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Mesajınızı yazın..." 
            className="flex-1 max-h-32 min-h-[44px] bg-transparent resize-none outline-none py-2.5 text-[15px] font-medium text-[#1D1D1F] placeholder:text-[#86868B]"
            rows={1}
            disabled={isSending}
          />
          
          <button 
            onClick={handleSend}
            disabled={isSending || !inputText.trim()}
            className={`p-2.5 text-white rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer ${inputText.trim() && !isSending ? "bg-[#007AFF] hover:scale-105 shadow-[0_4px_10px_rgba(0,122,255,0.3)]" : "bg-[#86868B]/50"}`}
          >
            {isSending ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin ml-0.5"></span> : <Send className="w-5 h-5 ml-0.5" />}
          </button>
        </div>
        <p className="text-center text-[11px] font-medium text-[#86868B] mt-3">
          Göndermek için <kbd className="font-mono bg-white border border-black/5 px-1.5 py-0.5 rounded shadow-sm mx-1">Enter</kbd> 
          (Alt satır için <kbd className="font-mono bg-white border border-black/5 px-1.5 py-0.5 rounded shadow-sm mx-1">Shift + Enter</kbd>)
        </p>
      </div>
    </div>
  );
}
