"use client";

import { useState, useCallback, useEffect } from "react";
import useSWR from "swr";
import { 
  Phone, MessageCircle, ClipboardList, Clock, AlertTriangle, 
  Calendar, CheckCircle2, XCircle, Search, Filter, Moon, Globe,
  FileText, ExternalLink, ChevronDown, Check, Trash2, ShieldAlert
} from "lucide-react";
import { getOperationItems, getOperationStats, type OperationItem } from "@/app/actions/operations";
import { logCallReached, logCallMissed, logCallbackScheduled, logNotInterested, activateBot } from "@/app/actions/outreach";
import { completeTask, rescheduleTask } from "@/app/actions/tasks";
import { prepareRemarketingDraft, saveRemarketingDraft, getRemarketingTemplates } from "@/app/actions/remarketing";
import { type TemplateListItem } from "@/lib/services/template-resolver.service";
import { getCountryFlag } from "@/lib/utils/country";

// ── CONSTANTS ──

const OP_TYPE_CONFIG: Record<string, { label: string; icon: string; bg: string; color: string }> = {
  call_due: { label: 'Geciken Arama', icon: '📞', bg: '#FF3B3012', color: '#FF3B30' },
  appointment_request: { label: 'Randevu Planı', icon: '📅', bg: '#34C75912', color: '#34C759' },
  callback_scheduled: { label: 'Geri Arama', icon: '📞', bg: '#5856D612', color: '#5856D6' },
  form_followup: { label: 'Form Takibi', icon: '📋', bg: '#AF52DE12', color: '#AF52DE' },
  report_waiting: { label: 'Rapor Bekliyor', icon: '📄', bg: '#FF950012', color: '#FF9500' },
  doctor_review: { label: 'Doktor Kontrolü', icon: '🩺', bg: '#FF648212', color: '#FF6482' },
  timezone_confirmation: { label: 'Saat Dilimi Teyidi', icon: '🌐', bg: '#FFD60A12', color: '#B8860B' },
  missed_call_followup: { label: 'Ulaşılamadı Takip', icon: '📞', bg: '#8E8E9312', color: '#8E8E93' },
  bot_handoff_followup: { label: 'Bot Devri Takip', icon: '🤖', bg: '#30B0C712', color: '#30B0C7' },
};

// Popular countries for filter list
const POPULAR_COUNTRIES = [
  'Almanya', 'Hollanda', 'İngiltere', 'Fransa', 'Irak', 'Suudi Arabistan', 
  'BAE', 'ABD', 'Kanada', 'Azerbaycan', 'Gürcistan', 'Libya'
];

const DEPARTMENTS = [
  'Genel', 'Saç Ekimi', 'Diş Tedavisi', 'Obezite Cerrahisi', 'Kardiyoloji', 
  'Ortopedi', 'Tüp Bebek', 'Plastik Cerrahi'
];

interface OperationsTabProps {
  onSelectOpportunity: (opp: any) => void;
  onGoToInbox: (opp: any) => void;
}

