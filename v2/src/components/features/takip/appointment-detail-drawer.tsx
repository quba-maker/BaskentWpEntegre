"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import {
  X, MessageCircle, Phone, Calendar, Clock, AlertTriangle,
  ChevronDown, ChevronUp, CheckCircle2, User, Globe, Building2, Zap, Copy
} from "lucide-react";
import { getPatientTrackingDetail, type PatientDetailData } from "@/app/actions/patient-tracking";
import { updateAppointmentConfirmation, completeAppointmentTask } from "@/app/actions/patient-tracking";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

const getCountryFlag = (country?: string): string => {
  if (!country) return '🌍';
  const FLAGS: Record<string, string> = {
    'Türkiye': '🇹🇷', 'Turkey': '🇹🇷', 'Almanya': '🇩🇪', 'Germany': '🇩🇪',
    'Irak': '🇮🇶', 'Iraq': '🇮🇶', 'İngiltere': '🇬🇧', 'UK': '🇬🇧',
    'ABD': '🇺🇸', 'USA': '🇺🇸', 'Hollanda': '🇳🇱', 'Fransa': '🇫🇷',
    'Suudi Arabistan': '🇸🇦', 'BAE': '🇦🇪', 'Libya': '🇱🇾',
  };
  return FLAGS[country] || '🌍';
};

interface AppointmentDetailDrawerProps {
  opportunityId: string | null;
  taskId?: string | null; // Optional link to specific task
  onClose: () => void;
  onGoToInbox: (item: any) => void;
  onOpenPatientDetail: (opportunityId: string) => void;
  onRefresh?: () => void;
}

