"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import {
  Search, ChevronDown, CheckCircle2, MessageCircle,
  Clock, Flame, Thermometer, Snowflake, Filter, X,
  ChevronRight, Moon, AlertTriangle, Bot, Phone
} from "lucide-react";
import { getPatientTrackingRows, type PatientTrackingRow, type PatientTrackingFilters } from "@/app/actions/patient-tracking";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

// ── Stage Config (same as takip/page) ──

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
  };
  return FLAGS[country] || '🌍';
};

// ══════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════

interface PatientTrackingTabProps {
  onGoToInbox: (item: any) => void;
  onOpenDrawer: (opportunityId: string) => void;
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
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase w-[170px]">Sonraki Aksiyon</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase w-[140px]">Sonraki Takip</th>
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
                <td colSpan={7} className="py-16 text-center">
                  <Phone className="w-10 h-10 text-[#C7C7CC] mx-auto mb-3" />
                  <p className="text-[#86868B] font-semibold text-sm">Aktif hasta bulunamadı</p>
                  <p className="text-[#C7C7CC] text-xs mt-1">Filtreleri değiştirmeyi deneyin</p>
                </td>
              </tr>
            )}

            {isLoading && (
              <tr>
                <td colSpan={7} className="py-16 text-center">
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
  onOpenDrawer: (opportunityId: string) => void;
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
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] font-medium text-[#86868B]">{formatPhone(item.phoneNumber)}</span>
          {item.department && item.department !== 'Genel' && (
            <span className="text-[10px] font-medium text-[#86868B]">· {item.department}</span>
          )}
        </div>
      </td>

      {/* Durum */}
      <td className="py-3.5 px-4">
        <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold tracking-wide ${item.journeyStatusColor}`}>
          {item.journeyStatus}
        </span>
      </td>

      {/* Kısa Özet */}
      <td className="py-3.5 px-4">
        <p className="text-[11px] text-[#1D1D1F] font-medium line-clamp-1 leading-relaxed max-w-[220px]" title={item.shortSummary}>
          {item.shortSummary}
        </p>
      </td>

      {/* Sonraki Aksiyon */}
      <td className="py-3.5 px-4">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold tracking-wide ${item.actionColorClass}`}>
          {item.nextBestAction === 'call_now' && <Phone className="w-3 h-3" />}
          {item.nextBestAction === 'call_today' && <Phone className="w-3 h-3" />}
          {item.nextBestAction === 'delegate_unreachable_followup_to_bot' && <Bot className="w-3 h-3" />}
          {item.actionLabel}
        </span>
      </td>

      {/* Sonraki Takip */}
      <td className="py-3.5 px-4">
        {item.nextFollowUpTurkey ? (
          <div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-[#1D1D1F]">
              <Clock className="w-3 h-3 text-[#86868B]" />
              {item.nextFollowUpTurkey}
            </div>
            {item.nextFollowUpPatientLocal && (
              <div className="text-[9px] text-[#86868B] mt-0.5">
                🌍 {item.nextFollowUpPatientLocal}
              </div>
            )}
            {item.timezoneNeedsConfirmation && (
              <div className="flex items-center gap-0.5 text-[9px] text-amber-600 font-semibold mt-0.5">
                <AlertTriangle className="w-2.5 h-2.5" /> Saat teyidi gerekli
              </div>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-[#C7C7CC]">—</span>
        )}
      </td>

      {/* Aksiyon Buttons */}
      <td className="py-3.5 px-4 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={(e) => { 
              e.stopPropagation(); 
              onGoToInbox({ phone_number: item.phoneNumber, display_name: item.patientName, source: item.source }); 
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-black/5 rounded-lg shadow-sm hover:bg-green-50 hover:border-green-200 hover:text-green-600 transition-all text-[11px] font-semibold text-[#1D1D1F]"
            title="Mesaja Git"
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (item.opportunityId) onOpenDrawer(item.opportunityId);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-black/5 rounded-lg shadow-sm hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-all text-[11px] font-semibold text-[#1D1D1F]"
            title="Detay"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
