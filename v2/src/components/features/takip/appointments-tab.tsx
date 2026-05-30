"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import {
  Search, ChevronDown, CheckCircle2, Phone, Calendar,
  Clock, AlertTriangle, X, Filter, Building2, MapPin, MoreVertical, Check, Ban, XCircle, CalendarClock, Moon, Zap
} from "lucide-react";
import { 
  getAppointmentRows, getAppointmentStats, completeAppointmentTask, updateAppointmentConfirmation, rescheduleAppointmentTask,
  type AppointmentRow, type AppointmentFilters 
} from "@/app/actions/patient-tracking";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

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
  const [statusFilter, setStatusFilter] = useState("pending");
  const [confirmFilter, setConfirmFilter] = useState("all");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters: AppointmentFilters = {
    search: debouncedSearch || undefined,
    dueRange: dueRange !== 'all' ? dueRange as any : undefined,
    appointmentType: appointmentType !== 'all' ? appointmentType : undefined,
    completed: statusFilter === 'completed',
    confirmationStatus: confirmFilter !== 'all' ? confirmFilter : undefined,
  };

  const { data, isLoading, mutate } = useSWR(
    ['appointments', debouncedSearch, dueRange, appointmentType, statusFilter, confirmFilter],
    () => getAppointmentRows(filters),
    { refreshInterval: 20000 }
  );

  const { data: stats, mutate: mutateStats } = useSWR(
    'appointment-stats',
    () => getAppointmentStats(),
    { refreshInterval: 30000 }
  );

  const items = data?.items || [];
  const total = data?.total || 0;

  return (
    <div className="flex flex-col h-full bg-[#F5F5F7]">
      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-white border-b border-black/5">
        <MetricCard label="Bugünkü Randevular" value={stats?.due_today || 0} icon={Calendar} color="#007AFF" />
        <MetricCard label="Gecikenler" value={stats?.overdue || 0} icon={AlertTriangle} color="#FF3B30" />
        <MetricCard label="Teyit Bekleyen" value={stats?.confirmation_pending || 0} icon={Clock} color="#FF9500" />
        <MetricCard label="Telefon Randevuları" value={stats?.total_phone || 0} icon={Phone} color="#5856D6" />
        <MetricCard label="Klinik Randevuları" value={stats?.total_clinic || 0} icon={Building2} color="#34C759" />
      </div>

      {/* Header Filters */}
      <div className="px-4 py-3 border-b border-black/5 bg-white space-y-3">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#86868B]" />
            <input 
              type="text" 
              placeholder="Hasta adı veya telefon..." 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#F5F5F7] border border-transparent rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white transition-all shadow-sm"
            />
          </div>
          <div className="flex items-center gap-2 ml-auto text-xs font-semibold text-[#86868B]">
            {total} Listeleniyor
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-3">
          <FilterGroup tabs={STATUS_TABS} active={statusFilter} onChange={setStatusFilter} />
          {statusFilter === 'pending' && <FilterGroup tabs={DUE_RANGE_TABS} active={dueRange} onChange={setDueRange} />}
          <FilterGroup tabs={TYPE_TABS} active={appointmentType} onChange={(v) => setAppointmentType(v as any)} />
          {statusFilter === 'pending' && <FilterGroup tabs={CONFIRM_TABS} active={confirmFilter} onChange={setConfirmFilter} />}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto bg-white">
        <table className="w-full text-left border-collapse min-w-[900px]">
          <thead className="sticky top-0 bg-white/90 backdrop-blur-md z-10 border-b border-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <tr>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Tarih & Saat</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Hasta</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Randevu Türü</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Randevu Durumu</th>
              <th className="py-3 px-4 text-[11px] font-semibold text-[#86868B] tracking-wider uppercase">Teyit Durumu</th>
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
              />
            ))}
            {items.length === 0 && !isLoading && (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <CalendarClock className="w-10 h-10 text-[#C7C7CC] mx-auto mb-3" />
                  <p className="text-[#86868B] font-semibold text-sm">Randevu bulunamadı</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <div className="bg-[#F5F5F7] rounded-xl p-3 border border-black/5 shadow-sm flex flex-col justify-center">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color }} />
        <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold text-[#1D1D1F]">{value}</div>
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

function AppointmentRowComponent({ apt, onOpenDrawer, onGoToInbox, onActionComplete }: { 
  apt: AppointmentRow; 
  onOpenDrawer: (opportunityId: string) => void;
  onGoToInbox: (item: any) => void;
  onActionComplete: () => void;
}) {
  const flag = getCountryFlag(apt.country);
  const actionDropdown = useDropdown();

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
      else if (action === 'call_missed') await completeAppointmentTask(apt.taskId, 'no_show'); // Or separate missed
      else if (action === 'confirm') await updateAppointmentConfirmation(apt.taskId, 'confirmed');
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

  const isPhone = apt.appointmentType === 'phone_call' || apt.appointmentType === 'pre_consultation';
  const isClinic = apt.appointmentType === 'clinic_visit';

  return (
    <tr 
      onClick={() => apt.opportunityId && onOpenDrawer(apt.opportunityId)}
      className={`hover:bg-[#007AFF]/5 transition-colors group cursor-pointer ${
        apt.status === 'overdue' ? 'bg-red-50/30' : ''
      }`}
    >
      <td className="py-3.5 px-4">
        {apt.dueAtUtc ? (
          <div>
            <div className="text-[13px] font-bold text-[#1D1D1F]">
              {new Date(apt.dueAtUtc).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' })}
            </div>
            <div className="text-[11px] font-semibold text-[#007AFF] mt-0.5">
              {new Date(apt.dueAtUtc).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}
            </div>
          </div>
        ) : (
          <span className="text-[11px] text-[#C7C7CC] font-medium">Tarih yok</span>
        )}
      </td>
      <td className="py-3.5 px-4 min-w-[180px]">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-[13px] text-[#1D1D1F]">{apt.patientName}</span>
          {apt.country && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F5F5F7] font-semibold text-[#86868B] border border-black/5">
              {flag}
            </span>
          )}
          {apt.priority === 'hot' && <Zap className="w-3 h-3 text-[#FF3B30] fill-[#FF3B30]" />}
        </div>
        <div className="text-[11px] text-[#86868B] font-medium mt-0.5 flex items-center gap-1">
          {formatPhone(apt.phoneNumber)}
        </div>
      </td>
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
      </td>
      <td className="py-3.5 px-4">
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
      </td>
      <td className="py-3.5 px-4">
        {apt.dueAtTurkey ? (
          <div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-[#1D1D1F]">
              <Clock className="w-3 h-3 text-[#86868B]" /> 🇹🇷 {apt.dueAtTurkey.split(' ')[1]}
            </div>
            {apt.dueAtPatientLocal ? (
              <div className="flex items-center gap-1 text-[10px] font-semibold text-[#86868B] mt-0.5">
                🌍 {apt.dueAtPatientLocal.split(' ')[1]}
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
      <td className="py-3.5 px-4 text-right">
        <div className="flex items-center justify-end gap-1.5 relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onGoToInbox({ phone_number: apt.phoneNumber, display_name: apt.patientName });
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-black/5 rounded-lg shadow-sm hover:bg-[#007AFF]/10 hover:border-[#007AFF]/20 hover:text-[#007AFF] transition-all text-[11px] font-semibold text-[#1D1D1F]"
            title="Mesaja Git"
          >
            <Phone className="w-3.5 h-3.5" />
          </button>
          
          <div ref={actionDropdown.ref} className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); actionDropdown.setIsOpen(!actionDropdown.isOpen); }}
              className="inline-flex items-center justify-center w-8 h-8 bg-white border border-black/5 rounded-lg shadow-sm hover:bg-black/5 transition-colors text-[#1D1D1F]"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            
            {actionDropdown.isOpen && (
              <div 
                className="absolute top-full right-0 mt-1 w-48 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 overflow-hidden"
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
                    <DropdownItem icon={Ban} label="Cevap Yok" onClick={() => handleAction('no_response')} />
                    
                    <div className="px-3 py-1.5 text-[10px] font-bold text-[#86868B] uppercase tracking-wider bg-[#F5F5F7] mt-1">Diğer</div>
                    <DropdownItem icon={X} label="İptal Et" color="text-red-600" onClick={() => handleAction('cancel')} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
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
