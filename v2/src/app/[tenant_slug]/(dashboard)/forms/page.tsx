"use client";

import { useState, useEffect, useRef } from "react";
import useSWRInfinite from "swr/infinite";
import { Search, MessageCircle, X, FileText, ChevronRight, CheckCircle2, Bot, Save, StickyNote, Sparkles, RefreshCw, ChevronDown, Filter } from "lucide-react";
import { getForms, getCampaignNames, updateLeadNotes, updateLeadStage, syncGoogleSheets } from "@/app/actions/forms";
import { useInboxStore } from "@/store/inbox-store";
import { useRouter, useParams } from "next/navigation";
import { resolveCountry, deduplicatePhones } from "@/lib/utils/country";

const formatDate = (dateString: string) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
};

const formatTime = (dateString: string) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
};

// Get best display name: raw_data.full_name > patient_name
const getDisplayName = (form: any): string => {
  const rd = form.raw_data || {};
  const fullName = rd.full_name || rd['full name'] || rd['Full Name'] || rd['full_name'];
  if (fullName && fullName.trim()) return fullName.trim();
  return form.patient_name || 'İsimsiz';
};

// Get best date: raw_data.created_time > created_at
const getBestDate = (form: any): string => {
  const rd = form.raw_data || {};
  const ct = rd.created_time || rd.Created_Time || rd.timestamp;
  if (ct) {
    const d = new Date(ct);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return form.created_at || '';
};

// Get all phone numbers from raw_data (deduplicated by last 10 digits)
const getAllPhones = (form: any): string[] => {
  const rd = form.raw_data || {};
  let phones: string[] = [];
  try {
    if (rd._all_phones) {
      const parsed = typeof rd._all_phones === 'string' ? JSON.parse(rd._all_phones) : rd._all_phones;
      if (Array.isArray(parsed) && parsed.length > 0) phones = parsed;
    }
  } catch (_) {}
  if (phones.length === 0) phones = [form.phone_number].filter(Boolean);
  return deduplicatePhones(phones);
};

// Format phone display
const formatPhone = (phone: string): string => {
  if (!phone) return '';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.startsWith('90') && clean.length >= 12) {
    return `+${clean.slice(0,2)} ${clean.slice(2,5)} ${clean.slice(5,8)} ${clean.slice(8,10)} ${clean.slice(10)}`;
  }
  if (clean.length >= 10) return `+${clean}`;
  return clean;
};

// Stage definitions
const STAGES = [
  { value: 'new', label: 'Yeni Lead', color: '#007AFF', bg: '#007AFF/10' },
  { value: 'contacted', label: 'İletişime Geçildi', color: '#FF9500', bg: '#FF9500/10' },
  { value: 'responded', label: 'Yanıt Alındı', color: '#34C759', bg: '#34C759/10' },
  { value: 'discovery', label: 'Keşif / Analiz', color: '#5856D6', bg: '#5856D6/10' },
  { value: 'qualified', label: 'Nitelikli', color: '#30B0C7', bg: '#30B0C7/10' },
  { value: 'appointed', label: 'Randevu Aldı', color: '#0F9D58', bg: '#0F9D58/10' },
  { value: 'lost', label: 'Kaybedildi', color: '#FF3B30', bg: '#FF3B30/10' },
] as const;

const getStageInfo = (stage: string) => STAGES.find(s => s.value === stage) || STAGES[0];

// Dropdown hook for outside click
function useDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);
  
  return { isOpen, setIsOpen, ref };
}

