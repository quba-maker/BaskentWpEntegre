"use client";

import { useState, useEffect } from "react";
import useSWRInfinite from "swr/infinite";
import { Search, MessageCircle, X, FileText, ChevronRight, CheckCircle2, Bot, Save, StickyNote } from "lucide-react";
import { getForms, getCampaignNames, updateLeadNotes } from "@/app/actions/forms";
import { useInboxStore } from "@/store/inbox-store";
import { useRouter } from "next/navigation";

const formatDate = (dateString: string) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
};

const formatTime = (dateString: string) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
};

export default function FormsPage() {
  const router = useRouter();
  const { setActiveContact } = useInboxStore();
  
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [campaigns, setCampaigns] = useState<string[]>([]);
  
  const [selectedForm, setSelectedForm] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  useEffect(() => {
    getCampaignNames().then(setCampaigns);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const getKey = (pageIndex: number, previousPageData: any) => {
    if (previousPageData && previousPageData.length < 50) return null;
    return ["forms", pageIndex + 1, debouncedSearch, sourceFilter];
  };

  const { data, size, setSize, isLoading, mutate } = useSWRInfinite(
    getKey, 
    ([_, page, search, source]: any) => getForms(page, search, source), 
    { refreshInterval: 15000 }
  );

  const forms = data ? data.flat() : [];
  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === "undefined");
  const isReachingEnd = data && data[data.length - 1]?.length < 50;

  const handleMessageClick = (form: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActiveContact(form.phone_number, {
      id: form.phone_number,
      name: form.patient_name,
      channel: "whatsapp",
      stage: form.stage
    });
    router.push("/inbox");
  };

  const getFlag = (form: any) => {
    const country = form.country || form.raw_data?.['ülke'] || form.raw_data?.['country'];
    if (!country) return "";
    const c = String(country).toLowerCase();
    if (c.includes("türkiye") || c.includes("turkey") || c.includes("tr")) return "🇹🇷";
    if (c.includes("almanya") || c.includes("germany") || c.includes("de")) return "🇩🇪";
    if (c.includes("ingiltere") || c.includes("england") || c.includes("uk")) return "🇬🇧";
    if (c.includes("fransa") || c.includes("france")) return "🇫🇷";
    if (c.includes("hollanda") || c.includes("netherlands")) return "🇳🇱";
    if (c.includes("belçika") || c.includes("belgium")) return "🇧🇪";
    if (c.includes("özbekistan") || c.includes("uzbekistan")) return "🇺🇿";
    if (c.includes("azerbaycan") || c.includes("azerbaijan")) return "🇦🇿";
    if (c.includes("rusya") || c.includes("russia")) return "🇷🇺";
    if (c.includes("abd") || c.includes("usa") || c.includes("amerika")) return "🇺🇸";
    return "🌍";
  };

  return (
    <div className="p-4 md:p-8 h-full flex flex-col relative overflow-hidden">
      {/* Background blobs for premium feel */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#007AFF]/5 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#5856D6]/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Header */}
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#1D1D1F]">Form Yönetimi</h1>
          <p className="text-[#86868B] mt-1 text-sm md:text-base font-medium">Tüm kanallardan gelen güncel lead kayıtları</p>
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#86868B]" />
            <input 
              type="text" 
              placeholder="İsim, telefon veya e-posta..." 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white/60 backdrop-blur-md border border-white/60 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)]"
            />
          </div>
          <select 
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-4 py-2.5 bg-white/60 backdrop-blur-md border border-white/60 rounded-xl text-sm font-semibold text-[#1D1D1F] appearance-none focus:outline-none focus:ring-2 focus:ring-black/5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] cursor-pointer"
          >
            <option value="all">Tüm Kampanyalar</option>
            {campaigns.map((camp, idx) => (
              <option key={idx} value={camp}>
                {camp.length > 30 ? camp.substring(0, 30) + '...' : camp}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      {/* Table Container */}
      <div className="flex-1 overflow-hidden flex flex-col bg-white/40 backdrop-blur-xl border border-white/50 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-white/80 backdrop-blur-md z-10 border-b border-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <tr>
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Tarih</th>
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Hasta Adı & İletişim</th>
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Kampanya / Form</th>
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Durum</th>
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase text-right">Aksiyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {forms.map((form: any) => (
                <tr 
                  key={form.id} 
                  onClick={() => {
                    setSelectedForm(form);
                    setNotes(form.notes || "");
                  }}
                  className="hover:bg-white/50 transition-colors group cursor-pointer"
                >
                  <td className="py-4 px-4 whitespace-nowrap">
                    <div className="text-[13px] font-semibold text-[#1D1D1F]">
                      {formatDate(form.created_at)}
                    </div>
                    <div className="text-[11px] font-medium text-[#86868B] mt-0.5">
                      {formatTime(form.created_at)}
                    </div>
                  </td>
                  <td className="py-4 px-4 min-w-[200px] max-w-[240px] whitespace-normal align-middle">
                    <div className="font-bold text-[14px] text-[#1D1D1F] flex flex-wrap items-center gap-2 leading-snug">
                      <span className="break-words whitespace-pre-wrap max-w-full">
                        {form.patient_name}
                        {getFlag(form) && (
                          <span className="ml-1.5 text-[12px] opacity-90 inline-block align-middle">{getFlag(form)}</span>
                        )}
                      </span>
                      {form.isBotActive && (
                        <span className="px-1.5 py-0.5 shrink-0 bg-[#0F9D58]/10 text-[#0F9D58] border border-[#0F9D58]/20 rounded text-[10px] font-bold uppercase flex items-center gap-1" title="Bot İlgileniyor">
                          <Bot className="w-3 h-3 animate-pulse" /> Bot
                        </span>
                      )}
                      {form.notes && form.notes.trim() !== '' && (
                        <span className="px-1.5 py-0.5 shrink-0 bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/20 rounded text-[10px] font-bold uppercase flex items-center gap-1" title="Not Eklendi">
                          <StickyNote className="w-3 h-3" /> Notlu
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] font-medium text-[#86868B] mt-1">{form.phone_number}</div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-black/5 shadow-sm">
                      {form.form_name.toLowerCase().includes("facebook") ? (
                        <div className="w-2 h-2 rounded-full bg-[#1877F2]" />
                      ) : form.form_name.toLowerCase().includes("instagram") ? (
                        <div className="w-2 h-2 rounded-full bg-[#E1306C]" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-gray-400" />
                      )}
                      <span className="text-[12px] font-semibold text-[#1D1D1F] max-w-[150px] truncate" title={form.form_name}>
                        {form.form_name}
                      </span>
                    </div>
                  </td>
                  <td className="py-4 px-4 whitespace-nowrap">
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 bg-black/5 border border-black/5 rounded-md text-[#1D1D1F]">
                      {form.stage === 'new' ? 'Yeni Lead' : 
                       form.stage === 'contacted' ? 'İletişime Geçildi' :
                       form.stage === 'responded' ? 'Yanıt Alındı' :
                       form.stage === 'discovery' ? 'Keşif / Analiz' :
                       form.stage === 'qualified' ? 'Nitelikli' :
                       form.stage === 'appointed' ? 'Randevu Aldı' :
                       form.stage === 'lost' ? 'Kaybedildi' : form.stage}
                    </span>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <button 
                      onClick={(e) => handleMessageClick(form, e)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-black/5 rounded-lg shadow-sm hover:bg-[#25D366]/10 hover:border-[#25D366]/20 hover:text-[#25D366] transition-all text-[13px] font-semibold text-[#1D1D1F]"
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span className="hidden md:inline">Mesaj Gönder</span>
                    </button>
                  </td>
                </tr>
              ))}
              
              {forms.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#86868B] font-medium">
                    Henüz kayıt bulunmuyor.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Footer / Load More */}
        <div className="p-3 border-t border-black/5 bg-white/40 flex justify-center">
          {!isReachingEnd && forms.length > 0 && (
            <button
              onClick={() => setSize(size + 1)}
              disabled={isLoadingMore}
              className="px-6 py-2 text-sm font-semibold text-[#007AFF] bg-white border border-[#007AFF]/20 rounded-full shadow-sm hover:bg-[#007AFF]/5 transition-all disabled:opacity-50"
            >
              {isLoadingMore ? "Yükleniyor..." : "Daha Fazla Kayıt Yükle"}
            </button>
          )}
          {isReachingEnd && forms.length > 0 && (
            <span className="text-[12px] font-medium text-[#86868B]">Tüm kayıtlar yüklendi.</span>
          )}
        </div>
      </div>

      {/* Centered Detail Modal */}
      {selectedForm && (
        <>
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity animate-in fade-in"
            onClick={() => setSelectedForm(null)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
            <div className="w-full max-w-[500px] bg-[#F5F5F7] rounded-[28px] shadow-[0_20px_40px_rgba(0,0,0,0.2)] flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200 pointer-events-auto border border-white/20">
              {/* Header */}
              <div className="px-6 py-5 bg-white border-b border-black/5 flex items-center justify-between shrink-0 rounded-t-[28px]">
                <div className="pr-4 w-full">
                  <h2 className="text-xl font-bold text-[#1D1D1F] flex flex-wrap items-center gap-2 leading-snug">
                    <span className="break-words whitespace-pre-wrap max-w-full">{selectedForm.patient_name}</span>
                    {getFlag(selectedForm) && <span className="text-lg shrink-0">{getFlag(selectedForm)}</span>}
                  </h2>
                  <p className="text-[#86868B] text-sm font-medium mt-1 break-words">{selectedForm.phone_number}</p>
                </div>
                <button 
                  onClick={() => setSelectedForm(null)}
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors"
                >
                  <X className="w-5 h-5 text-[#1D1D1F]" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              
              {/* Quick Actions */}
              <button 
                onClick={(e) => handleMessageClick(selectedForm, e as any)}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#25D366] text-white rounded-xl font-semibold shadow-[0_4px_14px_rgba(37,211,102,0.39)] hover:bg-[#1DA851] transition-colors"
              >
                <MessageCircle className="w-5 h-5" />
                WhatsApp'tan Mesaj Gönder
              </button>

              {/* Meta Info */}
              <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-black/5 flex flex-col items-center justify-center font-bold text-[#1D1D1F] text-xs">
                    {selectedForm.patient_name ? selectedForm.patient_name.charAt(0).toUpperCase() : '?'}
                  </div>
                  <div className="w-full pr-2">
                    <div className="flex items-center gap-2 flex-wrap leading-snug">
                      <p className="text-sm font-bold text-[#1D1D1F] break-words whitespace-pre-wrap max-w-full">
                        {selectedForm.patient_name || "İsimsiz"}
                        <span className="ml-2 text-lg inline-block" title={selectedForm.country}>{getFlag(selectedForm)}</span>
                      </p>
                      {selectedForm.isBotActive && (
                        <span className="px-1.5 py-0.5 shrink-0 bg-[#0F9D58]/10 text-[#0F9D58] border border-[#0F9D58]/20 rounded text-[10px] font-bold uppercase flex items-center gap-1" title="Bot İlgileniyor">
                          <Bot className="w-3 h-3 animate-pulse" /> Bot
                        </span>
                      )}
                      {selectedForm.notes && selectedForm.notes.trim() !== '' && (
                        <span className="px-1.5 py-0.5 shrink-0 bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/20 rounded text-[10px] font-bold uppercase flex items-center gap-1" title="Not Eklendi">
                          <StickyNote className="w-3 h-3" /> Notlu
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#86868B] font-medium mt-1 break-words">{selectedForm.phone_number}</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-black/5">
                  <div>
                    <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">Tarih</p>
                    <p className="text-[14px] font-semibold text-[#1D1D1F] mt-1">{formatDate(selectedForm.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">Aşama</p>
                    <p className="text-[14px] font-semibold text-[#1D1D1F] mt-1 capitalize">
                      {selectedForm.stage === 'new' ? 'Yeni Lead' : 
                       selectedForm.stage === 'contacted' ? 'İletişime Geçildi' :
                       selectedForm.stage === 'responded' ? 'Yanıt Alındı' :
                       selectedForm.stage === 'discovery' ? 'Keşif / Analiz' :
                       selectedForm.stage === 'qualified' ? 'Nitelikli' :
                       selectedForm.stage === 'appointed' ? 'Randevu Aldı' :
                       selectedForm.stage === 'lost' ? 'Kaybedildi' : selectedForm.stage}
                    </p>
                  </div>
                </div>
              </div>

              {/* AI Summary / Notes */}
              <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-[#1D1D1F] flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#0F9D58]" /> 
                    Görüşme Notları & AI Özeti
                  </h3>
                  <button 
                    onClick={async () => {
                      setIsSavingNotes(true);
                      await updateLeadNotes(selectedForm.id, notes);
                      mutate(); // SWR mutate
                      setIsSavingNotes(false);
                    }}
                    disabled={isSavingNotes}
                    className="text-[#007AFF] text-xs font-bold uppercase tracking-wider hover:text-[#0056b3] transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <Save className="w-3 h-3" />
                    {isSavingNotes ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                </div>
                <textarea 
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Botun görüşme özeti buraya düşer veya manuel olarak kendi satış notlarınızı alabilirsiniz..."
                  className="w-full h-28 bg-[#F5F5F7] border-none rounded-xl p-3 text-sm text-[#1D1D1F] placeholder:text-[#86868B] focus:ring-2 focus:ring-[#007AFF]/40 resize-none outline-none transition-all"
                />
              </div>

              {/* Form Data (raw_data) */}
              <div className="bg-white rounded-2xl p-1 border border-black/5 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-black/5 bg-[#F5F5F7]">
                  <h3 className="text-sm font-bold text-[#1D1D1F]">Form Yanıtları</h3>
                </div>
                <div className="divide-y divide-black/5">
                  {Object.entries(selectedForm.raw_data || {}).map(([key, value]: [string, any], index) => {
                    if (!value || typeof value === 'object') return null;
                    return (
                      <div key={index} className="px-4 py-3 flex flex-col">
                        <span className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-1">{key}</span>
                        <span className="text-[14px] font-medium text-[#1D1D1F] break-words whitespace-pre-wrap">{String(value)}</span>
                      </div>
                    );
                  })}
                  {Object.keys(selectedForm.raw_data || {}).length === 0 && (
                    <div className="px-4 py-6 text-center text-[#86868B] text-sm font-medium">
                      Bu formda ek veri bulunmuyor.
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
          </div>
        </>
      )}
    </div>
  );
}
