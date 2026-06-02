"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import {
  Search, ChevronDown, CheckCircle2, MessageCircle,
  Clock, Flame, Thermometer, Snowflake, Filter, X,
  ChevronRight, Moon, AlertTriangle, Bot, Phone, Building2
} from "lucide-react";
import { getPatientTrackingRows, type PatientTrackingRow, type PatientTrackingFilters } from "@/app/actions/patient-tracking";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

// ── Stage Config (same as takip/page) ──

const STAGES = [
  { value: 'new_lead', label: 'Yeni', color: '#007AFF', icon: '🆕' },
  { value: 'first_contact', label: 'İlk İletişim', color: '#FF9500', icon: '📞' },
  { value: 'engaged', label: 'Cevap Alındı', color: '#34C759', icon: '💬' },
  { value: 'discovery', label: 'Keşif/Analiz', color: '#5856D6', icon: '🔍' },
  { value: 'qualified', label: 'Nitelikli', color: '#30B0C7', icon: '⭐' },
  { value: 'phone_call_planning', label: 'Telefon Görüşmesi Planlanıyor', color: '#AF52DE', icon: '📞' },
  { value: 'appointment_planning', label: 'Randevu Planlanıyor', color: '#FFD60A', icon: '📅' },
  { value: 'appointment_booked', label: 'Randevu Alındı', color: '#0F9D58', icon: '✅' },
  { value: 'arrived', label: 'Geldi', color: '#0F9D58', icon: '🏥' },
  { value: 'not_qualified', label: 'Uygun Değil', color: '#8E8E93', icon: '🚫' },
];

const getStageInfo = (stage: string) => STAGES.find(s => s.value === stage) || { value: stage, label: stage, color: '#86868B', icon: '❓' };

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: typeof Flame }> = {
  hot: { label: 'Sıcak', color: '#FF3B30', icon: Flame },
  warm: { label: 'Ilık', color: '#FF9500', icon: Thermometer },
  cold: { label: 'Soğuk', color: '#8E8E93', icon: Snowflake },
};

// ── Phone formatter ──