export default function AppointmentDetailDrawer({
  opportunityId,
  taskId,
  onClose,
  onGoToInbox,
  onOpenPatientDetail,
  onRefresh
}: AppointmentDetailDrawerProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['summary', 'actions', 'clocks']));

  const { data, isLoading, mutate } = useSWR(
    opportunityId ? ['patient-detail', opportunityId] : null,
    () => getPatientTrackingDetail(opportunityId!),
    { revalidateOnFocus: false }
  );

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleAction = async (action: string) => {
    if (!opportunityId) return;
    const targetTaskId = taskId || data?.tasks?.[0]?.id;
    if (!targetTaskId) {
      alert("Randevu görevi bulunamadı.");
      return;
    }

    setActionLoading(action);
    setActionSuccess(null);
    try {
      if (action === 'call_completed') await completeAppointmentTask(targetTaskId, 'completed');
      else if (action === 'call_missed') await completeAppointmentTask(targetTaskId, 'no_show');
      else if (action === 'confirm') await updateAppointmentConfirmation(targetTaskId, 'confirmed');
      else if (action === 'no_response') await updateAppointmentConfirmation(targetTaskId, 'no_response');
      else if (action === 'arrived') await completeAppointmentTask(targetTaskId, 'arrived');
      else if (action === 'no_show') await completeAppointmentTask(targetTaskId, 'no_show');
      else if (action === 'cancel') {
        if (confirm("Bu randevuyu iptal etmek istediğinize emin misiniz?")) {
          await completeAppointmentTask(targetTaskId, 'cancelled');
        } else {
          setActionLoading(null);
          return;
        }
      }
      setActionSuccess('Aksiyon başarıyla kaydedildi.');
      mutate();
      onRefresh?.();
    } catch (e) {
      console.error(e);
      alert("İşlem sırasında bir hata oluştu.");
    } finally {
      setActionLoading(null);
    }
  };

  if (!opportunityId) return null;

  // Filter tasks to get appointment relevant ones
  const activeTask = data?.tasks?.find(t => t.id === taskId) || data?.tasks?.[0];
  const meta = activeTask?.metadata ? (typeof activeTask.metadata === 'string' ? JSON.parse(activeTask.metadata) : activeTask.metadata) : {};

  // Group reminders
  const reminders = data?.tasks?.filter(t => t.taskType === 'appointment_reminder') || [];

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 md:bg-black/20" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full md:w-[600px] max-w-full bg-[#F5F5F7] shadow-[0_0_60px_rgba(0,0,0,0.15)] flex flex-col animate-in slide-in-from-right duration-200">
        
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
                {data.country && <span className="text-sm">{getCountryFlag(data.country)} {data.country}</span>}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[12px] text-[#86868B] font-medium">
                <span className="text-[#1D1D1F] font-semibold">{formatPhoneReadable(data.phoneNumber)}</span>
                <span>· {activeTask?.title || 'Randevu Takibi'}</span>
              </div>
              {/* Top Quick Links */}
              <div className="flex items-center gap-3 mt-2 pt-2 border-t border-black/5 flex-wrap">
                <button
                  onClick={() => onGoToInbox({ phone_number: data.phoneNumber, display_name: data.patientName, source: data.source })}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1"
                >
                  💬 Mesaja Git
                </button>
                <button
                  onClick={() => onOpenPatientDetail(opportunityId)}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1"
                >
                  👤 Hasta Detayını Aç
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
              {/* 1. Randevu Sonuç Aksiyonları */}
              {activeTask && activeTask.status !== 'completed' && activeTask.status !== 'cancelled' && (
                <DrawerSection title="Randevu Sonuç Aksiyonları" sectionKey="actions" expanded={expandedSections} onToggle={toggleSection}>
                  <div className="p-4 bg-white rounded-xl border border-black/5 shadow-sm space-y-3">
                    <p className="text-[11px] text-[#86868B] font-semibold uppercase tracking-wider">Aksiyon Kaydet</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleAction('confirm')}
                        disabled={!!actionLoading}
                        className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Teyit Edildi
                      </button>
                      <button
                        onClick={() => handleAction('call_missed')}
                        disabled={!!actionLoading}
                        className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Phone className="w-4 h-4" /> Ulaşılamadı
                      </button>
                      <button
                        onClick={() => handleAction('arrived')}
                        disabled={!!actionLoading}
                        className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all cursor-pointer disabled:opacity-50 col-span-2"
                      >
                        <Building2 className="w-4 h-4" /> Hasta Geldi / Klinik Girişi
                      </button>
                      <button
                        onClick={() => handleAction('no_show')}
                        disabled={!!actionLoading}
                        className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-4 h-4" /> Gelmedi
                      </button>
                      <button
                        onClick={() => handleAction('cancel')}
                        disabled={!!actionLoading}
                        className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-4 h-4" /> Randevu İptal
                      </button>
                    </div>
                    {actionSuccess && (
                      <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 text-green-700 text-[11px] font-semibold rounded-lg">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {actionSuccess}
                      </div>
                    )}
                  </div>
                </DrawerSection>
              )}

              {/* 2. Randevu Özeti */}
              <DrawerSection title="Randevu Bilgileri" sectionKey="summary" expanded={expandedSections} onToggle={toggleSection}>
                <div className="grid grid-cols-2 gap-3 p-4 bg-white rounded-xl border border-black/5 shadow-sm">
                  <InfoField icon={<Calendar className="w-3.5 h-3.5" />} label="Randevu Tarihi" value={activeTask?.dueAt ? new Date(activeTask.dueAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' }) : '—'} />
                  <InfoField icon={<Clock className="w-3.5 h-3.5" />} label="Randevu Saati (TR)" value={activeTask?.dueAt ? new Date(activeTask.dueAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) : '—'} />
                  <InfoField icon={<Building2 className="w-3.5 h-3.5" />} label="Tür / Detay" value={meta?.appointment_type === 'clinic_visit' ? '🏥 Klinik Randevusu' : '📞 Telefon Görüşmesi'} />
                  <InfoField icon={<Zap className="w-3.5 h-3.5" />} label="Teyit Durumu" value={meta?.confirmation_status === 'confirmed' ? '✅ Teyitli' : meta?.confirmation_status === 'no_response' ? ' Cevap Yok' : '⏳ Teyit Bekliyor'} />
                  {activeTask?.description && (
                    <div className="col-span-2 mt-2 pt-2 border-t border-black/5">
                      <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-1">Görüşme / Randevu Notu</p>
                      <p className="text-[12px] font-medium text-[#1D1D1F] leading-relaxed">{activeTask.description}</p>
                    </div>
                  )}
                </div>
              </DrawerSection>

              {/* 3. Saat & Lokasyon */}
              <DrawerSection title="Saat & Lokasyon" sectionKey="clocks" expanded={expandedSections} onToggle={toggleSection}>
                <div className="p-4 bg-white rounded-xl border border-black/5 shadow-sm space-y-2.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-0.5">Türkiye Saati (TR)</p>
                      <p className="text-[14px] font-bold text-[#1D1D1F]">{data.turkeyTimeNow}</p>
                    </div>
                    {data.patientLocalTimeNow && (
                      <div>
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-0.5">Hasta Lokal Saati</p>
                        <p className="text-[14px] font-bold text-indigo-600">{data.patientLocalTimeNow} <span className="text-[10px] text-[#86868B] font-medium">({data.patientTimezone})</span></p>
                      </div>
                    )}
                  </div>
                  {data.timezoneNeedsConfirmation && (
                    <div className="flex items-center gap-1.5 p-2 bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-semibold rounded-lg">
                      <AlertTriangle className="w-3.5 h-3.5" /> Hasta yerel saati teyitsiz. Aramadan önce teyit önerilir.
                    </div>
                  )}
                </div>
              </DrawerSection>

              {/* 4. Hatırlatıcılar & Hazır Taslaklar */}
              {reminders.length > 0 && (
                <DrawerSection title={`Teyit Hatırlatıcıları (${reminders.length})`} sectionKey="reminders" expanded={expandedSections} onToggle={toggleSection}>
                  <div className="space-y-2">
                    {reminders.map(task => {
                      const rMeta = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
                      const typeLabel = rMeta.reminder_type === '3_days_before' ? '3 Gün Önce teyit' : rMeta.reminder_type === '1_day_before' ? '1 Gün Önce teyit' : rMeta.reminder_type === 'same_day' ? 'Aynı Gün hatırlatma' : 'Özel Hatırlatma';
                      return (
                        <div key={task.id} className="p-3 bg-white rounded-xl border border-black/5 shadow-sm space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] font-bold text-[#1D1D1F] flex items-center gap-1.5">
                              ⏰ {typeLabel}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              task.status === 'pending' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
                            }`}>
                              {task.status === 'pending' ? 'Bekliyor' : 'Tamamlandı'}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-[#86868B] font-medium">
                            <div>🇹🇷 TR: {rMeta.operation_due_at_tr || '—'}</div>
                            <div>🌍 Hasta Yerel: {rMeta.patient_local_time || '—'}</div>
                          </div>

                          {rMeta.generated_draft && (
                            <div className="mt-2 p-2 bg-[#F5F5F7] rounded-lg border border-black/5 flex flex-col gap-1.5">
                              <p className="text-[11px] text-[#1D1D1F] italic font-semibold">Teyit İçin Hazır Mesaj Taslağı:</p>
                              <p className="text-[11px] text-[#1D1D1F] bg-white p-2 rounded border border-black/5 whitespace-pre-wrap">{rMeta.generated_draft}</p>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(rMeta.generated_draft);
                                  alert("Taslak kopyalandı!");
                                }}
                                className="self-end flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                              >
                                <Copy className="w-3 h-3" /> Taslağı Kopyala
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </DrawerSection>
              )}

              {/* 5. Hasta Kısa Bilgisi */}
              <DrawerSection title="Hasta Bilgileri" sectionKey="patient_info" expanded={expandedSections} onToggle={toggleSection}>
                <div className="p-4 bg-white rounded-xl border border-black/5 shadow-sm space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <InfoField icon={<Building2 className="w-3.5 h-3.5" />} label="Bölüm" value={data.department || '—'} />
                    <InfoField icon={<Globe className="w-3.5 h-3.5" />} label="Ülke" value={data.country ? `${getCountryFlag(data.country)} ${data.country}` : '—'} />
                  </div>
                  {data.summary && (
                    <div className="pt-2 border-t border-black/5">
                      <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-1">AI Özeti</p>
                      <p className="text-[12px] text-[#1D1D1F] font-medium leading-relaxed italic">"{data.summary}"</p>
                    </div>
                  )}
                </div>
              </DrawerSection>
            </>
          )}
        </div>
      </div>
    </>
  );
}

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
