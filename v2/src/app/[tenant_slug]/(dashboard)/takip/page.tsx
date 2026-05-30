"use client";

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import useSWR from "swr";
import { 
  Radar, Search, ChevronDown, CheckCircle2, MessageCircle, 
  Phone, StickyNote, X, Flame, Thermometer, Snowflake,
  Clock, ArrowRight, Calendar, XCircle, Filter, ExternalLink,
  ClipboardList, Users, CalendarClock
} from "lucide-react";
import { getOpportunities, getOpportunityStats, updateOpportunityStage, addOpportunityNote } from "@/app/actions/pipeline";
import { useInboxStore } from "@/store/inbox-store";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { getCountryFlag } from "@/lib/utils/country";
import TasksTab from "@/components/features/takip/tasks-tab";
import OperationsTab from "@/components/features/takip/operations-tab";
import PatientTrackingTab from "@/components/features/takip/patient-tracking-tab";
import AppointmentsTab from "@/components/features/takip/appointments-tab";
import PatientDetailDrawer from "@/components/features/takip/patient-detail-drawer";
import AppointmentDetailDrawer from "@/components/features/takip/appointment-detail-drawer";

// ── Formatters ──

const formatDate = (dateString: string) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
};

const timeAgo = (dateString: string) => {
  if (!dateString) return "";
  const target = new Date(dateString);
  const diff = Math.round((Date.now() - target.getTime()) / 1000);
  
  // Future dates (follow-up scheduled)
  if (diff < 0) {
    const absDiff = Math.abs(diff);
    if (absDiff < 60) return "Birkaç saniye sonra";
    if (absDiff < 3600) return `${Math.floor(absDiff / 60)} dk sonra`;
    if (absDiff < 86400) return `${Math.floor(absDiff / 3600)} saat sonra`;
    if (absDiff < 172800) {
      const time = target.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
      return `Yarın ${time}`;
    }
    return target.toLocaleDateString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
  }
  
  // Past dates
  if (diff < 60) return "Az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
  return `${Math.floor(diff / 86400)} gün önce`;
};

const isOverdue = (dateString: string) => {
  if (!dateString) return false;
  return new Date(dateString) < new Date();
};

// ── Stage Config ──

const STAGES = [
  { value: 'new_lead', label: 'Yeni', color: '#007AFF', icon: '🆕' },
  { value: 'first_contact', label: 'İlk İletişim', color: '#FF9500', icon: '📞' },
  { value: 'engaged', label: 'Cevap Verdi', color: '#34C759', icon: '💬' },
  { value: 'discovery', label: 'Keşif', color: '#5856D6', icon: '🔍' },
  { value: 'report_waiting', label: 'Rapor Bekleniyor', color: '#FF9500', icon: '📋' },
  { value: 'report_received', label: 'Rapor Geldi', color: '#30B0C7', icon: '📄' },
  { value: 'doctor_review', label: 'Doktor İncelemesi', color: '#AF52DE', icon: '🩺' },
  { value: 'qualified', label: 'Nitelikli', color: '#30B0C7', icon: '⭐' },
  { value: 'offer_sent', label: 'Teklif Gönderildi', color: '#FF6482', icon: '💰' },
  { value: 'appointment_planning', label: 'Randevu Planlanıyor', color: '#FFD60A', icon: '📅' },
  { value: 'appointment_booked', label: 'Randevu Alındı', color: '#0F9D58', icon: '✅' },
  { value: 'arrived', label: 'Geldi', color: '#0F9D58', icon: '🏥' },
  { value: 'lost', label: 'Kayıp', color: '#FF3B30', icon: '❌' },
  { value: 'not_qualified', label: 'Uygun Değil', color: '#8E8E93', icon: '🚫' },
];

const getStageInfo = (stage: string) => STAGES.find(s => s.value === stage) || STAGES[0];

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: typeof Flame }> = {
  hot: { label: 'Sıcak', color: '#FF3B30', icon: Flame },
  warm: { label: 'Ilık', color: '#FF9500', icon: Thermometer },
  cold: { label: 'Soğuk', color: '#8E8E93', icon: Snowflake },
};

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '📱',
  instagram: '📷',
  messenger: '💬',
  google_form: '📋',
  manual: '✏️',
};

const INTENT_LABELS: Record<string, string> = {
  appointment_request: 'Randevu Talebi',
  call_request: 'Arama Talebi',
  report_sent: 'Rapor Gönderildi',
  report_waiting: 'Rapor Bekleniyor',
  price_inquiry: 'Fiyat Sorgusu',
  travel_planning: 'Seyahat Planı',
  doctor_review: 'Doktor İncelemesi',
  general_info: 'Genel Bilgi',
  follow_up_needed: 'Takip Gerekli',
  consultation_request: 'Danışma Talebi',
  second_opinion: 'İkinci Görüş',
  insurance_query: 'Sigorta Sorgusu',
  companion_inquiry: 'Refakatçi Bilgisi',
  emergency: 'Acil Durum',
};

