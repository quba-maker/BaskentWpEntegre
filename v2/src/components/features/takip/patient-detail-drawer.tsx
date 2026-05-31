"use client";

import { useState, useEffect, useCallback } from "react";
import useSWR from "swr";
import {
  X, MessageCircle, Phone, Bot, Calendar, Clock, MapPin,
  ChevronDown, ChevronUp, Flame, Thermometer, Snowflake,
  Moon, AlertTriangle, FileText, StickyNote, Send,
  XCircle, Sparkles, User, Globe, Building2, Zap, Copy,
  CheckCircle2, ExternalLink
} from "lucide-react";
import { getPatientTrackingDetail, getPatientTimeline, createAppointmentTask, type PatientDetailData, type TimelineEntry } from "@/app/actions/patient-tracking";
import { addOpportunityNote, updateOpportunityStage } from "@/app/actions/pipeline";
import { createBotDelegationTask, schedulePhoneCallTask, completeBotDelegationTask, cancelBotDelegationTask, type BotDelegationMode } from "@/app/actions/focus-queue";
import { logCallReached, logCallMissed, logCallbackScheduled, logNotInterested } from "@/app/actions/outreach";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

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

const ACTION_ICONS: Record<string, string> = {
  'call_now': '🔴',
  'call_today': '🔵',
  'scheduled_followup': '📅',
  'continue_appointment_planning': '📅',
  'delegate_unreachable_followup_to_bot': '🤖',
  'request_report': '📋',
  'doctor_review_needed': '🩺',
  'prepare_followup_draft': '✍️',
  'no_action': '✅',
};

// ── Props ──

interface PatientDetailDrawerProps {
  opportunityId: string | null;
  onClose: () => void;
  onGoToInbox: (item: any) => void;
  onRefresh?: () => void;
}

