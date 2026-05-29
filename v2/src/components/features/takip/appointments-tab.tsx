"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import {
  Search, ChevronDown, CheckCircle2, Phone, Calendar,
  Clock, AlertTriangle, X, Filter, Building2, MapPin
} from "lucide-react";
import { getAppointmentRows, type AppointmentRow, type AppointmentFilters } from "@/app/actions/patient-tracking";

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

// ── Phone formatter ──

const formatPhone = (phone: string): string => {
  if (!phone) return '';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.startsWith('90') && clean.length >= 12) {
    return `+${clean.slice(0,2)} ${clean.slice(2,5)} ${clean.slice(5,8)} ${clean.slice(8,10)} ${clean.slice(10)}`;
  }
  if (clean.length >= 10) return `+${clean}`;
  return clean;
};

// ── Country flag ──

const getCountryFlag = (country?: string): string => {
  if (!country) return '🌍';
  const FLAGS: Record<string, string> = {
    'Türkiye': '🇹🇷', 'Turkey': '🇹🇷', 'Almanya': '🇩🇪', 'Germany': '🇩🇪',
    'Irak': '🇮🇶', 'Iraq': '🇮🇶', 'ABD': '🇺🇸', 'USA': '🇺🇸',
    'İngiltere': '🇬🇧', 'UK': '🇬🇧', 'Suudi Arabistan': '🇸🇦',
    'Libya': '🇱🇾', 'Rusya': '🇷🇺', 'BAE': '🇦🇪', 'Azerbaycan': '🇦🇿',
  };
  return FLAGS[country] || '🌍';
};

// ── Main Component ──

interface AppointmentsTabProps {
  onOpenDrawer: (opportunityId: string) => void;
  onGoToInbox: (item: any) => void;
}