// ── Dropdown Hook ──

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

// ══════════════════════════════════════════
// MAIN PAGE COMPONENT
// ══════════════════════════════════════════

export default function TakipPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const tenantSlug = typeof params.tenant_slug === 'string' ? params.tenant_slug : '';
  const { setActiveContact } = useInboxStore();
  const deepLinkOppId = searchParams.get('opp');
  const [activeTab, setActiveTab] = useState<'hasta_takibi' | 'randevu'>('hasta_takibi');
  
  // Filters (for firsatlar legacy tab)
  const [stageFilter, setStageFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Detail drawer
  const [drawerOppId, setDrawerOppId] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<'patient' | 'appointment'>('patient');
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  // Legacy detail modal
  const [selectedOpp, setSelectedOpp] = useState<any>(null);
  const [noteText, setNoteText] = useState("");

  // Dropdowns
  const stageDropdown = useDropdown();
  const priorityDropdown = useDropdown();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ── Data (SWR) ──
  const { data, isLoading, mutate } = useSWR(
    ['opportunities', stageFilter, priorityFilter],
    () => getOpportunities({
      stage: stageFilter !== 'all' ? stageFilter : undefined,
      priority: priorityFilter !== 'all' ? priorityFilter : undefined,
      limit: 100
    }),
    { refreshInterval: 30000 }
  );

  const { data: stats, mutate: mutateStats } = useSWR(
    'opportunity-stats',
    () => getOpportunityStats(),
    { refreshInterval: 30000 }
  );

  // ── Actions ──
  const handleStageUpdate = useCallback(async (oppId: string, stage: string) => {
    await updateOpportunityStage(oppId, stage);
    mutate();
    mutateStats();
  }, [mutate, mutateStats]);

  const handleAddNote = useCallback(async (oppId: string, text: string) => {
    await addOpportunityNote(oppId, text);
    mutate();
    setNoteText("");
  }, [mutate]);

  const opportunities = data?.items || [];
  const total = data?.total || 0;

  // Deep link: auto-open opportunity detail from notification click
  useEffect(() => {
    if (deepLinkOppId && opportunities.length > 0 && !selectedOpp) {
      const target = opportunities.find((o: any) => o.id === deepLinkOppId);
      if (target) {
        setSelectedOpp(target);
        // Clean up URL
        router.replace(`/${tenantSlug}/takip`, { scroll: false });
      }
    }
  }, [deepLinkOppId, opportunities, selectedOpp, router, tenantSlug]);

  // Client-side search filter
  const filtered = debouncedSearch
    ? opportunities.filter((o: any) => {
        const search = debouncedSearch.toLowerCase();
        return (
          (o.display_name || o.patient_name || '')?.toLowerCase().includes(search) ||
          o.requester_name?.toLowerCase().includes(search) ||
          o.phone_number?.includes(search) ||
          o.department?.toLowerCase().includes(search) ||
          o.country?.toLowerCase().includes(search)
        );
      })
    : opportunities;

  const handleGoToInbox = (opp: any) => {
    setActiveContact(opp.phone_number, {
      id: opp.phone_number,
      name: opp.display_name || opp.requester_name || opp.patient_name || opp.phone_number,
      channel: opp.source || 'whatsapp',
      unread: 0
    });
    router.push(`/${tenantSlug}/inbox`);
  };

  return (
    <div className="p-4 md:p-8 h-full flex flex-col relative overflow-hidden">
      {/* Background */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#5856D6]/5 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#FF9500]/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#1D1D1F] flex items-center gap-2">
            <Radar className="w-7 h-7 text-[#5856D6]" />
            Takip Merkezi
          </h1>
          {/* Tab Switcher — Primary: Hasta Takibi + Randevu */}
          <div className="flex items-center gap-2 mt-2 w-fit">
            <button
              onClick={() => setActiveTab('hasta_takibi')}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'hasta_takibi' 
                  ? 'bg-indigo-600 text-white shadow-md' 
                  : 'bg-black/[0.04] text-[#86868B] hover:text-[#1D1D1F]'
              }`}
            >
              <Users className="w-4 h-4" />
              Hasta Takibi
            </button>
            <button
              onClick={() => setActiveTab('randevu')}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'randevu' 
                  ? 'bg-indigo-600 text-white shadow-md' 
                  : 'bg-black/[0.04] text-[#86868B] hover:text-[#1D1D1F]'
              }`}
            >
              <CalendarClock className="w-4 h-4" />
              Randevu Yönetimi
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3">
          {stats && (
            <>
              <StatBadge label="Aktif" value={stats.active} color="#007AFF" />
              <StatBadge label="Sıcak" value={stats.hot} color="#FF3B30" />
              <StatBadge label="Bugün Takip" value={stats.due_today} color="#FF9500" />
              {Number(stats.overdue) > 0 && (
                <StatBadge label="Gecikmiş" value={stats.overdue} color="#FF3B30" pulse />
              )}
            </>
          )}
        </div>
      </div>

      {/* HASTA TAKİBİ TAB */}
      {activeTab === 'hasta_takibi' && (
        <div className="flex-1 bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200">
          <PatientTrackingTab 
            onGoToInbox={handleGoToInbox} 
            onOpenDrawer={(id) => {
              setDrawerOppId(id);
              setDrawerMode('patient');
              setDrawerTaskId(null);
            }} 
          />
        </div>
      )}

      {/* RANDEVU YÖNETİMİ TAB */}
      {activeTab === 'randevu' && (
        <div className="flex-1 bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200">
          <AppointmentsTab 
            onGoToInbox={handleGoToInbox} 
            onOpenDrawer={(id) => {
              setDrawerOppId(id);
              setDrawerMode('appointment');
              setDrawerTaskId(null);
            }} 
          />
        </div>
      )}

      {/* Patient Detail Drawer */}
      {drawerOppId && drawerMode === 'patient' && (
        <PatientDetailDrawer
          opportunityId={drawerOppId}
          onClose={() => setDrawerOppId(null)}
          onGoToInbox={handleGoToInbox}
          onRefresh={() => { mutate(); mutateStats(); }}
        />
      )}

      {/* Appointment Detail Drawer */}
      {drawerOppId && drawerMode === 'appointment' && (
        <AppointmentDetailDrawer
          opportunityId={drawerOppId}
          taskId={drawerTaskId}
          onClose={() => { setDrawerOppId(null); setDrawerTaskId(null); }}
          onGoToInbox={handleGoToInbox}
          onOpenPatientDetail={(id) => {
            setDrawerMode('patient');
          }}
          onRefresh={() => { mutate(); mutateStats(); }}
        />
      )}
    </div>
  );
}

