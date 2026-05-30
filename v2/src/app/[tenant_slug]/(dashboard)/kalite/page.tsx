"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import { 
  Activity, Search, ChevronDown, CheckCircle2, MessageCircle, 
  Phone, StickyNote, X, Flame, ShieldAlert, Zap, Clock, 
  AlertTriangle, Filter, ExternalLink, CalendarClock, Moon, Sparkles, AlertCircle, Radar
} from "lucide-react";
import { 
  getOperationQualityDashboard, getOperationQualityItems, getQualityItemDetail, 
  type QualityRiskItem, type QualityDashboardStats, type RiskType 
} from "@/app/actions/operation-quality";
import { useRouter, useParams, useSearchParams } from "next/navigation";

// ── Country Flag Formatter ──
const getCountryFlag = (country?: string): string => {
  if (!country) return "🌍";
  const FLAGS: Record<string, string> = {
    'Türkiye': '🇹🇷', 'Turkey': '🇹🇷', 'Almanya': '🇩🇪', 'Germany': '🇩🇪',
    'Irak': '🇮🇶', 'Iraq': '🇮🇶', 'ABD': '🇺🇸', 'USA': '🇺🇸',
    'İngiltere': '🇬🇧', 'UK': '🇬🇧', 'Suudi Arabistan': '🇸🇦',
    'Libya': '🇱🇾', 'Rusya': '🇷🇺', 'BAE': '🇦🇪', 'Azerbaycan': '🇦🇿',
  };
  return FLAGS[country] || "🌍";
};

// ── Phone Masking Helper ──
const maskPhone = (phone: string): string => {
  if (!phone) return "";
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length < 6) return "***";

  let prefix = "";
  const lastFour = cleaned.slice(-4);

  if (cleaned.startsWith("90") && cleaned.length >= 10) {
    prefix = "+90";
  } else if (cleaned.startsWith("49") && cleaned.length >= 10) {
    prefix = "+49";
  } else if (cleaned.startsWith("33") && cleaned.length >= 10) {
    prefix = "+33";
  } else if (cleaned.startsWith("44") && cleaned.length >= 10) {
    prefix = "+44";
  } else if (cleaned.startsWith("1") && cleaned.length >= 10) {
    prefix = "+1";
  } else {
    prefix = `+${cleaned.substring(0, 2)}`;
  }

  const last2a = lastFour.substring(0, 2);
  const last2b = lastFour.substring(2, 4);

  return `${prefix} *** ** ${last2a} ${last2b}`;
};

// ── Dropdown Hook ──
function useDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    if (isOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);
  
  return { isOpen, setIsOpen, ref };
}

// ── Risk Type Labels ──
const RISK_TYPE_LABELS: Record<RiskType, string> = {
  hot_lead_waiting: "Sıcak Lead Bekliyor",
  draft_pending_review: "Onay Bekleyen Taslak",
  appointment_unconfirmed: "Teyitsiz Randevu",
  appointment_overdue: "Sonuçsuz Randevu",
  task_overdue: "Geciken Görev",
  bot_draft_ready: "Bota Devir Taslağı",
  reminder_draft_unreviewed: "Hatırlatıcı Taslağı",
  patient_message_waiting: "Mesaj Yanıt Bekliyor",
  patient_not_responding: "Hasta Yanıt Vermedi",
  stale_opportunity: "Hareketsiz Fırsat",
  missing_critical_data: "Kritik Bilgi Eksik"
};

const RISK_TYPE_ICONS: Record<RiskType, any> = {
  hot_lead_waiting: Flame,
  draft_pending_review: Sparkles,
  appointment_unconfirmed: Clock,
  appointment_overdue: AlertTriangle,
  task_overdue: AlertCircle,
  bot_draft_ready: Zap,
  reminder_draft_unreviewed: CalendarClock,
  patient_message_waiting: MessageSquareAlternative,
  patient_not_responding: Phone,
  stale_opportunity: Clock,
  missing_critical_data: AlertTriangle
};