export default function FormsPage() {
  const router = useRouter();
  const params = useParams();
  const tenantId = typeof params.tenant_slug === 'string' ? params.tenant_slug : 'baskent';
  const { setActiveContact } = useInboxStore();
  
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [campaigns, setCampaigns] = useState<string[]>([]);
  
  const [selectedForm, setSelectedForm] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ status: '', progress: 0, message: '' });

  // Header dropdowns
  const campDropdown = useDropdown();
  const stageDropdown = useDropdown();

  useEffect(() => {
    getCampaignNames().then(setCampaigns);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const getKey = (pageIndex: number, previousPageData: any) => {
    if (previousPageData && previousPageData.length < 50) return null;
    return ["forms", pageIndex + 1, debouncedSearch, sourceFilter, stageFilter];
  };

  const { data, size, setSize, isLoading, mutate } = useSWRInfinite(
    getKey, 
    ([_, page, search, source, stage]: any) => getForms(page, search, source, stage), 
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
      stage: form.stage,
      unread: 0
    });
    router.push(`/${tenantId}/inbox`);
  };

  const handleStageChange = async (form: any, newStage: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    // Optimistic update
    mutate(
      data?.map(page => page.map((f: any) => f.id === form.id ? { ...f, stage: newStage } : f)),
      false
    );
    await updateLeadStage(form.id, newStage);
    mutate();
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
          {/* Sync Button & Progress */}
          <div className="relative flex items-center">
            {isSyncing ? (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium ${
                syncProgress.status === 'error' 
                  ? 'bg-rose-50 text-rose-600 border-rose-200' 
                  : syncProgress.status === 'completed'
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                  : 'bg-blue-50 text-blue-600 border-blue-100'
              }`}>
                {syncProgress.status === 'error' ? (
                  <X className="w-4 h-4" />
                ) : syncProgress.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                )}
                <span className="min-w-[120px]">{syncProgress.message || 'Senkronize ediliyor...'} {syncProgress.progress > 0 && `${syncProgress.progress}%`}</span>
              </div>
            ) : (
              <button
                onClick={async () => {
                  try {
                    setIsSyncing(true);
                    setSyncProgress({ status: 'starting', progress: 0, message: 'Google Sheets verileri çekiliyor...' });
                    
                    const timeout = setTimeout(() => {
                      setSyncProgress({ status: 'error', progress: 0, message: 'İşlem zaman aşımına uğradı. Tekrar deneyin.' });
                      setTimeout(() => setIsSyncing(false), 3000);
                    }, 30000);

                    const res = await syncGoogleSheets();
                    clearTimeout(timeout);
                    
                    if (res.success) {
                      setSyncProgress({ status: 'completed', progress: 100, message: res.message || 'Senkronizasyon tamamlandı.' });
                      mutate();
                      setTimeout(() => setIsSyncing(false), 2500);
                    } else {
                      const errMsg = res.error || "Senkronizasyon başarısız.";
                      setSyncProgress({ status: 'error', progress: 0, message: errMsg });
                      setTimeout(() => setIsSyncing(false), 4000);
                    }
                  } catch (e: any) {
                    setSyncProgress({ status: 'error', progress: 0, message: e?.message || 'Senkronizasyon başlatılamadı.' });
                    setTimeout(() => setIsSyncing(false), 4000);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/60 backdrop-blur-md border border-white/60 hover:bg-white text-sm font-semibold text-[#1D1D1F] rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Senkronize Et
              </button>
            )}
          </div>

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
        </div>
      </div>
      
      {/* Active Filters Bar */}
      {(sourceFilter !== 'all' || stageFilter !== 'all') && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Filtreler:</span>
          {sourceFilter !== 'all' && (
            <button 
              onClick={() => setSourceFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#007AFF]/10 text-[#007AFF] text-[11px] font-bold hover:bg-[#007AFF]/20 transition-colors"
            >
              <Filter className="w-3 h-3" />
              {sourceFilter.length > 25 ? sourceFilter.substring(0, 25) + '...' : sourceFilter}
              <X className="w-3 h-3 ml-1" />
            </button>
          )}
          {stageFilter !== 'all' && (
            <button 
              onClick={() => setStageFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold hover:opacity-80 transition-colors"
              style={{ 
                backgroundColor: `${getStageInfo(stageFilter).color}15`,
                color: getStageInfo(stageFilter).color 
              }}
            >
              {getStageInfo(stageFilter).label}
              <X className="w-3 h-3 ml-1" />
            </button>
          )}
          <button 
            onClick={() => { setSourceFilter('all'); setStageFilter('all'); }}
            className="text-[11px] font-semibold text-[#86868B] hover:text-[#1D1D1F] transition-colors ml-1"
          >
            Tümünü temizle
          </button>
        </div>
      )}

      {/* Table Container */}
      <div className="flex-1 overflow-hidden flex flex-col bg-white/40 backdrop-blur-xl border border-white/50 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-white/80 backdrop-blur-md z-10 border-b border-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <tr>
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Tarih</th>
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Hasta Adı & İletişim</th>
                
                {/* Kampanya / Form — Clickable Filter Header */}
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase relative">
                  <div ref={campDropdown.ref} className="relative inline-block">
                    <button 
                      onClick={() => campDropdown.setIsOpen(!campDropdown.isOpen)}
                      className={`inline-flex items-center gap-1 hover:text-[#1D1D1F] transition-colors cursor-pointer select-none rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 ${
                        sourceFilter !== 'all' ? 'text-[#007AFF] bg-[#007AFF]/10' : 'hover:bg-black/5'
                      }`}
                    >
                      Kampanya / Form
                      <ChevronDown className={`w-3 h-3 transition-transform ${campDropdown.isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {campDropdown.isOpen && (
                      <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 max-h-[300px] overflow-y-auto">
                        <button 
                          onClick={() => { setSourceFilter('all'); campDropdown.setIsOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-black/5 transition-colors flex items-center gap-2 ${
                            sourceFilter === 'all' ? 'text-[#007AFF]' : 'text-[#1D1D1F]'
                          }`}
                        >
                          {sourceFilter === 'all' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          Tüm Kampanyalar
                        </button>
                        <div className="h-px bg-black/5 my-1" />
                        {campaigns.map((camp, idx) => (
                          <button 
                            key={idx}
                            onClick={() => { setSourceFilter(camp); campDropdown.setIsOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 transition-colors flex items-center gap-2 ${
                              sourceFilter === camp ? 'text-[#007AFF] font-semibold' : 'text-[#1D1D1F]'
                            }`}
                          >
                            {sourceFilter === camp && <CheckCircle2 className="w-3.5 h-3.5" />}
                            <span className="truncate">{camp}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
                
                {/* Durum — Clickable Filter Header */}
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase relative">
                  <div ref={stageDropdown.ref} className="relative inline-block">
                    <button 
                      onClick={() => stageDropdown.setIsOpen(!stageDropdown.isOpen)}
                      className={`inline-flex items-center gap-1 hover:text-[#1D1D1F] transition-colors cursor-pointer select-none rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 ${
                        stageFilter !== 'all' ? 'bg-[#007AFF]/10 text-[#007AFF]' : 'hover:bg-black/5'
                      }`}
                    >
                      Durum
                      <ChevronDown className={`w-3 h-3 transition-transform ${stageDropdown.isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {stageDropdown.isOpen && (
                      <div className="absolute top-full left-0 mt-1 w-52 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50">
                        <button 
                          onClick={() => { setStageFilter('all'); stageDropdown.setIsOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-black/5 transition-colors flex items-center gap-2 ${
                            stageFilter === 'all' ? 'text-[#007AFF]' : 'text-[#1D1D1F]'
                          }`}
                        >
                          {stageFilter === 'all' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          Tüm Durumlar
                        </button>
                        <div className="h-px bg-black/5 my-1" />
                        {STAGES.map(s => (
                          <button 
                            key={s.value}
                            onClick={() => { setStageFilter(s.value); stageDropdown.setIsOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 transition-colors flex items-center gap-2 ${
                              stageFilter === s.value ? 'font-semibold' : ''
                            }`}
                            style={{ color: stageFilter === s.value ? s.color : '#1D1D1F' }}
                          >
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.label}
                            {stageFilter === s.value && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
                
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase text-right">Aksiyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {forms.map((form: any) => {
                const displayName = getDisplayName(form);
                const bestDate = getBestDate(form);
                const allPhones = getAllPhones(form);
                const primaryPhone = allPhones[0] || form.phone_number;
                const extraPhones = allPhones.slice(1);
                const country = resolveCountry(primaryPhone, form.raw_data);
                const stageInfo = getStageInfo(form.stage);
                
                return (
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
                      {formatDate(bestDate)}
                    </div>
                    <div className="text-[11px] font-medium text-[#86868B] mt-0.5">
                      {formatTime(bestDate)}
                    </div>
                  </td>
                  <td className="py-4 px-4 min-w-[200px] max-w-[280px] whitespace-normal align-middle">
                    <div className="font-bold text-[14px] text-[#1D1D1F] flex flex-wrap items-center gap-1.5 leading-snug">
                      <span className="break-words whitespace-pre-wrap">
                        {displayName}
                      </span>
                      {country && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/[0.04] text-[11px] font-semibold text-[#86868B] shrink-0">
                          {country.flag} {country.name}
                        </span>
                      )}
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
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[12px] font-medium text-[#86868B]">{formatPhone(primaryPhone)}</span>
                      {extraPhones.length > 0 && (
                        <span 
                          className="text-[10px] font-bold text-[#007AFF] bg-[#007AFF]/10 px-1.5 py-0.5 rounded cursor-pointer hover:bg-[#007AFF]/20 transition-colors"
                          title={extraPhones.map(formatPhone).join(', ')}
                          onClick={(e) => {
                            e.stopPropagation();
                            alert(`Diğer numaralar:\n${extraPhones.map(formatPhone).join('\n')}`);
                          }}
                        >
                          +{extraPhones.length} numara
                        </span>
                      )}
                    </div>
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
                    <InlineStageSelector 
                      currentStage={form.stage} 
                      stageInfo={stageInfo}
                      onStageChange={(newStage) => handleStageChange(form, newStage)}
                    />
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
                );
              })}
              
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
                    <span className="break-words whitespace-pre-wrap max-w-full">{getDisplayName(selectedForm)}</span>
                    {(() => {
                      const c = resolveCountry(selectedForm.phone_number, selectedForm.raw_data);
                      return c ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/[0.04] text-[12px] font-semibold text-[#86868B] shrink-0">
                          {c.flag} {c.name}
                        </span>
                      ) : null;
                    })()}
                  </h2>
                  <p className="text-[#86868B] text-sm font-medium mt-1 break-words">{formatPhone(selectedForm.phone_number)}</p>
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
                    {getDisplayName(selectedForm).charAt(0).toUpperCase()}
                  </div>
                  <div className="w-full pr-2">
                    <div className="flex items-center gap-2 flex-wrap leading-snug">
                      <p className="text-sm font-bold text-[#1D1D1F] break-words whitespace-pre-wrap max-w-full">
                        {getDisplayName(selectedForm)}
                      </p>
                      {(() => {
                        const c = resolveCountry(selectedForm.phone_number, selectedForm.raw_data);
                        return c ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/[0.04] text-[11px] font-semibold text-[#86868B] shrink-0">
                            {c.flag} {c.name}
                          </span>
                        ) : null;
                      })()}
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
                    {/* Multi-phone display */}
                    {(() => {
                      const phones = getAllPhones(selectedForm);
                      return (
                        <div className="mt-1.5 space-y-1">
                          {phones.map((ph: string, idx: number) => (
                            <p key={idx} className="text-xs text-[#86868B] font-medium break-words flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${idx === 0 ? 'bg-[#25D366]' : 'bg-[#86868B]'}`} />
                              {formatPhone(ph)}
                              {idx === 0 && <span className="text-[10px] text-[#25D366] font-semibold">(Birincil)</span>}
                            </p>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-black/5">
                  <div>
                    <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">Tarih</p>
                    <p className="text-[14px] font-semibold text-[#1D1D1F] mt-1">{formatDate(getBestDate(selectedForm))}</p>
                    <p className="text-[12px] text-[#86868B] font-medium">{formatTime(getBestDate(selectedForm))}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">Aşama</p>
                    <div className="mt-1">
                      <InlineStageSelector 
                        currentStage={selectedForm.stage}
                        stageInfo={getStageInfo(selectedForm.stage)}
                        onStageChange={(newStage) => {
                          handleStageChange(selectedForm, newStage);
                          setSelectedForm({ ...selectedForm, stage: newStage });
                        }}
                      />
                    </div>
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

                {/* AI Taslak Önerisi (Frosted Cam Efektli Kutu) */}
                {(!notes || notes.trim() === "") && selectedForm.ai_summary && (
                  <div className="mt-3 p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] backdrop-blur-md relative overflow-hidden transition-all duration-300 shadow-sm text-left">
                    <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600 animate-pulse" /> Yapay Zeka Önerisi
                      </span>
                    </div>
                    <p className="text-[12px] text-emerald-950 font-medium leading-relaxed italic mb-3">
                      "{selectedForm.ai_summary}"
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        const aiText = selectedForm.ai_summary;
                        setNotes(aiText);
                        setIsSavingNotes(true);
                        const res = await updateLeadNotes(selectedForm.id, aiText);
                        if (res.success) {
                          mutate();
                        }
                        setIsSavingNotes(false);
                      }}
                      disabled={isSavingNotes}
                      className="w-full py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white transition-all flex items-center justify-center gap-1.5 shadow-md cursor-pointer disabled:opacity-50"
                    >
                      <FileText className="w-3.5 h-3.5" /> Nota Aktar ve Kaydet
                    </button>
                  </div>
                )}
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

// ─── Inline Stage Selector Component ───
function InlineStageSelector({ currentStage, stageInfo, onStageChange }: { 
  currentStage: string; 
  stageInfo: { value: string; label: string; color: string };
  onStageChange: (stage: string) => void;
}) {
  const dropdown = useDropdown();
  
  return (
    <div ref={dropdown.ref} className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); dropdown.setIsOpen(!dropdown.isOpen); }}
        className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border transition-all hover:shadow-sm cursor-pointer"
        style={{
          backgroundColor: `${stageInfo.color}12`,
          borderColor: `${stageInfo.color}25`,
          color: stageInfo.color
        }}
      >
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stageInfo.color }} />
        {stageInfo.label}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      
      {dropdown.isOpen && (
        <div 
          className="absolute top-full left-0 mt-1 w-48 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50"
          onClick={(e) => e.stopPropagation()}
        >
          {STAGES.map(s => (
            <button
              key={s.value}
              onClick={() => { onStageChange(s.value); dropdown.setIsOpen(false); }}
              className={`w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 transition-colors flex items-center gap-2 ${
                currentStage === s.value ? 'font-semibold' : ''
              }`}
              style={{ color: currentStage === s.value ? s.color : '#1D1D1F' }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
              {currentStage === s.value && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" style={{ color: s.color }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