// ── Stat Badge ──

function StatBadge({ label, value, color, pulse }: { label: string; value: any; color: string; pulse?: boolean }) {
  return (
    <div 
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border"
      style={{ backgroundColor: `${color}08`, borderColor: `${color}20` }}
    >
      {pulse && <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />}
      <span className="text-[12px] font-bold" style={{ color }}>{value}</span>
      <span className="text-[10px] font-semibold text-[#86868B]">{label}</span>
    </div>
  );
}

// ── Inline Stage Selector ──

function InlineStageSelector({ currentStage, stageInfo, onStageChange }: { 
  currentStage: string; 
  stageInfo: { value: string; label: string; color: string; icon: string };
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
        <span>{stageInfo.icon}</span>
        {stageInfo.label}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      
      {dropdown.isOpen && (
        <div 
          className="absolute top-full left-0 mt-1 w-52 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 max-h-[300px] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {STAGES.map(s => (
            <button
              key={s.value}
              onClick={() => { onStageChange(s.value); dropdown.setIsOpen(false); }}
              className={`w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 transition-colors flex items-center gap-2 ${currentStage === s.value ? 'font-bold' : ''}`}
              style={{ color: currentStage === s.value ? s.color : '#1D1D1F' }}
            >
              <span>{s.icon}</span>
              {s.label}
              {currentStage === s.value && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" style={{ color: s.color }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Detail Modal ──

function OppDetailModal({ opp, onClose, onStageChange, onAddNote, onGoToInbox, noteText, setNoteText }: {
  opp: any;
  onClose: () => void;
  onStageChange: (stage: string) => void;
  onAddNote: (text: string) => void;
  onGoToInbox: () => void;
  noteText: string;
  setNoteText: (t: string) => void;
}) {
  const stageInfo = getStageInfo(opp.stage);
  const prioConfig = PRIORITY_CONFIG[opp.priority] || PRIORITY_CONFIG.warm;
  const flag = opp.country ? getCountryFlag(opp.country) : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-[520px] bg-[#F5F5F7] rounded-[28px] shadow-[0_20px_40px_rgba(0,0,0,0.2)] flex flex-col max-h-[90vh] overflow-hidden pointer-events-auto border border-white/20">
          
          {/* Header */}
          <div className="px-6 py-5 bg-white border-b border-black/5 flex items-center justify-between shrink-0 rounded-t-[28px]">
            <div>
              <h2 className="text-xl font-bold text-[#1D1D1F] flex items-center gap-2">
                {opp.display_name || opp.requester_name || opp.patient_name || 'İsimsiz'}
                {flag && <span className="text-lg">{flag}</span>}
              </h2>
              <p className="text-[#86868B] text-sm font-medium mt-0.5">
                {opp.phone_number} · {CHANNEL_ICONS[opp.source]} {opp.source}
              </p>
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors">
              <X className="w-5 h-5 text-[#1D1D1F]" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            
            {/* Quick Actions */}
            <div className="flex gap-3">
              <button 
                onClick={onGoToInbox}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#5856D6] text-white rounded-xl font-semibold shadow-md hover:bg-[#4A48C4] transition-colors"
              >
                <MessageCircle className="w-5 h-5" />
                Mesaja Git
              </button>
              <button 
                onClick={() => onStageChange('lost')}
                className="flex items-center justify-center gap-2 py-3 px-4 bg-white text-[#FF3B30] border border-[#FF3B30]/20 rounded-xl font-semibold hover:bg-[#FF3B30]/5 transition-colors"
              >
                <XCircle className="w-5 h-5" />
                Kayıp
              </button>
            </div>

            {/* Info Card */}
            <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <InfoField label="Departman" value={opp.department || '—'} />
                <InfoField label="Ülke" value={opp.country ? `${flag} ${opp.country}` : '—'} />
                <InfoField label="Dil" value={opp.language || '—'} />
                <div>
                  <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">Öncelik</p>
                  <span 
                    className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md mt-1"
                    style={{ backgroundColor: `${prioConfig.color}12`, color: prioConfig.color }}
                  >
                    <prioConfig.icon className="w-3 h-3" />
                    {prioConfig.label}
                  </span>
                </div>
              </div>

              <div className="border-t border-black/5 pt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">Aşama</p>
                  <div className="mt-1">
                    <InlineStageSelector currentStage={opp.stage} stageInfo={stageInfo} onStageChange={onStageChange} />
                  </div>
                </div>
                <InfoField label="Niyet" value={INTENT_LABELS[opp.intent_type] || opp.intent_type || '—'} />
              </div>
            </div>

            {/* AI Summary */}
            <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm">
              <h3 className="text-sm font-bold text-[#1D1D1F] mb-2 flex items-center gap-2">
                🤖 AI Özeti
              </h3>
              {(opp.ai_summary || opp.summary) ? (
                <p className="text-[13px] text-[#1D1D1F] leading-relaxed">
                  {opp.ai_summary || opp.summary}
                </p>
              ) : (
                <p className="text-[12px] text-[#86868B] italic">Bu fırsat için henüz AI özeti yok.</p>
              )}
            </div>

            {/* AI Reason */}
            <div className="bg-[#5856D6]/5 rounded-xl p-3 border border-[#5856D6]/10">
              <p className="text-[11px] font-semibold text-[#5856D6]">
                🎯 Neden fırsat: {opp.ai_reason || 'Fırsat nedeni henüz çıkarılmadı.'}
              </p>
            </div>

            {/* Add Note */}
            <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm">
              <h3 className="text-sm font-bold text-[#1D1D1F] mb-2 flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-[#FF9500]" />
                Not Ekle
              </h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Hızlı not yazın..."
                  className="flex-1 px-3 py-2 bg-[#F5F5F7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#5856D6]/40"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && noteText.trim()) {
                      onAddNote(noteText.trim());
                    }
                  }}
                />
                <button
                  onClick={() => noteText.trim() && onAddNote(noteText.trim())}
                  disabled={!noteText.trim()}
                  className="px-4 py-2 bg-[#5856D6] text-white rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-[#4A48C4] transition-colors"
                >
                  Ekle
                </button>
              </div>

              {/* Existing notes */}
              {opp.notes && Array.isArray(opp.notes) && opp.notes.length > 0 && (
                <div className="mt-3 space-y-2">
                  {opp.notes.map((note: any, i: number) => (
                    <div key={i} className="p-2 bg-[#F5F5F7] rounded-lg text-[12px]">
                      <span className="font-semibold text-[#1D1D1F]">{note.author}</span>
                      <span className="text-[#86868B] ml-2">{note.created_at ? timeAgo(note.created_at) : ''}</span>
                      <p className="text-[#1D1D1F] mt-0.5">{note.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Timestamps */}
            <div className="text-[10px] text-[#C7C7CC] space-y-0.5">
              <p>Oluşturulma: {formatDate(opp.created_at)}</p>
              <p>Son güncelleme: {formatDate(opp.updated_at)}</p>
              {opp.conv_last_message_at && <p>Son mesaj: {timeAgo(opp.conv_last_message_at)}</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">{label}</p>
      <p className="text-[14px] font-semibold text-[#1D1D1F] mt-1">{value}</p>
    </div>
  );
}
