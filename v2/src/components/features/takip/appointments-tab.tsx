"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import {
  Search, ChevronDown, CheckCircle2, Phone, Calendar,
  Clock, AlertTriangle, X, Filter, Building2, MapPin, MoreVertical, Check, Ban, XCircle, CalendarClock, Moon, Zap,
  RotateCcw, Bot, FileText
} from "lucide-react";
import { 
  getAppointmentRows, getAppointmentStats, completeAppointmentTask, updateAppointmentConfirmation, rescheduleAppointmentTask,
  manuallyUpdateAppointmentStatus, recordAppointmentReminder, recordBotDirectiveSent,
  approveBotSuggestion, rejectBotSuggestion,
  type AppointmentRow, type AppointmentFilters 
} from "@/app/actions/patient-tracking";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";
import { saveBotDirective } from "@/app/actions/focus-queue";

const MONTHS_TR = [
  { value: '01', label: 'Ocak' },
  { value: '02', label: 'Şubat' },
  { value: '03', label: 'Mart' },
  { value: '04', label: 'Nisan' },
  { value: '05', label: 'Mayıs' },
  { value: '06', label: 'Haziran' },
  { value: '07', label: 'Temmuz' },
  { value: '08', label: 'Ağustos' },
  { value: '09', label: 'Eylül' },
  { value: '10', label: 'Ekim' },
  { value: '11', label: 'Kasım' },
  { value: '12', label: 'Aralık' },
];

function formatPartialDate(meta: any) {
  if (!meta) return '';
  const monthLabel = MONTHS_TR.find(m => m.value === meta.selected_month)?.label || '';
  if (meta.partial_precision === 'year_month') {
    return `${monthLabel} ${meta.selected_year}`;
  } else if (meta.partial_precision === 'year_month_day') {
    const day = meta.selected_day?.replace(/^0/, '') || '';
    return `${day} ${monthLabel} ${meta.selected_year}`;
  } else if (meta.partial_precision === 'full') {
    const day = meta.selected_day?.replace(/^0/, '') || '';
    return `${day} ${monthLabel} ${meta.selected_year}, Saat ${meta.selected_time}`;
  }
  return '';
}

function formatDateTr(dateStr: string | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: 'numeric',
      month: 'long',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(d);
  } catch (_) {
    return dateStr;
  }
}

function formatKalanTime(dueAtUtc: string | undefined, type: 'phone' | 'clinic') {
  if (!dueAtUtc) return '—';
  const due = new Date(dueAtUtc).getTime();
  const now = Date.now();
  const diffMs = due - now;

  if (diffMs < 0) {
    const absMs = Math.abs(diffMs);
    const mins = Math.floor(absMs / 60000);
    const hours = Math.floor(absMs / 3600000);
    const days = Math.floor(absMs / 86400000);
    if (days > 0) return `${days} Gün Gecikti`;
    if (hours > 0) return `${hours} Saat Gecikti`;
    return `${mins} Dk Gecikti`;
  }

  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (type === 'phone') {
    if (days > 0) {
      if (days === 1) return 'Yarın';
      return `${days} Gün Kalan`;
    }
    if (hours > 0) {
      return `${hours} Saat Kalan`;
    }
    return `${mins} Dk Kalan`;
  } else {
    if (days >= 30) {
      const months = Math.floor(days / 30);
      const remDays = days % 30;
      if (remDays === 0) return `${months} Ay Kalan`;
      return `${months} Ay ${remDays} Gün`;
    }
    if (days > 0) {
      if (days === 1) return 'Yarın';
      return `${days} Gün Kalan`;
    }
    if (hours > 0) return `${hours} Saat Kalan`;
    return `${mins} Dk Kalan`;
  }
}

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

// ── Filter tabs ──
const DUE_RANGE_TABS = [
  { value: 'all', label: 'Tümü' },
  { value: 'today', label: 'Bugün' },
  { value: 'tomorrow', label: 'Yarın' },
  { value: 'overdue', label: 'Geciken' },
  { value: 'week', label: 'Bu Hafta' },
];

const TYPE_TABS = [
  { value: 'all', label: 'Tümü' },
  { value: 'phone_call', label: '📞 Telefon' },
  { value: 'clinic_visit', label: '🏥 Klinik' },
];

const STATUS_TABS = [
  { value: 'pending', label: 'Açık' },
  { value: 'completed', label: 'Tamamlananlar' },
];

const CONFIRM_TABS = [
  { value: 'all', label: 'Tümü' },
  { value: 'pending', label: 'Teyit Bekleyen' },
];

// ── Phone formatter ──
const formatPhone = (phone: string): string => {
  return formatPhoneReadable(phone);
};

// ── Country flag ──
const getCountryFlag = (country?: string): string => {
  if (!country) return '🌍';
  const FLAGS: Record<string, string> = {
    'Türkiye': '🇹🇷', 'Turkey': '🇹🇷', 'Almanya': '🇩🇪', 'Germany': '🇩🇪',
    'Irak': '🇮🇶', 'Iraq': '🇮🇶', 'İngiltere': '🇬🇧', 'UK': '🇬🇧',
    'ABD': '🇺🇸', 'USA': '🇺🇸', 'Hollanda': '🇳🇱', 'Fransa': '🇫🇷',
    'Avusturya': '🇦🇹', 'Belçika': '🇧🇪', 'İsviçre': '🇨🇭',
    'Suudi Arabistan': '🇸🇦', 'BAE': '🇦🇪', 'Kuveyt': '🇰🇼',
    'Katar': '🇶🇦', 'Bahreyn': '🇧🇭', 'Umman': '🇴🇲',
    'Libya': '🇱🇾', 'Rusya': '🇷🇺', 'Ukrayna': '🇺🇦',
    'Azerbaycan': '🇦🇿', 'Gürcistan': '🇬🇪', 'Kazakistan': '🇰🇿',
    'Özbekistan': '🇺🇿', 'İtalya': '🇮🇹', 'İspanya': '🇪🇸',
    'Romanya': '🇷🇴', 'Bulgaristan': '🇧🇬', 'Yunanistan': '🇬🇷',
    'Finlandiya': '🇫🇮', 'Finland': '🇫🇮', 'İsveç': '🇸🇪', 'Sweden': '🇸🇪',
    'Norveç': '🇳🇴', 'Norway': '🇳🇴',
  };
  return FLAGS[country] || '🌍';
};

// ── Main Component ──
interface AppointmentsTabProps {
  onOpenDrawer: (opportunityId: string, taskId?: string) => void;
  onGoToInbox: (item: any) => void;
  viewType?: 'phone' | 'clinic';
  onSwitchTab?: (tab: 'hasta_takibi' | 'telefon' | 'randevu') => void;
}