export default function OperationsTab({ onSelectOpportunity, onGoToInbox }: OperationsTabProps) {
  // Filters
  const [dateRange, setDateRange] = useState<'all' | 'overdue' | 'today' | 'tomorrow' | 'week'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high'>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Action Modals State
  const [actionItem, setActionItem] = useState<OperationItem | null>(null);
  const [actionType, setActionType] = useState<'reached' | 'missed' | 'callback' | 'reschedule' | 'not_interested' | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [rescheduleHours, setRescheduleHours] = useState("24"); // hours
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Remarketing Modal State (PHASE 2P-P0A)
  const [remarketingItem, setRemarketingItem] = useState<OperationItem | null>(null);
  const [isPreparingRemarketing, setIsPreparingRemarketing] = useState(false);
  const [remarketingDraftData, setRemarketingDraftData] = useState<any>(null);
  const [remarketingTemplates, setRemarketingTemplates] = useState<TemplateListItem[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("default");
  const [remarketingText, setRemarketingText] = useState("");
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 450);
    return () => clearTimeout(timer);
  }, [search]);

  // ── SWR Data Fetching ──
  const { data, isLoading, mutate } = useSWR(
    ['operations-items', dateRange, priorityFilter, countryFilter, departmentFilter, debouncedSearch],
    () => getOperationItems({
      dueRange: dateRange,
      priority: priorityFilter,
      country: countryFilter !== 'all' ? countryFilter : undefined,
      department: departmentFilter !== 'all' ? departmentFilter : undefined,
      search: debouncedSearch || undefined,
      limit: 50
    }),
    { refreshInterval: 15000 }
  );

  const { data: stats, mutate: mutateStats } = useSWR(
    'operations-stats',
    () => getOperationStats(),
    { refreshInterval: 15000 }
  );

  const items = data?.items || [];
  const total = data?.total || 0;

  // Real-time sleep check helper
  const isPatientSleeping = useCallback((timezone?: string) => {
    if (!timezone) return false;
    try {
      const patientTimeStr = new Date().toLocaleTimeString('en-US', { timeZone: timezone, hour12: false });
      const patientHour = parseInt(patientTimeStr.split(':')[0]);
      return patientHour >= 22 || patientHour < 8;
    } catch (_) {
      return false;
    }
  }, []);

  // Format relative time helper
  const formatTaskTime = (dateString?: string) => {
    if (!dateString) return "";
    const target = new Date(dateString);
    const diff = Math.round((Date.now() - target.getTime()) / 1000);
    
    if (diff < 0) {
      const abs = Math.abs(diff);
      if (abs < 60) return "Birkaç saniye sonra";
      if (abs < 3600) return `${Math.floor(abs / 60)} dk sonra`;
      if (abs < 86400) return `${Math.floor(abs / 3600)} saat sonra`;
      if (abs < 172800) {
        const time = target.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
        return `Yarın ${time}`;
      }
      return target.toLocaleDateString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
    }
    
    if (diff < 60) return "Az önce";
    if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
    return `${Math.floor(diff / 86400)} gün önce`;
  };

  // ── QUICK ACTIONS FLOWS ──

  const executeAction = async () => {
    if (!actionItem) return;
    setIsSubmitting(true);
    try {
      const leadId = actionItem.lead_id;

      if (actionType === 'reached' && leadId) {
        // 1. Arandı / Ulaşıldı outreach log (updates stage via UnifiedStageService to engaged/responded)
        await logCallReached(leadId, actionNote || undefined);
        // 2. Complete active task
        if (actionItem.task_id) {
          await completeTask(actionItem.task_id, actionNote || "Arama ulaşıldı notu eklendi.");
        }
      } else if (actionType === 'missed' && leadId) {
        // 1. Arandı / Ulaşılamadı outreach log
        await logCallMissed(leadId, actionNote || undefined);
        // 2. Postpone task
        if (actionItem.task_id) {
          const postponeTime = new Date(Date.now() + parseInt(rescheduleHours) * 3600 * 1000).toISOString();
          await rescheduleTask(actionItem.task_id, postponeTime);
        }
      } else if (actionType === 'callback' && leadId) {
        // 1. Geri Aranacak outreach log
        await logCallbackScheduled(leadId, actionNote || undefined);
        // 2. Reschedule task
        if (actionItem.task_id) {
          const postponeTime = new Date(Date.now() + parseInt(rescheduleHours) * 3600 * 1000).toISOString();
          await rescheduleTask(actionItem.task_id, postponeTime);
        }
      } else if (actionType === 'reschedule') {
        // Ertele / Reschedule task directly
        if (actionItem.task_id) {
          const postponeTime = new Date(Date.now() + parseInt(rescheduleHours) * 3600 * 1000).toISOString();
          await rescheduleTask(actionItem.task_id, postponeTime);
        }
      } else if (actionType === 'not_interested' && leadId) {
        // İlgilenmiyor flow (via logNotInterested -> stage lost/not_qualified, cancels tasks)
        await logNotInterested(leadId, actionNote || undefined);
      }

      // Close and mutate SWR
      setActionItem(null);
      setActionType(null);
      setActionNote("");
      mutate();
      mutateStats();
    } catch (err) {
      console.error("[OPERATION_ACTION_ERROR]", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoToInboxClick = (item: OperationItem) => {
    onGoToInbox({
      phone_number: item.phone_number,
      display_name: item.patient_name,
      requester_name: item.patient_name,
      patient_name: item.patient_name,
      source: item.metadata.opp_source || 'whatsapp',
    });
  };

  const handleOpenDetailClick = (item: OperationItem) => {
    onSelectOpportunity({
      id: item.opportunity_id,
      stage: item.stage,
      priority: item.priority,
      country: item.country,
      language: item.language,
      phone_number: item.phone_number,
      patient_name: item.patient_name,
      requester_name: item.patient_name,
      display_name: item.patient_name,
      source: item.metadata.opp_source || 'form',
      intent_type: item.operation_type === 'appointment_request' ? 'appointment_request' : 'follow_up_needed',
      ai_summary: item.summary,
      ai_reason: item.ai_reason,
      notes: item.notes || [],
      created_at: item.metadata.opp_created_at || item.due_at_utc,
      updated_at: item.metadata.opp_updated_at || item.due_at_utc,
      conv_last_message_at: item.metadata.conv_last_message_at
    });
  };

  // ── REMARKETING DRAFT HANDLERS (PHASE 2P-P0A) ──

  const handleOpenRemarketingDraftClick = async (item: OperationItem) => {
    if (!item.opportunity_id) return;
    setRemarketingItem(item);
    setIsPreparingRemarketing(true);
    setSaveStatus('idle');
    setSaveErrorMessage("");
    try {
      const res = await prepareRemarketingDraft(item.opportunity_id);
      if (res.blocked) {
        alert(`Takip Taslağı Hazırlanamaz:\n\n${res.blockReason}`);
        setRemarketingItem(null);
        setIsPreparingRemarketing(false);
        return;
      }
      setRemarketingDraftData(res);
      setRemarketingText(res.draft || "");

      const templates = await getRemarketingTemplates();
      setRemarketingTemplates(templates);
      setSelectedTemplateId(res.templateId || "default");
    } catch (err: any) {
      console.error("[PREPARE_REMARKETING_ERROR]", err);
      alert(`Bir hata oluştu: ${err.message}`);
      setRemarketingItem(null);
    } finally {
      setIsPreparingRemarketing(false);
    }
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!remarketingDraftData) return;

    if (templateId === "default") {
      setRemarketingText(remarketingDraftData.draft || "");
      return;
    }

    const tpl = remarketingTemplates.find(t => t.id === templateId);
    if (!tpl) return;

    let body = tpl.body;
    const patientName = remarketingDraftData.patientName || "Hasta";
    const dept = remarketingDraftData.department || "bölüm";
    const tenantName = "Başkent Hastanesi";
    
    // Replace template vars
    body = body.replace(/\{\{\s*patient_name\s*\}\}/g, patientName);
    body = body.replace(/\{\{\s*department\s*\}\}/g, dept);
    body = body.replace(/\{\{\s*tenant_name\s*\}\}/g, tenantName);
    
    setRemarketingText(body);
  };

  const handleSaveRemarketingDraft = async () => {
    if (!remarketingItem?.opportunity_id) return;
    setSaveStatus('saving');
    try {
      const res = await saveRemarketingDraft(remarketingItem.opportunity_id, remarketingText);
      if (res.success) {
        setSaveStatus('saved');
        setTimeout(() => {
          setRemarketingItem(null);
          setRemarketingDraftData(null);
          setSaveStatus('idle');
          mutate();
        }, 1000);
      } else {
        setSaveStatus('error');
        setSaveErrorMessage(res.error || "Bilinmeyen bir hata oluştu.");
      }
    } catch (err: any) {
      setSaveStatus('error');
      setSaveErrorMessage(err.message || "Taslak kaydedilirken bir hata oluştu.");
    }
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(remarketingText);
    alert("Takip taslak metni panoya kopyalandı!");
  };

  return (
    <div className="space-y-4">
      
      {/* ── 1. METRIC CARDS (Apple/Linear-inspired minimal white cards) ── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 shrink-0">
          
          {/* Overdue */}
          <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Geciken</p>
              <h3 className="text-xl font-bold text-red-500 mt-0.5">{stats.overdue}</h3>
            </div>
          </div>

          {/* Today */}
          <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Bugün</p>
              <h3 className="text-xl font-bold text-orange-600 mt-0.5">{stats.dueToday}</h3>
            </div>
          </div>

          {/* Appointment Requests */}
          <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Randevu Talebi</p>
              <h3 className="text-xl font-bold text-emerald-600 mt-0.5">{stats.requests}</h3>
            </div>
          </div>

          {/* Timezone Teyit */}
          <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
              <Globe className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Saat Teyidi</p>
              <h3 className="text-xl font-bold text-amber-600 mt-0.5">{stats.ambiguousTimezones}</h3>
            </div>
          </div>

          {/* Medical pending */}
          <div className="bg-white rounded-2xl p-4 border border-black/5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] flex items-center gap-3 col-span-2 md:col-span-1">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Rapor/Doktor</p>
              <h3 className="text-xl font-bold text-purple-600 mt-0.5">{stats.medicalPending}</h3>
            </div>
          </div>

        </div>
      )}

      {/* ── 2. ADVANCED FILTERS BAR ── */}
      <div className="flex flex-col gap-3 bg-white/60 backdrop-blur-md rounded-2xl p-4 border border-white/60 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Search bar */}
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#86868B]" />
            <input 
              type="text" 
              placeholder="Hasta adı, telefon, departman..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5856D6]/40 transition-all"
            />
          </div>

          {/* Date range pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 shrink-0">
            {([
              { value: 'all', label: 'Tümü' },
              { value: 'overdue', label: '⚠️ Gecikmiş' },
              { value: 'today', label: 'Bugün' },
              { value: 'tomorrow', label: 'Yarın' },
              { value: 'week', label: 'Bu Hafta' },
            ] as const).map(pill => (
              <button
                key={pill.value}
                onClick={() => setDateRange(pill.value)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all shrink-0 cursor-pointer ${
                  dateRange === pill.value
                    ? 'bg-[#5856D6] text-white shadow-sm'
                    : 'bg-white/80 border border-black/5 text-[#86868B] hover:text-[#1D1D1F]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* High Priority toggle */}
          <button
            onClick={() => setPriorityFilter(priorityFilter === 'all' ? 'high' : 'all')}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all cursor-pointer shrink-0 ${
              priorityFilter === 'high'
                ? 'bg-red-500/10 border-red-500/20 text-red-500 font-bold'
                : 'bg-white/80 border border-black/5 text-[#86868B]'
            }`}
          >
            🔥 Yüksek Öncelik
          </button>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-3 border-t border-black/5 pt-3">
          
          {/* Country filter */}
          <div className="w-full md:w-auto flex items-center gap-2">
            <span className="text-[12px] font-semibold text-[#86868B] shrink-0">Ülke:</span>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="bg-white border border-black/5 px-3 py-1.5 rounded-lg text-sm text-[#1D1D1F] focus:ring-1 focus:ring-[#5856D6] outline-none"
            >
              <option value="all">Tümü (Hepsi)</option>
              {POPULAR_COUNTRIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Department filter */}
          <div className="w-full md:w-auto flex items-center gap-2">
            <span className="text-[12px] font-semibold text-[#86868B] shrink-0">Departman:</span>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="bg-white border border-black/5 px-3 py-1.5 rounded-lg text-sm text-[#1D1D1F] focus:ring-1 focus:ring-[#5856D6] outline-none"
            >
              <option value="all">Tümü (Hepsi)</option>
              {DEPARTMENTS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <span className="text-[11px] text-[#86868B] font-semibold ml-auto">{total} kayıt listeleniyor</span>
        </div>
      </div>

      {/* ── 3. LIST OF OPERATIONS (computed tasks) ── */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="bg-white/80 rounded-2xl p-12 border border-black/5 text-center flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-[#5856D6] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-semibold text-[#86868B]">Operasyonel veri derleniyor...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white/80 rounded-2xl p-16 border border-black/5 text-center">
            <ClipboardList className="w-12 h-12 text-[#C7C7CC] mx-auto mb-3" />
            <h3 className="text-base font-bold text-[#1D1D1F]">Operasyon Sırası Boş</h3>
            <p className="text-sm text-[#86868B] mt-1">Belirttiğiniz kriterlere uygun veya gecikmiş aktif görev bulunmuyor.</p>
          </div>
        ) : (
          items.map((item) => {
            const opCfg = OP_TYPE_CONFIG[item.operation_type] || OP_TYPE_CONFIG.call_due;
            const flag = item.country ? getCountryFlag(item.country) : null;
            const isOverdueItem = item.status === 'overdue';
            const isSleeping = isPatientSleeping(item.patient_timezone);

            return (
              <div 
                key={item.id}
                className={`bg-white/80 backdrop-blur-sm rounded-2xl border p-5 transition-all hover:shadow-md ${
                  isOverdueItem ? 'border-red-500/20 bg-red-500/[0.01]' : 'border-black/5'
                }`}
              >
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                  
                  {/* Left: Patient basic details */}
                  <div className="flex items-start gap-3 w-full lg:w-[30%]">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-[#5856D6]/10 text-[#5856D6] font-bold text-sm flex items-center justify-center shrink-0 uppercase">
                      {item.patient_name ? item.patient_name.substring(0, 2) : "IS"}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-[#1D1D1F] text-[15px] truncate flex items-center gap-1.5">
                        {item.patient_name}
                        {item.priority === 'hot' && <span className="text-xs shrink-0">🔥</span>}
                      </h4>
                      <p className="text-[#86868B] text-[12px] font-medium mt-0.5 truncate">
                        {item.phone_number}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {item.country && (
                          <span className="inline-flex items-center gap-1 bg-[#F5F5F7] px-2 py-0.5 rounded-md text-[11px] font-semibold text-[#1D1D1F]">
                            <span>{flag}</span>
                            {item.country}
                          </span>
                        )}
                        <span className="bg-[#5856D6]/5 px-2 py-0.5 rounded-md text-[11px] font-bold text-[#5856D6] uppercase tracking-wide">
                          {item.department}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Middle: Task details & AI reasoning */}
                  <div className="w-full lg:w-[40%] space-y-2">
                    <div className="flex items-center gap-2">
                      <span 
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0"
                        style={{ backgroundColor: opCfg.bg, color: opCfg.color }}
                      >
                        {opCfg.icon} {opCfg.label}
                      </span>
                      <span className="text-[12px] font-bold text-[#1D1D1F] truncate">
                        {item.metadata.task_title || 'Hasta Takip Araması'}
                      </span>
                    </div>

                    {/* AI description or reason */}
                    {item.ai_reason && (
                      <div className="bg-[#5856D6]/5 border border-[#5856D6]/10 rounded-lg p-2 text-[12px] text-[#5856D6] leading-relaxed">
                        🤖 <strong>Gerekçe:</strong> {item.ai_reason}
                      </div>
                    )}

                    {/* Last message bubble */}
                    {item.last_message_preview && (
                      <div className="bg-[#F5F5F7] border border-black/5 rounded-lg p-2 text-[12px] text-[#1D1D1F] italic truncate max-w-full">
                        💬 Son mesaj: "{item.last_message_preview}"
                      </div>
                    )}
                  </div>

                  {/* Time Intelligence Clock display */}
                  <div className="w-full lg:w-[18%] flex flex-col justify-center gap-1.5 bg-[#F5F5F7] p-3 rounded-xl border border-black/5 shrink-0">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-[#86868B]">
                      <span>🇹🇷 Türkiye:</span>
                      <span className="text-[#1D1D1F] font-bold">{item.due_at_turkey}</span>
                    </div>

                    {item.due_at_patient_local ? (
                      <div className="flex items-center justify-between text-[11px] font-semibold text-[#86868B] border-t border-black/5 pt-1.5">
                        <span>🌎 Hasta ({item.country ? item.country.substring(0, 3).toUpperCase() : 'LOC'}):</span>
                        <span className="text-[#1D1D1F] font-bold">{item.due_at_patient_local}</span>
                      </div>
                    ) : (
                      <div className="text-[11px] font-semibold text-[#86868B] border-t border-black/5 pt-1.5 flex items-center justify-between">
                        <span>🌎 Hasta:</span>
                        <span className="text-[#34C759] font-bold">Aynı Saat Dilimi</span>
                      </div>
                    )}

                    {/* Sleeping patient warnings */}
                    {isSleeping && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-md">
                        <Moon className="w-3 h-3 text-amber-500 animate-pulse" />
                        Hasta uyku saatinde (🌙)
                      </div>
                    )}

                    {/* Ambiguous country timezone warn */}
                    {item.timezone_needs_confirmation && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-[#B8860B] bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                        Saat Dilimi Teyidi Gerekiyor
                      </div>
                    )}
                  </div>

                  {/* Right: Quick actions menu */}
                  <div className="w-full lg:w-[12%] flex flex-row lg:flex-col items-center justify-end gap-2 shrink-0">
                    
                    {/* Primary chat route */}
                    <button
                      onClick={() => handleGoToInboxClick(item)}
                      className="flex-1 lg:w-full flex items-center justify-center gap-1.5 py-2 bg-[#5856D6] hover:bg-[#4A48C4] text-white rounded-xl text-[12px] font-bold shadow-sm transition-colors cursor-pointer"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      Mesaja Git
                    </button>

                    {/* Options/Dropdown Actions Trigger */}
                    <div className="relative group flex-1 lg:w-full">
                      <button className="w-full inline-flex items-center justify-center gap-1 py-2 bg-white border border-black/5 hover:bg-[#F5F5F7] text-[#1D1D1F] rounded-xl text-[12px] font-bold transition-all cursor-pointer">
                        <Phone className="w-3.5 h-3.5 text-[#34C759]" />
                        Arandı...
                        <ChevronDown className="w-3 h-3 text-[#86868B]" />
                      </button>

                      {/* Dropdown Actions */}
                      <div className="absolute right-0 bottom-full lg:bottom-auto lg:top-full mt-1 w-52 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-40 hidden group-hover:block hover:block">
                        
                        {/* Called Reached */}
                        <button
                          onClick={() => { setActionItem(item); setActionType('reached'); }}
                          className="w-full text-left px-3 py-2 text-[12px] font-semibold text-[#1D1D1F] hover:bg-black/5 flex items-center gap-2 cursor-pointer"
                        >
                          <Check className="w-4 h-4 text-emerald-500" />
                          Arandı / Ulaşıldı
                        </button>

                        {/* Called Missed */}
                        <button
                          onClick={() => { setActionItem(item); setActionType('missed'); }}
                          className="w-full text-left px-3 py-2 text-[12px] font-semibold text-[#1D1D1F] hover:bg-black/5 flex items-center gap-2 cursor-pointer"
                        >
                          <XCircle className="w-4 h-4 text-red-500" />
                          Arandı / Ulaşılamadı
                        </button>

                        {/* Callback Scheduled */}
                        <button
                          onClick={() => { setActionItem(item); setActionType('callback'); }}
                          className="w-full text-left px-3 py-2 text-[12px] font-semibold text-[#1D1D1F] hover:bg-black/5 flex items-center gap-2 cursor-pointer"
                        >
                          <Clock className="w-4 h-4 text-[#5856D6]" />
                          Geri Aranacak
                        </button>

                        {/* Direct Reschedule */}
                        <button
                          onClick={() => { setActionItem(item); setActionType('reschedule'); }}
                          className="w-full text-left px-3 py-2 text-[12px] font-semibold text-[#1D1D1F] hover:bg-black/5 flex items-center gap-2 cursor-pointer"
                        >
                          <Calendar className="w-4 h-4 text-orange-500" />
                          Görevi Ertele
                        </button>

                        {/* Complete Task */}
                        <button
                          onClick={async () => {
                            if (confirm("Bu görevi tamamlamak istediğinize emin misiniz?")) {
                              await completeTask(item.id, "Gözlemci tarafından doğrudan tamamlandı.");
                              mutate();
                              mutateStats();
                            }
                          }}
                          className="w-full text-left px-3 py-2 text-[12px] font-semibold text-[#1D1D1F] hover:bg-black/5 flex items-center gap-2 cursor-pointer border-t border-black/5"
                        >
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          Görevi Tamamla
                        </button>

                        {/* Takipte Aç (Opportunities side panel detail) */}
                        {item.opportunity_id && (
                          <button
                            onClick={() => handleOpenDetailClick(item)}
                            className="w-full text-left px-3 py-2 text-[12px] font-semibold text-[#1D1D1F] hover:bg-black/5 flex items-center gap-2 cursor-pointer border-t border-black/5"
                          >
                            <ExternalLink className="w-4 h-4 text-blue-500" />
                            Takipte Aç (Detay)
                          </button>
                        )}

                        {/* Takip Taslağı Hazırla (PHASE 2P-P0A) */}
                        {item.opportunity_id && (
                          <button
                            onClick={() => handleOpenRemarketingDraftClick(item)}
                            className="w-full text-left px-3 py-2 text-[12px] font-semibold text-[#1D1D1F] hover:bg-black/5 flex items-center gap-2 cursor-pointer border-t border-black/5"
                          >
                            <FileText className="w-4 h-4 text-[#5856D6]" />
                            Takip Taslağı Hazırla
                          </button>
                        )}

                        {/* Ambiguous prompt tz confirmation ask */}
                        {item.timezone_needs_confirmation && item.lead_id && (
                          <button
                            onClick={async () => {
                              if (confirm("Hastaya saat dilimi/şehir teyidi almak için bota sinyal gönderilsin mi?")) {
                                await activateBot(item.lead_id!);
                                alert("Bot devreye alındı. İlk mesajında şehir bilgisi alacaktır.");
                                mutate();
                              }
                            }}
                            className="w-full text-left px-3 py-2 text-[12px] font-semibold text-[#B8860B] hover:bg-amber-500/5 flex items-center gap-2 cursor-pointer border-t border-black/5"
                          >
                            <Globe className="w-4 h-4 text-amber-500" />
                            Saat Dilimi Sorulacak
                          </button>
                        )}

                        {/* Bot Handoff bot activate */}
                        {item.lead_id && (
                          <button
                            onClick={async () => {
                              if (confirm("Görüşmeyi bota devretmek istediğinize emin misiniz?")) {
                                await activateBot(item.lead_id!);
                                mutate();
                              }
                            }}
                            className="w-full text-left px-3 py-2 text-[12px] font-semibold text-sky-600 hover:bg-sky-50 flex items-center gap-2 cursor-pointer border-t border-black/5"
                          >
                            🤖 Bota Devret
                          </button>
                        )}

                        {/* Not Interested (Lost stage) */}
                        <button
                          onClick={() => { setActionItem(item); setActionType('not_interested'); }}
                          className="w-full text-left px-3 py-2 text-[12px] font-semibold text-red-500 hover:bg-red-50 flex items-center gap-2 cursor-pointer border-t border-black/5"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                          İlgilenmiyor (Kayıp)
                        </button>

                      </div>
                    </div>

                  </div>

                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── 4. QUICK ACTION DETAILED FORM MODAL ── */}
      {actionItem && actionType && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => { setActionItem(null); setActionType(null); }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="w-full max-w-[450px] bg-white rounded-3xl shadow-[0_20px_40px_rgba(0,0,0,0.2)] flex flex-col pointer-events-auto border border-black/5 overflow-hidden">
              
              {/* Header */}
              <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
                <h3 className="font-bold text-[#1D1D1F] text-base flex items-center gap-2">
                  {actionType === 'reached' && <Check className="w-5 h-5 text-emerald-500" />}
                  {actionType === 'missed' && <XCircle className="w-5 h-5 text-red-500" />}
                  {actionType === 'callback' && <Clock className="w-5 h-5 text-[#5856D6]" />}
                  {actionType === 'reschedule' && <Calendar className="w-5 h-5 text-orange-500" />}
                  {actionType === 'not_interested' && <ShieldAlert className="w-5 h-5 text-red-500" />}
                  
                  {actionType === 'reached' && "Arandı / Ulaşıldı"}
                  {actionType === 'missed' && "Arandı / Ulaşılamadı"}
                  {actionType === 'callback' && "Geri Aranacak Planı"}
                  {actionType === 'reschedule' && "Görevi Ertele"}
                  {actionType === 'not_interested' && "İlgilenmiyor (Fırsatı Kapat)"}
                </h3>
                <button
                  onClick={() => { setActionItem(null); setActionType(null); }}
                  className="w-6 h-6 rounded-full bg-black/5 flex items-center justify-center font-bold hover:bg-black/10 transition-colors"
                >
                  ×
                </button>
              </div>

              {/* Form Content */}
              <div className="p-5 space-y-4">
                <p className="text-[12px] font-semibold text-[#86868B]">
                  Hasta: <span className="text-[#1D1D1F]">{actionItem.patient_name}</span> ({actionItem.phone_number})
                </p>

                {/* Reschedule/Postpone select boxes */}
                {(actionType === 'missed' || actionType === 'callback' || actionType === 'reschedule') && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider">Erteleme Süresi</label>
                    <select
                      value={rescheduleHours}
                      onChange={(e) => setRescheduleHours(e.target.value)}
                      className="w-full bg-[#F5F5F7] border border-black/5 px-3 py-2 rounded-xl text-sm outline-none focus:ring-1 focus:ring-[#5856D6]"
                    >
                      <option value="1">1 Saat Sonra</option>
                      <option value="2">2 Saat Sonra</option>
                      <option value="4">4 Saat Sonra</option>
                      <option value="24">Yarın (24 Saat)</option>
                      <option value="48">2 Gün Sonra</option>
                      <option value="168">1 Hafta Sonra</option>
                    </select>
                  </div>
                )}

                {/* Action Note text input */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider">
                    {actionType === 'not_interested' ? "Kayıp Nedeni / Detay" : "Açıklama / Not Ekle"}
                  </label>
                  <textarea
                    rows={3}
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder={
                      actionType === 'not_interested' 
                        ? "Hasta neden ilgilenmiyor? (Örn: Bütçesi yetersiz, başka hastane seçti)" 
                        : "Arama hakkında notunuzu girin..."
                    }
                    className="w-full px-3 py-2 bg-[#F5F5F7] border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#5856D6]/40 resize-none"
                  />
                </div>

                {actionType === 'not_interested' && (
                  <div className="bg-red-500/5 rounded-xl p-3 border border-red-500/10 flex items-start gap-2">
                    <ShieldAlert className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] font-semibold text-red-500 leading-normal">
                      <strong>⚠️ Kritik Uyarı:</strong> Bu işlem onaylandığında, hastanın fırsatı kalıcı olarak <strong>Lost (Kayıp)</strong> durumuna geçecek ve bu hastaya ait bekleyen tüm operasyonel arama görevleri <strong>iptal (cancelled)</strong> edilecektir.
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3.5 bg-[#F5F5F7] border-t border-black/5 flex items-center justify-end gap-2 shrink-0">
                <button
                  disabled={isSubmitting}
                  onClick={() => { setActionItem(null); setActionType(null); }}
                  className="px-4 py-2 bg-white border border-black/5 hover:bg-black/5 text-[#1D1D1F] rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                >
                  Vazgeç
                </button>
                <button
                  disabled={isSubmitting || (actionType === 'not_interested' && !actionNote.trim())}
                  onClick={executeAction}
                  className={`px-4 py-2 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 ${
                    actionType === 'not_interested' 
                      ? 'bg-red-500 hover:bg-red-600 disabled:opacity-40' 
                      : 'bg-[#5856D6] hover:bg-[#4A48C4]'
                  }`}
                >
                  {isSubmitting && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Aksiyonu Tamamla
                </button>
              </div>

            </div>
          </div>
        </>
      )}

      {/* ── 5. REMARKETING DRAFT DETAILED MODAL (PHASE 2P-P0A) ── */}
      {remarketingItem && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" onClick={() => { if (!isPreparingRemarketing && saveStatus !== 'saving') { setRemarketingItem(null); setRemarketingDraftData(null); } }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="w-full max-w-[500px] bg-white rounded-3xl shadow-[0_20px_40px_rgba(0,0,0,0.2)] flex flex-col pointer-events-auto border border-black/5 overflow-hidden">
              
              {/* Header */}
              <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
                <h3 className="font-bold text-[#1D1D1F] text-base flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#5856D6]" />
                  Takip / Remarketing Taslağı Hazırla
                </h3>
                <button
                  disabled={isPreparingRemarketing || saveStatus === 'saving'}
                  onClick={() => { setRemarketingItem(null); setRemarketingDraftData(null); }}
                  className="w-6 h-6 rounded-full bg-black/5 flex items-center justify-center font-bold hover:bg-black/10 transition-colors disabled:opacity-40"
                >
                  ×
                </button>
              </div>

              {/* Loader */}
              {isPreparingRemarketing ? (
                <div className="p-12 text-center flex flex-col items-center gap-3">
                  <div className="w-6 h-6 border-2 border-[#5856D6] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-semibold text-[#86868B]">Hastaya özel takip taslağı oluşturuluyor...</p>
                </div>
              ) : remarketingDraftData ? (
                <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                  
                  {/* Patient Info */}
                  <div className="bg-[#F5F5F7] p-3 rounded-xl border border-black/5 text-[12px] space-y-1">
                    <p className="font-semibold text-[#1D1D1F]">
                      Hasta: <span className="font-bold">{remarketingDraftData.patientName}</span>
                    </p>
                    <p className="text-[#86868B]">
                      Telefon: <span className="font-medium">{remarketingDraftData.phone}</span>
                    </p>
                    {remarketingDraftData.department && (
                      <p className="text-[#86868B]">
                        Bölüm: <span className="font-medium">{remarketingDraftData.department}</span>
                      </p>
                    )}
                  </div>

                  {/* Cooldown/Dedupe Warning */}
                  {remarketingDraftData.hasRecentDraftWarning && (
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] font-bold text-amber-600 leading-normal">
                        ⚠️ Dikkat: Son 24 saat içinde bu hasta için başka bir takip taslağı oluşturulmuş veya mesaj gönderilmiştir.
                      </p>
                    </div>
                  )}

                  {/* Safety & Channel State Widgets */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* 24h Window status */}
                    <div className={`p-3 rounded-xl border text-center flex flex-col items-center justify-center ${
                      remarketingDraftData.canSendFreeform
                        ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-600'
                        : 'bg-orange-500/5 border-orange-500/10 text-orange-600'
                    }`}>
                      <span className="text-[10px] font-bold uppercase tracking-wider">Müşteri Penceresi</span>
                      <span className="text-[11px] font-bold mt-1">
                        {remarketingDraftData.canSendFreeform ? "🟢 Serbest Yazışma Açık" : "🟠 24 Saat Kapalı (Template Gerekir)"}
                      </span>
                    </div>

                    {/* Channel readiness */}
                    <div className={`p-3 rounded-xl border text-center flex flex-col items-center justify-center ${
                      remarketingDraftData.channelReady
                        ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-600'
                        : 'bg-red-500/5 border-red-500/10 text-red-500'
                    }`}>
                      <span className="text-[10px] font-bold uppercase tracking-wider">WhatsApp Kanalı</span>
                      <span className="text-[11px] font-bold mt-1">
                        {remarketingDraftData.channelReady ? "🟢 Entegrasyon Aktif" : "🔴 Kanal Bağlantısı Eksik"}
                      </span>
                    </div>
                  </div>

                  {/* Template selector */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center justify-between">
                      <span>CRM Şablonu</span>
                      <span className="text-[10px] lowercase text-[#86868B] italic">gönderilecek WhatsApp approved template değildir</span>
                    </label>
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      className="w-full bg-[#F5F5F7] border border-black/5 px-3 py-2 rounded-xl text-xs font-semibold outline-none focus:ring-1 focus:ring-[#5856D6]"
                    >
                      <option value="default">Varsayılan Sistem Şablonu ({remarketingDraftData.templateName})</option>
                      {remarketingTemplates.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} [{t.language.toUpperCase()}]
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Rich Editable Textarea */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider">Taslak Mesaj Metni</label>
                    <textarea
                      rows={5}
                      value={remarketingText}
                      onChange={(e) => setRemarketingText(e.target.value)}
                      placeholder="Önerilen takip mesajını düzenleyin..."
                      className="w-full px-3 py-2.5 bg-[#F5F5F7] border border-black/5 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#5856D6]/40 resize-none font-medium text-[#1D1D1F] leading-relaxed"
                    />
                    <div className="text-right text-[10px] font-bold text-[#86868B]">
                      {remarketingText.length} / 4096 karakter
                    </div>
                  </div>

                  {/* Save Status / Errors */}
                  {saveStatus === 'saved' && (
                    <div className="p-2.5 bg-emerald-500/10 text-emerald-600 rounded-xl text-center text-xs font-bold border border-emerald-500/20">
                      ✓ Taslak başarıyla sisteme kaydedildi!
                    </div>
                  )}
                  {saveStatus === 'error' && (
                    <div className="p-2.5 bg-red-500/10 text-red-500 rounded-xl text-center text-xs font-semibold border border-red-500/20">
                      ⚠️ Hata: {saveErrorMessage}
                    </div>
                  )}

                </div>
              ) : (
                <div className="p-8 text-center text-sm font-semibold text-red-500">
                  Beklenmeyen veri yükleme hatası.
                </div>
              )}

              {/* Footer */}
              <div className="px-5 py-3.5 bg-[#F5F5F7] border-t border-black/5 flex items-center justify-between shrink-0">
                {/* Left: Copy actions */}
                {!isPreparingRemarketing && remarketingDraftData && (
                  <button
                    onClick={handleCopyToClipboard}
                    className="px-3.5 py-2 bg-white border border-black/5 hover:bg-black/5 text-[#1D1D1F] rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer inline-flex items-center gap-1.5"
                  >
                    Panoya Kopyala
                  </button>
                )}

                {/* Right: Save & Disabled send */}
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    disabled={isPreparingRemarketing || saveStatus === 'saving'}
                    onClick={() => { setRemarketingItem(null); setRemarketingDraftData(null); }}
                    className="px-3.5 py-2 bg-white border border-black/5 hover:bg-black/5 text-[#1D1D1F] rounded-xl text-xs font-bold transition-all disabled:opacity-40"
                  >
                    Vazgeç
                  </button>

                  {!isPreparingRemarketing && remarketingDraftData && (
                    <>
                      <button
                        disabled={saveStatus === 'saving' || !remarketingText.trim()}
                        onClick={handleSaveRemarketingDraft}
                        className="px-3.5 py-2 bg-[#5856D6] hover:bg-[#4A48C4] text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-40"
                      >
                        {saveStatus === 'saving' && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                        Taslağı Kaydet
                      </button>

                      <button
                        disabled={true}
                        title="Manuel gönderim P0B fazında açılacaktır."
                        className="px-3.5 py-2 bg-[#8E8E93] text-white rounded-xl text-xs font-bold cursor-not-allowed flex items-center gap-1.5 opacity-60"
                      >
                        🔒 WhatsApp Gönder
                      </button>
                    </>
                  )}
                </div>
              </div>

            </div>
          </div>
        </>
      )}

    </div>
  );
}
