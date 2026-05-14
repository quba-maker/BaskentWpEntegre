"use client";

import { useState, useEffect } from "react";
import useSWRInfinite from "swr/infinite";
import { Search, MessageCircle } from "lucide-react";
import { getConversations } from "@/app/actions/inbox";
import { useInboxStore } from "@/store/inbox-store";

export function ContactList() {
  const { activePhone, setActiveContact, mobileView } = useInboxStore();
  const [filter, setFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const getKey = (pageIndex: number, previousPageData: any) => {
    if (previousPageData && previousPageData.length < 50) return null;
    return ["conversations", pageIndex + 1, debouncedSearch, stageFilter];
  };

  const { data, size, setSize, isLoading, isValidating } = useSWRInfinite(
    getKey, 
    ([_, page, search, stage]: any) => getConversations(page, search, stage), 
    { refreshInterval: 3000 } // Daha hızlı listeleme yenilemesi
  );

  const contacts = data ? data.flat() : [];
  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === "undefined");
  const isReachingEnd = data && data[data.length - 1]?.length < 50;

  return (
    <div className={`w-full md:w-80 border-r border-white/50 bg-white/30 backdrop-blur-[40px] flex-col h-full z-10 shadow-[2px_0_20px_rgba(0,0,0,0.02)] ${mobileView === 'list' ? 'flex' : 'hidden md:flex'}`}>
      {/* Header & Search */}
      <div className="p-5 pb-3">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold tracking-tight text-foreground/90">Mesajlar</h2>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="bg-transparent text-xs text-[#007AFF] font-semibold outline-none cursor-pointer appearance-none text-right pr-2"
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
        <div className="relative group">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="İsim veya numara ara..." 
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white/50 border border-white/60 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)]"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex px-5 py-2 space-x-2 overflow-x-auto pb-4 no-scrollbar">
        <button 
          onClick={() => setFilter("all")}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap transition-all duration-200 ${filter === "all" ? "bg-[#007AFF] text-white shadow-[0_2px_8px_rgba(0,122,255,0.3)]" : "bg-white/50 hover:bg-white text-[#86868B] hover:text-[#1D1D1F] border border-white/60 shadow-[0_2px_8px_rgba(0,0,0,0.02)]"}`}
        >
          Tümü
        </button>
        <button 
          onClick={() => setFilter("whatsapp")}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap transition-all duration-200 ${filter === "whatsapp" ? "bg-[#25D366] text-white shadow-[0_2px_8px_rgba(37,211,102,0.3)]" : "bg-white/50 hover:bg-white text-[#86868B] hover:text-[#1D1D1F] border border-white/60 shadow-[0_2px_8px_rgba(0,0,0,0.02)]"}`}
        >
          WhatsApp
        </button>
        <button 
          onClick={() => setFilter("instagram")}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap transition-all duration-200 ${filter === "instagram" ? "bg-gradient-to-r from-[#833AB4] via-[#FD1D1D] to-[#F56040] text-white shadow-[0_2px_8px_rgba(225,48,108,0.3)]" : "bg-white/50 hover:bg-white text-[#86868B] hover:text-[#1D1D1F] border border-white/60 shadow-[0_2px_8px_rgba(0,0,0,0.02)]"}`}
        >
          Instagram
        </button>
        <button 
          onClick={() => setFilter("messenger")}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap transition-all duration-200 ${filter === "messenger" ? "bg-[#1877F2] text-white shadow-[0_2px_8px_rgba(24,119,242,0.3)]" : "bg-white/50 hover:bg-white text-[#86868B] hover:text-[#1D1D1F] border border-white/60 shadow-[0_2px_8px_rgba(0,0,0,0.02)]"}`}
        >
          Facebook
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5">
        {isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 w-full bg-white/40 animate-pulse rounded-2xl"></div>
            ))}
          </div>
        ) : (
          (contacts || []).filter((c: any) => filter === "all" || c.channel === filter).map((c: any) => (
            <button 
              key={c.id}
              onClick={() => setActiveContact(c.id, c)}
              className={`w-full text-left p-3.5 rounded-2xl transition-all duration-200 flex items-start gap-3.5 border ${activePhone === c.id ? "bg-white border-white shadow-[0_4px_15px_rgba(0,0,0,0.05)]" : "border-transparent hover:bg-white/60 hover:border-white/50 hover:shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:-translate-y-[1px]"}`}
            >
              <div className="relative mt-1">
                {c.channel === "whatsapp" && <MessageCircle className="w-8 h-8 text-[#25D366] opacity-80" />}
                {c.channel === "instagram" && (
                  <svg className="w-8 h-8 text-[#E1306C] opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                  </svg>
                )}
                {c.channel === "messenger" && (
                  <svg className="w-8 h-8 text-[#1877F2] opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>
                  </svg>
                )}
                {c.unread > 0 && (
                  <span className="absolute -top-1 -right-1 bg-[#FF3B30] text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full border-2 border-white shadow-sm">
                    {c.unread}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-0.5">
                  <div className="flex items-center min-w-0 flex-1 mr-2">
                    <span className="font-bold text-[14px] text-[#1D1D1F] truncate">
                      {c.name || c.id}
                    </span>
                    {c.country && (
                      <span className="ml-1.5 text-[12px] opacity-90 flex-shrink-0" title={c.country}>
                        {c.country === "Türkiye" ? "🇹🇷" : 
                         c.country === "Almanya" ? "🇩🇪" : 
                         c.country === "İngiltere" ? "🇬🇧" : 
                         c.country === "Fransa" ? "🇫🇷" : 
                         c.country === "Hollanda" ? "🇳🇱" : 
                         c.country === "Belçika" ? "🇧🇪" : 
                         c.country === "Özbekistan" ? "🇺🇿" : 
                         c.country === "Azerbaycan" ? "🇦🇿" : 
                         c.country === "Rusya" ? "🇷🇺" : 
                         c.country === "ABD" ? "🇺🇸" : "🌍"}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[#86868B] font-semibold tracking-wide whitespace-nowrap ml-2">{c.formattedTime}</span>
                </div>
                <p className={`text-[13px] truncate ${c.unread > 0 ? "font-bold text-[#1D1D1F]" : "text-[#86868B] font-medium"}`}>
                  {c.last_message || "Görsel veya medya"}
                </p>
                <div className="flex gap-2 mt-2">
                  <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 bg-white border border-black/5 rounded text-[#86868B] shadow-sm">
                    {
                      c.stage === 'new' ? 'Yeni Lead' :
                      c.stage === 'contacted' ? 'İletişime Geçildi' :
                      c.stage === 'responded' ? 'Yanıt Alındı' :
                      c.stage === 'discovery' ? 'Keşif / Bilgi' :
                      c.stage === 'appointed' ? 'Randevu Aldı' :
                      c.stage === 'lost' ? 'Kaybedildi' :
                      (c.stage || 'Yeni Lead')
                    }
                  </span>
                  {!c.isBotActive && (
                    <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/20 rounded shadow-sm">
                      Sen
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
        
        {!isLoading && !isReachingEnd && contacts.length > 0 && (
          <button
            onClick={() => setSize(size + 1)}
            disabled={isLoadingMore}
            className="w-full py-3 mt-2 text-sm font-semibold text-[#007AFF] bg-white/50 hover:bg-white border border-white/60 rounded-xl transition-all disabled:opacity-50"
          >
            {isLoadingMore ? "Yükleniyor..." : "Daha Fazla Yükle"}
          </button>
        )}
      </div>
    </div>
  );
}