function MessageSquareAlternative(props: any) {
  return <MessageCircle {...props} />;
}

export default function KalitePage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const tenantSlug = typeof params.tenant_slug === "string" ? params.tenant_slug : "";
  const deepLinkItemId = searchParams.get("itemId");

  // Filters
  const [riskTypeFilter, setRiskTypeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Drawer
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemType, setSelectedItemType] = useState<RiskType | null>(null);
  const [drawerData, setDrawerData] = useState<any>(null);
  const [isDrawerLoading, setIsDrawerLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // SWR for dashboard stats
  const { data: stats, mutate: mutateStats } = useSWR(
    ["operation-quality-stats"],
    () => getOperationQualityDashboard(),
    { refreshInterval: 15000 }
  );

  // SWR for items
  const { data: allItems, isLoading: isListLoading, mutate: mutateItems } = useSWR(
    ["operation-quality-items", riskTypeFilter, priorityFilter],
    () => getOperationQualityItems({
      risk_type: riskTypeFilter !== "all" ? riskTypeFilter : undefined,
      priority: priorityFilter !== "all" ? priorityFilter : undefined
    }),
    { refreshInterval: 15000 }
  );

  // Handle drawer detail loading
  useEffect(() => {
    if (selectedItemId && selectedItemType) {
      setIsDrawerLoading(true);
      getQualityItemDetail(selectedItemId, selectedItemType)
        .then(data => {
          setDrawerData(data);
          setIsDrawerLoading(false);
        })
        .catch(err => {
          console.error(err);
          setIsDrawerLoading(false);
        });
    } else {
      setDrawerData(null);
    }
  }, [selectedItemId, selectedItemType]);

  // Deep Link auto-opening
  useEffect(() => {
    if (deepLinkItemId && allItems && allItems.length > 0 && !selectedItemId) {
      const match = allItems.find(i => i.id === deepLinkItemId);
      if (match) {
        setSelectedItemId(match.id);
        setSelectedItemType(match.type);
        // Clean URL params safely
        router.replace(`/${tenantSlug}/kalite`, { scroll: false });
      }
    }
  }, [deepLinkItemId, allItems, selectedItemId, router, tenantSlug]);

  const items = allItems || [];

  // Client-side search mapping
  const filteredItems = debouncedSearch
    ? items.filter(i => {
        const query = debouncedSearch.toLowerCase();
        return (
          i.patient_name.toLowerCase().includes(query) ||
          i.phone.includes(query) ||
          i.risk_reason.toLowerCase().includes(query)
        );
      })
    : items;

  return (
    <div className="p-4 md:p-8 h-full flex flex-col relative overflow-hidden bg-[#F5F5F7]">
      {/* Background radial soft highlights */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#5856D6]/5 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#FF3B30]/3 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Zero Outbound Containment Security Audit Header */}
      <div className="flex-none bg-white border border-black/5 p-4 rounded-2xl flex items-center justify-between gap-4 mb-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#1D1D1F] tracking-tight flex items-center gap-2">
              Operasyon Kalite & SLA Denetim Merkezi
            </h1>
            <p className="text-[11px] text-[#86868B] font-semibold flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-2.5 h-2.5 bg-indigo-600 rounded-full animate-ping" />
              SLA Risk Analiz Motoru Aktif · Sıfır-Outbound Denetim Modu
            </p>
          </div>
        </div>
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200/55 rounded-xl text-[10px] font-bold text-amber-700">
          <ShieldAlert className="w-3.5 h-3.5" />
          GÖNDERİM P0 MODUNDA KAPALIDIR. BU PANEL OPERASYONEL RİSK VE SLA DENETİMİ İÇİNDİR.
        </div>
      </div>

      {/* Dashboard Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6 flex-none">
        <MetricCard label="Aktif Riskler" value={items.length} color="#FF3B30" subtext="Toplam SLA İhlali" icon={AlertTriangle} />
        <MetricCard label="Sıcak Lead Bekleyen" value={stats?.hot_leads_waiting_count || 0} color="#FF9500" subtext="SLA Aşanlar (>2s)" icon={Flame} />
        <MetricCard label="Geciken Görevler" value={stats?.overdue_tasks_count || 0} color="#FF3B30" subtext="Takip Görevleri" icon={AlertCircle} />
        <MetricCard label="Teyitsiz Randevular" value={stats?.appointments_unconfirmed_count || 0} color="#007AFF" subtext="Yaklaşan (<24s)" icon={Clock} />
        <MetricCard label="Bekleyen Taslaklar" value={stats?.pending_drafts_count || 0} color="#5856D6" subtext="Onay Bekleyenler" icon={Sparkles} />
        <MetricCard label="Bugünkü Randevular" value={stats?.appointments_today_count || 0} color="#34C759" subtext="Toplam Randevu" icon={CalendarClock} />
      </div>

      {/* Main Grid Card Area */}
      <div className="flex-1 bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex flex-col">
        {/* Table Filters & Search */}
        <div className="p-4 border-b border-black/5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#86868B]" />
              <input 
                type="text" 
                placeholder="Hasta adı veya gerekçe..." 
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-[#F5F5F7] border border-transparent rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-600/40 focus:bg-white transition-all shadow-sm"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-2 bg-[#F5F5F7] p-1 rounded-xl border border-black/5">
              <button 
                onClick={() => setRiskTypeFilter("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${riskTypeFilter === "all" ? "bg-white text-[#1D1D1F] shadow-sm" : "text-[#86868B] hover:text-[#1D1D1F]"}`}
              >
                Tüm Riskler
              </button>
              <button 
                onClick={() => setRiskTypeFilter("hot_lead_waiting")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${riskTypeFilter === "hot_lead_waiting" ? "bg-white text-[#1D1D1F] shadow-sm" : "text-[#86868B] hover:text-[#1D1D1F]"}`}
              >
                🔥 Sıcak Bekleyen
              </button>
              <button 
                onClick={() => setRiskTypeFilter("appointment_unconfirmed")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${riskTypeFilter === "appointment_unconfirmed" ? "bg-white text-[#1D1D1F] shadow-sm" : "text-[#86868B] hover:text-[#1D1D1F]"}`}
              >
                📅 Teyitsiz Randevu
              </button>
              <button 
                onClick={() => setRiskTypeFilter("task_overdue")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${riskTypeFilter === "task_overdue" ? "bg-white text-[#1D1D1F] shadow-sm" : "text-[#86868B] hover:text-[#1D1D1F]"}`}
              >
                ⚠️ Geciken Görev
              </button>
            </div>

            <div className="flex items-center gap-1.5 bg-[#F5F5F7] p-1 rounded-xl border border-black/5">
              <button 
                onClick={() => setPriorityFilter("all")}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${priorityFilter === "all" ? "bg-white text-[#1D1D1F] shadow-sm" : "text-[#86868B] hover:text-[#1D1D1F]"}`}
              >
                Tümü
              </button>
              <button 
                onClick={() => setPriorityFilter("hot")}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${priorityFilter === "hot" ? "bg-white text-[#1D1D1F] shadow-sm" : "text-[#86868B] hover:text-[#1D1D1F]"}`}
              >
                🔥 Yüksek
              </button>
            </div>
          </div>
          <div className="text-xs font-semibold text-[#86868B] flex items-center gap-2">
            {filteredItems.length} Risk Kaydı Listeleniyor
          </div>
        </div>

        {/* Audit Queue Grid Table */}
        <div className="flex-1 overflow-y-auto min-h-[300px]">
          <table className="w-full border-collapse text-left">
            <thead className="bg-[#F5F5F7] sticky top-0 z-10 border-b border-black/5">
              <tr>
                <th className="py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Audit Skor</th>
                <th className="py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Risk Türü</th>
                <th className="py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Hasta / İletişim</th>
                <th className="py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Kaynak</th>
                <th className="py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Son Eylem</th>
                <th className="py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Gecikme Süresi</th>
                <th className="py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Açıklama / Gerekçe</th>
                <th className="py-3 px-4 text-[10px] font-bold text-[#86868B] uppercase tracking-wider text-right">Detay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 bg-white">
              {filteredItems.map((item) => {
                const Icon = RISK_TYPE_ICONS[item.type] || AlertTriangle;
                return (
                  <tr 
                    key={item.id}
                    onClick={() => { setSelectedItemId(item.id); setSelectedItemType(item.type); }}
                    className="hover:bg-indigo-50/20 transition-colors cursor-pointer group"
                  >
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center justify-center w-10 h-6 rounded-lg text-xs font-bold ${
                        item.severity === "yüksek" ? "bg-rose-50 text-rose-700 border border-rose-200" :
                        item.severity === "orta" ? "bg-amber-50 text-amber-700 border border-amber-200" :
                        "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      }`}>
                        {item.risk_score}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1D1D1F]">
                        <Icon className={`w-3.5 h-3.5 ${
                          item.severity === "yüksek" ? "text-rose-600" :
                          item.severity === "orta" ? "text-amber-600" :
                          "text-emerald-600"
                        }`} />
                        {RISK_TYPE_LABELS[item.type] || item.type}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div>
                        <div className="text-[13px] font-bold text-[#1D1D1F] flex items-center gap-1.5">
                          {item.patient_name}
                          {item.country && (
                            <span className="text-[10px] font-semibold text-[#86868B] bg-[#F5F5F7] px-1 py-0.5 rounded border border-black/5">
                              {getCountryFlag(item.country)} {item.country}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#86868B] font-medium mt-0.5">
                          {item.masked_phone}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-xs font-semibold text-[#86868B] uppercase bg-[#F5F5F7] px-2 py-1 rounded-md border border-black/5">
                        {item.source}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium text-[#1D1D1F]">
                      {item.last_action_time ? new Date(item.last_action_time).toLocaleDateString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`text-xs font-bold ${
                        item.severity === "yüksek" ? "text-rose-600" : "text-[#1D1D1F]"
                      }`}>
                        {item.idle_duration_label}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 max-w-xs truncate text-xs text-[#86868B] font-medium">
                      {item.risk_reason}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <ExternalLink className="w-4 h-4 text-[#C7C7CC] group-hover:text-indigo-600 transition-colors ml-auto" />
                    </td>
                  </tr>
                );
              })}
              {filteredItems.length === 0 && !isListLoading && (
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <Activity className="w-10 h-10 text-[#C7C7CC] mx-auto mb-3" />
                    <p className="text-sm font-semibold text-[#86868B]">Operasyonel risk veya SLA ihlali bulunamadı.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dynamic Slide-over Audit Detail Drawer */}
      {selectedItemId && selectedItemType && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40" onClick={() => { setSelectedItemId(null); setSelectedItemType(null); }} />
          <div className="fixed top-0 right-0 h-full w-full max-w-[500px] bg-[#F5F5F7] shadow-[0_20px_50px_rgba(0,0,0,0.15)] z-50 flex flex-col border-l border-white/20">
            {/* Drawer Header */}
            <div className="px-6 py-5 bg-white border-b border-black/5 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-bold text-[#1D1D1F]">SLA Kalite Denetimi</h3>
                <p className="text-[11px] text-[#86868B] font-semibold uppercase tracking-wider mt-0.5">
                  AUDIT ID: {selectedItemId.slice(0, 15)}...
                </p>
              </div>
              <button 
                onClick={() => { setSelectedItemId(null); setSelectedItemType(null); }}
                className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 transition-colors flex items-center justify-center"
              >
                <X className="w-5 h-5 text-[#1D1D1F]" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {isDrawerLoading ? (
                <div className="py-20 text-center">
                  <Activity className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
                  <p className="text-xs font-semibold text-[#86868B]">SLA ihlal detayları analiz ediliyor...</p>
                </div>
              ) : drawerData ? (
                <>
                  {/* Quality Score Risk Card */}
                  <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-[#86868B] uppercase tracking-wider">Risk Puanı</p>
                      <h4 className="text-3xl font-extrabold text-[#1D1D1F] mt-1 flex items-baseline gap-1">
                        {drawerData.item.risk_score}
                        <span className="text-xs font-semibold text-[#86868B]">/ 100</span>
                      </h4>
                    </div>
                    <span className={`px-3 py-1.5 rounded-xl text-xs font-bold border uppercase tracking-wider ${
                      drawerData.item.severity === "yüksek" ? "bg-rose-50 text-rose-700 border-rose-200" :
                      drawerData.item.severity === "orta" ? "bg-amber-50 text-amber-700 border-amber-200" :
                      "bg-emerald-50 text-emerald-700 border-emerald-200"
                    }`}>
                      {drawerData.item.severity} Seviye
                    </span>
                  </div>

                  {/* Sleep Hours / Timezone Warnings */}
                  {drawerData.timezone_warning && (
                    <div className="bg-rose-50 border border-rose-200/50 rounded-2xl p-4 flex gap-3 text-rose-800 text-[12px] font-semibold leading-relaxed">
                      <Moon className="w-5 h-5 text-rose-600 shrink-0" />
                      <div>
                        {drawerData.timezone_warning}
                        {drawerData.dual_clock && (
                          <div className="mt-2 text-[10px] text-rose-600 flex items-center gap-3">
                            <span>🇹🇷 TR Saat: {drawerData.dual_clock.tenantTime.split(" ")[1]}</span>
                            <span>🌍 Hasta Saat: {drawerData.dual_clock.patientTime.split(" ")[1]}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Risk Gerekçesi ve Önerilen Aksiyon */}
                  <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-3">
                    <div>
                      <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded">Gerekçe / Bulgular</span>
                      <p className="text-sm font-bold text-[#1D1D1F] mt-2 leading-relaxed">
                        {drawerData.risk_reason}
                      </p>
                    </div>
                    <div className="border-t border-black/5 pt-3">
                      <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-widest bg-[#F5F5F7] px-2 py-0.5 rounded">Önerilen Çözüm Aksiyonu</span>
                      <p className="text-[13px] font-medium text-[#1D1D1F] mt-2 leading-relaxed">
                        {drawerData.suggested_action}
                      </p>
                    </div>
                  </div>

                  {/* Patient Info Card */}
                  {drawerData.opportunity && (
                    <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-3.5">
                      <h4 className="text-xs font-bold text-[#86868B] uppercase tracking-wider border-b border-black/5 pb-2">Hasta Kartı Bilgileri</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">İsim</p>
                          <p className="text-sm font-bold text-[#1D1D1F] mt-0.5">{drawerData.opportunity.patient_name}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Telefon</p>
                          <p className="text-sm font-bold text-[#1D1D1F] mt-0.5">{maskPhone(drawerData.opportunity.phone_number)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Departman / Ülke</p>
                          <p className="text-xs font-bold text-[#1D1D1F] mt-0.5">
                            {drawerData.opportunity.department} ({getCountryFlag(drawerData.opportunity.country)} {drawerData.opportunity.country})
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Aşama / Öncelik</p>
                          <p className="text-xs font-bold text-[#1D1D1F] mt-0.5 uppercase tracking-wide">
                            {drawerData.opportunity.stage} / {drawerData.opportunity.priority}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Opportunity AI Context */}
                  {drawerData.opportunity && (
                    <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-3">
                      <div>
                        <h4 className="text-xs font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
                          🤖 Klinik AI Özeti
                        </h4>
                        <p className="text-[13px] text-[#1D1D1F] mt-2 leading-relaxed">
                          {drawerData.opportunity.summary}
                        </p>
                      </div>
                      <div className="border-t border-black/5 pt-3">
                        <h4 className="text-xs font-bold text-[#86868B] uppercase tracking-wider">
                          🎯 AI Fırsat Analiz Gerekçesi
                        </h4>
                        <p className="text-xs text-[#86868B] font-semibold mt-2 leading-relaxed">
                          {drawerData.opportunity.ai_reason}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Last Message Snippet */}
                  {drawerData.last_message && (
                    <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-2">
                      <div className="flex items-center justify-between border-b border-black/5 pb-2">
                        <h4 className="text-xs font-bold text-[#86868B] uppercase tracking-wider">Sohbetteki Son İletişim</h4>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                          drawerData.last_message.direction === "in" 
                            ? "bg-blue-50 text-blue-700 border-blue-200" 
                            : "bg-[#F5F5F7] text-[#86868B] border-black/5"
                        }`}>
                          {drawerData.last_message.direction === "in" ? "Hasta Gönderdi" : "Platform Gönderdi"}
                        </span>
                      </div>
                      <p className="text-[13px] text-[#1D1D1F] italic leading-relaxed pt-1">
                        "{drawerData.last_message.text}"
                      </p>
                      <p className="text-[10px] text-[#86868B] font-semibold mt-1">
                        Tarih: {new Date(drawerData.last_message.created_at).toLocaleDateString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  )}

                  {/* Deep Navigation Actions */}
                  <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-3 shrink-0">
                    <h4 className="text-xs font-bold text-[#86868B] uppercase tracking-wider border-b border-black/5 pb-2">Hızlı Operasyon Linkleri</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {drawerData.item.links.patientTracking && (
                        <button 
                          onClick={() => router.push(drawerData.item.links.patientTracking)}
                          className="flex items-center justify-center gap-2 py-3 bg-[#F5F5F7] border border-black/5 hover:bg-black/5 text-[#1D1D1F] text-xs font-bold rounded-xl shadow-sm transition-colors"
                        >
                          <Radar className="w-4 h-4 text-indigo-600" />
                          Takip Merkezi
                        </button>
                      )}
                      {drawerData.item.links.draftApproval && (
                        <button 
                          onClick={() => router.push(drawerData.item.links.draftApproval)}
                          className="flex items-center justify-center gap-2 py-3 bg-[#F5F5F7] border border-black/5 hover:bg-black/5 text-[#1D1D1F] text-xs font-bold rounded-xl shadow-sm transition-colors"
                        >
                          <Sparkles className="w-4 h-4 text-indigo-600" />
                          Onay Merkezi
                        </button>
                      )}
                      {drawerData.item.links.appointment && (
                        <button 
                          onClick={() => router.push(drawerData.item.links.appointment)}
                          className="flex items-center justify-center gap-2 py-3 bg-[#F5F5F7] border border-black/5 hover:bg-black/5 text-[#1D1D1F] text-xs font-bold rounded-xl shadow-sm transition-colors"
                        >
                          <CalendarClock className="w-4 h-4 text-indigo-600" />
                          Randevular
                        </button>
                      )}
                      {drawerData.item.links.inbox && (
                        <button 
                          onClick={() => router.push(drawerData.item.links.inbox)}
                          className="flex items-center justify-center gap-2 py-3 bg-[#F5F5F7] border border-black/5 hover:bg-black/5 text-[#1D1D1F] text-xs font-bold rounded-xl shadow-sm transition-colors"
                        >
                          <MessageCircle className="w-4 h-4 text-indigo-600" />
                          Mesaja Git
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-20 text-center text-[#86868B] text-xs font-semibold">
                  Detay verileri yüklenemedi.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Dashboard Metric Card Component ──
function MetricCard({ 
  label, 
  value, 
  color, 
  subtext, 
  icon: Icon 
}: { 
  label: string; 
  value: number; 
  color: string; 
  subtext: string; 
  icon: any; 
}) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{label}</span>
        <Icon className="w-4 h-4 shrink-0" style={{ color }} />
      </div>
      <div>
        <h3 className="text-2xl font-extrabold text-[#1D1D1F] tracking-tight">{value}</h3>
        <p className="text-[9px] text-[#86868B] font-semibold mt-0.5 uppercase tracking-wide">{subtext}</p>
      </div>
    </div>
  );
}