export default function PatientDetailDrawer({ opportunityId, onClose, onGoToInbox, onRefresh }: PatientDetailDrawerProps) {
  const [noteText, setNoteText] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<'lost' | 'not_interested' | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['action', 'ai']));

  const { data, isLoading, mutate } = useSWR(
    opportunityId ? ['patient-detail', opportunityId] : null,
    () => getPatientTrackingDetail(opportunityId!),
    { revalidateOnFocus: false }
  );

  // Reset state on new opportunity
  useEffect(() => {
    setNoteText("");
    setConfirmDialog(null);
    setActionLoading(null);
    setActionSuccess(null);
  }, [opportunityId]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAddNote = async () => {
    if (!noteText.trim() || !opportunityId) return;
    setIsSavingNote(true);
    await addOpportunityNote(opportunityId, noteText.trim());
    setNoteText("");
    setIsSavingNote(false);
    mutate();
    onRefresh?.();
  };

  const handleStageChange = async (stage: string) => {
    if (!opportunityId) return;
    setActionLoading('stage');
    await updateOpportunityStage(opportunityId, stage);
    setActionLoading(null);
    mutate();
    onRefresh?.();
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog || !opportunityId) return;
    setActionLoading(confirmDialog);
    if (confirmDialog === 'lost') {
      await updateOpportunityStage(opportunityId, 'lost');
    } else {
      await logNotInterested(opportunityId);
    }
    setConfirmDialog(null);
    setActionLoading(null);
    setActionSuccess(confirmDialog === 'lost' ? 'Kayıp olarak işaretlendi.' : 'İlgilenmiyor olarak işaretlendi.');
    mutate();
    onRefresh?.();
  };

  const handleCallAction = async (action: 'reached' | 'missed' | 'callback') => {
    if (!opportunityId) return;
    setActionLoading(action);
    if (action === 'reached') await logCallReached(opportunityId);
    else if (action === 'missed') await logCallMissed(opportunityId);
    else if (action === 'callback') await logCallbackScheduled(opportunityId);
    setActionLoading(null);
    setActionSuccess('İşlem kaydedildi.');
    mutate();
    onRefresh?.();
  };

  const handleUnreachableAction = async () => {
    if (!opportunityId) return;
    setActionLoading('missed');
    try {
      await logCallMissed(opportunityId);
      setActionSuccess('Ulaşılamadı kaydedildi, otopilot devam ediyor.');
      mutate();
      onRefresh?.();
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReachedAction = async () => {
    if (!opportunityId) return;
    setActionLoading('reached');
    try {
      await logCallReached(opportunityId);
      setActionSuccess('Ulaşıldı olarak işaretlendi. Lütfen randevu planlayın.');
      mutate();
      onRefresh?.();
      setExpandedSections(prev => {
        const next = new Set(prev);
        next.add('appointment');
        return next;
      });
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCompleteBotTask = async (taskId: string) => {
    setActionLoading(taskId);
    try {
      const res = await completeBotDelegationTask(taskId);
      if (res.success) {
        setActionSuccess('Takip başarıyla tamamlandı.');
        mutate();
        onRefresh?.();
      } else {
        alert(res.error || 'İşlem başarısız.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelBotTask = async (taskId: string) => {
    const reason = prompt("Lütfen iptal sebebini belirtin:", "Koordinatör iptal etti");
    if (reason === null) return; // user cancelled prompt
    setActionLoading(taskId);
    try {
      const res = await cancelBotDelegationTask(taskId, reason);
      if (res.success) {
        setActionSuccess('Takip başarıyla iptal edildi.');
        mutate();
        onRefresh?.();
      } else {
        alert(res.error || 'İşlem başarısız.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  if (!opportunityId) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 md:bg-black/20" onClick={onClose} />
      
      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full md:w-[680px] lg:w-[720px] max-w-full bg-[#F5F5F7] shadow-[0_0_60px_rgba(0,0,0,0.15)] flex flex-col animate-in slide-in-from-right duration-200">
        
        {/* Header */}
        <div className="px-5 py-4 bg-white border-b border-black/5 flex items-start justify-between shrink-0">
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[#86868B]">Yükleniyor...</span>
            </div>
          ) : data ? (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-[#1D1D1F] truncate">{data.patientName}</h2>
                {data.isTestWhitelist && (
                  <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded text-[9px] font-bold uppercase">TEST</span>
                )}
              </div>
              
              {/* Sub-header text info */}
              <div className="flex items-center gap-3 mt-1.5 text-[12px] text-[#86868B] font-medium flex-wrap">
                <span className="text-[#1D1D1F] font-semibold">{formatPhoneReadable(data.phoneNumber)}</span>
                {data.source && <span>· Kaynak: {data.source}</span>}
                {data.department && <span>· Departman: {data.department}</span>}
              </div>

              {/* Notion-style Metadata Tags */}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {data.country && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-black/[0.04] text-[#1D1D1F]/80 rounded-md text-[10px] font-semibold">
                    <Globe className="w-3 h-3 text-[#86868B]" /> {getCountryFlag(data.country)} {data.country}
                  </span>
                )}
                {data.language && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-black/[0.04] text-[#1D1D1F]/80 rounded-md text-[10px] font-semibold">
                    🗣️ {data.language}
                  </span>
                )}
                {data.priority && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                    data.priority.toLowerCase() === 'hot'
                      ? 'bg-red-50 text-red-600 border border-red-100'
                      : 'bg-black/[0.04] text-[#1D1D1F]/80'
                  }`}>
                    🔥 {data.priority}
                  </span>
                )}
                {data.intentType && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-black/[0.04] text-[#1D1D1F]/80 rounded-md text-[10px] font-semibold">
                    🎯 {data.intentType}
                  </span>
                )}
              </div>

              {/* Quick links & Stage Selector (Linear style) */}
              <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-black/5 flex-wrap">
                <StageSelector currentStage={data.stage || 'new_lead'} onStageChange={handleStageChange} />
                <span className="text-black/10">|</span>
                <button
                  onClick={() => onGoToInbox({ phone_number: data.phoneNumber, display_name: data.patientName, source: data.source })}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1"
                >
                  💬 Mesaja Git
                </button>
                {data.leadRawData && Object.keys(data.leadRawData).length > 0 && (
                  <button
                    onClick={() => toggleSection('form')}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1"
                  >
                    📋 Formu Gör
                  </button>
                )}
                <button
                  onClick={() => toggleSection('appointment')}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1"
                >
                  📅 Randevu/Görev Planla
                </button>
              </div>
            </div>
          ) : null}
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors ml-3 shrink-0">
            <X className="w-5 h-5 text-[#1D1D1F]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {data && (
            <>
              {/* 1. Next Best Action Banner */}
              <DrawerSection title="Sıradaki Aksiyon" sectionKey="action" expanded={expandedSections} onToggle={toggleSection}>
                <div className="flex flex-col gap-3 p-4 bg-white rounded-xl border border-black/5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{ACTION_ICONS[data.nextBestAction] || '❓'}</span>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-[#1D1D1F]">{data.actionLabel}</p>
                      <p className="text-xs text-[#86868B] mt-0.5">Durum: {data.journeyStatus}</p>
                    </div>
                    {/* Quick action buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => onGoToInbox({ phone_number: data.phoneNumber, display_name: data.patientName, source: data.source })}
                        className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-[12px] font-semibold hover:bg-indigo-700 transition-colors"
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> Mesaj
                      </button>
                    </div>
                  </div>
                  {data.aiReason && (
                    <div className="text-[11px] font-medium text-indigo-600 bg-indigo-50/50 p-2.5 rounded border border-indigo-100/80 leading-relaxed">
                      🎯 <strong>Gerekçe:</strong> {data.aiReason}
                    </div>
                  )}
                </div>

                {/* Call Actions */}
                <div className="flex flex-col gap-2 mt-3">
                  <div className="flex gap-3">
                    <button
                      onClick={handleReachedAction}
                      disabled={!!actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 hover:shadow-md disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Ulaşıldı (Randevu Planla)
                    </button>
                    <button
                      onClick={handleUnreachableAction}
                      disabled={!!actionLoading}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 hover:shadow-md disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" /> Ulaşılamadı (Bot Takip Devam)
                    </button>
                  </div>
                  
                  {/* Secondary/Admin Actions */}
                  <div className="flex gap-4 mt-2.5 pt-2 border-t border-black/5 justify-between flex-wrap">
                    <button
                      onClick={() => handleCallAction('callback')}
                      disabled={!!actionLoading}
                      className="text-[10px] font-bold text-[#86868B] hover:text-indigo-600 transition-colors flex items-center gap-1"
                    >
                      📅 Geri Arama Planla
                    </button>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setConfirmDialog('lost')}
                        disabled={!!actionLoading}
                        className="text-[10px] font-bold text-red-500 hover:text-red-600 transition-colors flex items-center gap-1"
                      >
                        ❌ Fırsatı Kaybet
                      </button>
                      <button
                        onClick={() => setConfirmDialog('not_interested')}
                        disabled={!!actionLoading}
                        className="text-[10px] font-bold text-[#86868B] hover:text-red-500 transition-colors flex items-center gap-1"
                      >
                        🚫 İlgilenmiyor
                      </button>
                    </div>
                  </div>
                </div>

                {actionSuccess && (
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-[11px] font-semibold text-green-700">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {actionSuccess}
                  </div>
                )}
              </DrawerSection>

              {/* 1.5. Appointment Form */}
              <DrawerSection title="Randevu / Görev Planla" sectionKey="appointment" expanded={expandedSections} onToggle={toggleSection}>
                <AppointmentForm opportunityId={opportunityId!} onComplete={() => { mutate(); onRefresh?.(); }} />
              </DrawerSection>



              {/* 3. Time Intelligence */}
              <DrawerSection title="Zaman & Lokasyon" sectionKey="time" expanded={expandedSections} onToggle={toggleSection}>
                <div className="p-4 bg-white rounded-xl border border-black/5 shadow-sm space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#1D1D1F]">
                      <Clock className="w-3.5 h-3.5 text-[#86868B]" /> 🇹🇷 {data.turkeyTimeNow}
                    </div>
                    {data.patientLocalTimeNow && (
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#1D1D1F]">
                        🌍 {data.patientLocalTimeNow} <span className="text-[10px] text-[#86868B]">({data.patientTimezone})</span>
                      </div>
                    )}
                  </div>
                  {data.isPatientSleeping && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] font-semibold text-amber-700">
                      <Moon className="w-3.5 h-3.5" /> Hasta saatinde gece — arama uygun değil
                    </div>
                  )}
                  {data.timezoneNeedsConfirmation && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] font-semibold text-amber-700">
                      <AlertTriangle className="w-3.5 h-3.5" /> Hasta yerel saati teyitsiz. Aramadan önce saat teyidi önerilir.
                    </div>
                  )}
                  {data.nextFollowUpTurkey && (
                    <div className="flex items-center gap-2 mt-1 text-[12px]">
                      <span className="font-semibold text-[#1D1D1F]">Sonraki takip:</span>
                      <span className="font-bold text-indigo-600">{data.nextFollowUpTurkey}</span>
                      {data.nextFollowUpPatientLocal && <span className="text-[#86868B]">({data.nextFollowUpPatientLocal})</span>}
                    </div>
                  )}
                </div>
              </DrawerSection>

              {/* 4. AI Summary */}
              <DrawerSection title="AI Özeti" sectionKey="ai" expanded={expandedSections} onToggle={toggleSection}>
                <div className="p-4 bg-white rounded-xl border border-black/5 shadow-sm space-y-3">
                  {data.summary ? (
                    <p className="text-[13px] text-[#1D1D1F] leading-relaxed">{data.summary}</p>
                  ) : (
                    <p className="text-[12px] text-[#86868B] italic">Henüz AI özeti oluşmamış.</p>
                  )}
                  {data.aiReason && (
                    <div className="px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg">
                      <p className="text-[11px] font-semibold text-indigo-600">🎯 Neden fırsat: {data.aiReason}</p>
                    </div>
                  )}
                </div>
              </DrawerSection>

              {/* 5. Form Data */}
              {data.leadRawData && Object.keys(data.leadRawData).length > 0 && (
                <DrawerSection title="Form Bilgileri" sectionKey="form" expanded={expandedSections} onToggle={toggleSection}>
                  <FormDataDisplay rawData={data.leadRawData} formName={data.leadFormName} />
                </DrawerSection>
              )}

              {/* 6. Tasks / Appointments */}
              {data.tasks.filter(t => t.taskType !== 'appointment_reminder').length > 0 && (
                <DrawerSection 
                  title={`Aktif Görevler (${data.tasks.filter(t => t.taskType !== 'appointment_reminder').length})`} 
                  sectionKey="tasks" 
                  expanded={expandedSections} 
                  onToggle={toggleSection}
                >
                  <div className="space-y-2">
                    {data.tasks.filter(t => t.taskType !== 'appointment_reminder').map(task => (
                      <div key={task.id} className="p-3 bg-white rounded-xl border border-black/5 shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] font-bold text-[#1D1D1F]">{task.title}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            task.status === 'pending' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
                          }`}>
                            {task.status === 'pending' ? 'Bekliyor' : task.status}
                          </span>
                        </div>
                        {task.description && <p className="text-[11px] text-[#86868B] mt-1">{task.description}</p>}
                        {task.dueAt && (
                          <p className="text-[10px] text-[#86868B] mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(task.dueAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </DrawerSection>
              )}

              {/* 6.5. Reminder Tasks list */}
              {data.tasks.filter(t => t.taskType === 'appointment_reminder').length > 0 && (
                <DrawerSection 
                  title={`Planlanmış Hatırlatıcılar (${data.tasks.filter(t => t.taskType === 'appointment_reminder').length})`} 
                  sectionKey="reminders" 
                  expanded={expandedSections} 
                  onToggle={toggleSection}
                >
                  <div className="space-y-2">
                    {data.tasks.filter(t => t.taskType === 'appointment_reminder').map(task => {
                      const meta = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
                      const typeLabel = meta.reminder_type === '3_days_before' ? '3 Gün Önce teyit' : meta.reminder_type === '1_day_before' ? '1 Gün Önce teyit' : meta.reminder_type === 'same_day' ? 'Aynı Gün hatırlatma' : 'Özel Hatırlatma';
                      return (
                        <div key={task.id} className="p-3 bg-white rounded-xl border border-black/5 shadow-sm space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-bold text-[#1D1D1F] flex items-center gap-1.5">
                              ⏰ {typeLabel}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              task.status === 'pending' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
                            }`}>
                              {task.status === 'pending' ? 'Bekliyor' : task.status}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-[#86868B] font-medium">
                            <div>🇹🇷 TR: {meta.operation_due_at_tr || '—'}</div>
                            <div>🌍 Hasta Yerel: {meta.patient_local_time || '—'}</div>
                          </div>

                          {meta.generated_draft && (
                            <div className="mt-2 p-2 bg-[#F5F5F7] rounded-lg border border-black/5 flex flex-col gap-1.5">
                              <p className="text-[11px] text-[#1D1D1F] italic font-semibold">Hazır Taslak (Koordinatör İçin):</p>
                              <p className="text-[11px] text-[#1D1D1F] bg-white p-2 rounded border border-black/5 whitespace-pre-wrap">{meta.generated_draft}</p>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(meta.generated_draft);
                                  alert("Taslak kopyalandı!");
                                }}
                                className="self-end flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                              >
                                <Copy className="w-3 h-3" /> Kopyala
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </DrawerSection>
              )}

              {/* 7. Bot Delegation */}
              {(() => {
                const activeBotTasks = data.tasks.filter((t: any) => t.taskType === 'bot_handoff_followup' && (t.status === 'pending' || t.status === 'in_progress'));
                const hasBot = data.hasBotDelegation || activeBotTasks.length > 0;
                
                const modeLabels: Record<string, string> = {
                  unreachable_followup: 'Ulaşılamadı Takibi',
                  collect_phone_call_time: 'Uygun Saat İsteme',
                  confirm_phone_call: 'Telefon Randevu Teyidi',
                  clinic_appointment_reminder: 'Randevu Teyidi',
                  no_response_followup: 'Cevapsız Fırsat Takibi',
                  report_request: 'Rapor/Belge İsteme',
                  appointment_reschedule_request: 'Randevu Erteleme Takibi'
                };

                const warningLabels: Record<string, string> = {
                  missing_patient_name: 'Hasta Adı Eksik',
                  missing_timezone: 'Saat Dilimi Eksik',
                  missing_appointment_time: 'Randevu Zamanı Eksik',
                  missing_conversation: 'Geçmiş Konuşma Bulunamadı',
                  missing_summary: 'Fırsat Özeti Eksik'
                };

                if (!hasBot) return null;

                return (
                  <DrawerSection title="Bot Takip Modu" sectionKey="bot" expanded={expandedSections} onToggle={toggleSection}>
                    <div className="flex flex-col gap-3">
                      {activeBotTasks.length === 0 ? (
                        <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-xl">
                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4 text-cyan-600" />
                            <span className="text-[12px] font-bold text-cyan-700">Bot Aktif — {(data.botDelegationMode && modeLabels[data.botDelegationMode]) || data.botDelegationMode || 'Takip'}</span>
                          </div>
                          <p className="text-[11px] text-cyan-600 mt-1">Bot, hastaya otomatik takip mesajları göndermek üzere atanmış. (Metadata-only, P0 outbound yok)</p>
                        </div>
                      ) : (
                        activeBotTasks.map((task: any) => {
                          const botDel = task.metadata?.bot_delegation || {};
                          const isDraftReady = task.status === 'in_progress' && botDel.status === 'draft_ready';
                          
                          return (
                            <div key={task.id} className="p-4 bg-white border border-black/5 rounded-xl shadow-sm flex flex-col gap-2.5">
                              {/* Header */}
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-1.5">
                                  <Bot className="w-4 h-4 text-cyan-600 animate-pulse" />
                                  <span className="text-[12px] font-bold text-[#1D1D1F]">
                                    {modeLabels[botDel.mode] || botDel.mode}
                                  </span>
                                </div>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isDraftReady 
                                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' 
                                    : 'bg-amber-50 text-amber-600 border border-amber-200'
                                }`}>
                                  {isDraftReady ? 'Taslak Hazır' : 'Hazırlanıyor'}
                                </span>
                              </div>

                              {/* Source / Reason */}
                              <div className="text-[10px] text-[#86868B] flex flex-col gap-0.5">
                                <div>Kaynak: <span className="font-semibold text-[#1D1D1F]">{botDel.source || 'patient_tracking'}</span></div>
                                <div>Sebep: <span className="font-semibold text-[#1D1D1F]">{botDel.reason || 'manual_trigger'}</span></div>
                                {botDel.generated_draft_at && (
                                  <div>Taslak Zamanı: <span className="font-semibold text-[#1D1D1F]">{new Date(botDel.generated_draft_at).toLocaleString('tr-TR')}</span></div>
                                )}
                              </div>

                              {/* Context Warnings */}
                              {botDel.context_warnings && botDel.context_warnings.length > 0 && (
                                <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg flex flex-col gap-1">
                                  <div className="flex items-center gap-1 text-amber-700 text-[10px] font-bold">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                    <span>Bazı Bilgiler Eksik:</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {botDel.context_warnings.map((w: string) => (
                                      <span key={w} className="px-1.5 py-0.5 bg-white border border-amber-200 text-amber-700 text-[9px] rounded font-medium">
                                        {warningLabels[w] || w}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Generated Draft */}
                              {botDel.generated_draft && (
                                <div className="p-3 bg-[#F5F5F7] border border-black/5 rounded-lg flex flex-col gap-2">
                                  <p className="text-[10px] font-bold text-red-600 italic">
                                    Bu taslak sadece koordinatör içindir. Hastaya otomatik gönderilmez.
                                  </p>
                                  <div className="text-[11px] text-[#1D1D1F] bg-white p-2.5 rounded border border-black/5 whitespace-pre-wrap select-all font-mono leading-relaxed">
                                    {botDel.generated_draft}
                                  </div>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(botDel.generated_draft);
                                      alert("Taslak kopyalandı!");
                                    }}
                                    className="self-end flex items-center gap-1.5 px-3 py-1 bg-white hover:bg-black/5 text-[11px] font-bold text-indigo-600 rounded-lg border border-black/5 shadow-sm transition-colors"
                                  >
                                    <Copy className="w-3.5 h-3.5" /> Taslağı Kopyala
                                  </button>
                                </div>
                              )}

                              {/* Action Buttons */}
                              <div className="flex items-center justify-end gap-2 pt-1 border-t border-black/5">
                                <button
                                  onClick={() => handleCancelBotTask(task.id)}
                                  disabled={actionLoading === task.id}
                                  className="px-3 py-1.5 border border-red-200 hover:bg-red-50 text-red-600 disabled:opacity-40 text-[11px] font-bold rounded-lg transition-colors"
                                >
                                  {actionLoading === task.id ? '...' : 'İptal Et'}
                                </button>
                                <button
                                  onClick={() => handleCompleteBotTask(task.id)}
                                  disabled={actionLoading === task.id}
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 text-[11px] font-bold rounded-lg transition-colors"
                                >
                                  {actionLoading === task.id ? '...' : 'Tamamla'}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </DrawerSection>
                );
              })()}

              {/* 9. Quick Note */}
              <DrawerSection title="Hızlı Not" sectionKey="note" expanded={expandedSections} onToggle={toggleSection}>
                <div className="p-4 bg-white rounded-xl border border-black/5 shadow-sm">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Hızlı not yazın..."
                      className="flex-1 px-3 py-2 bg-[#F5F5F7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/40"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && noteText.trim()) handleAddNote();
                      }}
                    />
                    <button
                      onClick={handleAddNote}
                      disabled={!noteText.trim() || isSavingNote}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-indigo-700 transition-colors"
                    >
                      {isSavingNote ? '...' : 'Ekle'}
                    </button>
                  </div>
                  {/* Existing notes */}
                  {data.notes && data.notes.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {data.notes.slice(0, 5).map((note: any, idx: number) => (
                        <div key={idx} className="flex gap-2 text-[11px]">
                          <span className="text-[#86868B] shrink-0">
                            {note.created_at ? new Date(note.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' }) : '—'}
                          </span>
                          <span className="text-[#1D1D1F]">{note.text || note}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </DrawerSection>

              {/* 10. Timeline */}
              <DrawerSection title="Zaman Çizelgesi" sectionKey="timeline" expanded={expandedSections} onToggle={toggleSection}>
                <TimelineDisplay timeline={data.timeline} />
              </DrawerSection>

              {/* 11. Media placeholder */}
              <DrawerSection title="Medya / Belgeler" sectionKey="media" expanded={expandedSections} onToggle={toggleSection}>
                <div className="p-6 bg-white rounded-xl border border-black/5 shadow-sm text-center">
                  <FileText className="w-8 h-8 text-[#C7C7CC] mx-auto mb-2" />
                  <p className="text-[12px] text-[#86868B]">Henüz dosya veya medya yüklenmemiş.</p>
                </div>
              </DrawerSection>
            </>
          )}
        </div>

        {/* Confirm Dialog */}
        {confirmDialog && (
          <div className="absolute inset-0 bg-black/40 z-50 flex items-center justify-center p-6">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
              <h3 className="text-lg font-bold text-[#1D1D1F] mb-2">
                {confirmDialog === 'lost' ? 'Kayıp Olarak İşaretle' : 'İlgilenmiyor Olarak İşaretle'}
              </h3>
              <p className="text-[13px] text-[#86868B] mb-4">
                {confirmDialog === 'lost' 
                  ? 'Bu fırsat "Kayıp" olarak işaretlenecek ve takip listesinden kaldırılacak.' 
                  : 'Bu hasta "İlgilenmiyor" olarak işaretlenecek.'
                }
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="flex-1 px-4 py-2 bg-[#F5F5F7] text-[#1D1D1F] rounded-lg text-sm font-semibold hover:bg-black/10 transition-colors"
                >
                  İptal
                </button>
                <button
                  onClick={handleConfirmAction}
                  disabled={!!actionLoading}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? '...' : 'Onayla'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Sub-components ──

function DrawerSection({ title, sectionKey, expanded, onToggle, children }: {
  title: string;
  sectionKey: string;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  children: React.ReactNode;
}) {
  const isExpanded = expanded.has(sectionKey);
  return (
    <div>
      <button 
        onClick={() => onToggle(sectionKey)}
        className="w-full flex items-center justify-between px-1 py-1.5 text-[12px] font-bold text-[#86868B] uppercase tracking-wider hover:text-[#1D1D1F] transition-colors"
      >
        {title}
        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {isExpanded && <div className="mt-1">{children}</div>}
    </div>
  );
}

function InfoField({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider flex items-center gap-1 mb-0.5">
        {icon} {label}
      </p>
      <p className="text-[13px] font-medium text-[#1D1D1F]">{value}</p>
    </div>
  );
}

function StageSelector({ currentStage, onStageChange }: { currentStage: string; onStageChange: (stage: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const stageInfo = getStageInfo(currentStage);

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border transition-all hover:shadow-sm"
        style={{ backgroundColor: `${stageInfo.color}12`, borderColor: `${stageInfo.color}25`, color: stageInfo.color }}
      >
        <span>{stageInfo.icon}</span>
        {stageInfo.label}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-52 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 max-h-[300px] overflow-y-auto">
          {STAGES.map(s => (
            <button
              key={s.value}
              onClick={() => { onStageChange(s.value); setIsOpen(false); }}
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

function FormDataDisplay({ rawData, formName }: { rawData: Record<string, any>; formName?: string }) {
  const HIDE_KEYS = new Set(['_all_phones', 'id', 'page_id', 'form_id', 'ad_id', 'adgroup_id', 'campaign_id', 'leadgen_id', 'platform', 'is_organic', 'retailer_item_id']);
  
  const entries = Object.entries(rawData).filter(([key, value]) => {
    if (HIDE_KEYS.has(key)) return false;
    if (value === null || value === undefined || value === '') return false;
    if (typeof value === 'string' && value.length > 200) return false;
    return true;
  });

  if (entries.length === 0) return null;

  return (
    <div className="p-4 bg-white rounded-xl border border-black/5 shadow-sm">
      {formName && (
        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-2">📋 {formName}</p>
      )}
      <div className="space-y-1.5">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start gap-2">
            <span className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider min-w-[100px] shrink-0 pt-0.5">
              {key.replace(/_/g, ' ')}
            </span>
            <span className="text-[12px] text-[#1D1D1F] font-medium break-words">
              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineDisplay({ timeline }: { timeline: TimelineEntry[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? timeline : timeline.slice(0, 3);

  if (timeline.length === 0) {
    return (
      <div className="p-4 bg-white rounded-xl border border-black/5 shadow-sm text-center">
        <p className="text-[12px] text-[#86868B]">Henüz zaman çizelgesi olayı yok.</p>
      </div>
    );
  }

  const TYPE_ICONS: Record<string, string> = {
    'outreach': '📤',
    'task': '📋',
    'note': '📝',
    'stage_change': '🔄',
    'bot_delegation': '🤖',
  };

  return (
    <div className="bg-white rounded-xl border border-black/5 shadow-sm overflow-hidden">
      <div className="divide-y divide-black/5">
        {displayed.map((entry) => (
          <div key={entry.id} className="px-4 py-2.5 flex items-start gap-3">
            <span className="text-sm mt-0.5">{TYPE_ICONS[entry.type] || '📌'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-[#1D1D1F]">{entry.label}</p>
              {entry.description && (
                <p className="text-[11px] text-[#86868B] mt-0.5 line-clamp-2">{entry.description}</p>
              )}
            </div>
            <span className="text-[10px] text-[#86868B] shrink-0">
              {new Date(entry.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}
            </span>
          </div>
        ))}
      </div>
      {timeline.length > 3 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full py-2 text-center text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 transition-colors border-t border-black/5"
        >
          Tümünü Göster ({timeline.length} olay)
        </button>
      )}
    </div>
  );
}

// ── Country flag helper ──

const getCountryFlag = (country?: string): string => {
  if (!country) return '🌍';
  const FLAGS: Record<string, string> = {
    'Türkiye': '🇹🇷', 'Turkey': '🇹🇷', 'Almanya': '🇩🇪', 'Germany': '🇩🇪',
    'Irak': '🇮🇶', 'Iraq': '🇮🇶', 'İngiltere': '🇬🇧', 'UK': '🇬🇧',
    'ABD': '🇺🇸', 'USA': '🇺🇸', 'Hollanda': '🇳🇱', 'Fransa': '🇫🇷',
    'Suudi Arabistan': '🇸🇦', 'BAE': '🇦🇪', 'Libya': '🇱🇾',
    'Rusya': '🇷🇺', 'Ukrayna': '🇺🇦', 'Azerbaycan': '🇦🇿',
  };
  return FLAGS[country] || '🌍';
};

function AppointmentForm({ opportunityId, onComplete }: { opportunityId: string; onComplete: () => void }) {
  const [type, setType] = useState<'phone_call' | 'clinic_visit' | 'pre_consultation' | 'doctor_review' | 'report_followup'>('phone_call');
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  // Reminder Planning Selection States (Phase 2U-P0)
  const [remind3Days, setRemind3Days] = useState(false);
  const [remind1Day, setRemind1Day] = useState(true);
  const [remindSameDay, setRemindSameDay] = useState(true);

  // Auto-select 3 days reminder for clinic visits to assist coordinator
  useEffect(() => {
    if (type === 'clinic_visit') {
      setRemind3Days(true);
    } else {
      setRemind3Days(false);
    }
  }, [type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time) return;
    setLoading(true);
    try {
      const localDateStr = `${date}T${time}:00`;
      const dateObj = new Date(localDateStr);

      const reminders: { type: '3_days_before' | '1_day_before' | 'same_day' }[] = [];
      if (remind3Days) reminders.push({ type: '3_days_before' });
      if (remind1Day) reminders.push({ type: '1_day_before' });
      if (remindSameDay) reminders.push({ type: 'same_day' });
      
      const res = await createAppointmentTask(opportunityId, dateObj.toISOString(), type, { 
        note, 
        requireConfirmation: type === 'clinic_visit',
        reminders
      });
      
      if (res.success) {
        setNote("");
        setDate("");
        setTime("");
        onComplete();
      } else {
        alert(res.error || "Hata oluştu");
      }
    } catch(err) {
      alert("Hata oluştu");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-white rounded-xl border border-black/5 shadow-sm space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-[#86868B] mb-1">Tür</label>
          <select value={type} onChange={e => setType(e.target.value as any)} className="w-full px-3 py-2 bg-[#F5F5F7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/40">
            <option value="phone_call">📞 Telefon Görüşmesi</option>
            <option value="clinic_visit">🏥 Klinik Randevusu</option>
            <option value="pre_consultation">Ön Görüşme</option>
            <option value="doctor_review">Doktor İncelemesi</option>
            <option value="report_followup">Rapor Takibi</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#86868B] mb-1">Not</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="İsteğe bağlı..." className="w-full px-3 py-2 bg-[#F5F5F7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/40" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#86868B] mb-1">Tarih</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full px-3 py-2 bg-[#F5F5F7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/40" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-[#86868B] mb-1">Saat (TR)</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} required className="w-full px-3 py-2 bg-[#F5F5F7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/40" />
        </div>
      </div>

      {/* Reminder Selection Checkboxes (Phase 2U-P0) */}
      <div className="pt-2 border-t border-black/5 space-y-2">
        <span className="block text-[11px] font-semibold text-[#86868B] mb-1">⏰ Planlı Hatırlatıcılar</span>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[12px] font-medium text-[#1D1D1F] cursor-pointer">
            <input 
              type="checkbox" 
              checked={remind3Days} 
              onChange={e => setRemind3Days(e.target.checked)} 
              className="w-3.5 h-3.5 rounded border-black/10 text-indigo-600 focus:ring-indigo-500/40 cursor-pointer"
            />
            <span>3 Gün Önce Teyit Arama Görevi Planla</span>
          </label>
          
          <label className="flex items-center gap-2 text-[12px] font-medium text-[#1D1D1F] cursor-pointer">
            <input 
              type="checkbox" 
              checked={remind1Day} 
              onChange={e => setRemind1Day(e.target.checked)} 
              className="w-3.5 h-3.5 rounded border-black/10 text-indigo-600 focus:ring-indigo-500/40 cursor-pointer"
            />
            <span>1 Gün Önce Teyit Arama Görevi Planla</span>
          </label>

          <label className="flex items-center gap-2 text-[12px] font-medium text-[#1D1D1F] cursor-pointer">
            <input 
              type="checkbox" 
              checked={remindSameDay} 
              onChange={e => setRemindSameDay(e.target.checked)} 
              className="w-3.5 h-3.5 rounded border-black/10 text-indigo-600 focus:ring-indigo-500/40 cursor-pointer"
            />
            <span>Aynı Gün Hatırlatma Arama Görevi Planla</span>
          </label>
        </div>
      </div>

      <button type="submit" disabled={loading || !date || !time} className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-indigo-700 transition-colors mt-2">
        {loading ? 'Oluşturuluyor...' : 'Planla'}
      </button>
    </form>
  );
}