export default function AppointmentsTab({ onOpenDrawer, onGoToInbox, viewType, onSwitchTab }: AppointmentsTabProps) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dueRange, setDueRange] = useState("all");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [confirmFilter, setConfirmFilter] = useState("all");
  const filterDropdown = useDropdown();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters: AppointmentFilters = {
    search: debouncedSearch || undefined,
    dueRange: dueRange !== 'all' ? dueRange as any : undefined,
    appointmentType: viewType === 'phone' ? 'phone_call' : viewType === 'clinic' ? 'clinic_visit' : undefined,
    completed: statusFilter === 'completed',
    status: statusFilter,
    confirmationStatus: confirmFilter !== 'all' ? confirmFilter : undefined,
  };

  const { data, isLoading, mutate } = useSWR(
    ['appointments', debouncedSearch, dueRange, viewType, statusFilter, confirmFilter],
    () => getAppointmentRows(filters),
    { 
      refreshInterval: 60000,
      refreshWhenHidden: false,
      revalidateOnFocus: true
    }
  );

  const { data: stats, mutate: mutateStats } = useSWR(
    'appointment-stats',
    () => getAppointmentStats(),
    { 
      refreshInterval: 90000,
      refreshWhenHidden: false,
      revalidateOnFocus: true
    }
  );

  const items = data?.items || [];
  const total = data?.total || 0;

  const openCount = stats ? (
    viewType === 'phone' ? Number(stats.total_phone || 0) :
    viewType === 'clinic' ? Number(stats.total_clinic || 0) :
    (Number(stats.total_phone || 0) + Number(stats.total_clinic || 0))
  ) : 0;

  return (
    <div className="flex flex-col h-full bg-[#F5F5F7]">
      {/* Unified Premium Filter Bar */}
      <div className="px-4 py-3 border-b border-black/5 bg-white flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)] z-20">
        
        {/* Left: Tab Switcher & Dynamic Counter Badges */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-[#F5F5F7] rounded-xl p-0.5 border border-black/5 shadow-inner flex-wrap md:flex-nowrap">
            {viewType === 'phone' ? (
              <>
                <button
                  onClick={() => setStatusFilter("pending")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'pending'
                      ? 'bg-white text-[#1D1D1F] shadow-sm'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  Açık ({openCount})
                </button>
                <button
                  onClick={() => setStatusFilter("confirmed")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'confirmed'
                      ? 'bg-white text-green-700 shadow-sm border border-green-100/50'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  Planlandı ve Onaylandı ({stats ? Number(stats.confirmed_phone || 0) : 0})
                </button>
                <button
                  onClick={() => setStatusFilter("completed")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'completed'
                      ? 'bg-white text-emerald-700 shadow-sm border border-emerald-100/50'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  Arandı ve Ulaşıldı
                </button>
                <button
                  onClick={() => setStatusFilter("no_show")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'no_show'
                      ? 'bg-white text-amber-700 shadow-sm border border-amber-100/50'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  Ulaşılamadı
                </button>
                <button
                  onClick={() => setStatusFilter("cancelled")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'cancelled'
                      ? 'bg-white text-gray-500 shadow-sm border border-gray-100/50'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  İptal Edildi
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setStatusFilter("pending")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'pending'
                      ? 'bg-white text-[#1D1D1F] shadow-sm'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  Açık ({openCount})
                </button>
                <button
                  onClick={() => setStatusFilter("arrived")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'arrived'
                      ? 'bg-white text-emerald-700 shadow-sm border border-emerald-100/50'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  Geldi
                </button>
                <button
                  onClick={() => setStatusFilter("no_show")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'no_show'
                      ? 'bg-white text-red-700 shadow-sm border border-red-100/50'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  Gelmedi
                </button>
                <button
                  onClick={() => setStatusFilter("no_response")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'no_response'
                      ? 'bg-white text-amber-700 shadow-sm border border-amber-100/50'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  Ulaşılamadı
                </button>
                <button
                  onClick={() => setStatusFilter("cancelled")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'cancelled'
                      ? 'bg-white text-gray-500 shadow-sm border border-gray-100/50'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  İptal Edildi
                </button>
                <button
                  onClick={() => setStatusFilter("completed")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                    statusFilter === 'completed'
                      ? 'bg-white text-[#1D1D1F] shadow-sm'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  Tamamlananlar
                </button>
              </>
            )}
          </div>

          {stats && (
            viewType === 'phone' ? Number(stats.overdue_phone || 0) :
            viewType === 'clinic' ? Number(stats.overdue_clinic || 0) :
            Number(stats.overdue || 0)
          ) > 0 && statusFilter === 'pending' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 border border-red-200/50 rounded-xl text-[11px] font-extrabold tracking-wide shadow-sm animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              {Number(
                viewType === 'phone' ? stats.overdue_phone :
                viewType === 'clinic' ? stats.overdue_clinic :
                stats.overdue
              )} GECİKMİŞ
            </span>
          )}
          
          {stats && (
            viewType === 'phone' ? Number(stats.confirmation_pending_phone || 0) :
            viewType === 'clinic' ? Number(stats.confirmation_pending_clinic || 0) :
            Number(stats.confirmation_pending || 0)
          ) > 0 && statusFilter === 'pending' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200/50 rounded-xl text-[11px] font-extrabold tracking-wide shadow-sm">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              {Number(
                viewType === 'phone' ? stats.confirmation_pending_phone :
                viewType === 'clinic' ? stats.confirmation_pending_clinic :
                stats.confirmation_pending
              )} TEYİT BEKLEYEN
            </span>
          )}
        </div>

        {/* Right: Search Input & Advanced Filter Popover */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative w-full md:w-60">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#86868B]" />
            <input 
              type="text" 
              placeholder="Hasta adı veya telefon..." 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#F5F5F7] border border-black/5 rounded-xl text-xs outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500/20 transition-all font-semibold"
            />
          </div>

          {/* Filter Popover */}
          <div ref={filterDropdown.ref} className="relative">
            <button
              onClick={() => filterDropdown.setIsOpen(!filterDropdown.isOpen)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 border rounded-xl shadow-sm text-xs font-bold transition-all cursor-pointer ${
                filterDropdown.isOpen || dueRange !== 'all' || confirmFilter !== 'all'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-[#1D1D1F] border-black/5 hover:bg-[#F5F5F7]'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Süzgeçler</span>
              {(dueRange !== 'all' || confirmFilter !== 'all') && (
                <span className="w-2 h-2 rounded-full bg-red-400 border border-white ml-0.5" />
              )}
            </button>

            {filterDropdown.isOpen && (
              <div className="absolute top-full right-0 mt-1.5 w-64 bg-white rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 p-4 z-50 space-y-4 animate-in fade-in duration-100">
                {/* Randevu Türü (Sadece genel görünümde göster) */}
                {!viewType && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Randevu Türü</label>
                    <div className="flex items-center gap-1 bg-[#F5F5F7] rounded-lg p-0.5 border border-black/5">
                      {TYPE_TABS.map(t => (
                        <button
                          key={t.value}
                          onClick={() => {
                            // Can add actual logic if not restricted
                          }}
                          className={`flex-1 py-1 rounded-md text-[10px] font-bold border transition-all cursor-pointer bg-white text-[#1D1D1F] border-black/5 shadow-sm`}
                        >
                          {t.label.replace(/^[^\s]+\s/, '')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tarih Dilimi (sadece Açık tabında) */}
                {statusFilter === 'pending' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Tarih Dilimi</label>
                    <div className="grid grid-cols-2 gap-1">
                      {DUE_RANGE_TABS.map(t => (
                        <button
                          key={t.value}
                          onClick={() => setDueRange(t.value)}
                          className={`py-1.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                            dueRange === t.value
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                              : 'bg-[#F5F5F7] text-[#1D1D1F] border-transparent hover:bg-black/5'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Teyit Durumu (sadece Açık tabında) */}
                {statusFilter === 'pending' && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Teyit Süzgeci</label>
                    <div className="grid grid-cols-2 gap-1">
                      {CONFIRM_TABS.map(t => (
                        <button
                          key={t.value}
                          onClick={() => setConfirmFilter(t.value)}
                          className={`py-1.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                            confirmFilter === t.value
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                              : 'bg-[#F5F5F7] text-[#1D1D1F] border-transparent hover:bg-black/5'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sıfırla Butonu */}
                {(dueRange !== 'all' || confirmFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setDueRange('all');
                      setConfirmFilter('all');
                    }}
                    className="w-full py-1.5 text-center text-[10px] font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-xl transition-all cursor-pointer"
                  >
                    Süzgeçleri Temizle
                  </button>
                )}
              </div>
            )}
          </div>
          
          <div className="text-[10px] font-bold text-[#86868B] tracking-wider uppercase ml-1 shrink-0 bg-[#F5F5F7] border border-black/5 px-2 py-1.5 rounded-lg shadow-sm">
            {total} Bulundu
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-x-auto bg-white">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead className="sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <tr>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Tarih & Saat</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Hasta</th>
              
              {!viewType ? (
                <>
                  <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Randevu Türü</th>
                  <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Randevu Durumu</th>
                  <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Teyit Durumu</th>
                </>
              ) : viewType === 'clinic' ? (
                <>
                  <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Randevu Durumu</th>
                  <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Randevuya Kalan</th>
                </>
              ) : (
                <>
                  <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Arama Durumu</th>
                  <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Aramaya Kalan</th>
                </>
              )}

              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Saat Bilgisi</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase text-right">Aksiyon</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {items.map((apt) => (
              <AppointmentRowComponent 
                key={apt.taskId} 
                apt={apt} 
                onOpenDrawer={onOpenDrawer}
                onGoToInbox={onGoToInbox}
                onActionComplete={() => { mutate(); mutateStats(); }}
                viewType={viewType}
                onSwitchTab={onSwitchTab}
              />
            ))}
            {items.length === 0 && !isLoading && (
              <tr>
                <td colSpan={viewType ? 6 : 7} className="py-16 text-center">
                  <CalendarClock className="w-10 h-10 text-[#C7C7CC] mx-auto mb-3" />
                  <p className="text-[#86868B] font-semibold text-sm">
                    {viewType === 'phone' ? 'Arama görevi bulunamadı' : 'Randevu bulunamadı'}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterGroup({ tabs, active, onChange }: { tabs: any[]; active: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 bg-[#F5F5F7] rounded-lg p-0.5 border border-black/5">
      {tabs.map(tab => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
            active === tab.value
              ? 'bg-white text-[#1D1D1F] shadow-sm'
              : 'text-[#86868B] hover:text-[#1D1D1F]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Appointment Row ──

function AppointmentRowComponent({ apt, onOpenDrawer, onGoToInbox, onActionComplete, viewType, onSwitchTab }: { 
  apt: AppointmentRow; 
  onOpenDrawer: (opportunityId: string, taskId?: string) => void;
  onGoToInbox: (item: any) => void;
  onActionComplete: () => void;
  viewType?: 'phone' | 'clinic';
  onSwitchTab?: (tab: 'hasta_takibi' | 'telefon' | 'randevu') => void;
}) {
  const flag = getCountryFlag(apt.country);
  const actionDropdown = useDropdown();
  const statusDropdown = useDropdown();
  const randevuAksiyonuDropdown = useDropdown();
  const [activeBotPopup, setActiveBotPopup] = useState<'teyit' | 'hatirlat' | 'devret' | null>(null);
  const [directiveText, setDirectiveText] = useState('');
  const isSuggestionPending = apt.metadata?.bot_suggestion?.status === 'pending';

  // Arama Notu Ekleme/Görüntüleme Modern Modalleri
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteInputText, setNoteInputText] = useState('');
  const [activeNoteResult, setActiveNoteResult] = useState<'completed' | 'arrived'>('completed');
  const [viewNoteModalOpen, setViewNoteModalOpen] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [sentMessagePreview, setSentMessagePreview] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendingStep, setSendingStep] = useState(0);

  const handleOpenBotPopup = (mode: 'teyit' | 'hatirlat' | 'devret') => {
    setActiveBotPopup(mode);
    setIsSuccess(false);
    setIsSending(false);
    setSendingStep(0);
    setSentMessagePreview('');
    
    let defaultTemplate = 'Hastadan randevu teyidini ve katılım durumunu öğrenip doğrula.';
    if (mode === 'hatirlat') {
      defaultTemplate = 'Hastaya randevusunu hatırlat ve katılım durumunu teyit et.';
    } else if (mode === 'devret') {
      if (apt.status === 'no_show') {
        defaultTemplate = "Sizi aradık ulaşamadık, müsait olduğunuzda tekrar aramak isteriz gibi bir mesaj gönder ve tekrar telefon görüşmesi günü almaya çalış.";
      } else if (apt.status === 'cancelled') {
        defaultTemplate = "Hastanın neden aramadan vazgeçtiğini anla ve ona göre ikna taktikleri uygula.";
      } else if (apt.status === 'completed' || apt.status === 'arrived') {
        const rawNote = (apt.appointmentNote || apt.metadata?.note || '').trim();
        if (rawNote) {
          defaultTemplate = `Arama Notu: ${rawNote} - bu şekilde hasta ile görüşüldü. hastayı randevuya bu bilgileri de anlayıp analiz ederek ikna etme çalışmalarına başla.`;
        } else {
          defaultTemplate = "Hasta ile görüşüldü, hastayı randevuya ikna etme çalışmalarına başla.";
        }
      } else {
        defaultTemplate = 'Hastadan arama veya klinik ön görüşmesi için uygun gün ve saat bilgisini öğren.';
      }
    }
    
    const saved = typeof window !== 'undefined' ? localStorage.getItem(`baskent_bot_template_${mode}_${apt.status}`) : null;
    
    const hasActiveNote = !!(apt.appointmentNote?.trim() || apt.metadata?.note?.trim());
    
    // For completed/arrived status, if they have an active note, we ALWAYS want to prioritize the dynamic patient-specific note template.
    if (mode === 'devret' && (apt.status === 'completed' || apt.status === 'arrived') && hasActiveNote) {
      setDirectiveText(defaultTemplate);
    } else {
      setDirectiveText(saved || defaultTemplate);
    }
    setSaveAsDefault(false);
  };

  // Sleep detection (basic heuristic)
  let isPatientSleeping = false;
  if (apt.dueAtPatientLocal) {
    const timeMatch = apt.dueAtPatientLocal.match(/(\d{2}):(\d{2})/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      if (hour >= 22 || hour < 8) isPatientSleeping = true;
    }
  }

  // Handle Actions
  const handleAction = async (action: string) => {
    actionDropdown.setIsOpen(false);
    try {
      if (action === 'call_completed') await completeAppointmentTask(apt.taskId, 'completed');
      else if (action === 'call_missed') await completeAppointmentTask(apt.taskId, 'no_show'); 
      else if (action === 'confirm') await updateAppointmentConfirmation(apt.taskId, 'confirmed');
      else if (action === 'pending') await updateAppointmentConfirmation(apt.taskId, 'pending');
      else if (action === 'no_response') await updateAppointmentConfirmation(apt.taskId, 'no_response');
      else if (action === 'arrived') await completeAppointmentTask(apt.taskId, 'arrived');
      else if (action === 'no_show') await completeAppointmentTask(apt.taskId, 'no_show');
      else if (action === 'cancel') {
        if (confirm("Bu randevuyu iptal etmek istediğinize emin misiniz?")) {
          await completeAppointmentTask(apt.taskId, 'cancelled');
        }
      }
      onActionComplete();
    } catch (e) {
      console.error(e);
      alert("İşlem sırasında bir hata oluştu.");
    }
  };

  // Handle Status Change Manually via Clickable Badges
  const handleStatusChange = async (
    status: 'pending' | 'completed' | 'cancelled', 
    result?: 'completed' | 'arrived' | 'no_show' | 'cancelled' | 'none',
    confirmStat?: 'pending' | 'confirmed' | 'declined' | 'no_response' | 'none'
  ) => {
    statusDropdown.setIsOpen(false);
    
    if (status === 'completed' && (result === 'completed' || result === 'arrived')) {
      setActiveNoteResult(result);
      setNoteInputText('');
      setNoteModalOpen(true);
      return; // Handled by modal save
    }

    try {
      await manuallyUpdateAppointmentStatus(apt.taskId, status, result, confirmStat);
      onActionComplete();
    } catch (e) {
      console.error(e);
      alert("Durum güncellenirken bir hata oluştu.");
    }
  };

  const isPhone = apt.appointmentType === 'phone_call' || apt.appointmentType === 'pre_consultation';
  const isClinic = apt.appointmentType === 'clinic_visit';

  const getClinicStatusBadge = () => {
    let label = 'Planlandı';
    let colorClasses = 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100/80';
    
    if (apt.status === 'arrived') {
      label = 'Geldi';
      colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100/80';
    } else if (apt.status === 'no_show') {
      label = 'Gelmedi';
      colorClasses = 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100/80';
    } else if (apt.status === 'cancelled') {
      label = 'İptal Edildi';
      colorClasses = 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100/80';
    } else if (apt.status === 'overdue' && apt.confirmationStatus !== 'confirmed') {
      label = 'Ulaşılamadı';
      colorClasses = 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100/80';
    } else if (apt.confirmationStatus === 'confirmed') {
      label = 'Planlandı ve Teyit Alındı';
      colorClasses = 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100/80';
    } else if (apt.confirmationStatus === 'no_response') {
      label = 'Ulaşılamadı';
      colorClasses = 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100/80';
    }
    
    return (
      <div ref={statusDropdown.ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => statusDropdown.setIsOpen(!statusDropdown.isOpen)}
          className={`inline-flex items-center gap-1 px-2 py-0.8 rounded-md text-[10px] font-bold tracking-wide border cursor-pointer transition-all active:scale-95 ${colorClasses}`}
        >
          <span>{label}</span>
          <ChevronDown className="w-2.5 h-2.5 opacity-60" />
        </button>

        {statusDropdown.isOpen && (
          <div className="absolute top-full left-0 mt-1 w-52 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 overflow-hidden text-left">
            <div className="px-3 py-1 text-[9px] font-bold text-[#86868B] uppercase tracking-wider bg-[#F5F5F7] mb-1">Durumu Değiştir</div>
            <StatusOption label="Planlandı" active={label === 'Planlandı'} onClick={() => handleStatusChange('pending', 'none', 'pending')} />
            <StatusOption label="Planlandı ve Teyit Alındı" active={label === 'Planlandı ve Teyit Alındı'} onClick={() => handleStatusChange('pending', 'none', 'confirmed')} />
            <StatusOption label="Geldi" active={label === 'Geldi'} onClick={() => handleStatusChange('completed', 'arrived', 'confirmed')} />
            <StatusOption label="Gelmedi" active={label === 'Gelmedi'} onClick={() => handleStatusChange('completed', 'no_show', 'none')} />
            <StatusOption label="Ulaşılamadı" active={label === 'Ulaşılamadı'} onClick={() => handleStatusChange('pending', 'none', 'no_response')} />
            <StatusOption label="İptal Edildi" active={label === 'İptal Edildi'} onClick={() => handleStatusChange('cancelled', 'cancelled', 'none')} />
          </div>
        )}
      </div>
    );
  };

  const getPhoneStatusBadge = () => {
    let label = 'Planlandı';
    let colorClasses = 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100/80';
    
    if (apt.status === 'completed' || apt.status === 'arrived') {
      label = 'Arandı ve Ulaşıldı';
      colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100/80';
    } else if (apt.status === 'cancelled') {
      label = 'İptal Edildi';
      colorClasses = 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100/80';
    } else if (apt.confirmationStatus === 'confirmed') {
      label = 'Planlandı ve Onaylandı';
      colorClasses = 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100/80';
    } else if (apt.status === 'overdue' || apt.status === 'no_show') {
      label = 'Ulaşılamadı';
      colorClasses = 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100/80';
    }
    
    return (
      <div ref={statusDropdown.ref} className="relative inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => statusDropdown.setIsOpen(!statusDropdown.isOpen)}
          className={`inline-flex items-center gap-1 px-2 py-0.8 rounded-md text-[10px] font-bold tracking-wide border cursor-pointer transition-all active:scale-95 ${colorClasses}`}
        >
          <span>{label}</span>
          <ChevronDown className="w-2.5 h-2.5 opacity-60" />
        </button>
        
        {/* Tıklayınca Açılan Not Butonu */}
        {(apt.status === 'completed' || apt.status === 'arrived') && apt.metadata?.note && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setViewNoteModalOpen(true);
            }}
            className="p-1 hover:bg-[#F5F5F7] border border-black/5 hover:border-black/10 rounded-md transition-all cursor-pointer inline-flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F]"
            title="Arama Notunu Görüntüle"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
        )}
 
        {statusDropdown.isOpen && (
          <div className="absolute top-full left-0 mt-1 w-52 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 overflow-hidden text-left">
            <div className="px-3 py-1 text-[9px] font-bold text-[#86868B] uppercase tracking-wider bg-[#F5F5F7] mb-1">Durumu Değiştir</div>
            <StatusOption label="Planlandı" active={label === 'Planlandı'} onClick={() => handleStatusChange('pending', 'none', 'pending')} />
            <StatusOption label="Planlandı ve Onaylandı" active={label === 'Planlandı ve Onaylandı'} onClick={() => handleStatusChange('pending', 'none', 'confirmed')} />
            <StatusOption label="Arandı ve Ulaşıldı" active={label === 'Arandı ve Ulaşıldı'} onClick={() => handleStatusChange('completed', 'completed', 'confirmed')} />
            <StatusOption label="Ulaşılamadı" active={label === 'Ulaşılamadı'} onClick={() => handleStatusChange('completed', 'no_show', 'no_response')} />
            <StatusOption label="İptal Edildi" active={label === 'İptal Edildi'} onClick={() => handleStatusChange('cancelled', 'cancelled', 'none')} />
          </div>
        )}
      </div>
    );
  };

  const isTerminalState = ['completed', 'arrived', 'no_show', 'cancelled'].includes(apt.status);
  const kalanStr = isTerminalState ? '—' : formatKalanTime(apt.dueAtUtc, viewType || 'clinic');
  const isOverdueTask = !isTerminalState && kalanStr.includes('Gecikti');

  return (
    <>
      <tr 
        onClick={() => apt.opportunityId && onOpenDrawer(apt.opportunityId, apt.taskId)}
        className={`hover:bg-[#007AFF]/5 transition-colors group cursor-pointer ${
          apt.status === 'overdue' ? 'bg-red-50/30' : ''
        }`}
      >
      <td className="py-3.5 px-4">
        {apt.dueAtUtc ? (
          <div>
            <div className="text-[13px] font-bold text-[#1D1D1F]">
              {apt.metadata?.is_partial_date 
                ? formatPartialDate(apt.metadata)
                : new Date(apt.dueAtUtc).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' })}
            </div>
            {!apt.metadata?.is_partial_date && (
              <div className="text-[11px] font-semibold text-[#007AFF] mt-0.5">
                {new Date(apt.dueAtUtc).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}
              </div>
            )}
            {apt.metadata?.is_partial_date && apt.metadata?.partial_precision === 'year_month' && (
              <div className="text-[10px] font-semibold text-[#86868B] mt-0.5">
                Ay Geneli Plan
              </div>
            )}
            {apt.metadata?.is_partial_date && apt.metadata?.partial_precision === 'year_month_day' && (
              <div className="text-[10px] font-semibold text-[#86868B] mt-0.5">
                Gün Geneli Plan
              </div>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-[#C7C7CC] font-medium">Tarih yok</span>
        )}
      </td>
      <td className="py-3.5 px-4 min-w-[180px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-[13px] text-[#1D1D1F]">{apt.patientName}</span>
          {apt.country && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/[0.04] text-[10px] font-semibold text-[#86868B] border border-black/5">
              {flag} {apt.country}
            </span>
          )}
          {apt.priority === 'hot' && <Zap className="w-3 h-3 text-[#FF3B30] fill-[#FF3B30]" />}
        </div>
        <div className="text-[11px] text-[#86868B] font-medium mt-0.5 flex items-center gap-1">
          {formatPhone(apt.phoneNumber)}
        </div>
      </td>

      {/* Dynamic columns based on viewType */}
      {!viewType ? (
        <>
          <td className="py-3.5 px-4">
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold tracking-wide border ${
              isPhone ? 'bg-blue-50 text-blue-700 border-blue-200' :
              isClinic ? 'bg-green-50 text-green-700 border-green-200' :
              'bg-[#F5F5F7] text-[#86868B] border-black/5'
            }`}>
              {isPhone && <Phone className="w-3 h-3" />}
              {isClinic && <Building2 className="w-3 h-3" />}
              {apt.appointmentTypeLabel}
            </span>
          </td>
          <td className="py-3.5 px-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold tracking-wide border ${
                apt.status === 'completed' ? 'bg-green-50 text-green-700 border-green-200' :
                apt.status === 'arrived' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                apt.status === 'no_show' ? 'bg-red-50 text-red-700 border-red-200' :
                apt.status === 'cancelled' ? 'bg-[#F5F5F7] text-[#86868B] border-black/5' :
                apt.status === 'overdue' ? 'bg-red-50 text-red-700 border-red-200' :
                apt.status === 'approaching' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                'bg-blue-50 text-blue-700 border-blue-200'
              }`}>
                {apt.status === 'overdue' && <AlertTriangle className="w-3 h-3" />}
                {apt.status === 'approaching' && <Clock className="w-3 h-3" />}
                {apt.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                {apt.statusLabel}
              </span>
              {(apt.metadata?.bot_teyit_sent || apt.metadata?.bot_hatirlat_sent || apt.metadata?.bot_devret_sent) && (
                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border shrink-0 ${
                  isSuggestionPending 
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 animate-[pulse_1.2s_infinite] shadow-[0_0_8px_rgba(16,185,129,0.25)]' 
                    : 'border-cyan-200 bg-cyan-50 text-cyan-700 animate-pulse'
                }`}>
                  <Bot className={`w-3 h-3 ${isSuggestionPending ? 'text-emerald-600' : 'text-cyan-600'}`} />
                  <span>{isSuggestionPending ? 'Öneri Geldi!' : 'Bot Takipte'}</span>
                </span>
              )}
            </div>
          </td>
          <td className="py-3.5 px-4">
            <div className="space-y-1.5">
              {apt.confirmationStatus === 'confirmed' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded border border-green-200">
                  <CheckCircle2 className="w-3 h-3" /> Teyitli
                </span>
              ) : apt.confirmationStatus === 'declined' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                  <XCircle className="w-3 h-3" /> Reddetti
                </span>
              ) : apt.confirmationStatus === 'no_response' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                  <Ban className="w-3 h-3" /> Cevap Yok
                </span>
              ) : apt.confirmationStatus === 'pending' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                  <Clock className="w-3 h-3" /> Teyit Bekliyor
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-[#C7C7CC]">—</span>
              )}
            </div>
          </td>
        </>
      ) : viewType === 'clinic' ? (
        <>
          <td className="py-3.5 px-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              {getClinicStatusBadge()}
              {(apt.metadata?.bot_teyit_sent || apt.metadata?.bot_hatirlat_sent || apt.metadata?.bot_devret_sent) && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.8 rounded-md text-[10px] font-bold border shrink-0 ${
                  isSuggestionPending 
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 animate-[pulse_1.2s_infinite] shadow-[0_0_8px_rgba(16,185,129,0.25)]' 
                    : 'border-cyan-200 bg-cyan-50 text-cyan-700 animate-pulse'
                }`}>
                  <Bot className={`w-2.5 h-2.5 ${isSuggestionPending ? 'text-emerald-600' : 'text-cyan-600'}`} />
                  <span>{isSuggestionPending ? 'Öneri Geldi!' : 'Bot Takipte'}</span>
                </span>
              )}
            </div>
          </td>
          <td className="py-3.5 px-4">
            <span className={`text-[12px] font-bold flex items-center gap-1.5 ${
              isOverdueTask ? 'text-[#FF3B30]' : 'text-[#1D1D1F]'
            }`}>
              <Calendar className="w-3.5 h-3.5 text-[#86868B]" />
              {kalanStr}
            </span>
          </td>
        </>
      ) : (
        <>
          <td className="py-3.5 px-4">
            <div className="flex items-center gap-1.5 flex-wrap">
              {getPhoneStatusBadge()}
              {(apt.metadata?.bot_teyit_sent || apt.metadata?.bot_hatirlat_sent || apt.metadata?.bot_devret_sent) && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.8 rounded-md text-[10px] font-bold border shrink-0 ${
                  isSuggestionPending 
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 animate-[pulse_1.2s_infinite] shadow-[0_0_8px_rgba(16,185,129,0.25)]' 
                    : 'border-cyan-200 bg-cyan-50 text-cyan-700 animate-pulse'
                }`}>
                  <Bot className={`w-2.5 h-2.5 ${isSuggestionPending ? 'text-emerald-600' : 'text-cyan-600'}`} />
                  <span>{isSuggestionPending ? 'Öneri Geldi!' : 'Bot Takipte'}</span>
                </span>
              )}
            </div>
          </td>
          <td className="py-3.5 px-4">
            <span className={`text-[12px] font-bold flex items-center gap-1.5 ${
              isOverdueTask ? 'text-[#FF3B30]' : 'text-[#1D1D1F]'
            }`}>
              <Calendar className="w-3.5 h-3.5 text-[#86868B]" />
              {kalanStr}
            </span>
          </td>
        </>
      )}

      <td className="py-3.5 px-4">
        {apt.dueAtTurkey && (!apt.metadata?.is_partial_date || apt.metadata?.partial_precision === 'full') ? (
          <div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-[#1D1D1F]">
              <Clock className="w-3 h-3 text-[#86868B]" /> 🇹🇷 {apt.dueAtTurkey}
            </div>
            {apt.dueAtPatientLocal ? (
              <div className="flex items-center gap-1 text-[10px] font-semibold text-[#86868B] mt-0.5">
                {flag} {apt.dueAtPatientLocal}
                {isPatientSleeping && <span title="Hasta muhtemelen uyuyor"><Moon className="w-3 h-3 text-indigo-500 fill-indigo-500" /></span>}
              </div>
            ) : (
              <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 mt-0.5 bg-amber-50 rounded px-1 w-fit">
                <AlertTriangle className="w-3 h-3" /> Teyit Gerekli
              </div>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-[#C7C7CC] font-semibold">—</span>
        )}
      </td>

      <td className="py-3.5 px-4 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1.5 relative">
          
          {/* Quick Primary Actions right in the row (extremely high conversion and micro UX) */}
          {viewType === 'clinic' && apt.status !== 'completed' && apt.status !== 'cancelled' && apt.status !== 'arrived' && apt.status !== 'no_show' && (
            <>
              {apt.confirmationStatus !== 'confirmed' ? (
                <>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await updateAppointmentConfirmation(apt.taskId, 'confirmed');
                        onActionComplete();
                      } catch (err) {
                        alert("İşlem başarısız oldu.");
                      }
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-emerald-600/20 text-emerald-700 rounded-lg shadow-sm hover:bg-emerald-50/50 hover:border-emerald-600/40 transition-all text-[11px] font-bold cursor-pointer"
                    title="Randevuyu Teyit Et"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Randevuyu Teyit Et</span>
                  </button>
                  
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenBotPopup('teyit');
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200/50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg shadow-sm transition-all text-[11px] font-bold cursor-pointer shrink-0"
                      title="Randevuyu Bota Teyit Ettir"
                    >
                      <Zap className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" />
                      <span className="hidden sm:inline">Randevuyu Bota Teyit Ettir</span>
                    </button>
                    {apt.metadata?.bot_teyit_sent && (
                      <div className="flex items-center gap-1 ml-0.5 shrink-0">
                        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm" title="Bota teyit ettirildi">
                          <Check className="w-3 h-3 text-white stroke-[3.5]" />
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenBotPopup('teyit');
                          }}
                          className="w-5 h-5 rounded-full bg-white hover:bg-[#F5F5F7] border border-black/5 flex items-center justify-center shadow-sm transition-all cursor-pointer hover:scale-105 active:scale-95 text-[#86868B] hover:text-[#1D1D1F] shrink-0"
                          title="Yeniden Bota Teyit Ettir"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Confirmed stage: Bot Remind, and "Randevu Aksiyonu" dropdown */}
                  <div className="flex items-center gap-1.5 flex-wrap md:flex-nowrap">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenBotPopup('hatirlat');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200/50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg shadow-sm transition-all text-[11px] font-bold cursor-pointer shrink-0"
                        title="Randevuyu Bota Hatırlattır"
                      >
                        <Zap className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" />
                        <span className="hidden sm:inline">Randevuyu Bota Hatırlattır</span>
                      </button>
                      {apt.metadata?.bot_hatirlat_sent && (
                        <div className="flex items-center gap-1 ml-0.5 shrink-0">
                          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm" title="Bota hatırlatıldı">
                            <Check className="w-3 h-3 text-white stroke-[3.5]" />
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenBotPopup('hatirlat');
                            }}
                            className="w-5 h-5 rounded-full bg-white hover:bg-[#F5F5F7] border border-black/5 flex items-center justify-center shadow-sm transition-all cursor-pointer hover:scale-105 active:scale-95 text-[#86868B] hover:text-[#1D1D1F] shrink-0"
                            title="Yeniden Bota Hatırlattır"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* "Randevu Aksiyonu" Dropdown */}
                    <div ref={randevuAksiyonuDropdown.ref} className="relative shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          randevuAksiyonuDropdown.setIsOpen(!randevuAksiyonuDropdown.isOpen);
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 border border-black/5 rounded-lg shadow-sm transition-all text-[11px] font-bold bg-white text-[#1D1D1F] hover:bg-[#F5F5F7] cursor-pointer ${
                          randevuAksiyonuDropdown.isOpen ? 'border-[#007AFF] bg-[#007AFF]/5 text-[#007AFF]' : ''
                        }`}
                      >
                        <span>Randevu Aksiyonu</span>
                        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                      </button>

                      {randevuAksiyonuDropdown.isOpen && (
                        <div 
                          className="absolute top-full right-0 mt-1 w-48 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 overflow-hidden text-left"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="px-3 py-1.5 text-[9px] font-bold text-[#86868B] uppercase tracking-wider bg-[#F5F5F7] mb-1">Durumu Seç</div>
                          <DropdownItem 
                            icon={Check} 
                            label="Geldi" 
                            color="text-emerald-600 hover:bg-emerald-50/50" 
                            onClick={async () => {
                              randevuAksiyonuDropdown.setIsOpen(false);
                              try {
                                  await completeAppointmentTask(apt.taskId, 'arrived');
                                  onActionComplete();
                              } catch (err) {
                                alert("İşlem başarısız oldu.");
                              }
                            }} 
                          />
                          <DropdownItem 
                            icon={XCircle} 
                            label="Gelmedi" 
                            color="text-red-600 hover:bg-red-50/50" 
                            onClick={async () => {
                              randevuAksiyonuDropdown.setIsOpen(false);
                              try {
                                await completeAppointmentTask(apt.taskId, 'no_show');
                                onActionComplete();
                              } catch (err) {
                                alert("İşlem başarısız oldu.");
                              }
                            }} 
                          />
                          <DropdownItem 
                            icon={Ban} 
                            label="Ulaşılamadı" 
                            color="text-amber-600 hover:bg-amber-50/50" 
                            onClick={async () => {
                              randevuAksiyonuDropdown.setIsOpen(false);
                              try {
                                await updateAppointmentConfirmation(apt.taskId, 'no_response');
                                onActionComplete();
                              } catch (err) {
                                alert("İşlem başarısız oldu.");
                              }
                            }} 
                          />
                          <DropdownItem 
                            icon={X} 
                            label="İptal Edildi" 
                            color="text-gray-500 hover:bg-gray-50" 
                            onClick={async () => {
                              randevuAksiyonuDropdown.setIsOpen(false);
                              if (confirm("Bu randevuyu iptal etmek istediğinize emin misiniz?")) {
                                try {
                                  await completeAppointmentTask(apt.taskId, 'cancelled');
                                  onActionComplete();
                                } catch (err) {
                                  alert("İşlem başarısız oldu.");
                                }
                              }
                            }} 
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {viewType === 'phone' && (
            <div className="flex items-center gap-1.5 flex-wrap md:flex-nowrap">
              <div className="flex items-center gap-1.5 shrink-0">
                {(() => {
                  if (apt.status === 'completed' || apt.status === 'arrived') {
                    if (apt.hasClinicVisit) {
                      return (
                        <>
                          {/* Randevu Planlandı Badge / Butonu */}
                          <div 
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#E8F5E9] border border-green-200 text-green-700 rounded-lg text-[11px] font-bold shadow-sm shrink-0"
                            title="Müşterinin Klinik Randevusu Planlandı"
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                            <span>Randevu Planlandı</span>
                          </div>

                          {/* Randevu Ekranında Görüntüle Butonu */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSwitchTab?.('randevu');
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200/50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg shadow-sm transition-all text-[11px] font-bold cursor-pointer shrink-0 active:scale-95"
                            title="Klinik Randevusunu Randevu Yönetimi Ekranında Görüntüle"
                          >
                            <CalendarClock className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500/10" />
                            <span>Randevu Ekranında Görüntüle</span>
                          </button>
                        </>
                      );
                    }

                    return (
                      <>
                        {/* Randevu Planla Butonu */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (apt.opportunityId) onOpenDrawer(apt.opportunityId, apt.taskId);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200/50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 rounded-lg shadow-sm transition-all text-[11px] font-bold cursor-pointer shrink-0"
                          title="Randevu Planla"
                        >
                          <Calendar className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500/10" />
                          <span className="hidden sm:inline">Randevu Planla</span>
                        </button>
                        
                        {/* Bota Randevu İçin İkna Ettir Butonu */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenBotPopup('devret');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200/50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg shadow-sm transition-all text-[11px] font-bold cursor-pointer shrink-0"
                          title="Bota Randevu İçin İkna Ettir"
                        >
                          <Zap className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" />
                          <span className="hidden sm:inline">Bota Randevu İçin İkna Ettir</span>
                        </button>
                        {apt.metadata?.bot_devret_sent && (
                          <div className="flex items-center gap-1 ml-0.5 shrink-0">
                            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm" title="Bota devredildi">
                              <Check className="w-3 h-3 text-white stroke-[3.5]" />
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBotPopup('devret');
                              }}
                              className="w-5 h-5 rounded-full bg-white hover:bg-[#F5F5F7] border border-black/5 flex items-center justify-center shadow-sm transition-all cursor-pointer hover:scale-105 active:scale-95 text-[#86868B] hover:text-[#1D1D1F] shrink-0"
                              title="Yeniden Bota Devret"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </>
                    );
                  }

                  if (apt.status === 'no_show') {
                    return (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenBotPopup('devret');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200/50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg shadow-sm transition-all text-[11px] font-bold cursor-pointer shrink-0"
                          title="Bota Tekrar Telefon Görüşmesi Aldır"
                        >
                          <Zap className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" />
                          <span className="hidden sm:inline">Bota Tekrar Telefon Görüşmesi Aldır</span>
                        </button>
                        {apt.metadata?.bot_devret_sent && (
                          <div className="flex items-center gap-1 ml-0.5 shrink-0">
                            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm" title="Bota devredildi">
                              <Check className="w-3 h-3 text-white stroke-[3.5]" />
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBotPopup('devret');
                              }}
                              className="w-5 h-5 rounded-full bg-white hover:bg-[#F5F5F7] border border-black/5 flex items-center justify-center shadow-sm transition-all cursor-pointer hover:scale-105 active:scale-95 text-[#86868B] hover:text-[#1D1D1F] shrink-0"
                              title="Yeniden Bota Devret"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </>
                    );
                  }
                  
                  if (apt.status === 'cancelled') {
                    return (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenBotPopup('devret');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200/50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg shadow-sm transition-all text-[11px] font-bold cursor-pointer shrink-0"
                          title="Bota Yeniden Pazarlama Yaptır İletişime Geç"
                        >
                          <Zap className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" />
                          <span className="hidden sm:inline">Bota Yeniden Pazarlama Yaptır İletişime Geç</span>
                        </button>
                        {apt.metadata?.bot_devret_sent && (
                          <div className="flex items-center gap-1 ml-0.5 shrink-0">
                            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm" title="Bota devredildi">
                              <Check className="w-3 h-3 text-white stroke-[3.5]" />
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBotPopup('devret');
                              }}
                              className="w-5 h-5 rounded-full bg-white hover:bg-[#F5F5F7] border border-black/5 flex items-center justify-center shadow-sm transition-all cursor-pointer hover:scale-105 active:scale-95 text-[#86868B] hover:text-[#1D1D1F] shrink-0"
                              title="Yeniden Bota Devret"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </>
                    );
                  }
                  
                  if (apt.confirmationStatus !== 'confirmed') {
                    return (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenBotPopup('devret');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200/50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg shadow-sm transition-all text-[11px] font-bold cursor-pointer shrink-0"
                          title="Bota Telefon Randevusunu Teyit Ettir"
                        >
                          <Zap className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" />
                          <span className="hidden sm:inline">Bota Telefon Randevusunu Teyit Ettir</span>
                        </button>
                        {apt.metadata?.bot_devret_sent && (
                          <div className="flex items-center gap-1 ml-0.5 shrink-0">
                            <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm" title="Bota devredildi">
                              <Check className="w-3 h-3 text-white stroke-[3.5]" />
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBotPopup('devret');
                              }}
                              className="w-5 h-5 rounded-full bg-white hover:bg-[#F5F5F7] border border-black/5 flex items-center justify-center shadow-sm transition-all cursor-pointer hover:scale-105 active:scale-95 text-[#86868B] hover:text-[#1D1D1F] shrink-0"
                              title="Yeniden Bota Devret"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </>
                    );
                  }
                  
                  return (
                    <>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenBotPopup('hatirlat');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-50 border border-indigo-200/50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 rounded-lg shadow-sm transition-all text-[11px] font-bold cursor-pointer shrink-0"
                        title="Aramayı Bota Hatırlattır"
                      >
                        <Zap className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" />
                        <span className="hidden sm:inline">Bota Hatırlattır</span>
                      </button>
                      {apt.metadata?.bot_hatirlat_sent && (
                        <div className="flex items-center gap-1 ml-0.5 shrink-0">
                          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm" title="Bota hatırlatıldı">
                            <Check className="w-3 h-3 text-white stroke-[3.5]" />
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenBotPopup('hatirlat');
                            }}
                            className="w-5 h-5 rounded-full bg-white hover:bg-[#F5F5F7] border border-black/5 flex items-center justify-center shadow-sm transition-all cursor-pointer hover:scale-105 active:scale-95 text-[#86868B] hover:text-[#1D1D1F] shrink-0"
                            title="Yeniden Bota Hatırlattır"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* "Arama Aksiyonu" Dropdown */}
              <div ref={randevuAksiyonuDropdown.ref} className="relative shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    randevuAksiyonuDropdown.setIsOpen(!randevuAksiyonuDropdown.isOpen);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 border border-black/5 rounded-lg shadow-sm transition-all text-[11px] font-bold bg-white text-[#1D1D1F] hover:bg-[#F5F5F7] cursor-pointer ${
                    randevuAksiyonuDropdown.isOpen ? 'border-[#007AFF] bg-[#007AFF]/5 text-[#007AFF]' : ''
                  }`}
                >
                  <span>Arama Aksiyonu</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                </button>

                {randevuAksiyonuDropdown.isOpen && (
                  <div 
                    className="absolute top-full right-0 mt-1 w-48 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 overflow-hidden text-left"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-3 py-1.5 text-[9px] font-bold text-[#86868B] uppercase tracking-wider bg-[#F5F5F7] mb-1">Durumu Seç</div>
                    <DropdownItem 
                      icon={Check} 
                      label="Arandı - Ulaşıldı" 
                      color="text-emerald-600 hover:bg-emerald-50/50" 
                      onClick={() => {
                        randevuAksiyonuDropdown.setIsOpen(false);
                        setActiveNoteResult('completed');
                        setNoteInputText('');
                        setNoteModalOpen(true);
                      }} 
                    />
                    <DropdownItem 
                      icon={Ban} 
                      label="Ulaşılamadı" 
                      color="text-amber-600 hover:bg-amber-50/50" 
                      onClick={async () => {
                        randevuAksiyonuDropdown.setIsOpen(false);
                        try {
                          await completeAppointmentTask(apt.taskId, 'no_show');
                          onActionComplete();
                        } catch (err) {
                          alert("İşlem başarısız oldu.");
                        }
                      }} 
                    />
                    <DropdownItem 
                      icon={X} 
                      label="İptal Edildi" 
                      color="text-gray-500 hover:bg-gray-50" 
                      onClick={async () => {
                        randevuAksiyonuDropdown.setIsOpen(false);
                        if (confirm("Bu arama görevini iptal etmek istediğinize emin misiniz?")) {
                          try {
                            await completeAppointmentTask(apt.taskId, 'cancelled');
                            onActionComplete();
                          } catch (err) {
                            alert("İşlem başarısız oldu.");
                          }
                        }
                      }} 
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onGoToInbox({ phone_number: apt.phoneNumber, display_name: apt.patientName });
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-black/5 rounded-lg shadow-sm hover:bg-[#007AFF]/10 hover:border-[#007AFF]/20 hover:text-[#007AFF] transition-all text-[11px] font-semibold text-[#1D1D1F] cursor-pointer"
            title="Mesaja Git"
          >
            <Phone className="w-3.5 h-3.5" />
          </button>
          
          <div ref={actionDropdown.ref} className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); actionDropdown.setIsOpen(!actionDropdown.isOpen); }}
              className="inline-flex items-center justify-center w-8 h-8 bg-white border border-black/5 rounded-lg shadow-sm hover:bg-black/5 transition-colors text-[#1D1D1F] cursor-pointer"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            
            {actionDropdown.isOpen && (
              <div 
                className="absolute top-full right-0 mt-1 w-48 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 overflow-hidden text-left"
                onClick={(e) => e.stopPropagation()}
              >
                {apt.status !== 'completed' && apt.status !== 'cancelled' && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-[#86868B] uppercase tracking-wider bg-[#F5F5F7]">Aksiyonlar</div>
                    
                    {isPhone && (
                      <>
                        <DropdownItem icon={Check} label="Görüşüldü" onClick={() => handleAction('call_completed')} />
                        <DropdownItem icon={Ban} label="Ulaşılamadı" onClick={() => handleAction('call_missed')} />
                      </>
                    )}
                    
                    {isClinic && (
                      <>
                        <DropdownItem icon={CheckCircle2} label="Geldi" color="text-emerald-600" onClick={() => handleAction('arrived')} />
                        <DropdownItem icon={XCircle} label="Gelmedi" color="text-red-600" onClick={() => handleAction('no_show')} />
                      </>
                    )}

                    <div className="px-3 py-1.5 text-[10px] font-bold text-[#86868B] uppercase tracking-wider bg-[#F5F5F7] mt-1">Teyit</div>
                    <DropdownItem icon={CheckCircle2} label="Teyit Edildi" onClick={() => handleAction('confirm')} />
                    <DropdownItem icon={Clock} label="Teyit Sürecini Başa Al" onClick={() => handleAction('pending')} />
                    <DropdownItem icon={Ban} label="Cevap Yok" onClick={() => handleAction('no_response')} />
                    
                    <div className="px-3 py-1.5 text-[10px] font-bold text-[#86868B] uppercase tracking-wider bg-[#F5F5F7] mt-1">Diğer</div>
                    <DropdownItem icon={X} label="İptal Et" color="text-red-600" onClick={() => handleAction('cancel')} />
                  </>
                )}
              </div>
            )}
          </div>

          {/* Bot Yönlendirme Şablon Modalı (Buzlu Cam Efektli & fixed viewport sayesinde asla kesilmez) */}
          {activeBotPopup && (
            <div 
              className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200"
              onClick={(e) => { if (!isSending) { e.stopPropagation(); setActiveBotPopup(null); } }}
            >
              <div 
                className="bg-white rounded-3xl p-6 w-[420px] max-w-[90%] shadow-[0_20px_50px_rgba(0,0,0,0.25)] border border-black/5 animate-in zoom-in-95 duration-200 text-left"
                onClick={(e) => e.stopPropagation()}
              >
                {isSending ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center animate-in fade-in duration-200">
                    <div className="relative w-16 h-16 mb-6 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin" />
                      <Zap className="w-6 h-6 text-indigo-500 fill-indigo-500 animate-pulse" />
                    </div>
                    <h3 className="text-sm font-extrabold text-[#1D1D1F] mb-1">
                      {sendingStep === 1 && "Talimat Doğrulanıyor"}
                      {sendingStep === 2 && "Bağlam Çözümleniyor"}
                      {sendingStep === 3 && "Mesaj Taslağı Hazırlanıyor"}
                      {sendingStep === 4 && "WhatsApp İletimi Başlatıldı"}
                      {sendingStep === 0 && "Lütfen Bekleyin"}
                    </h3>
                    <p className="text-[11px] text-[#86868B] max-w-[280px] font-semibold leading-relaxed">
                      {sendingStep === 1 && "Yönlendirme talimatı AI asistanına iletiliyor..."}
                      {sendingStep === 2 && "Son konuşma geçmişi ve kurum kuralları analiz ediliyor..."}
                      {sendingStep === 3 && "Gemini 2.5 Flash ile hastaya en uygun yanıt kurgulanıyor..."}
                      {sendingStep === 4 && "WhatsApp API aracılığıyla mesaj hastaya ulaştırılıyor..."}
                      {sendingStep === 0 && "İşleminiz başlatılıyor..."}
                    </p>
                  </div>
                ) : !isSuccess ? (
                  <>
                    <div className="flex items-center gap-2 mb-3 pb-3 border-b border-black/5">
                      <Zap className="w-5 h-5 text-indigo-500 fill-indigo-500 animate-pulse" />
                      <span className="text-sm font-extrabold text-[#1D1D1F]">AI Yapay Zeka Yönlendirme Talimatı</span>
                    </div>
                    <p className="text-[11px] text-[#86868B] mb-3 font-semibold leading-relaxed">
                      Yapay zekanın hastaya özel olarak kurgulayıp göndereceği WhatsApp mesaj şablonunu yönlendirecek talimatı aşağıdan düzenleyebilirsiniz:
                    </p>
                    <textarea
                      value={directiveText}
                      onChange={(e) => setDirectiveText(e.target.value)}
                      className="w-full min-h-[100px] p-3.5 bg-[#F5F5F7] border border-black/5 rounded-2xl text-xs font-bold focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none resize-none transition-all duration-200 leading-relaxed text-[#1D1D1F]"
                      placeholder="Bota verilecek özel talimatı buraya yazın..."
                    />
                    
                    {/* Minimalist Varsayılan Olarak Kaydet Checkbox'ı */}
                    <div className="flex items-center gap-2 mt-3 px-1">
                      <label className="flex items-center gap-2 text-[11px] font-bold text-[#86868B] hover:text-[#1D1D1F] cursor-pointer transition-all select-none">
                        <input
                          type="checkbox"
                          checked={saveAsDefault}
                          onChange={(e) => setSaveAsDefault(e.target.checked)}
                          className="w-3.5 h-3.5 rounded border-black/10 text-indigo-600 focus:ring-indigo-500/20 accent-indigo-600"
                        />
                        <span>Bu şablonu varsayılan olarak kaydet</span>
                      </label>
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-black/5">
                      <button
                        onClick={() => setActiveBotPopup(null)}
                        className="px-4 py-2 bg-[#F5F5F7] hover:bg-black/5 border border-transparent rounded-xl text-xs font-bold text-[#1D1D1F] transition-all cursor-pointer"
                      >
                        Vazgeç
                      </button>
                      <button
                        onClick={async () => {
                          if (!apt.opportunityId) return;
                          try {
                            setIsSending(true);
                            setSendingStep(1);

                            // Setup live steps simulation
                            const t1 = setTimeout(() => setSendingStep(2), 600);
                            const t2 = setTimeout(() => setSendingStep(3), 1300);
                            const t3 = setTimeout(() => setSendingStep(4), 2100);

                            const res = await saveBotDirective(apt.opportunityId, directiveText);

                            clearTimeout(t1);
                            clearTimeout(t2);
                            clearTimeout(t3);

                            if (res.success && res.data?.success) {
                              if (saveAsDefault) {
                                localStorage.setItem(`baskent_bot_template_${activeBotPopup}_${apt.status}`, directiveText);
                              }
                              await recordBotDirectiveSent(apt.taskId, activeBotPopup);
                              setSentMessagePreview(res.data.draftMessage || '');
                              setIsSuccess(true);
                              onActionComplete();
                            } else {
                              alert(res.error || res.data?.error || "İşlem başarısız oldu.");
                            }
                          } catch (err) {
                            alert("Bir hata oluştu.");
                          } finally {
                            setIsSending(false);
                            setSendingStep(0);
                          }
                        }}
                        className="px-4.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm hover:shadow active:scale-95 flex items-center gap-1"
                      >
                        <Zap className="w-3.5 h-3.5 fill-white" />
                        Gönder
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col items-center text-center py-3">
                      <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-2.5 shadow-sm">
                        <Check className="w-6 h-6 text-emerald-600 stroke-[3]" />
                      </div>
                      <h3 className="text-sm font-extrabold text-[#1D1D1F] mb-1">Talimat Bota İletildi</h3>
                      <p className="text-[11px] text-[#86868B] max-w-[320px] font-semibold leading-relaxed">
                        Yönlendirme talimatı bota başarıyla iletildi ve hastaya özel AI mesajı gönderildi!
                      </p>
                    </div>
                    
                    {sentMessagePreview && (
                      <div className="space-y-1.5 mt-2 bg-[#F5F5F7] border border-black/5 rounded-2xl p-4">
                        <div className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Gönderilen Mesaj İçeriği</div>
                        <div className="text-xs font-semibold text-[#1D1D1F] max-h-[120px] overflow-y-auto leading-relaxed whitespace-pre-wrap">
                          {sentMessagePreview}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-black/5">
                      <button
                        onClick={() => setActiveBotPopup(null)}
                        className="px-4 py-2 bg-[#F5F5F7] hover:bg-black/5 border border-transparent rounded-xl text-xs font-bold text-[#1D1D1F] transition-all cursor-pointer"
                      >
                        Kapat
                      </button>
                      <button
                        onClick={() => {
                          onGoToInbox({ phone_number: apt.phoneNumber, display_name: apt.patientName });
                          setActiveBotPopup(null);
                        }}
                        className="px-4.5 py-2 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm hover:shadow active:scale-95 flex items-center gap-1.5"
                      >
                        <Phone className="w-3.5 h-3.5 fill-white text-white" />
                        Mesaja Git
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
    {isSuggestionPending && (() => {
      const isConfirmationOnly = !!apt.metadata?.bot_suggestion?.is_confirmation_only;
      const userMessage = apt.metadata?.bot_suggestion?.user_message;
      
      let suggestionTitle = "🤖 Bot Yeni Tarih Önerdi";
      let suggestionDesc = (
        <>
          Hasta WhatsApp üzerinden randevu tarihini <span className="text-indigo-700 font-extrabold">{formatDateTr(apt.metadata?.bot_suggestion?.proposed_date)}</span> olarak kararlaştırdı.
        </>
      );

      if (isConfirmationOnly) {
        suggestionTitle = apt.appointmentType === 'clinic_visit'
          ? "🤖 Bot Klinik randevusu tarihini teyit aldı."
          : "🤖 Bot Telefon görüşmesi tarihini teyit aldı.";
        
        suggestionDesc = (
          <>
            Müşteri onay mesajı: <span className="text-indigo-700 font-extrabold">"{userMessage || 'evet onaylıyorum'}"</span>
          </>
        );
      } else if (userMessage) {
        suggestionDesc = (
          <>
            Hasta WhatsApp üzerinden randevu tarihini <span className="text-indigo-700 font-extrabold">{formatDateTr(apt.metadata?.bot_suggestion?.proposed_date)}</span> olarak kararlaştırdı.
            <span className="block text-[10px] text-[#86868B] mt-0.5 italic">
              Müşteri mesajı: "{userMessage}"
            </span>
          </>
        );
      }

      return (
        <tr className="bg-indigo-50/10 hover:bg-indigo-50/20 transition-colors">
          <td colSpan={viewType ? 6 : 7} className="px-4 py-2.5 border-b border-black/5" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-indigo-50/65 border border-indigo-100/80 rounded-xl p-3 shadow-sm">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/10 border border-indigo-200 flex items-center justify-center text-indigo-700">
                  <Bot className="w-4.5 h-4.5 animate-pulse" />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#1D1D1F] flex items-center gap-1.5">
                    {suggestionTitle}
                  </div>
                  <div className="text-[11px] font-semibold text-[#86868B] mt-0.5">
                    {suggestionDesc}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const res = await approveBotSuggestion(apt.taskId, apt.metadata?.bot_suggestion?.proposed_date);
                      if (res.success) {
                        onActionComplete();
                      } else {
                        alert(res.error || "İşlem başarısız oldu.");
                      }
                    } catch (err) {
                      alert("Bir hata oluştu.");
                    }
                  }}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700 rounded-lg text-xs font-bold transition-all shadow-sm hover:shadow active:scale-95 cursor-pointer flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>Kabul Et ve Teyitli Yap</span>
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const res = await rejectBotSuggestion(apt.taskId);
                      if (res.success) {
                        onActionComplete();
                      } else {
                        alert(res.error || "İşlem başarısız oldu.");
                      }
                    } catch (err) {
                      alert("Bir hata oluştu.");
                    }
                  }}
                  className="px-3 py-1.5 bg-white hover:bg-[#F5F5F7] border border-black/5 text-[#86868B] hover:text-[#1D1D1F] rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
                >
                  Yoksay
                </button>
              </div>
            </div>
          </td>
        </tr>
      );
    })()}

    {/* Modern Arama Notu Ekleme Modali */}
    {noteModalOpen && (
      <tr className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-50" onClick={() => setNoteModalOpen(false)}>
        <td className="p-0 border-0" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-black/5 w-full max-w-md p-6 mx-4 text-left">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#1D1D1F] flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#007AFF] animate-pulse"></span>
                Arama Notu Ekle
              </h3>
              <button 
                onClick={() => setNoteModalOpen(false)}
                className="p-1 hover:bg-[#F5F5F7] rounded-lg transition-colors cursor-pointer text-[#86868B] hover:text-[#1D1D1F]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <p className="text-[11px] font-semibold text-[#86868B] mb-3">
              {apt.patientName} ile yapılan telefon görüşmesinin detaylarını not edin. Bu not geçmişte saklanacaktır.
            </p>

            <textarea
              value={noteInputText}
              onChange={(e) => setNoteInputText(e.target.value)}
              placeholder="Görüşme detaylarını buraya yazın... (Örn: Fiyat teklifi düşünüyor, haftaya çarşamba tekrar aranmak istiyor.)"
              rows={4}
              className="w-full text-xs font-semibold p-3 border border-black/10 rounded-xl focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/20 transition-all outline-none resize-none bg-[#F5F5F7]/30 text-[#1D1D1F]"
              autoFocus
            />

            <div className="flex items-center justify-end gap-2 mt-4.5">
              <button
                onClick={() => setNoteModalOpen(false)}
                className="px-4 py-2 bg-[#F5F5F7] hover:bg-[#E8E8ED] border border-black/5 text-[#1D1D1F] rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                onClick={async () => {
                  setNoteModalOpen(false);
                  try {
                    await completeAppointmentTask(apt.taskId, activeNoteResult, noteInputText);
                    onActionComplete();
                  } catch (err) {
                    alert("İşlem başarısız oldu.");
                  }
                }}
                disabled={!noteInputText.trim()}
                className="px-4 py-2 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:pointer-events-none shadow-sm hover:shadow"
              >
                Kaydet ve Tamamla
              </button>
            </div>
          </div>
        </td>
      </tr>
    )}

    {/* Modern Arama Notu Görüntüleme Modali */}
    {viewNoteModalOpen && (
      <tr className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-50" onClick={() => setViewNoteModalOpen(false)}>
        <td className="p-0 border-0" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-black/5 w-full max-w-md p-6 mx-4 text-left">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#1D1D1F] flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#007AFF]" />
                Arama Notu
              </h3>
              <button 
                onClick={() => setViewNoteModalOpen(false)}
                className="p-1 hover:bg-[#F5F5F7] rounded-lg transition-colors cursor-pointer text-[#86868B] hover:text-[#1D1D1F]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-4">
              <div className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">HASTA</div>
              <div className="text-xs font-bold text-[#1D1D1F]">{apt.patientName}</div>
            </div>

            <div className="bg-indigo-50/40 border border-indigo-100/50 rounded-xl p-4 mb-4">
              <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <span>Görüşme Detayı</span>
              </div>
              <p className="text-xs font-semibold text-[#1D1D1F] leading-relaxed italic whitespace-pre-wrap">
                "{apt.metadata?.note}"
              </p>
            </div>

            <div className="flex items-center justify-end">
              <button
                onClick={() => setViewNoteModalOpen(false)}
                className="px-4 py-2 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white rounded-lg text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm hover:shadow"
              >
                Kapat
              </button>
            </div>
          </div>
        </td>
      </tr>
    )}
  </>
);
}

function DropdownItem({ icon: Icon, label, color = "text-[#1D1D1F]", onClick }: { icon: any; label: string; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-[#F5F5F7] transition-colors flex items-center gap-2 ${color}`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function StatusOption({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-[11px] font-semibold hover:bg-[#F5F5F7] transition-colors flex items-center justify-between cursor-pointer ${
        active ? 'text-indigo-600 bg-indigo-50/40 font-bold' : 'text-[#1D1D1F]'
      }`}
    >
      <span>{label}</span>
      {active && <Check className="w-3.5 h-3.5 text-indigo-600" />}
    </button>
  );
}