const formatPhone = (phone: string): string => {
  return formatPhoneReadable(phone);
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

// ── Country flag resolver ──

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

// ══════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════

interface PatientTrackingTabProps {
  onGoToInbox: (item: any) => void;
  onOpenDrawer: (opportunityId: string, initialTab?: 'profile' | 'appointment', targetPageTab?: 'hasta_takibi' | 'telefon' | 'randevu') => void;
}

export default function PatientTrackingTab({ onGoToInbox, onOpenDrawer }: PatientTrackingTabProps) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const stageDropdown = useDropdown();
  const priorityDropdown = useDropdown();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters: PatientTrackingFilters = {
    search: debouncedSearch || undefined,
    stage: stageFilter !== 'all' ? stageFilter : undefined,
    priority: priorityFilter !== 'all' ? priorityFilter : undefined,
  };

  const { data, isLoading } = useSWR(
    ['patient-tracking', debouncedSearch, stageFilter, priorityFilter],
    () => getPatientTrackingRows(filters),
    { 
      refreshInterval: 60000,
      refreshWhenHidden: false,
      revalidateOnFocus: true
    }
  );

  const items = data?.items || [];
  const total = data?.total || 0;

  const hasActiveFilters = stageFilter !== 'all' || priorityFilter !== 'all';

  return (
    <div className="flex flex-col h-full">
      {/* Filters Bar */}
      <div className="px-4 py-3 border-b border-black/5 bg-white/60 flex flex-col md:flex-row items-start md:items-center gap-3">
        {/* Search */}
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#86868B]" />
          <input 
            type="text" 
            placeholder="İsim, telefon, departman..." 
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white/80 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/40 focus:bg-white transition-all shadow-sm"
          />
        </div>

        {/* Stage Filter */}
        <div ref={stageDropdown.ref} className="relative">
          <button
            onClick={() => stageDropdown.setIsOpen(!stageDropdown.isOpen)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-all cursor-pointer ${
              stageFilter !== 'all' 
                ? 'bg-indigo-50 border-indigo-200 text-indigo-600' 
                : 'bg-white/80 border-black/5 text-[#1D1D1F] hover:bg-white'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            {stageFilter !== 'all' ? getStageInfo(stageFilter).label : 'Aşama'}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {stageDropdown.isOpen && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 max-h-[400px] overflow-y-auto">
              <button 
                onClick={() => { setStageFilter('all'); stageDropdown.setIsOpen(false); }}
                className={`w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-black/5 transition-colors ${stageFilter === 'all' ? 'text-indigo-600' : 'text-[#1D1D1F]'}`}
              >
                Tüm Aşamalar
              </button>
              <div className="h-px bg-black/5 my-1" />
              {STAGES.map(s => (
                <button 
                  key={s.value}
                  onClick={() => { setStageFilter(s.value); stageDropdown.setIsOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 transition-colors flex items-center gap-2 ${stageFilter === s.value ? 'font-semibold' : ''}`}
                  style={{ color: stageFilter === s.value ? s.color : '#1D1D1F' }}
                >
                  <span>{s.icon}</span>
                  {s.label}
                  {stageFilter === s.value && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Priority Filter */}
        <div ref={priorityDropdown.ref} className="relative">
          <button
            onClick={() => priorityDropdown.setIsOpen(!priorityDropdown.isOpen)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-all cursor-pointer ${
              priorityFilter !== 'all'
                ? `border-opacity-20`
                : 'bg-white/80 border-black/5 text-[#1D1D1F] hover:bg-white'
            }`}
            style={priorityFilter !== 'all' ? {
              backgroundColor: `${PRIORITY_CONFIG[priorityFilter]?.color}15`,
              borderColor: `${PRIORITY_CONFIG[priorityFilter]?.color}30`,
              color: PRIORITY_CONFIG[priorityFilter]?.color
            } : {}}
          >
            {priorityFilter !== 'all' ? PRIORITY_CONFIG[priorityFilter]?.label : 'Öncelik'}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {priorityDropdown.isOpen && (
            <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50">
              <button 
                onClick={() => { setPriorityFilter('all'); priorityDropdown.setIsOpen(false); }}
                className="w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-black/5"
              >
                Tümü
              </button>
              <div className="h-px bg-black/5 my-1" />
              {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => {
                const PIcon = cfg.icon;
                return (
                  <button 
                    key={key}
                    onClick={() => { setPriorityFilter(key); priorityDropdown.setIsOpen(false); }}
                    className="w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 flex items-center gap-2"
                    style={{ color: priorityFilter === key ? cfg.color : '#1D1D1F' }}
                  >
                    <PIcon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button 
            onClick={() => { setStageFilter('all'); setPriorityFilter('all'); }}
            className="text-xs font-semibold text-[#86868B] hover:text-[#1D1D1F] transition-colors flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> Temizle
          </button>
        )}

        <span className="text-xs text-[#86868B] font-medium ml-auto">{total} hasta</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead className="sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <tr>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase w-[140px]">Son Aktivite</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase min-w-[200px]">Hasta</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase w-[160px]">Durum</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase min-w-[180px]">Kısa Özet</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase w-[200px]">Manuel Notlar</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase text-right w-[100px]">Aksiyon</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {items.map((item) => (
              <PatientRow 
                key={item.opportunityId || item.taskId || item.phoneNumber} 
                item={item} 
                onGoToInbox={onGoToInbox}
                onOpenDrawer={onOpenDrawer}
              />
            ))}

            {items.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <Phone className="w-10 h-10 text-[#C7C7CC] mx-auto mb-3" />
                  <p className="text-[#86868B] font-semibold text-sm">Aktif hasta bulunamadı</p>
                  <p className="text-[#C7C7CC] text-xs mt-1">Filtreleri değiştirmeyi deneyin</p>
                </td>
              </tr>
            )}

            {isLoading && (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <div className="inline-flex items-center gap-2 text-[#86868B] text-sm font-medium">
                    <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    Yükleniyor...
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Patient Row Component ──

function PatientRow({ item, onGoToInbox, onOpenDrawer }: { 
  item: PatientTrackingRow; 
  onGoToInbox: (item: any) => void; 
  onOpenDrawer: (opportunityId: string, initialTab?: 'profile' | 'appointment', targetPageTab?: 'hasta_takibi' | 'telefon' | 'randevu') => void;
}) {
  const prioConfig = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.warm;
  const PrioIcon = prioConfig.icon;
  const flag = getCountryFlag(item.country);

  return (
    <tr 
      onClick={() => item.opportunityId && onOpenDrawer(item.opportunityId)}
      className="hover:bg-indigo-50/30 transition-colors group cursor-pointer"
    >
      {/* Son Aktivite */}
      <td className="py-3.5 px-4">
        <div className="text-[12px] font-medium text-[#1D1D1F] leading-tight">{item.lastActivityLabel}</div>
      </td>

      {/* Hasta */}
      <td className="py-3.5 px-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-[13px] text-[#1D1D1F]">{item.patientName}</span>
          {item.country && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/[0.04] text-[10px] font-semibold text-[#86868B]">
              {flag} {item.country}
            </span>
          )}
          <span 
            className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `${prioConfig.color}12`, color: prioConfig.color }}
          >
            <PrioIcon className="w-2.5 h-2.5" />
            {prioConfig.label}
          </span>
          {item.hasBotDelegation && (
            <span className="px-1.5 py-0.5 bg-cyan-50 text-cyan-600 border border-cyan-200 rounded text-[9px] font-bold uppercase flex items-center gap-0.5">
              <Bot className="w-2.5 h-2.5" /> Bot
            </span>
          )}
          {item.isPatientSleeping && (
            <span className="text-[10px] text-amber-600" title="Hasta saatinde gece">
              <Moon className="w-3 h-3 inline" />
            </span>
          )}
          {item.isTestWhitelist && (
            <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded text-[9px] font-bold uppercase">
              TEST
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[11px] font-medium text-[#86868B]">{formatPhone(item.phoneNumber)}</span>
          {item.department && (
            <>
              <span className="text-[#C7C7CC]">·</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 border border-indigo-100 rounded text-[9px] font-bold text-indigo-700 uppercase tracking-wide">
                <Building2 className="w-2.5 h-2.5 text-indigo-600" />
                {item.department}
              </span>
            </>
          )}
        </div>
      </td>

      {/* Durum */}
      <td className="py-3.5 px-4">
        <div className="flex flex-col gap-1 items-start">
          {/* Evrensel Aşama Durumu */}
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide ${item.journeyStatusColor}`}>
            {item.journeyStatus}
          </span>
          
          {/* Telefon Takibi Alıcı Durumu */}
          {item.phoneTaskStatus && (
            <span 
              onClick={(e) => {
                e.stopPropagation();
                if (item.opportunityId) {
                  onOpenDrawer(item.opportunityId, 'appointment', 'telefon');
                }
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 select-none cursor-pointer hover:opacity-85 hover:scale-[1.02] active:scale-95 transition-all shadow-sm ${
                item.phoneTaskStatus === 'Gecikti' 
                  ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100/50' 
                  : item.phoneTaskStatus === 'Planlandı'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100/50'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100/50'
              }`}
            >
              <Phone className="w-2.5 h-2.5 shrink-0" />
              <span>Telefon: {item.phoneTaskStatus}</span>
            </span>
          )}

          {/* Randevu Yönetimi Alıcı Durumu */}
          {item.clinicTaskStatus && (
            <span 
              onClick={(e) => {
                e.stopPropagation();
                if (item.opportunityId) {
                  onOpenDrawer(item.opportunityId, 'appointment', 'randevu');
                }
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 select-none cursor-pointer hover:opacity-85 hover:scale-[1.02] active:scale-95 transition-all shadow-sm ${
                item.clinicTaskStatus === 'Geldi'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100/50'
                  : item.clinicTaskStatus === 'Gelmedi'
                  ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100/50'
                  : item.clinicTaskStatus === 'Gecikti'
                  ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100/50'
                  : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100/50'
              }`}
            >
              <Building2 className="w-2.5 h-2.5 shrink-0" />
              <span>Randevu: {item.clinicTaskStatus}</span>
            </span>
          )}
        </div>
      </td>

      {/* Kısa Özet */}
      <td className="py-3.5 px-4">
        <div className="max-w-[220px]">
          {item.aiReason && (
            <p className="text-[11px] text-[#FF3B30] font-bold leading-tight mb-1" title={item.aiReason}>
              🔥 Neden Fırsat: <span className="font-semibold text-slate-700">{item.aiReason}</span>
            </p>
          )}
          <p className="text-[11px] text-[#1D1D1F] font-medium line-clamp-2 leading-relaxed" title={item.shortSummary}>
            {item.shortSummary}
          </p>
        </div>
      </td>

      {/* Manuel Notlar */}
      <td className="py-3.5 px-4">
        <p className="text-[11px] text-slate-700 font-medium line-clamp-2 leading-relaxed max-w-[180px]" title={item.mostRecentNote}>
          {item.mostRecentNote || <span className="text-[#C7C7CC]">—</span>}
        </p>
      </td>

      {/* Aksiyon Buttons */}
      <td className="py-3.5 px-4 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={(e) => { 
              e.stopPropagation(); 
              onGoToInbox({ phone_number: item.phoneNumber, display_name: item.patientName, source: item.source }); 
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#007AFF] hover:bg-[#007AFF]/90 text-white rounded-lg shadow-sm hover:shadow transition-all text-[11px] font-bold cursor-pointer shrink-0 active:scale-95"
            title="Mesajları Gör"
          >
            <MessageCircle className="w-3.5 h-3.5 text-white" />
            <span>Mesajları Gör</span>
          </button>
        </div>
      </td>
    </tr>
  );
}