export default function AppointmentsTab({ onOpenDrawer, onGoToInbox }: AppointmentsTabProps) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dueRange, setDueRange] = useState("all");
  const [appointmentType, setAppointmentType] = useState<'all' | 'phone_call' | 'clinic_visit'>("all");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters: AppointmentFilters = {
    search: debouncedSearch || undefined,
    dueRange: dueRange !== 'all' ? dueRange as any : undefined,
    appointmentType: appointmentType !== 'all' ? appointmentType : undefined,
  };

  const { data, isLoading, mutate } = useSWR(
    ['appointments', debouncedSearch, dueRange, appointmentType],
    () => getAppointmentRows(filters),
    { refreshInterval: 20000 }
  );

  const items = data?.items || [];
  const total = data?.total || 0;

  // Count by status for visual indicators
  const overdueCount = items.filter(i => i.status === 'overdue').length;
  const approachingCount = items.filter(i => i.status === 'approaching').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header Filters */}
      <div className="px-4 py-3 border-b border-black/5 bg-white/60 space-y-3">
        {/* Top row: search + stats */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#86868B]" />
            <input 
              type="text" 
              placeholder="Hasta adı veya telefon..." 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white/80 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/40 focus:bg-white transition-all shadow-sm"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {overdueCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 border border-red-200 text-[11px] font-bold text-red-700">
                ⚠️ {overdueCount} geciken
              </span>
            )}
            {approachingCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-700">
                🔔 {approachingCount} yaklaşan
              </span>
            )}
            <span className="text-xs text-[#86868B] font-medium">{total} randevu</span>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex flex-col md:flex-row gap-3">
          {/* Due Range */}
          <div className="flex items-center gap-1 bg-black/[0.03] rounded-lg p-0.5">
            {DUE_RANGE_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setDueRange(tab.value)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                  dueRange === tab.value
                    ? 'bg-white text-[#1D1D1F] shadow-sm'
                    : 'text-[#86868B] hover:text-[#1D1D1F]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-1 bg-black/[0.03] rounded-lg p-0.5">
            {TYPE_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setAppointmentType(tab.value as any)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                  appointmentType === tab.value
                    ? 'bg-white text-[#1D1D1F] shadow-sm'
                    : 'text-[#86868B] hover:text-[#1D1D1F]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead className="sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <tr>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Tarih & Saat</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Hasta</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Tür</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Durum</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Teyit</th>
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
              />
            ))}

            {items.length === 0 && !isLoading && (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <Calendar className="w-10 h-10 text-[#C7C7CC] mx-auto mb-3" />
                  <p className="text-[#86868B] font-semibold text-sm">Randevu bulunamadı</p>
                  <p className="text-[#C7C7CC] text-xs mt-1">Aktif randevu veya arama planı yok</p>
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

// ── Appointment Row ──

function AppointmentRowComponent({ apt, onOpenDrawer, onGoToInbox }: { 
  apt: AppointmentRow; 
  onOpenDrawer: (opportunityId: string) => void;
  onGoToInbox: (item: any) => void;
}) {
  const flag = getCountryFlag(apt.country);

  return (
    <tr 
      onClick={() => apt.opportunityId && onOpenDrawer(apt.opportunityId)}
      className={`hover:bg-indigo-50/30 transition-colors group cursor-pointer ${
        apt.status === 'overdue' ? 'bg-red-50/20' : ''
      }`}
    >
      {/* Tarih & Saat */}
      <td className="py-3.5 px-4">
        {apt.dueAtUtc ? (
          <div>
            <div className="text-[13px] font-semibold text-[#1D1D1F]">
              {new Date(apt.dueAtUtc).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' })}
            </div>
            <div className="text-[11px] font-medium text-[#86868B] mt-0.5">
              {new Date(apt.dueAtUtc).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-[#C7C7CC]">Tarih yok</span>
        )}
      </td>

      {/* Hasta */}
      <td className="py-3.5 px-4 min-w-[180px]">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-[13px] text-[#1D1D1F]">{apt.patientName}</span>
          {apt.country && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/[0.04] font-semibold text-[#86868B]">
              {flag}
            </span>
          )}
        </div>
        <div className="text-[11px] text-[#86868B] font-medium mt-0.5">{formatPhone(apt.phoneNumber)}</div>
      </td>

      {/* Tür */}
      <td className="py-3.5 px-4">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold tracking-wide ${
          apt.appointmentType === 'phone_call' ? 'bg-blue-50 text-blue-700' :
          apt.appointmentType === 'clinic_visit' ? 'bg-green-50 text-green-700' :
          apt.appointmentType === 'doctor_review' ? 'bg-purple-50 text-purple-700' :
          'bg-gray-50 text-gray-700'
        }`}>
          {apt.appointmentType === 'phone_call' && <Phone className="w-3 h-3" />}
          {apt.appointmentType === 'clinic_visit' && <Building2 className="w-3 h-3" />}
          {apt.appointmentTypeLabel}
        </span>
      </td>

      {/* Durum */}
      <td className="py-3.5 px-4">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold tracking-wide ${apt.statusColor}`}>
          {apt.status === 'overdue' && <AlertTriangle className="w-3 h-3" />}
          {apt.status === 'approaching' && <Clock className="w-3 h-3" />}
          {apt.statusLabel}
        </span>
      </td>

      {/* Teyit */}
      <td className="py-3.5 px-4">
        {apt.confirmationStatus === 'confirmed' ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-600">
            <CheckCircle2 className="w-3 h-3" /> Teyit Edildi
          </span>
        ) : apt.confirmationStatus === 'pending' ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600">
            <Clock className="w-3 h-3" /> Teyit Bekliyor
          </span>
        ) : (
          <span className="text-[11px] text-[#C7C7CC]">—</span>
        )}
      </td>

      {/* Saat Bilgisi */}
      <td className="py-3.5 px-4">
        {apt.dueAtTurkey ? (
          <div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-[#1D1D1F]">
              <Clock className="w-3 h-3 text-[#86868B]" /> 🇹🇷 {apt.dueAtTurkey}
            </div>
            {apt.dueAtPatientLocal && (
              <div className="text-[10px] text-[#86868B] mt-0.5">
                🌍 {apt.dueAtPatientLocal}
              </div>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-[#C7C7CC]">—</span>
        )}
      </td>

      {/* Aksiyon */}
      <td className="py-3.5 px-4 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onGoToInbox({ phone_number: apt.phoneNumber, display_name: apt.patientName });
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-black/5 rounded-lg shadow-sm hover:bg-green-50 hover:border-green-200 hover:text-green-600 transition-all text-[11px] font-semibold text-[#1D1D1F]"
            title="Mesaja Git"
          >
            <Phone className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
