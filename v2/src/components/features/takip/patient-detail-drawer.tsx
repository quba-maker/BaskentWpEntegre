"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import useSWR from "swr";
import {
  X, MessageCircle, Phone, Bot, Calendar, Clock, MapPin,
  ChevronDown, ChevronUp, Flame, Thermometer, Snowflake,
  Moon, AlertTriangle, AlertCircle, FileText, StickyNote, Send,
  XCircle, Sparkles, User, Globe, Building2, Zap, Copy,
  CheckCircle2, ExternalLink, Trash2, Edit3, Check,
  Play, Download, Image, Mic, ChevronLeft, ChevronRight,
  Bell
} from "lucide-react";
import { getPatientTrackingDetail, getPatientTimeline, createAppointmentTask, completeAppointmentTask, deletePatientTask, updatePatientTask, updateAppointmentConfirmation, manuallyUpdateAppointmentStatus, type PatientDetailData, type TimelineEntry } from "@/app/actions/patient-tracking";
import { addOpportunityNote, updateOpportunityStage } from "@/app/actions/pipeline";
import { createBotDelegationTask, schedulePhoneCallTask, completeBotDelegationTask, cancelBotDelegationTask, sendTestBotMessage, saveBotDirective, type BotDelegationMode } from "@/app/actions/focus-queue";
import { logCallReached, logCallMissed, logCallbackScheduled, logNotInterested, sendMetaTemplateMessage } from "@/app/actions/outreach";
import { sendMessage } from "@/app/actions/inbox";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

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

const META_TEMPLATES = [
  { id: 'report_followup', label: '📋 Rapor Takip Şablonu', text: 'Merhaba, sağlık raporlarınızın takibi ve doktor incelemesi için belgelerinizi bu hat üzerinden bizimle paylaşabilirsiniz. Teşekkürler!' },
  { id: 'unreachable', label: '📞 Ulaşılamadı Şablonu', text: 'Merhaba, tedavi planlamanız ve danışmanlığınız için az önce sizi aradık ancak ulaşamadık. Müsait olduğunuz saati iletebilir misiniz?' },
  { id: 'appointment_reminder', label: '📅 Randevu Hatırlatma', text: 'Merhaba, klinik randevunuz yaklaşmaktadır. Detayları onaylamak veya değişiklik yapmak için lütfen bu mesaja cevap veriniz.' },
  { id: 'general_followup', label: '💬 Genel Takip Şablonu', text: 'Merhaba, tedavi süreciniz hakkında güncel durumu görüşmek ve size destek olmak için buradayız. Görüşmeye devam etmek için lütfen yazınız.' },
];

const DIRECTIVE_PRESETS = [
  { id: 'info_missing', label: 'ℹ️ Bilgiler Eksik', text: 'Bilgiler eksik, hastayla konuşarak daha fazla detay/bilgi topla.' },
  { id: 'collect_reports', label: '📋 Rapor Topla', text: 'Hastadan son sağlık ve tıbbi raporlarını, tahlillerini topla.' },
  { id: 'learn_appointment_time', label: '🕒 Randevu Saatini Öğren', text: 'Hastadan arama veya klinik ön görüşmesi için uygun gün ve saat bilgisini öğren.' },
  { id: 'unreachable_new_call', label: '📞 Yeni Arama Planla', text: 'Hastaya ulaşılamadı. Bot üzerinden durumunu sorup yeni bir telefon görüşmesi randevusu planlamaya çalış.' },
  { id: 'persuade_more', label: '🔥 Daha Fazla İkna Et', text: 'Hasta kararsız görünüyor. Tedavi süreci avantajlarından bahsederek hastayı daha fazla ikna et.' },
];

// ── Props ──

interface PatientDetailDrawerProps {
  opportunityId: string | null;
  initialTab?: 'profile' | 'appointment';
  activeTaskId?: string | null;
  onClose: () => void;
  onGoToInbox: (item: any) => void;
  onRefresh?: () => void;
}

export default function PatientDetailDrawer({
  opportunityId,
  initialTab = 'profile',
  activeTaskId = null,
  onClose,
  onGoToInbox,
  onRefresh
}: PatientDetailDrawerProps) {
  const { data, isLoading, mutate } = useSWR(
    opportunityId ? ['patient-detail', opportunityId, activeTaskId] : null,
    () => getPatientTrackingDetail(opportunityId!, activeTaskId),
    { revalidateOnFocus: false }
  );

  // ── Unified Appointment Extraction Logic ──
  const appointmentTasks = data?.tasks?.filter((t: any) => {
    if (t.taskType === 'appointment_reminder') return false;
    const tMeta = t.metadata ? (typeof t.metadata === 'string' ? JSON.parse(t.metadata) : t.metadata) : {};
    return (
      t.taskType === 'callback_scheduled' ||
      ['phone_call', 'clinic_visit', 'pre_consultation', 'consultation'].includes(tMeta?.appointment_type)
    );
  }) || [];

  const activeTask = (activeTaskId ? data?.tasks?.find((t: any) => t.id === activeTaskId) : undefined) || appointmentTasks[0];
  const meta = activeTask?.metadata ? (typeof activeTask.metadata === 'string' ? JSON.parse(activeTask.metadata) : activeTask.metadata) : {};

  // Extract appointment type safely
  const appointmentType = meta?.appointment_type || (activeTask?.taskType === 'callback_scheduled' ? 'phone_call' : 'phone_call');

  // Group reminders ONLY for this active appointment
  const reminders = data?.tasks?.filter((t: any) => {
    if (t.taskType !== 'appointment_reminder') return false;
    const rMeta = t.metadata ? (typeof t.metadata === 'string' ? JSON.parse(t.metadata) : t.metadata) : {};
    return rMeta.parent_task_id === activeTask?.id;
  }) || [];

  const hasActiveAppointment = appointmentTasks.length > 0;

  // Tab State: 'overview' (Özet Aksiyon), 'plan' (Planla), 'detail' (Detay), 'appointment' (Randevu & Teyit)
  const [activeTab, setActiveTab] = useState<'overview' | 'plan' | 'detail' | 'appointment'>(initialTab === 'appointment' ? 'appointment' : 'overview');

  // Synchronize activeTab if initialTab changes and hasActiveAppointment is true
  useEffect(() => {
    if (initialTab === 'appointment' && hasActiveAppointment) {
      setActiveTab('appointment');
    } else {
      setActiveTab('overview');
    }
  }, [initialTab, hasActiveAppointment]);

  // Meta 24-Hour Session & Direct Bot States
  const [selectedMetaTemplate, setSelectedMetaTemplate] = useState("report_followup");
  const [botManualResponse, setBotManualResponse] = useState("");
  const [isSendingBotDirect, setIsSendingBotDirect] = useState(false);

  // Human-in-the-Loop Bot Directive States
  const [botDirectiveText, setBotDirectiveText] = useState("");
  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);
  const [isSavingDirective, setIsSavingDirective] = useState(false);
  const [isAiSummaryExpanded, setIsAiSummaryExpanded] = useState(false);
  const [isBotInterventionExpanded, setIsBotInterventionExpanded] = useState(false);
  const [isFormExpanded, setIsFormExpanded] = useState(false);
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  const [isMediaExpanded, setIsMediaExpanded] = useState(false);
  const [gallery, setGallery] = useState<{ images: Array<{ src: string; caption?: string; timeMs?: number }>; currentIndex: number } | null>(null);

  const allGalleryImages = useMemo(() => {
    if (!data?.mediaFiles) return [];
    return data.mediaFiles
      .filter((m: any) => (m.mediaType === 'image' || m.mediaType === 'sticker') && m.mediaUrl)
      .map((m: any) => ({
        src: m.mediaUrl,
        caption: m.mediaMetadata?.filename || m.mediaMetadata?.caption || undefined,
        timeMs: new Date(m.createdAt).getTime(),
      }));
  }, [data?.mediaFiles]);

  const [noteText, setNoteText] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<'lost' | 'not_interested' | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Integrated Form States
  const [planType, setPlanType] = useState<'phone_call' | 'clinic_visit'>('phone_call');
  const [planDate, setPlanDate] = useState("");
  const [planTime, setPlanTime] = useState("");
  const [planNote, setPlanNote] = useState("");
  const [planLoading, setPlanLoading] = useState(false);

  // Clinic Visit Precision Date & Reminders States
  const [planYear, setPlanYear] = useState<string>("");
  const [planMonth, setPlanMonth] = useState<string>("");
  const [planDay, setPlanDay] = useState<string>("");
  const [planTimeCv, setPlanTimeCv] = useState<string>(""); // Clinic Visit optional time
  const [approvedReminders, setApprovedReminders] = useState<Record<string, boolean>>({
    '30_days_before': false,
    '14_days_before': false,
    '7_days_before': false,
    '1_day_before': false,
  });

  // Bot Draft Editable State
  const [editableDraft, setEditableDraft] = useState("");

  // Task Editing States
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskDate, setEditTaskDate] = useState("");
  const [editTaskTime, setEditTaskTime] = useState("");
  const [editTaskNote, setEditTaskNote] = useState("");
  const [editTaskDescription, setEditTaskDescription] = useState("");
  const [isUpdatingTask, setIsUpdatingTask] = useState(false);

  // Clinic Visit Editing precision states
  const [editTaskYear, setEditTaskYear] = useState<string>("");
  const [editTaskMonth, setEditTaskMonth] = useState<string>("");
  const [editTaskDay, setEditTaskDay] = useState<string>("");
  const [editTaskTimeCv, setEditTaskTimeCv] = useState<string>("");
  const [editApprovedReminders, setEditApprovedReminders] = useState<Record<string, boolean>>({
    '30_days_before': false,
    '14_days_before': false,
    '7_days_before': false,
    '1_day_before': false,
  });

  // Manual Status Override States
  const [manualStatus, setManualStatus] = useState<string>("");
  const [manualConfirmation, setManualConfirmation] = useState<string>("");
  const [isUpdatingManualStatus, setIsUpdatingManualStatus] = useState(false);

  // Custom premium dialog states & helpers
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
  });

  const [cancelPromptModal, setCancelPromptModal] = useState<{
    isOpen: boolean;
    taskId: string;
    reason: string;
  }>({
    isOpen: false,
    taskId: "",
    reason: "Koordinatör iptal etti",
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm,
    });
  };

  const showAlert = (title: string, message: string) => {
    setAlertModal({
      isOpen: true,
      title,
      message,
    });
  };

  // Selector Option Computations
  const yearsOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return [
      String(currentYear),
      String(currentYear + 1),
      String(currentYear + 2),
      String(currentYear + 3),
    ];
  }, []);

  const monthsOptions = useMemo(() => MONTHS_TR, []);

  const daysOptions = useMemo(() => {
    const days = [];
    for (let i = 1; i <= 31; i++) {
      days.push(String(i).padStart(2, '0'));
    }
    return days;
  }, []);

  const timesOptions = useMemo(() => {
    const times = [];
    for (let h = 8; h <= 20; h++) {
      const hh = String(h).padStart(2, '0');
      times.push(`${hh}:00`);
      times.push(`${hh}:30`);
    }
    return times;
  }, []);

  const activeBotTasks = data?.tasks.filter((t: any) => t.taskType === 'bot_handoff_followup' && (t.status === 'pending' || t.status === 'in_progress')) || [];
  const activeBotTask = activeBotTasks[0];
  const botDel = activeBotTask?.metadata?.bot_delegation || {};
  const draftText = botDel?.generated_draft || '';

  // Auto-fill editable draft
  useEffect(() => {
    if (draftText) {
      setEditableDraft(draftText);
    } else {
      setEditableDraft('');
    }
  }, [draftText]);

  // Auto-populate AI suggested draft for Bot Directing
  useEffect(() => {
    if (draftText) {
      setBotManualResponse(draftText);
    } else if (data) {
      const name = data.patientName || 'Hastamız';
      let defaultMsg = `Merhaba ${name}, tedavi sürecinizle ilgili destek olmak için buradayız. `;
      if (data.journeyStatus === 'Ulaşılamadı') {
        defaultMsg = `Merhaba ${name}, az önce sizi aradık ancak ulaşamadık. Detayları netleştirmek için ne zaman müsait olursunuz?`;
      } else if (data.journeyStatus === 'Rapor Bekleniyor') {
        defaultMsg = `Merhaba ${name}, raporlarınızın doktorumuz tarafından incelenmesi için belgelerinizi gönderebilir misiniz?`;
      } else if (data.journeyStatus === 'Doktor İncelemesi') {
        defaultMsg = `Merhaba ${name}, doktorumuz raporlarınızı inceliyor. Detaylı bilgi almak için hazırız.`;
      }
      setBotManualResponse(defaultMsg);
    }
  }, [draftText, data]);

  // Reset state on new opportunity
  useEffect(() => {
    setNoteText("");
    setConfirmDialog(null);
    setActionLoading(null);
    setActionSuccess(null);
    setPlanNote("");
    
    // Set smart defaults (Tomorrow at 10:00 AM)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    setPlanDate(`${year}-${month}-${day}`);
    setPlanTime("10:00");

    setPlanYear(String(year));
    setPlanMonth(month);
    setPlanDay("");
    setPlanTimeCv("");
    setApprovedReminders({
      '30_days_before': false,
      '14_days_before': false,
      '7_days_before': false,
      '1_day_before': false,
    });

    setActiveTab('overview');
    setBotManualResponse("");
    setSelectedMetaTemplate("report_followup");
    setBotDirectiveText("");
  }, [opportunityId]);

  // Auto-populate active bot directive if present
  useEffect(() => {
    if (activeBotTask?.metadata?.active_bot_directive) {
      setBotDirectiveText(activeBotTask.metadata.active_bot_directive);
    } else {
      setBotDirectiveText("");
    }
  }, [activeBotTask]);

  // Synchronize manual status and confirmation when activeTask loads
  useEffect(() => {
    if (activeTask) {
      let initStatus = activeTask.status || 'pending';
      if (activeTask.metadata?.appointment_result) {
        initStatus = activeTask.metadata.appointment_result;
      }
      setManualStatus(initStatus);

      const initConfirm = activeTask.metadata?.confirmation_status || 'pending';
      setManualConfirmation(initConfirm);
    } else {
      setManualStatus("");
      setManualConfirmation("");
    }
  }, [activeTask]);

  const handleManualUpdateStatus = async () => {
    if (!activeTask?.id) return;
    setIsUpdatingManualStatus(true);
    setActionSuccess(null);
    try {
      let finalStatus: 'pending' | 'completed' | 'cancelled' = 'pending';
      let appointmentResult: 'completed' | 'arrived' | 'no_show' | 'cancelled' | 'none' = 'none';

      if (manualStatus === 'pending') {
        finalStatus = 'pending';
        appointmentResult = 'none';
      } else if (manualStatus === 'completed') {
        finalStatus = 'completed';
        appointmentResult = 'completed';
      } else if (manualStatus === 'arrived') {
        finalStatus = 'completed';
        appointmentResult = 'arrived';
      } else if (manualStatus === 'no_show') {
        finalStatus = 'completed';
        appointmentResult = 'no_show';
      } else if (manualStatus === 'cancelled') {
        finalStatus = 'cancelled';
        appointmentResult = 'cancelled';
      }

      const res = await manuallyUpdateAppointmentStatus(
        activeTask.id,
        finalStatus,
        appointmentResult,
        manualConfirmation as any
      );

      if (res.success) {
        setActionSuccess("Durumlar manuel olarak başarıyla güncellendi.");
        mutate();
        onRefresh?.();
      } else {
        showAlert("Hata", res.error || "Güncelleme başarısız.");
      }
    } catch (err: any) {
      console.error(err);
      showAlert("Hata", "Hata oluştu.");
    } finally {
      setIsUpdatingManualStatus(false);
    }
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

  const handleAppointmentAction = async (action: string) => {
    if (!opportunityId) return;
    const targetTaskId = activeTaskId || activeTask?.id;
    if (!targetTaskId) {
      showAlert("Hata", "Randevu görevi bulunamadı.");
      return;
    }

    if (action === 'cancel') {
      showConfirm(
        "Randevuyu İptal Et",
        "Bu randevuyu iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz.",
        async () => {
          setActionLoading(action);
          try {
            await completeAppointmentTask(targetTaskId, 'cancelled');
            setActionSuccess('Aksiyon başarıyla kaydedildi.');
            mutate();
            onRefresh?.();
          } catch (e) {
            console.error(e);
            showAlert("Hata", "İşlem sırasında bir hata oluştu.");
          } finally {
            setActionLoading(null);
          }
        }
      );
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
      
      setActionSuccess('Aksiyon başarıyla kaydedildi.');
      mutate();
      onRefresh?.();
    } catch (e) {
      console.error(e);
      showAlert("Hata", "İşlem sırasında bir hata oluştu.");
    } finally {
      setActionLoading(null);
    }
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
      setActiveTab('plan'); // Smart UX: Switch automatically to "Planla" Tab!
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreatePlan = async () => {
    if (!opportunityId) return;
    setPlanLoading(true);
    try {
      let dateObj: Date;
      let customMetadata: any = null;
      let remindersToSend: any[] = [];

      if (planType === 'clinic_visit') {
        if (!planYear || !planMonth) {
          showAlert("Hata", "Lütfen Yıl ve Ay seçiniz.");
          setPlanLoading(false);
          return;
        }

        const day = planDay || '01';
        const time = planTimeCv || '10:00';
        const localDateStr = `${planYear}-${planMonth}-${day}T${time}:00`;
        dateObj = new Date(localDateStr);

        customMetadata = {
          is_partial_date: !planDay || !planTimeCv,
          partial_precision: !planDay ? 'year_month' : (!planTimeCv ? 'year_month_day' : 'full'),
          selected_year: planYear,
          selected_month: planMonth,
          selected_day: planDay || null,
          selected_time: planTimeCv || null,
        };

        remindersToSend = Object.keys(approvedReminders)
          .filter(k => approvedReminders[k])
          .map(k => ({ type: k as any }));
      } else {
        if (!planDate || !planTime) return;
        const localDateStr = `${planDate}T${planTime}:00`;
        dateObj = new Date(localDateStr);
      }

      const res = await createAppointmentTask(opportunityId, dateObj.toISOString(), planType, { 
        note: planNote, 
        requireConfirmation: planType === 'clinic_visit',
        reminders: remindersToSend,
        customMetadata
      });
      
      if (res.success) {
        setPlanNote("");
        
        // Reset states
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const day = String(tomorrow.getDate()).padStart(2, '0');
        
        setPlanDate(`${year}-${month}-${day}`);
        setPlanTime("10:00");
        setPlanYear(String(year));
        setPlanMonth(month);
        setPlanDay("");
        setPlanTimeCv("");
        setApprovedReminders({
          '30_days_before': false,
          '14_days_before': false,
          '7_days_before': false,
          '1_day_before': false,
        });

        setActionSuccess(planType === 'clinic_visit' ? 'Randevu başarıyla planlandı.' : 'Görev başarıyla planlandı.');
        mutate();
        onRefresh?.();
      } else {
        showAlert("Hata", res.error || "Hata oluştu");
      }
    } catch(err) {
      showAlert("Hata", "Hata oluştu");
    } finally {
      setPlanLoading(false);
    }
  };

  const handleUpdateTask = async (taskId: string) => {
    setIsUpdatingTask(true);
    try {
      let dateObj: Date;
      let customMetadata: any = null;
      let remindersToSend: any[] = [];
      
      const task = data?.tasks.find((t: any) => t.id === taskId);
      const isClinicVisit = task?.metadata?.appointment_type === 'clinic_visit';

      if (isClinicVisit) {
        if (!editTaskYear || !editTaskMonth) {
          showAlert("Hata", "Lütfen Yıl ve Ay seçiniz.");
          setIsUpdatingTask(false);
          return;
        }

        const day = editTaskDay || '01';
        const time = editTaskTimeCv || '10:00';
        const localDateStr = `${editTaskYear}-${editTaskMonth}-${day}T${time}:00`;
        dateObj = new Date(localDateStr);

        customMetadata = {
          is_partial_date: !editTaskDay || !editTaskTimeCv,
          partial_precision: !editTaskDay ? 'year_month' : (!editTaskTimeCv ? 'year_month_day' : 'full'),
          selected_year: editTaskYear,
          selected_month: editTaskMonth,
          selected_day: editTaskDay || null,
          selected_time: editTaskTimeCv || null,
        };

        remindersToSend = Object.keys(editApprovedReminders)
          .filter(k => editApprovedReminders[k])
          .map(k => ({ type: k as any }));
      } else {
        if (!editTaskDate || !editTaskTime) return;
        const localDateStr = `${editTaskDate}T${editTaskTime}:00`;
        dateObj = new Date(localDateStr);
      }

      const res = await updatePatientTask(taskId, dateObj.toISOString(), editTaskDescription, editTaskNote, {
        reminders: remindersToSend,
        customMetadata
      });

      if (res.success) {
        setEditingTaskId(null);
        setActionSuccess('Plan başarıyla güncellendi.');
        mutate();
        onRefresh?.();
      } else {
        showAlert("Hata", res.error || "Güncelleme sırasında hata oluştu");
      }
    } catch(err) {
      showAlert("Hata", "Güncelleme sırasında hata oluştu");
    } finally {
      setIsUpdatingTask(false);
    }
  };

  const handleDeleteTask = (taskId: string) => {
    showConfirm(
      "Görevi Sil",
      "Bu planlı görevi silmek istediğinize emin misiniz? Bu işlem geri alınamaz.",
      async () => {
        setActionLoading("delete_task");
        try {
          const res = await deletePatientTask(taskId);
          if (res.success) {
            setActionSuccess('Görev başarıyla silindi.');
            mutate();
            onRefresh?.();
          } else {
            showAlert("Hata", res.error || "Silme sırasında hata oluştu");
          }
        } catch(err) {
          showAlert("Hata", "Silme sırasında hata oluştu");
        } finally {
          setActionLoading(null);
        }
      }
    );
  };

  const handleCompleteTask = (taskId: string, result: 'completed' | 'cancelled') => {
    const actionLabel = result === 'completed' ? 'tamamlandı' : 'iptal edildi';
    showConfirm(
      result === 'completed' ? "Görevi Tamamla" : "Görevi İptal Et",
      `Bu görevi ${actionLabel} olarak işaretlemek istediğinize emin misiniz?`,
      async () => {
        setActionLoading("complete_task");
        try {
          const res = await completeAppointmentTask(taskId, result);
          if (res.success) {
            setActionSuccess(`Görev başarıyla ${actionLabel} olarak işaretlendi.`);
            mutate();
            onRefresh?.();
          } else {
            showAlert("Hata", res.error || "İşlem sırasında hata oluştu");
          }
        } catch(err) {
          showAlert("Hata", "İşlem sırasında hata oluştu");
        } finally {
          setActionLoading(null);
        }
      }
    );
  };

  const handleSendBotFreeMessage = async () => {
    if (!opportunityId || !botManualResponse.trim() || !data?.phoneNumber) return;
    setIsSendingBotDirect(true);
    try {
      const res = await sendMessage(data.phoneNumber, botManualResponse.trim());
      if (res.success) {
        setActionSuccess('Mesaj bota onaylandı ve hastaya gönderildi.');
        
        // Optimistic SWR Update: Instant 0ms response!
        mutate((currentData) => {
          if (!currentData) return currentData;
          return {
            ...currentData,
            lastMessageAt: new Date().toISOString(),
            lastIncomingMessageAt: new Date().toISOString(), // Mock that session remains active!
          };
        }, false);
        
        onRefresh?.();
      } else {
        showAlert("Hata", res.error || 'Mesaj gönderilemedi.');
      }
    } catch (err: any) {
      showAlert("Hata", err?.message || 'Hata oluştu.');
    } finally {
      setIsSendingBotDirect(false);
    }
  };

  const handleSendMetaTemplate = async () => {
    if (!opportunityId) return;
    const template = META_TEMPLATES.find(t => t.id === selectedMetaTemplate);
    if (!template) return;
    setIsSendingBotDirect(true);
    try {
      const res = await sendMetaTemplateMessage(opportunityId, template.id, data?.language || 'tr', template.text);
      if (res.success) {
        setActionSuccess('Meta şablon mesajı başarıyla gönderildi, oturum tetiklendi.');
        
        // Optimistic SWR Update: Instant 0ms response!
        mutate((currentData) => {
          if (!currentData) return currentData;
          return {
            ...currentData,
            lastMessageAt: new Date().toISOString(),
            lastIncomingMessageAt: new Date().toISOString(), // Re-opens session instantly!
          };
        }, false);
        
        onRefresh?.();
      } else {
        showAlert("Hata", res.error || 'Şablon gönderilemedi.');
      }
    } catch (err: any) {
      showAlert("Hata", err?.message || 'Hata oluştu.');
    } finally {
      setIsSendingBotDirect(false);
    }
  };

  const handleSaveBotDirective = async () => {
    if (!opportunityId || !botDirectiveText.trim()) return;
    setIsSavingDirective(true);
    try {
      const res = await saveBotDirective(opportunityId, botDirectiveText.trim());
      if (res.success) {
        if (res.data?.sessionClosed) {
          setActionSuccess('Talimat bota kaydedildi ancak 24s WhatsApp oturumu kapalı olduğu için mesaj gönderilemedi. Lütfen Şablon Mesaj sekmelerini kullanın.');
        } else {
          setActionSuccess('Taktik talimatı bota iletildi ve hastaya özel AI mesajı başarıyla gönderildi!');
          setBotDirectiveText(""); // Clear text area on successful dispatch
        }
        mutate();
        onRefresh?.();
      } else {
        showAlert("Hata", res.error || 'Talimat iletilemedi.');
      }
    } catch (err: any) {
      showAlert("Hata", err?.message || 'Hata oluştu.');
    } finally {
      setIsSavingDirective(false);
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
        showAlert("Hata", res.error || 'İşlem başarısız.');
      }
    } catch (err) {
      console.error(err);
      showAlert("Hata", 'İşlem sırasında hata oluştu.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelBotTask = (taskId: string) => {
    setCancelPromptModal({
      isOpen: true,
      taskId,
      reason: "Koordinatör iptal etti",
    });
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
            <div className="w-full">
              {/* Top Row: Left details, Right action buttons */}
              <div className="flex items-center justify-between gap-4 w-full">
                <div className="flex items-center gap-1.5 flex-wrap min-w-0 font-sans">
                  <h2 className="text-lg font-bold text-[#1D1D1F] truncate">{data.patientName}</h2>
                  {data.isTestWhitelist && (
                    <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded text-[9px] font-bold uppercase shrink-0">TEST</span>
                  )}
                  <span className="text-[12px] text-[#86868B] font-bold">· {formatPhoneReadable(data.phoneNumber)}</span>
                  {data.country && (
                    <span className="text-[12px] text-[#86868B] font-semibold">· {getCountryFlag(data.country)} {data.country}</span>
                  )}
                  {data.patientLocalTimeNow && (() => {
                    let tzLabel = "";
                    try {
                      const parts = new Intl.DateTimeFormat('en-US', {
                        timeZone: data.patientTimezone || undefined,
                        timeZoneName: 'short'
                      }).formatToParts(new Date());
                      tzLabel = parts.find(p => p.type === 'timeZoneName')?.value || data.patientTimezone || "";
                    } catch (_) {
                      tzLabel = data.patientTimezone || "";
                    }

                    return (
                      <span 
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border transition-all duration-200 shrink-0 select-none ${
                          data.isPatientSleeping 
                            ? 'bg-amber-50 border-amber-250 text-amber-700' 
                            : 'bg-green-50 border-green-250 text-green-700'
                        }`}
                        title={`Hasta Yerel Saati: ${data.patientLocalTimeNow} (${data.patientTimezone}) — ${
                          data.isPatientSleeping 
                            ? 'Hasta yerel saatinde gece — arama uygun değil' 
                            : 'Hasta yerel saatinde gündüz — arama uygun'
                        }`}
                      >
                        {data.isPatientSleeping ? '😴' : '☀️'} {data.patientLocalTimeNow}
                        {tzLabel && <span className="text-[8px] opacity-75 font-medium ml-0.5">({tzLabel})</span>}
                      </span>
                    );
                  })()}
                  {data.language && (
                    <span className="text-[12px] text-[#86868B] font-semibold">· 🗣️ {getLanguageLabel(data.language)}</span>
                  )}
                  {data.department && (
                    <span className="text-[12px] text-[#86868B] font-semibold">· {data.department}</span>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onGoToInbox({ phone_number: data.phoneNumber, display_name: data.patientName, source: data.source })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl text-xs font-bold transition-all duration-200 shadow-sm"
                  >
                    <MessageCircle className="w-3.5 h-3.5" /> Mesaja Git
                  </button>
                  <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors">
                    <X className="w-5 h-5 text-[#1D1D1F]" />
                  </button>
                </div>
              </div>
              
              {/* Underneath: Stage Selector dropdown, Priority badge, Intent badge, and Source card */}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                
                {data.priority && (
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase ${
                    data.priority.toLowerCase() === 'hot'
                      ? 'bg-red-50 text-red-600 border border-red-150 shadow-sm'
                      : 'bg-black/[0.04] text-[#1D1D1F]/80 border border-black/5'
                  }`}>
                    🔥 {getPriorityLabel(data.priority)}
                  </span>
                )}

                {data.intentType && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-black/[0.04] text-[#1D1D1F]/80 border border-black/5 rounded-md text-[10px] font-bold">
                    🎯 {getIntentLabel(data.intentType)}
                  </span>
                )}

                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-black/[0.03] text-[#86868B] border border-black/5 rounded-md text-[10px] font-bold whitespace-nowrap">
                  Kaynak: {data.source || 'Bilinmiyor'} {data.leadRawData && Object.keys(data.leadRawData).length > 0 ? '(Form)' : ''}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Dynamic Segmented Tab Switcher (Overview, Plan, Detail) */}
        {data && (
          <div className="bg-[#F5F5F7] px-4 py-2 flex items-center justify-between gap-2 select-none shrink-0 border-b border-black/[0.03]">
            {[
              { id: 'overview', label: 'Özet Aksiyon', icon: <MessageCircle className="w-3.5 h-3.5" /> },
              ...(hasActiveAppointment ? [{ id: 'appointment', label: 'Randevu & Teyit', icon: <Zap className="w-3.5 h-3.5" /> }] : []),
              { id: 'plan', label: 'Plan/Görev', icon: <Calendar className="w-3.5 h-3.5" /> },
              { id: 'detail', label: 'Detay', icon: <User className="w-3.5 h-3.5" /> },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold transition-all duration-200 cursor-pointer ${
                  activeTab === tab.id 
                    ? 'bg-[#5856D6] text-white shadow-sm' 
                    : 'bg-white border border-black/5 text-[#86868B] hover:text-[#1D1D1F] hover:bg-black/5'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Scrollable Container */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-48">
          {data && (
            <>
              {/* TAB 1: ÖZET AKSİYON */}
              {activeTab === 'overview' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  
                  {/* AI Otopilot Durumu */}
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

                    const lastMsgTime = data.lastIncomingMessageAt ? new Date(data.lastIncomingMessageAt).getTime() : 0;
                    const timeDiff = Date.now() - lastMsgTime;
                    const isSessionActive = lastMsgTime > 0 && timeDiff < 24 * 60 * 60 * 1000;
                    const remainingHours = Math.max(0, Math.floor((24 * 60 * 60 * 1000 - timeDiff) / (1000 * 60 * 60)));
                    const remainingMinutes = Math.max(0, Math.floor(((24 * 60 * 60 * 1000 - timeDiff) % (1000 * 60 * 60)) / (1000 * 60)));

                    return (
                      <div className="space-y-4">
                        {/* 1. AI Otopilot Durumu Card */}
                        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-4">
                          
                          {/* AI Görüşme Özeti (Başa Alındı & Sabitlendi) */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between pb-2 border-b border-black/[0.04]">
                              <span className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" /> AI Görüşme Özeti
                              </span>
                              <StageSelector currentStage={data.stage || 'new_lead'} onStageChange={handleStageChange} />
                            </div>

                            {/* Özet Detayları */}
                            <div className="space-y-3">
                              {data.aiReason && (
                                <div className="px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-xl">
                                  <p className="text-[11px] font-semibold text-indigo-600 leading-normal flex items-start gap-1">
                                    <span>🎯</span>
                                    <span><strong>Neden Fırsat:</strong> {data.aiReason}</span>
                                  </p>
                                </div>
                              )}
                              {data.summary ? (
                                <p className="text-[13px] text-[#1D1D1F] leading-relaxed font-semibold bg-[#F5F5F7]/60 p-3 rounded-xl border border-black/5">
                                  {data.summary}
                                </p>
                              ) : (
                                <p className="text-[12px] text-[#86868B] italic px-1">Henüz AI özeti oluşmamış.</p>
                              )}
                            </div>
                          </div>

                          {/* 🎯 Hasta Talebi Intent Card (Görüşme Özeti Altına Alındı) */}
                          {data.intentType && (
                            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2.5 items-start animate-in fade-in duration-200">
                              <span className="text-base mt-0.5">🎯</span>
                              <div className="space-y-1 text-[11px]">
                                <p className="font-bold text-amber-800 uppercase tracking-wider text-[9px]">Hasta Talebi & Niyeti</p>
                                <p className="font-semibold text-amber-900 leading-relaxed">
                                  {data.intentType === 'appointment_request' 
                                    ? 'Hasta ön görüşme veya klinik randevusu talep ediyor, koordinatör onayını bekliyor.' 
                                    : `Hasta niyeti tespit edildi: ${getIntentLabel(data.intentType)}`
                                  }
                                </p>
                                {data.actionLabel && (
                                  <p className="text-amber-700 font-medium italic mt-1">
                                    Öneri: {data.actionLabel}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 2. Botu Yönlendir Management Card */}
                        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-3.5">
                          {/* Header Status Row */}
                          <div className="flex items-center justify-between pb-1 border-b border-black/[0.03]">
                            <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
                              <Bot className="w-3.5 h-3.5 text-indigo-600" /> Bota Müdahale & Aksiyon
                            </span>
                            {isSessionActive ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full text-[9px] font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span>Oturum Aktif ({remainingHours}s Kalan)</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 rounded-full text-[9px] font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                <span>Oturum Kapalı</span>
                              </span>
                            )}
                          </div>

                          {/* Action Button Bar */}
                          <div className="flex gap-3 pt-0.5">
                             {/* Ulaşıldı (Plan/Görev) - Sol Buton */}
                             <button
                               type="button"
                               onClick={handleReachedAction}
                               disabled={!!actionLoading}
                               className="flex-1 flex items-center justify-center gap-2 px-3 py-3 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 disabled:opacity-50"
                             >
                               <CheckCircle2 className="w-4 h-4" />
                               <span>Ulaşıldı (Plan/Görev)</span>
                             </button>

                            {/* Botu Yönlendir (Müdahale) - Sağ Buton */}
                            <button
                              type="button"
                              onClick={() => setIsBotInterventionExpanded(!isBotInterventionExpanded)}
                              className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-xs font-bold shadow-sm transition-all duration-200 ${
                                isBotInterventionExpanded 
                                  ? 'bg-indigo-700 text-white hover:bg-indigo-800 ring-2 ring-indigo-500/20' 
                                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
                              }`}
                            >
                              <Zap className={`w-4 h-4 ${isBotInterventionExpanded ? 'animate-bounce' : 'animate-pulse'}`} />
                              <span>Botu Yönlendir (Müdahale)</span>
                              <ChevronDown className={`w-4 h-4 ml-0.5 transition-transform duration-200 ${isBotInterventionExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          </div>

                          {isBotInterventionExpanded && (
                            <div className="space-y-3.5 animate-in fade-in slide-in-from-top-1 duration-200">
                              <div className="relative mb-3">
                                <span className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-2">Hazır Taktik Seç</span>
                                <button
                                  type="button"
                                  onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                                  className="w-full flex items-center justify-between p-3 bg-[#F5F5F7]/60 hover:bg-[#F5F5F7] border border-black/5 rounded-xl text-left transition-all duration-200"
                                >
                                  <span className="font-bold text-[11px] text-[#1D1D1F]">
                                    {botDirectiveText 
                                      ? DIRECTIVE_PRESETS.find(p => p.text === botDirectiveText)?.label || "Özel Talimat Yazılıyor..." 
                                      : "Hazır bir taktik/talimat paketi seçin..."}
                                  </span>
                                  <ChevronDown className={`w-4 h-4 text-[#86868B] transition-transform duration-200 ${isPresetDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>
                                
                                {isPresetDropdownOpen && (
                                  <div className="absolute z-10 w-full mt-1 bg-white border border-black/5 shadow-lg rounded-xl overflow-hidden py-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                    {DIRECTIVE_PRESETS.map((preset) => {
                                      const isSelected = botDirectiveText === preset.text;
                                      return (
                                        <button
                                          key={preset.id}
                                          type="button"
                                          onClick={() => {
                                            setBotDirectiveText(preset.text);
                                            setIsPresetDropdownOpen(false);
                                          }}
                                          className={`w-full p-3 text-left transition-all duration-200 hover:bg-[#F5F5F7] ${
                                            isSelected ? 'bg-indigo-50/50 text-indigo-900' : 'text-[#1D1D1F]'
                                          }`}
                                        >
                                          <div className="font-bold text-[11px]">{preset.label}</div>
                                          <div className="text-[10px] text-[#86868B] font-semibold leading-normal mt-0.5">{preset.text}</div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1.5 flex items-center justify-between">
                                  <span>Özel Talimat / Taktik Detayı</span>
                                  {botDirectiveText && (
                                    <button 
                                      type="button"
                                      onClick={() => setBotDirectiveText("")}
                                      className="text-indigo-600 hover:text-indigo-700 font-bold lowercase text-[9px]"
                                    >
                                      temizle
                                    </button>
                                  )}
                                </label>
                                <textarea
                                  value={botDirectiveText}
                                  onChange={(e) => setBotDirectiveText(e.target.value)}
                                  className="w-full min-h-[90px] px-3.5 py-3 bg-[#F5F5F7] hover:bg-white focus:bg-white rounded-xl text-xs font-semibold outline-none border border-transparent focus:border-indigo-500/25 ring-2 ring-indigo-500/5 focus:ring-indigo-500/15 transition-all duration-200 resize-none leading-relaxed text-[#1D1D1F]"
                                  placeholder="Bota verilecek özel takip/ikna talimatı..."
                                />
                              </div>

                              {activeBotTask?.metadata?.active_bot_directive && (
                                <div className="px-3.5 py-2.5 bg-emerald-50/60 border border-emerald-100 rounded-xl flex items-start gap-2 text-[11px] text-emerald-800 font-semibold leading-relaxed animate-in fade-in duration-200">
                                  <span className="text-emerald-600 font-bold shrink-0">🟢 Aktif Bot Talimatı:</span>
                                  <span>{activeBotTask.metadata.active_bot_directive}</span>
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={handleSaveBotDirective}
                                disabled={isSavingDirective || !botDirectiveText.trim()}
                                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-40"
                              >
                                {isSavingDirective ? (
                                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                )}
                                <span>Talimatı Bota İlet & Devam Et</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}



                  {/* Hızlı Not Ekle */}
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
                        <StickyNote className="w-3.5 h-3.5 text-indigo-600" /> Hızlı Not Ekle
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Arama sonucu veya hasta hakkında hızlı not..."
                        className="flex-1 px-3 py-2.5 bg-[#F5F5F7] rounded-xl text-xs font-semibold outline-none border border-transparent focus:border-indigo-500/25 focus:bg-white transition-all duration-200"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && noteText.trim()) handleAddNote();
                        }}
                      />
                      <button
                        onClick={handleAddNote}
                        disabled={!noteText.trim() || isSavingNote}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 transition-colors"
                      >
                        {isSavingNote ? '...' : 'Ekle'}
                      </button>
                    </div>
                    {/* Son 3 Not listesi */}
                    {data.notes && data.notes.length > 0 && (
                      <div className="pt-2 border-t border-black/5 space-y-1.5">
                        {data.notes.slice(0, 3).map((note: any, idx: number) => (
                          <div key={idx} className="flex gap-2 text-[11px] font-medium items-start">
                            <span className="text-[#86868B] shrink-0 font-bold bg-black/[0.03] px-1.5 py-0.5 rounded text-[9px]">
                              {note.created_at ? new Date(note.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'Europe/Istanbul' }) : '—'}
                            </span>
                            <span className="text-[#1D1D1F] leading-relaxed break-words">{note.text || note}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 1.5: RANDEVU & TEYİT */}
              {activeTab === 'appointment' && activeTask && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  
                  {/* Randevu Sonuç Aksiyonları (Sadece açık veya bekleyen randevular için) */}
                  {activeTask.status !== 'completed' && activeTask.status !== 'cancelled' && (
                    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-3">
                      <p className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5 border-b border-black/[0.04] pb-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 animate-pulse" /> Randevu Sonuç Aksiyonları
                      </p>
                      
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          onClick={() => handleAppointmentAction('confirm')}
                          disabled={!!actionLoading}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-bold bg-green-50 text-green-700 border border-green-200/50 hover:bg-green-100 transition-all cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Teyit Edildi
                        </button>
                        
                        <button
                          onClick={() => handleAppointmentAction('call_missed')}
                          disabled={!!actionLoading}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-bold bg-orange-50 text-orange-700 border border-orange-200/50 hover:bg-orange-100 transition-all cursor-pointer disabled:opacity-50"
                        >
                          <Phone className="w-4 h-4" /> Ulaşılamadı
                        </button>
                        
                        {appointmentType === 'clinic_visit' && (
                          <button
                            onClick={() => handleAppointmentAction('arrived')}
                            disabled={!!actionLoading}
                            className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/50 hover:bg-emerald-100 transition-all cursor-pointer disabled:opacity-50 col-span-2 shadow-sm"
                          >
                            <Building2 className="w-4 h-4" /> Hasta Geldi / Klinik Girişi
                          </button>
                        )}
                        
                        <button
                          onClick={() => handleAppointmentAction('no_show')}
                          disabled={!!actionLoading}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-bold bg-red-50 text-red-700 border border-red-200/50 hover:bg-red-100 transition-all cursor-pointer disabled:opacity-50"
                        >
                          <X className="w-4 h-4" /> Gelmedi
                        </button>
                        
                        <button
                          onClick={() => handleAppointmentAction('cancel')}
                          disabled={!!actionLoading}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-bold bg-gray-50 text-gray-600 border border-gray-200/50 hover:bg-gray-100 transition-all cursor-pointer disabled:opacity-50"
                        >
                          <X className="w-4 h-4" /> İptal Et
                        </button>
                      </div>

                      {actionSuccess && (
                        <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 text-green-700 text-[11px] font-bold rounded-lg shadow-sm">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> {actionSuccess}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manuel Durum ve Teyit Yönetimi (Süreci Başa Al) */}
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-3">
                    <p className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5 border-b border-black/[0.04] pb-2">
                      <Edit3 className="w-3.5 h-3.5 text-indigo-600" /> Manuel Durum ve Teyit Yönetimi
                    </p>
                    
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">
                          Randevu Durumu
                        </label>
                        <select
                          value={manualStatus}
                          onChange={(e) => setManualStatus(e.target.value)}
                          className="w-full text-[12px] font-semibold bg-[#F5F5F7] border border-black/5 rounded-xl px-2.5 py-2 text-[#1D1D1F] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="pending">⏳ Açık / Planlandı (Süreci Başa Al)</option>
                          <option value="completed">✅ Tamamlandı</option>
                          <option value="arrived">🏥 Hasta Geldi (Klinik Girişi)</option>
                          <option value="no_show">❌ Gelmedi</option>
                          <option value="cancelled">🚫 İptal Edildi</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">
                          Teyit Durumu
                        </label>
                        <select
                          value={manualConfirmation}
                          onChange={(e) => setManualConfirmation(e.target.value)}
                          className="w-full text-[12px] font-semibold bg-[#F5F5F7] border border-black/5 rounded-xl px-2.5 py-2 text-[#1D1D1F] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="pending">⏳ Teyit Bekliyor</option>
                          <option value="confirmed">✅ Teyit Edildi</option>
                          <option value="declined">❌ Reddetti</option>
                          <option value="no_response">🚫 Cevap Yok</option>
                          <option value="none">⚪ Yok / Belirtilmemiş</option>
                        </select>
                      </div>

                      <button
                        onClick={handleManualUpdateStatus}
                        disabled={isUpdatingManualStatus}
                        className="col-span-2 mt-2 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50 shadow-sm"
                      >
                        {isUpdatingManualStatus ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Güncelleniyor...
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" /> Manuel Durumları Uygula
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Randevu Bilgileri Özeti */}
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-4">
                    <p className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5 border-b border-black/[0.04] pb-2">
                      <Calendar className="w-3.5 h-3.5 text-indigo-600" /> Randevu Bilgileri
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-0.5 flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" /> Randevu Tarihi
                        </p>
                        <p className="text-[13px] font-bold text-[#1D1D1F]">
                          {activeTask.metadata?.is_partial_date 
                            ? formatPartialDate(activeTask.metadata) 
                            : (activeTask.dueAt ? new Date(activeTask.dueAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' }) : '—')}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-0.5 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> Randevu Saati (TR)
                        </p>
                        <p className="text-[13px] font-bold text-[#1D1D1F]">
                          {activeTask.metadata?.is_partial_date && activeTask.metadata?.partial_precision !== 'full'
                            ? '—'
                            : (activeTask.dueAt ? new Date(activeTask.dueAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) : '—')}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-0.5 flex items-center gap-1">
                          {appointmentType === 'clinic_visit' ? <Building2 className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />} Tür / Detay
                        </p>
                        <p className="text-[13px] font-bold text-[#1D1D1F]">
                          {appointmentType === 'clinic_visit' ? '🏥 Klinik Randevusu' :
                           appointmentType === 'phone_call' ? '📞 Telefon Görüşmesi' :
                           appointmentType === 'pre_consultation' ? '📞 Ön Görüşme' :
                           appointmentType === 'doctor_review' ? '🩺 Doktor İncelemesi' :
                           appointmentType === 'report_followup' ? '📄 Rapor Takibi' :
                           '🗓️ Randevu Takibi'}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-0.5 flex items-center gap-1">
                          <Zap className="w-3.5 h-3.5" /> Teyit Durumu
                        </p>
                        <p className="text-[13px] font-bold text-[#1D1D1F]">
                          {meta?.confirmation_status === 'confirmed' ? '✅ Teyitli' :
                           meta?.confirmation_status === 'declined' ? '❌ Reddetti' :
                           meta?.confirmation_status === 'no_response' ? '🚫 Cevap Yok' :
                           meta?.confirmation_status === 'not_required' ? '🟢 Teyit Gerekmiyor' :
                           '⏳ Teyit Bekliyor'}
                        </p>
                      </div>

                      {activeTask.description && (
                        <div className="col-span-2 pt-2 border-t border-black/[0.04]">
                          <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-1">Görüşme / Randevu Notu</p>
                          <p className="text-[12px] font-medium text-[#1D1D1F] leading-relaxed">{activeTask.description}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Saat & Lokasyon Kartı */}
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-3">
                    <p className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5 border-b border-black/[0.04] pb-2">
                      <Globe className="w-3.5 h-3.5 text-indigo-600" /> Saat & Lokasyon
                    </p>
                    
                    <div className="grid grid-cols-2 gap-3 text-xs font-semibold">
                      <div>
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-0.5">Türkiye Saati (TR)</p>
                        <p className="text-[13px] font-bold text-[#1D1D1F]">{data.turkeyTimeNow}</p>
                      </div>
                      {data.patientLocalTimeNow && (
                        <div>
                          <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-0.5">Hasta Lokal Saati</p>
                          <p className="text-[13px] font-bold text-indigo-600 flex items-center gap-1">
                            {data.patientLocalTimeNow} 
                            <span className="text-[10px] text-[#86868B] font-medium">({data.patientTimezone})</span>
                            {(() => {
                              if (data.patientLocalTimeNow) {
                                const timeMatch = data.patientLocalTimeNow.match(/(\d{2}):(\d{2})/);
                                if (timeMatch) {
                                  const hour = parseInt(timeMatch[1], 10);
                                  if (hour >= 22 || hour < 8) return <span title="Hasta muhtemelen uyuyor"><Moon className="w-3.5 h-3.5 text-indigo-500 fill-indigo-500" /></span>;
                                }
                              }
                              return null;
                            })()}
                          </p>
                        </div>
                      )}
                    </div>

                    {data.timezoneNeedsConfirmation && (
                      <div className="flex items-center gap-1.5 p-2 bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-semibold rounded-xl">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Hasta yerel saeti teyitsiz. Aramadan önce teyit önerilir.</span>
                      </div>
                    )}
                  </div>

                  {/* Teyit Hatırlatıcıları (Sadece Klinik Randevularında varsalar listelenir) */}
                  {reminders.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5 px-1 py-1.5">
                        <Bell className="w-3.5 h-3.5 text-indigo-600" /> Teyit Hatırlatıcıları ({reminders.length})
                      </p>
                      
                      {reminders.map(task => {
                        const rMeta = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
                        const typeLabel = rMeta.reminder_type === '30_days_before' ? '30 Gün Önce Teyit' :
                                          rMeta.reminder_type === '14_days_before' ? '14 Gün Önce Teyit' :
                                          rMeta.reminder_type === '7_days_before' ? '7 Gün Önce Teyit' :
                                          rMeta.reminder_type === '1_day_before' ? '1 Gün Önce Teyit' : 'Özel Hatırlatma';

                        return (
                          <div key={task.id} className="p-3 bg-white rounded-2xl border border-black/5 shadow-sm space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[12px] font-bold text-[#1D1D1F] flex items-center gap-1.5">
                                ⏰ {typeLabel}
                              </span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${
                                task.status === 'pending'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200/50 animate-pulse'
                                  : 'bg-green-50 text-green-700 border-green-200/50'
                              }`}>
                                {task.status === 'pending' ? 'Bekliyor' : 'Tamamlandı'}
                              </span>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 text-[11px] text-[#86868B] font-semibold">
                              <div>🇹🇷 TR: {rMeta.operation_due_at_tr || '—'}</div>
                              <div>🌍 Yerel: {rMeta.patient_local_time || '—'}</div>
                            </div>

                            {rMeta.generated_draft && (
                              <div className="mt-2 p-2 bg-[#F5F5F7] rounded-xl border border-black/5 flex flex-col gap-1.5">
                                <p className="text-[10px] text-[#1D1D1F] italic font-bold">Hazır Mesaj Taslağı:</p>
                                <p className="text-[11px] text-[#1D1D1F] bg-white p-2 rounded-lg border border-black/5 whitespace-pre-wrap leading-relaxed">{rMeta.generated_draft}</p>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(rMeta.generated_draft);
                                    showAlert("Başarılı", "Taslak kopyalandı!");
                                  }}
                                  className="self-end flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors cursor-pointer"
                                >
                                  <Copy className="w-3 h-3" /> Taslağı Kopyala
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              )}

              {/* TAB 2: PLANLA */}
              {activeTab === 'plan' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  
                  {/* Randevu ve Görev Planla (FORM AT THE TOP) */}
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-4">
                    <span className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-indigo-600" /> Randevu & Görev Planla
                    </span>

                    {/* Mükerrer Görev Uyarı Bandı */}
                    {data.tasks.filter(t => t.taskType !== 'appointment_reminder' && t.status === 'pending').length > 0 && (
                      <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-[10px] text-amber-700 font-semibold leading-relaxed">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Aktif bir planlı göreviniz zaten bulunuyor. Mükerrer planlama yapmamaya dikkat edin.</span>
                      </div>
                    )}

                    <div className="space-y-3">
                      {/* Tür Segmented Group */}
                      <div>
                        <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1.5">Görev/Randevu Türü</label>
                        <div className="grid grid-cols-2 gap-1 bg-[#F5F5F7] p-1 rounded-xl">
                          {[
                            { id: 'phone_call', label: 'Telefon Görüşmesi', icon: <Phone className="w-3.5 h-3.5" /> },
                            { id: 'clinic_visit', label: 'Klinik Randevusu', icon: <Building2 className="w-3.5 h-3.5" /> },
                          ].map(item => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setPlanType(item.id as any)}
                              className={`flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-lg text-[10px] font-bold transition-all duration-200 ${
                                planType === item.id 
                                  ? 'bg-white text-indigo-600 shadow-sm border border-black/[0.02]' 
                                  : 'text-[#86868B] hover:text-[#1D1D1F]'
                              }`}
                            >
                              {item.icon}
                              <span>{item.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Hızlı Planlama Şablonları (Sadece Telefon Görüşmesi için) */}
                      {planType === 'phone_call' ? (
                        <div>
                          <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1.5">Hızlı Planlama Şablonları</label>
                          <div className="flex gap-1.5 flex-wrap">
                            {(() => {
                              const presets = [
                                { label: 'Bugün (+2s)', getValue: () => {
                                  const d = new Date();
                                  d.setHours(d.getHours() + 2);
                                  return { date: d.toISOString().split('T')[0], time: String(d.getHours()).padStart(2, '0') + ':00' };
                                }},
                                { label: 'Yarın (10:00)', getValue: () => {
                                  const d = new Date();
                                  d.setDate(d.getDate() + 1);
                                  return { date: d.toISOString().split('T')[0], time: '10:00' };
                                }},
                                { label: '3 Gün Sonra', getValue: () => {
                                  const d = new Date();
                                  d.setDate(d.getDate() + 3);
                                  return { date: d.toISOString().split('T')[0], time: '14:00' };
                                }},
                                { label: '5 Gün Sonra', getValue: () => {
                                  const d = new Date();
                                  d.setDate(d.getDate() + 5);
                                  return { date: d.toISOString().split('T')[0], time: '11:00' };
                                }}
                              ];

                              const matchedPreset = presets.find(p => {
                                const vals = p.getValue();
                                return planDate === vals.date && planTime === vals.time;
                              });

                              const isCustomActive = !matchedPreset && planDate && planTime;

                              return (
                                <>
                                  {presets.map(p => {
                                    const vals = p.getValue();
                                    const isActive = planDate === vals.date && planTime === vals.time;
                                    return (
                                      <button
                                        key={p.label}
                                        type="button"
                                        onClick={() => {
                                          setPlanDate(vals.date);
                                          setPlanTime(vals.time);
                                        }}
                                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all duration-200 ${
                                          isActive 
                                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                                            : 'bg-white hover:bg-[#F5F5F7] border-black/5 text-[#86868B] hover:text-[#1D1D1F]'
                                        }`}
                                      >
                                        {p.label}
                                      </button>
                                    );
                                  })}

                                  <button
                                    type="button"
                                    onClick={() => {
                                      const now = new Date();
                                      const year = now.getFullYear();
                                      const month = String(now.getMonth() + 1).padStart(2, '0');
                                      const day = String(now.getDate()).padStart(2, '0');
                                      const hours = String(now.getHours()).padStart(2, '0');
                                      const mins = String(now.getMinutes()).padStart(2, '0');
                                      setPlanDate(`${year}-${month}-${day}`);
                                      setPlanTime(`${hours}:${mins}`);
                                    }}
                                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all duration-200 ${
                                      isCustomActive 
                                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                                        : 'bg-white hover:bg-[#F5F5F7] border-black/5 text-[#86868B] hover:text-[#1D1D1F]'
                                    }`}
                                  >
                                    ⏱️ Özel Zaman
                                  </button>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      ) : (
                        /* Klinik Randevusu için 4 Aşamalı Teyit Akışı İnteraktif Canlı Ön İzleme */
                        planYear && planMonth && (
                          <div className="bg-white rounded-xl border border-black/5 p-3 space-y-2.5 animate-in fade-in duration-200">
                            <div className="flex items-center justify-between">
                              <span className="text-[9.5px] font-bold text-[#86868B] uppercase tracking-wider block">
                                🔔 Teyit & Hatırlatıcı Takvimi (Onaylamak için tıklayın)
                              </span>
                              <span className="text-[8px] font-extrabold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-0.2 uppercase tracking-wide">
                                Tıkla-Onayla
                              </span>
                            </div>
                            
                            {(() => {
                              try {
                                const day = planDay || '01';
                                const time = planTimeCv || '10:00';
                                const baseDate = new Date(`${planYear}-${planMonth}-${day}T${time}:00`);
                                if (isNaN(baseDate.getTime())) return <p className="text-[10px] text-red-500">Geçersiz tarih</p>;

                                const offsets = [
                                  { label: '1 Ay Kala', days: 30, key: '30_days_before' },
                                  { label: '2 Hafta Kala', days: 14, key: '14_days_before' },
                                  { label: '1 Hafta Kala', days: 7, key: '7_days_before' },
                                  { label: '1 Gün Önce', days: 1, key: '1_day_before' },
                                ];

                                return (
                                  <div className="grid grid-cols-4 gap-2 relative pt-2">
                                    {/* Horizontal connector line */}
                                    <div className="absolute left-[12%] right-[12%] top-[20px] h-0.5 bg-indigo-100" />
                                    
                                    {offsets.map((o, idx) => {
                                      const remDate = new Date(baseDate.getTime());
                                      remDate.setDate(remDate.getDate() - o.days);
                                      remDate.setHours(10, 0, 0, 0);

                                      const isPast = remDate.getTime() <= Date.now();
                                      const dateStr = remDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
                                      const isApproved = approvedReminders[o.key];

                                      return (
                                        <div key={o.label} className="flex flex-col items-center text-center relative z-10">
                                          <button 
                                            type="button"
                                            disabled={isPast}
                                            onClick={() => {
                                              setApprovedReminders(prev => ({
                                                ...prev,
                                                [o.key]: !prev[o.key]
                                              }));
                                            }}
                                            className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-extrabold transition-all duration-300 ${
                                              isPast 
                                                ? 'bg-[#F5F5F7] border border-black/10 text-[#86868B] cursor-not-allowed' 
                                                : isApproved
                                                  ? 'bg-indigo-600 border-2 border-indigo-600 text-white shadow-md shadow-indigo-600/20 hover:scale-105 active:scale-95'
                                                  : 'bg-white border-2 border-[#86868B]/30 text-[#86868B] hover:border-indigo-400 hover:text-indigo-500 hover:scale-105 active:scale-95'
                                            }`} 
                                            title={isPast ? 'Süreç geçmişte kalmıştır.' : 'Teyit hatırlatıcısını onaylamak veya iptal etmek için tıklayın.'}
                                          >
                                            {isPast ? '—' : isApproved ? '✓' : '+'}
                                          </button>
                                          <span className={`text-[9px] font-bold mt-1.5 block truncate w-full px-0.5 ${
                                            isPast ? 'text-[#86868B] opacity-60' : isApproved ? 'text-indigo-600 font-bold' : 'text-[#1D1D1F]'
                                          }`}>
                                            {o.label}
                                          </span>
                                          <span className={`text-[8.5px] font-bold mt-0.5 ${
                                            isPast ? 'text-[#86868B] opacity-50' : isApproved ? 'text-indigo-600 font-extrabold' : 'text-[#86868B]'
                                          }`}>
                                            {isPast ? 'Kurulmayacak' : isApproved ? `${dateStr} (Onaylı)` : `${dateStr} (Pasif)`}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              } catch (_) {
                                return null;
                              }
                            })()}
                          </div>
                        )
                      )}

                      {/* Date & Time Input / Dropdowns Grid */}
                      {planType === 'phone_call' ? (
                        <div className="grid grid-cols-2 gap-3 animate-in fade-in duration-200">
                          <div>
                            <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Tarih</label>
                            <input 
                              type="date" 
                              value={planDate} 
                              onChange={e => setPlanDate(e.target.value)} 
                              required 
                              className="w-full px-3 py-2 bg-[#F5F5F7] rounded-xl text-xs font-semibold outline-none border border-transparent focus:border-indigo-500/25 focus:bg-white transition-all duration-200" 
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Saat (TR)</label>
                            <input 
                              type="time" 
                              value={planTime} 
                              onChange={e => setPlanTime(e.target.value)} 
                              required 
                              className="w-full px-3 py-2 bg-[#F5F5F7] rounded-xl text-xs font-semibold outline-none border border-transparent focus:border-indigo-500/25 focus:bg-white transition-all duration-200" 
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3 animate-in fade-in duration-200">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Yıl</label>
                              <select
                                value={planYear}
                                onChange={e => setPlanYear(e.target.value)}
                                className="w-full px-3 py-2 bg-[#F5F5F7] rounded-xl text-xs font-semibold outline-none border border-transparent focus:border-indigo-500/25 focus:bg-white transition-all duration-200 appearance-none"
                              >
                                {yearsOptions.map(y => (
                                  <option key={y} value={y}>{y}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Ay</label>
                              <select
                                value={planMonth}
                                onChange={e => setPlanMonth(e.target.value)}
                                className="w-full px-3 py-2 bg-[#F5F5F7] rounded-xl text-xs font-semibold outline-none border border-transparent focus:border-indigo-500/25 focus:bg-white transition-all duration-200 appearance-none"
                              >
                                {monthsOptions.map((m: any) => (
                                  <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Gün (İsteğe Bağlı)</label>
                              <select
                                value={planDay}
                                onChange={e => setPlanDay(e.target.value)}
                                className="w-full px-3 py-2 bg-[#F5F5F7] rounded-xl text-xs font-semibold outline-none border border-transparent focus:border-indigo-500/25 focus:bg-white transition-all duration-200 appearance-none"
                              >
                                <option value="">Seçilmedi (Ay Geneli)</option>
                                {daysOptions.map(d => (
                                  <option key={d} value={d}>{d}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Saat (İsteğe Bağlı)</label>
                              <select
                                value={planTimeCv}
                                onChange={e => setPlanTimeCv(e.target.value)}
                                disabled={!planDay}
                                className="w-full px-3 py-2 bg-[#F5F5F7] rounded-xl text-xs font-semibold outline-none border border-transparent focus:border-indigo-500/25 focus:bg-white transition-all duration-200 appearance-none disabled:opacity-50"
                              >
                                <option value="">Saat Seçilmedi (10:00)</option>
                                {timesOptions.map(t => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Görev Notu */}
                      <div>
                        <label className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Görev Notu</label>
                        <input 
                          type="text" 
                          value={planNote} 
                          onChange={e => setPlanNote(e.target.value)} 
                          placeholder="Eklemek istediğiniz özel not veya detay..." 
                          className="w-full px-3 py-2.5 bg-[#F5F5F7] rounded-xl text-xs font-semibold outline-none border border-transparent focus:border-indigo-500/25 focus:bg-white transition-all duration-200" 
                        />
                      </div>

                      <button 
                        type="button" 
                        onClick={handleCreatePlan}
                        disabled={planLoading || (planType === 'phone_call' ? (!planDate || !planTime) : (!planYear || !planMonth))} 
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 shadow-sm transition-all duration-200"
                      >
                        {planLoading ? 'Oluşturuluyor...' : (planType === 'clinic_visit' ? 'Randevuyu Planla' : 'Görevi Planla')}
                      </button>
                    </div>
                  </div>

                  {/* Planlanmış Görevler & Hatırlatıcılar (LIST AT THE BOTTOM) */}
                  {(() => {
                    const activeTasks = data.tasks.filter(t => t.taskType !== 'appointment_reminder');
                    const hasTasks = data.tasks.length > 0;

                    if (!hasTasks) return null;

                    return (
                      <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-3">
                        <span className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-indigo-600" /> Planlanmış Görevler & Hatırlatıcılar
                        </span>
                        
                        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                          {activeTasks.map(task => {
                            const isEditing = editingTaskId === task.id;
                            const childReminders = data.tasks.filter(
                              r => r.taskType === 'appointment_reminder' && r.metadata?.parent_task_id === task.id
                            );

                            if (isEditing) {
                              const isClinicVisit = task.metadata?.appointment_type === 'clinic_visit';
                              return (
                                <div key={task.id} className="p-3.5 bg-indigo-50/50 rounded-xl border border-indigo-150 space-y-3 text-[11px] animate-in fade-in duration-200">
                                  <div className="font-bold text-[#1D1D1F] flex items-center justify-between">
                                    <span className="flex items-center gap-1">✏️ {isClinicVisit ? 'Randevuyu Düzenle' : 'Görevi Düzenle'}: <strong className="text-indigo-900">{task.title}</strong></span>
                                    <button 
                                      type="button" 
                                      onClick={() => setEditingTaskId(null)} 
                                      className="text-[10px] text-[#86868B] hover:text-[#1D1D1F] font-bold"
                                    >
                                      Vazgeç
                                    </button>
                                  </div>
                                  
                                  {!isClinicVisit ? (
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Tarih</label>
                                        <input 
                                          type="date" 
                                          value={editTaskDate} 
                                          onChange={e => setEditTaskDate(e.target.value)} 
                                          className="w-full px-2.5 py-1.5 bg-white rounded-lg text-xs font-semibold outline-none border border-black/10 focus:border-indigo-500 transition-all duration-200" 
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Saat (TR)</label>
                                        <input 
                                          type="time" 
                                          value={editTaskTime} 
                                          onChange={e => setEditTaskTime(e.target.value)} 
                                          className="w-full px-2.5 py-1.5 bg-white rounded-lg text-xs font-semibold outline-none border border-black/10 focus:border-indigo-500 transition-all duration-200" 
                                        />
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <label className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Yıl</label>
                                          <select
                                            value={editTaskYear}
                                            onChange={e => setEditTaskYear(e.target.value)}
                                            className="w-full px-2.5 py-1.5 bg-white rounded-lg text-xs font-semibold outline-none border border-black/10 focus:border-indigo-500 transition-all duration-200 appearance-none"
                                          >
                                            {yearsOptions.map(y => (
                                              <option key={y} value={y}>{y}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Ay</label>
                                          <select
                                            value={editTaskMonth}
                                            onChange={e => setEditTaskMonth(e.target.value)}
                                            className="w-full px-2.5 py-1.5 bg-white rounded-lg text-xs font-semibold outline-none border border-black/10 focus:border-indigo-500 transition-all duration-200 appearance-none"
                                          >
                                            {monthsOptions.map((m: any) => (
                                              <option key={m.value} value={m.value}>{m.label}</option>
                                            ))}
                                          </select>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <label className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Gün (İsteğe Bağlı)</label>
                                          <select
                                            value={editTaskDay}
                                            onChange={e => setEditTaskDay(e.target.value)}
                                            className="w-full px-2.5 py-1.5 bg-white rounded-lg text-xs font-semibold outline-none border border-black/10 focus:border-indigo-500 transition-all duration-200 appearance-none"
                                          >
                                            <option value="">Seçilmedi (Ay Geneli)</option>
                                            {daysOptions.map(d => (
                                              <option key={d} value={d}>{d}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Saat (İsteğe Bağlı)</label>
                                          <select
                                            value={editTaskTimeCv}
                                            onChange={e => setEditTaskTimeCv(e.target.value)}
                                            disabled={!editTaskDay}
                                            className="w-full px-2.5 py-1.5 bg-white rounded-lg text-xs font-semibold outline-none border border-black/10 focus:border-indigo-500 transition-all duration-200 appearance-none disabled:opacity-50"
                                          >
                                            <option value="">Saat Seçilmedi (10:00)</option>
                                            {timesOptions.map(t => (
                                              <option key={t} value={t}>{t}</option>
                                            ))}
                                          </select>
                                        </div>
                                      </div>

                                      {/* Teyit & Hatırlatıcı Akışını Düzenle */}
                                      <div className="bg-white rounded-xl border border-black/5 p-3 space-y-2.5">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[9.5px] font-bold text-[#86868B] uppercase tracking-wider block">
                                            🔔 Teyit & Hatırlatıcı Akışını Düzenle (Tıklayarak Onaylayın)
                                          </span>
                                        </div>
                                        {(() => {
                                          try {
                                            if (!editTaskYear || !editTaskMonth) return null;
                                            const day = editTaskDay || '01';
                                            const time = editTaskTimeCv || '10:00';
                                            const baseDate = new Date(`${editTaskYear}-${editTaskMonth}-${day}T${time}:00`);
                                            if (isNaN(baseDate.getTime())) return null;

                                            const offsets = [
                                              { label: '1 Ay Kala', days: 30, key: '30_days_before' },
                                              { label: '2 Hafta Kala', days: 14, key: '14_days_before' },
                                              { label: '1 Hafta Kala', days: 7, key: '7_days_before' },
                                              { label: '1 Gün Önce', days: 1, key: '1_day_before' },
                                            ];

                                            return (
                                              <div className="grid grid-cols-4 gap-2 relative pt-2">
                                                <div className="absolute left-[12%] right-[12%] top-[20px] h-0.5 bg-indigo-100" />
                                                {offsets.map((o, idx) => {
                                                  const remDate = new Date(baseDate.getTime());
                                                  remDate.setDate(remDate.getDate() - o.days);
                                                  remDate.setHours(10, 0, 0, 0);

                                                  const isPast = remDate.getTime() <= Date.now();
                                                  const dateStr = remDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
                                                  const isApproved = editApprovedReminders[o.key];

                                                  return (
                                                    <div key={o.label} className="flex flex-col items-center text-center relative z-10">
                                                      <button 
                                                        type="button"
                                                        disabled={isPast}
                                                        onClick={() => {
                                                          setEditApprovedReminders(prev => ({
                                                            ...prev,
                                                            [o.key]: !prev[o.key]
                                                          }));
                                                        }}
                                                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-extrabold transition-all duration-300 ${
                                                          isPast 
                                                            ? 'bg-[#F5F5F7] border border-black/10 text-[#86868B] cursor-not-allowed' 
                                                            : isApproved
                                                              ? 'bg-indigo-600 border-2 border-indigo-600 text-white shadow-md shadow-indigo-600/20 hover:scale-105 active:scale-95'
                                                              : 'bg-white border-2 border-[#86868B]/30 text-[#86868B] hover:border-indigo-400 hover:text-indigo-500 hover:scale-105 active:scale-95'
                                                        }`}
                                                        title={isPast ? 'Süreç geçmişte kalmıştır.' : 'Teyit durumunu onaylamak için tıklayın.'}
                                                      >
                                                        {isPast ? '—' : isApproved ? '✓' : '+'}
                                                      </button>
                                                      <span className={`text-[9px] font-bold mt-1.5 block truncate w-full px-0.5 ${
                                                        isPast ? 'text-[#86868B] opacity-60' : isApproved ? 'text-indigo-600 font-bold' : 'text-[#1D1D1F]'
                                                      }`}>
                                                        {o.label}
                                                      </span>
                                                      <span className={`text-[8.5px] font-bold mt-0.5 ${
                                                        isPast ? 'text-[#86868B] opacity-50' : isApproved ? 'text-indigo-600 font-extrabold' : 'text-[#86868B]'
                                                      }`}>
                                                        {isPast ? 'Kurulmayacak' : isApproved ? `${dateStr} (Onaylı)` : `${dateStr} (Pasif)`}
                                                      </span>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            );
                                          } catch (_) {
                                            return null;
                                          }
                                        })()}
                                      </div>
                                    </div>
                                  )}

                                  <div>
                                    <label className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Görev Notu</label>
                                    <input 
                                      type="text" 
                                      value={editTaskNote} 
                                      onChange={e => {
                                        setEditTaskNote(e.target.value);
                                        setEditTaskDescription(e.target.value);
                                      }} 
                                      placeholder="Eklemek istediğiniz özel not veya detay..." 
                                      className="w-full px-2.5 py-1.5 bg-white rounded-lg text-xs font-semibold outline-none border border-black/10 focus:border-indigo-500 transition-all duration-200" 
                                    />
                                  </div>

                                  <button 
                                    type="button" 
                                    onClick={() => handleUpdateTask(task.id)}
                                    disabled={isUpdatingTask || (isClinicVisit ? (!editTaskYear || !editTaskMonth) : (!editTaskDate || !editTaskTime))}
                                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1 shadow-sm"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>{isUpdatingTask ? 'Güncelleniyor...' : (isClinicVisit ? 'Randevuyu Güncelle' : 'Görevi Güncelle')}</span>
                                  </button>
                                </div>
                              );
                            }

                            const isClinicVisit = task.metadata?.appointment_type === 'clinic_visit';

                            return (
                              <div key={task.id} className="bg-[#F5F5F7] rounded-xl border border-black/5 overflow-hidden flex flex-col text-[11px] hover:shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-300">
                                {/* Parent Task Card Body */}
                                <div className="p-3.5 flex flex-col gap-2.5 bg-gradient-to-br from-white to-[#F5F5F7]">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-1">
                                      <div className="font-bold text-[#1D1D1F] flex items-center gap-1.5">
                                        <span>⏰ {task.title}</span>
                                        <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider ${
                                          isClinicVisit 
                                            ? 'bg-purple-50 border border-purple-100 text-purple-600' 
                                            : 'bg-indigo-50 border border-indigo-100 text-indigo-600'
                                        }`}>
                                          {isClinicVisit ? 'Klinik Randevusu' : 'Telefon Görüşmesi'}
                                        </span>
                                      </div>
                                      {task.description && <p className="text-[#86868B] leading-relaxed font-semibold">{task.description}</p>}
                                      {task.dueAt && (
                                        <p className="text-[10px] text-[#86868B] font-bold flex items-center gap-1">
                                          <span>📅</span>
                                          <span>Tarih: {task.metadata?.is_partial_date 
                                            ? formatPartialDate(task.metadata) 
                                            : new Date(task.dueAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}</span>
                                        </p>
                                      )}
                                    </div>
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                      task.status === 'pending' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
                                    }`}>
                                      {task.status === 'pending' ? 'Bekliyor' : task.status}
                                    </span>
                                  </div>

                                  {task.status === 'pending' && (
                                    <div className="flex items-center gap-2 pt-2 border-t border-black/[0.04]">
                                      {/* Edit Button */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingTaskId(task.id);
                                          const taskDateObj = new Date(task.dueAt || '');
                                          const year = taskDateObj.getFullYear();
                                          const month = String(taskDateObj.getMonth() + 1).padStart(2, '0');
                                          const day = String(taskDateObj.getDate()).padStart(2, '0');
                                          setEditTaskDate(`${year}-${month}-${day}`);
                                          const hours = String(taskDateObj.getHours()).padStart(2, '0');
                                          const mins = String(taskDateObj.getMinutes()).padStart(2, '0');
                                          setEditTaskTime(`${hours}:${mins}`);
                                          
                                          setEditTaskNote(task.metadata?.note || "");
                                          setEditTaskDescription(task.description || "");

                                          // Initialize CV editing states
                                          const isCv = task.metadata?.appointment_type === 'clinic_visit';
                                          if (isCv) {
                                            setEditTaskYear(task.metadata?.selected_year || String(year));
                                            setEditTaskMonth(task.metadata?.selected_month || month);
                                            setEditTaskDay(task.metadata?.selected_day || "");
                                            setEditTaskTimeCv(task.metadata?.selected_time || "");
                                            
                                            const appRems = task.metadata?.approved_reminders || {};
                                            setEditApprovedReminders({
                                              '30_days_before': !!appRems['30_days_before'],
                                              '14_days_before': !!appRems['14_days_before'],
                                              '7_days_before': !!appRems['7_days_before'],
                                              '1_day_before': !!appRems['1_day_before'],
                                            });
                                          } else {
                                            setEditTaskYear("");
                                            setEditTaskMonth("");
                                            setEditTaskDay("");
                                            setEditTaskTimeCv("");
                                            setEditApprovedReminders({
                                              '30_days_before': false,
                                              '14_days_before': false,
                                              '7_days_before': false,
                                              '1_day_before': false,
                                            });
                                          }
                                        }}
                                        className="flex-1 py-1.5 px-3 bg-white hover:bg-[#F5F5F7] border border-black/5 text-[#86868B] hover:text-[#1D1D1F] rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all duration-200"
                                      >
                                        <Edit3 className="w-3 h-3" />
                                        <span>Düzenle</span>
                                      </button>

                                      {/* Delete Button */}
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteTask(task.id)}
                                        className="flex-1 py-1.5 px-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all duration-200"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                        <span>Sil</span>
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Child Reminders Indented Timeline View */}
                                {childReminders.length > 0 && (
                                  <div className="px-3.5 pb-3.5 pt-2 bg-[#FAFAFC] border-t border-black/[0.03] space-y-2.5 relative">
                                    {/* Timeline vertical connector line */}
                                    <div className="absolute left-[21px] top-4 bottom-7 w-0.5 bg-indigo-100/50" />

                                    <div className="text-[8.5px] font-bold text-indigo-950/60 uppercase tracking-wider mb-1 flex items-center gap-1">
                                      <span>🔔 AI HATIRLATICI VE TEYİT AKIŞI</span>
                                    </div>

                                    {childReminders.map(rem => {
                                      const remMeta = typeof rem.metadata === 'string' ? JSON.parse(rem.metadata) : (rem.metadata || {});
                                      const isCompleted = rem.status === 'completed';

                                      return (
                                        <div key={rem.id} className="flex items-start gap-2.5 relative group text-[10.5px]">
                                          {/* Bullet point status indicator */}
                                          <div className={`w-[14px] h-[14px] rounded-full flex items-center justify-center shrink-0 z-10 transition-all duration-200 ${
                                            isCompleted 
                                              ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/10' 
                                              : 'bg-white border-2 border-indigo-200 text-indigo-500'
                                          }`}>
                                            {isCompleted ? (
                                              <Check className="w-2 h-2 stroke-[3.5]" />
                                            ) : (
                                              <Clock className="w-2 h-2 stroke-[2.5]" />
                                            )}
                                          </div>

                                          {/* Details container */}
                                          <div className="flex-1 min-w-0 bg-white/40 group-hover:bg-white/90 p-2 rounded-lg border border-black/[0.02] hover:border-black/[0.04] transition-all duration-200">
                                            <div className="flex items-start justify-between gap-2">
                                              <div>
                                                <span className={`font-bold ${isCompleted ? 'text-[#86868B] line-through' : 'text-[#1D1D1F]'}`}>
                                                  {rem.title}
                                                </span>
                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[9.5px] text-[#86868B] font-semibold">
                                                  <span className="flex items-center gap-0.5">🇹🇷 {remMeta.operation_due_at_tr || '—'}</span>
                                                  <span className="text-black/5">•</span>
                                                  <span className="flex items-center gap-0.5">🌍 {remMeta.patient_local_time || '—'}</span>
                                                </div>
                                              </div>
                                              <div className="flex items-center gap-1.5 shrink-0">
                                                <span className={`text-[8.5px] font-bold px-1.2 py-0.4 rounded ${
                                                  isCompleted ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-700'
                                                }`}>
                                                  {isCompleted ? 'İletildi' : 'Kuyrukta'}
                                                </span>
                                                {rem.status === 'pending' && (
                                                  <button
                                                    type="button"
                                                    onClick={() => handleDeleteTask(rem.id)}
                                                    className="p-0.5 text-[#86868B] hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                    title="Hatırlatıcıyı Sil"
                                                  >
                                                    <Trash2 className="w-3 h-3" />
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* TAB 3: DETAY */}
              {activeTab === 'detail' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  
                  {/* Form Bilgileri (Eğer varsa bu sekmenin en tepesinde yer alacak) */}
                  {data.leadRawData && Object.keys(data.leadRawData).length > 0 && (
                    <div id="section-form" className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden transition-all duration-200">
                      <button
                        onClick={() => setIsFormExpanded(!isFormExpanded)}
                        className="w-full flex items-center justify-between p-4 bg-white hover:bg-[#F5F5F7] transition-colors duration-200 outline-none"
                      >
                        <span className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-indigo-600" /> Form Bilgileri
                        </span>
                        <ChevronDown 
                          className={`w-4 h-4 text-[#86868B] transition-transform duration-300 ${
                            isFormExpanded ? "transform rotate-180" : ""
                          }`} 
                        />
                      </button>
                      {isFormExpanded && (
                        <div className="p-4 pt-0 border-t border-black/[0.03] space-y-3 bg-white animate-in fade-in slide-in-from-top-1 duration-200">
                          <FormDataDisplay rawData={data.leadRawData} formName={data.leadFormName} />
                        </div>
                      )}
                    </div>
                  )}



                  {/* Zaman Çizelgesi */}
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden transition-all duration-200">
                    <button
                      onClick={() => setIsTimelineExpanded(!isTimelineExpanded)}
                      className="w-full flex items-center justify-between p-4 bg-white hover:bg-[#F5F5F7] transition-colors duration-200 outline-none"
                    >
                      <span className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-indigo-600" /> Zaman Çizelgesi
                      </span>
                      <ChevronDown 
                        className={`w-4 h-4 text-[#86868B] transition-transform duration-300 ${
                          isTimelineExpanded ? "transform rotate-180" : ""
                        }`} 
                      />
                    </button>
                    {isTimelineExpanded && (
                      <div className="p-4 pt-0 border-t border-black/[0.03] space-y-3 bg-white animate-in fade-in slide-in-from-top-1 duration-200">
                        <TimelineDisplay timeline={data.timeline} />
                      </div>
                    )}
                  </div>

                  {/* Medya / Belgeler */}
                  <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden transition-all duration-200">
                    <button
                      onClick={() => setIsMediaExpanded(!isMediaExpanded)}
                      className="w-full flex items-center justify-between p-4 bg-white hover:bg-[#F5F5F7] transition-colors duration-200 outline-none"
                    >
                      <span className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-indigo-600" /> Medya & Belgeler
                      </span>
                      <ChevronDown 
                        className={`w-4 h-4 text-[#86868B] transition-transform duration-300 ${
                          isMediaExpanded ? "transform rotate-180" : ""
                        }`} 
                      />
                    </button>
                    {isMediaExpanded && (
                      <div className="p-4 pt-0 border-t border-black/[0.03] space-y-3 bg-white animate-in fade-in slide-in-from-top-1 duration-200">
                        {data.mediaFiles && data.mediaFiles.length > 0 ? (
                          <div className="grid grid-cols-1 gap-2">
                            {data.mediaFiles.map((file: any) => {
                              const isImg = file.mediaType === 'image' || file.mediaType === 'sticker';
                              const isDoc = file.mediaType === 'document';
                              const isAudio = file.mediaType === 'audio';
                              const isVideo = file.mediaType === 'video';
                              const isLoc = file.mediaType === 'location';
                              
                              let iconElement = <FileText className="w-4 h-4 text-indigo-500" />;
                              let badgeText = "BELGE";
                              let badgeBg = "bg-indigo-50 text-indigo-600 border-indigo-100";
                              
                              if (isImg) {
                                iconElement = <Image className="w-4 h-4 text-sky-500" />;
                                badgeText = "GÖRSEL";
                                badgeBg = "bg-sky-50 text-sky-600 border-sky-100";
                              } else if (isVideo) {
                                iconElement = <Play className="w-4 h-4 text-emerald-500" />;
                                badgeText = "VİDEO";
                                badgeBg = "bg-emerald-50 text-emerald-600 border-emerald-100";
                              } else if (isAudio) {
                                iconElement = <Mic className="w-4 h-4 text-amber-500" />;
                                badgeText = "SES";
                                badgeBg = "bg-amber-50 text-amber-600 border-amber-100";
                              } else if (isLoc) {
                                iconElement = <MapPin className="w-4 h-4 text-red-500" />;
                                badgeText = "KONUM";
                                badgeBg = "bg-red-50 text-red-600 border-red-100";
                              }

                              const formattedDate = new Date(file.createdAt).toLocaleDateString('tr-TR', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'Europe/Istanbul'
                              });

                              const filename = file.mediaMetadata?.filename || 
                                (file.mediaUrl ? file.mediaUrl.split('/').pop()?.split('_').pop() : 'Belge');

                              return (
                                <div 
                                  key={file.id} 
                                  onClick={() => {
                                    if (isImg) {
                                      const idx = allGalleryImages.findIndex((ci: any) => ci.src === file.mediaUrl);
                                      setGallery({
                                        images: allGalleryImages,
                                        currentIndex: idx >= 0 ? idx : 0,
                                      });
                                    } else {
                                      window.open(file.mediaUrl, '_blank', 'noopener,noreferrer');
                                    }
                                  }}
                                  className="group flex items-center justify-between p-3 bg-white hover:bg-[#F5F5F7] rounded-xl border border-black/5 transition-all duration-200 cursor-pointer"
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    {isImg && file.mediaUrl ? (
                                      <div className="relative w-10 h-10 rounded-lg overflow-hidden border border-black/5 bg-gray-50 flex-shrink-0">
                                        <img 
                                          src={file.mediaUrl} 
                                          alt={filename} 
                                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" 
                                        />
                                      </div>
                                    ) : (
                                      <div className="w-10 h-10 rounded-lg bg-[#F5F5F7] border border-black/[0.02] flex items-center justify-center flex-shrink-0 group-hover:bg-white group-hover:border-black/5 transition-all duration-200">
                                        {iconElement}
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <p className="text-[12px] font-bold text-[#1D1D1F] truncate group-hover:text-indigo-600 transition-colors max-w-[200px] md:max-w-[250px]" title={filename}>
                                        {filename}
                                      </p>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`text-[8px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${badgeBg}`}>
                                          {badgeText}
                                        </span>
                                        <span className="text-[10px] text-[#86868B] font-semibold">{formattedDate}</span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                    <a 
                                      href={file.mediaUrl} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="w-8 h-8 rounded-lg flex items-center justify-center bg-white hover:bg-indigo-50 border border-black/5 hover:border-indigo-150 text-[#86868B] hover:text-indigo-600 shadow-sm transition-all"
                                      title="Görüntüle / İndir"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                    </a>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="p-6 bg-white rounded-xl border border-black/5 shadow-sm text-center w-full">
                            <FileText className="w-8 h-8 text-[#C7C7CC] mx-auto mb-2" />
                            <p className="text-[12px] text-[#86868B]">Henüz dosya veya medya yüklenmemiş.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 👇 AKILLI ONAY & AKSİYON DECK (Sticky Footer) */}
        {(activeBotTask || actionSuccess) && (
          <div className="shrink-0 bg-white/90 backdrop-blur-lg border-t border-black/5 p-4 shadow-[0_-8px_30px_rgba(0,0,0,0.05)] space-y-3 z-30 animate-in fade-in duration-200">
            {/* BOT TASLAĞI (Onay & Gönder Şablonu) */}
            {activeBotTask && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5 text-cyan-600 animate-pulse" /> 🤖 BOT TASLAĞI (Onay & Gönder Şablonu)
                  </span>
                  <span className="text-[9px] bg-amber-50 border border-amber-200 text-amber-600 font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                    KOORDİNATÖR ONAYI BEKLİYOR
                  </span>
                </div>

                <div className="p-3 bg-[#F5F5F7] border border-black/5 rounded-xl flex flex-col gap-2.5">
                  <textarea
                    value={editableDraft}
                    onChange={(e) => setEditableDraft(e.target.value)}
                    className="w-full h-24 p-2 bg-white rounded-lg border border-black/5 text-xs text-[#1D1D1F] font-mono leading-relaxed outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                    placeholder="Bot taslağı yükleniyor..."
                  />
                  <div className="flex items-center justify-between text-[11px]">
                    <button
                      onClick={() => handleCancelBotTask(activeBotTask.id)}
                      disabled={actionLoading === activeBotTask.id}
                      className="text-red-500 hover:text-red-600 font-bold"
                    >
                      {actionLoading === activeBotTask.id ? '...' : 'İptal Et'}
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(editableDraft);
                          showAlert("Başarılı", "Taslak kopyalandı!");
                        }}
                        className="px-3 py-1.5 bg-white hover:bg-black/5 text-indigo-600 border border-black/5 shadow-sm rounded-lg font-bold transition-all"
                      >
                        Kopyala
                      </button>
                      <button
                        onClick={() => handleCompleteBotTask(activeBotTask.id)}
                        disabled={actionLoading === activeBotTask.id}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm transition-all"
                      >
                        {actionLoading === activeBotTask.id ? '...' : 'Onayla & Gönder'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {actionSuccess && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-xl text-[11px] font-semibold text-green-700">
                <CheckCircle2 className="w-3.5 h-3.5 animate-bounce" /> {actionSuccess}
              </div>
            )}
          </div>
        )}

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
        {/* ── Media Gallery Lightbox (Portal to body — escapes z-0 stacking context) ── */}
        {gallery && createPortal(
          <MediaGalleryLightbox 
            images={gallery.images} 
            currentIndex={gallery.currentIndex} 
            onClose={() => setGallery(null)} 
            onNavigate={(idx) => setGallery(prev => prev ? { ...prev, currentIndex: idx } : null)}
          />,
          document.body
        )}

        {/* Custom Premium Confirm Modal */}
        {confirmModal.isOpen && createPortal(
          <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}>
            <div className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-sm p-6 mx-4 text-center animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center mb-4">
                <AlertTriangle className="w-6 h-6 text-rose-500" />
              </div>
              
              <h3 className="text-sm font-extrabold text-[#1D1D1F] mb-2">
                {confirmModal.title}
              </h3>
              
              <p className="text-[11px] font-semibold text-[#86868B] leading-relaxed px-2 mb-6">
                {confirmModal.message}
              </p>

              <div className="flex items-center justify-center gap-2 pt-2 border-t border-black/5">
                <button
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-2.5 bg-[#F5F5F7] hover:bg-[#E8E8ED] text-[#1D1D1F] rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer text-center"
                >
                  Vazgeç
                </button>
                <button
                  onClick={() => {
                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    confirmModal.onConfirm();
                  }}
                  className="flex-1 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm hover:shadow text-center"
                >
                  Onayla
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Custom Premium Alert Modal */}
        {alertModal.isOpen && createPortal(
          <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}>
            <div className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-sm p-6 mx-4 text-center animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-indigo-500" />
              </div>
              
              <h3 className="text-sm font-extrabold text-[#1D1D1F] mb-2">
                {alertModal.title}
              </h3>
              
              <p className="text-[11px] font-semibold text-[#86868B] leading-relaxed px-2 mb-6">
                {alertModal.message}
              </p>

              <div className="pt-2 border-t border-black/5">
                <button
                  onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm hover:shadow text-center"
                >
                  Tamam
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Custom Premium Cancel Prompt Modal */}
        {cancelPromptModal.isOpen && createPortal(
          <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={() => setCancelPromptModal(prev => ({ ...prev, isOpen: false }))}>
            <div className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-sm p-6 mx-4 text-left animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="text-center">
                <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
                  <XCircle className="w-6 h-6 text-amber-500" />
                </div>
                
                <h3 className="text-sm font-extrabold text-[#1D1D1F] mb-2 text-center">
                  Bot Takibini İptal Et
                </h3>
                
                <p className="text-[11px] font-semibold text-[#86868B] leading-relaxed px-2 mb-4 text-center">
                  Lütfen bu bot takip görevinin iptal edilme sebebini belirtin:
                </p>
              </div>

              <div className="mb-6 px-2">
                <input
                  type="text"
                  value={cancelPromptModal.reason}
                  onChange={(e) => setCancelPromptModal(prev => ({ ...prev, reason: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-[#F5F5F7] border border-black/5 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 text-[#1D1D1F]"
                  placeholder="İptal sebebi..."
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-center gap-2 pt-2 border-t border-black/5">
                <button
                  onClick={() => setCancelPromptModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-2.5 bg-[#F5F5F7] hover:bg-[#E8E8ED] text-[#1D1D1F] rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer text-center"
                >
                  Vazgeç
                </button>
                <button
                  onClick={async () => {
                    const taskId = cancelPromptModal.taskId;
                    const reason = cancelPromptModal.reason;
                    setCancelPromptModal(prev => ({ ...prev, isOpen: false }));
                    
                    setActionLoading(taskId);
                    try {
                      const res = await cancelBotDelegationTask(taskId, reason);
                      if (res.success) {
                        setActionSuccess('Takip başarıyla iptal edildi.');
                        mutate();
                        onRefresh?.();
                      } else {
                        showAlert("Hata", res.error || 'İşlem başarısız.');
                      }
                    } catch (err) {
                      console.error(err);
                      showAlert("Hata", 'İşlem sırasında hata oluştu.');
                    } finally {
                      setActionLoading(null);
                    }
                  }}
                  disabled={!cancelPromptModal.reason.trim()}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm hover:shadow disabled:opacity-50 text-center"
                >
                  Görevi İptal Et
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </>
  );
}

// ── Sub-components ──

function FormDataDisplay({ rawData, formName }: { rawData: Record<string, any>; formName?: string }) {
  const HIDE_KEYS = new Set(['_all_phones', 'id', 'page_id', 'form_id', 'ad_id', 'adgroup_id', 'campaign_id', 'leadgen_id', 'platform', 'is_organic', 'retailer_item_id']);
  
  const entries = Object.entries(rawData).filter(([key, value]) => {
    if (HIDE_KEYS.has(key)) return false;
    if (value === null || value === undefined || value === '') return false;
    return true;
  });

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2.5 animate-in fade-in duration-200">
      {formName && (
        <div className="flex items-center justify-between pb-1.5 border-b border-black/[0.04] mb-2">
          <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">📋 {formName}</span>
          <span className="text-[9px] bg-indigo-50 border border-indigo-100 text-indigo-600 font-bold px-2 py-0.5 rounded-full">
            FORM VERİSİ
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2">
        {entries.map(([key, value]) => {
          const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
          const isLongText = valStr.length > 60;
          
          if (isLongText) {
            return (
              <div key={key} className="flex flex-col gap-1.5 bg-[#F5F5F7] p-3.5 rounded-xl border border-black/[0.02]">
                <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                  {key.replace(/_/g, ' ')}
                </span>
                <span className="text-[12px] text-[#1D1D1F] font-semibold leading-relaxed whitespace-pre-wrap">
                  {valStr}
                </span>
              </div>
            );
          }
          
          return (
            <div key={key} className="flex items-start gap-2 bg-[#F5F5F7] p-2.5 rounded-xl border border-black/[0.02]">
              <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider min-w-[120px] shrink-0 pt-0.5">
                {key.replace(/_/g, ' ')}
              </span>
              <span className="text-[12px] text-[#1D1D1F] font-semibold break-words">
                {valStr}
              </span>
            </div>
          );
        })}
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
    <div className="bg-[#F5F5F7] rounded-xl border border-black/5 shadow-sm overflow-hidden p-1">
      <div className="divide-y divide-black/5">
        {displayed.map((entry) => (
          <div key={entry.id} className="px-3 py-2.5 flex items-start gap-3 bg-white rounded-lg mb-1 last:mb-0 border border-black/[0.02]">
            <span className="text-sm mt-0.5">{TYPE_ICONS[entry.type] || '📌'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-[#1D1D1F]">{entry.label}</p>
              {entry.description && (
                <p className="text-[11px] text-[#86868B] mt-0.5 line-clamp-2 leading-relaxed font-semibold">{entry.description}</p>
              )}
            </div>
            <span className="text-[10px] text-[#86868B] shrink-0 font-bold">
              {new Date(entry.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}
            </span>
          </div>
        ))}
      </div>
      {timeline.length > 3 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full py-2 text-center text-[11px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors border-t border-black/5"
        >
          Tümünü Göster ({timeline.length} olay)
        </button>
      )}
    </div>
  );
}

// ── Translation Helpers ──

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

const getLanguageLabel = (language?: string): string => {
  if (!language) return '';
  const LANGS: Record<string, string> = {
    'Turkish': 'Türkçe',
    'turkish': 'Türkçe',
    'English': 'İngilizce',
    'english': 'İngilizce',
    'Arabic': 'Arapça',
    'arabic': 'Arapça',
    'German': 'Almanca',
    'german': 'Almanca',
    'French': 'Fransızca',
    'french': 'Fransızca',
    'Russian': 'Rusça',
    'russian': 'Rusça',
    'Dutch': 'Felemenkçe',
    'dutch': 'Felemenkçe',
    'Finnish': 'Fince',
    'finnish': 'Fince',
    'Swedish': 'İsveççe',
    'swedish': 'İsveççe',
  };
  return LANGS[language] || language;
};

const getPriorityLabel = (priority?: string): string => {
  if (!priority) return '';
  const PRIOS: Record<string, string> = {
    'HOT': 'Sıcak Fırsat',
    'hot': 'Sıcak Fırsat',
    'WARM': 'Ilık Fırsat',
    'warm': 'Ilık Fırsat',
    'COLD': 'Soğuk',
    'cold': 'Soğuk',
  };
  return PRIOS[priority] || priority;
};

const getIntentLabel = (intent?: string): string => {
  if (!intent) return '';
  const INTENTS: Record<string, string> = {
    'report_waiting': 'Rapor Bekleniyor',
    'report_sent': 'Rapor Gönderildi',
    'appointment_request': 'Randevu Talebi',
    'price_inquiry': 'Fiyat Bilgisi İstiyor',
    'doctor_consultation': 'Doktor Görüşmesi',
    'general_inquiry': 'Genel Bilgi Talebi',
    'general_info': 'Genel Bilgi Talebi',
    'callback_request': 'Geri Arama Talebi',
    'call_request': 'Arama Talebi',
    'complaint': 'Şikayet / Destek',
    'travel_planning': 'Seyahat Planlama',
    'doctor_review': 'Doktor İncelemesi',
    'follow_up_needed': 'Takip Gerekli',
    'other': 'Diğer',
  };
  return INTENTS[intent] || intent;
};

function StageSelector({ currentStage, onStageChange }: { currentStage: string; onStageChange: (stage: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const stageInfo = getStageInfo(currentStage);

  return (
    <div className="relative inline-block text-left shrink-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border transition-all hover:shadow-sm"
        style={{ backgroundColor: `${stageInfo.color}12`, borderColor: `${stageInfo.color}25`, color: stageInfo.color }}
      >
        <span>{stageInfo.icon}</span>
        {stageInfo.label}
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
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

// ── Media Gallery Lightbox (Pre-built WhatsApp style overlay slider) ──
function MediaGalleryLightbox({ 
  images, 
  currentIndex, 
  onClose, 
  onNavigate 
}: { 
  images: Array<{ src: string; caption?: string; timeMs?: number }>;
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const thumbStripRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchDeltaX = useRef<number>(0);
  const current = images[currentIndex];

  const goNext = useCallback(() => {
    if (currentIndex < images.length - 1) onNavigate(currentIndex + 1);
  }, [currentIndex, images.length, onNavigate]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  }, [currentIndex, onNavigate]);

  // Keyboard + scroll lock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    document.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, goNext, goPrev]);

  // Auto-scroll thumbnail strip to active
  useEffect(() => {
    if (thumbStripRef.current) {
      const activeThumb = thumbStripRef.current.children[currentIndex] as HTMLElement;
      if (activeThumb) {
        activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [currentIndex]);

  // Touch handlers for swipe
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };
  const onTouchEnd = () => {
    if (touchDeltaX.current > 60) goPrev();
    else if (touchDeltaX.current < -60) goNext();
    touchDeltaX.current = 0;
  };

  if (!current) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ background: "rgba(0,0,0,0.95)" }}
      onClick={onClose}
    >
      {/* Top bar */}
      <div 
        className="flex items-center justify-between px-4 py-3 z-20 flex-shrink-0"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Counter */}
        <span className="text-white/80 text-sm font-semibold tabular-nums">
          {currentIndex + 1} / {images.length}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={current.src}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors"
            title="İndir"
          >
            <Download className="w-5 h-5 text-white" />
          </a>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>

      {/* Main image area with swipe + arrows */}
      <div
        className="flex-1 flex items-center justify-center relative px-4 min-h-0"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Left arrow */}
        {currentIndex > 0 && (
          <button
            onClick={goPrev}
            className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors z-10"
          >
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
        )}

        {/* Image */}
        <AnimatePresence mode="wait">
          <motion.img
            key={current.src}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            src={current.src}
            alt={current.caption || 'Media'}
            className="max-w-full max-h-[70vh] rounded-lg shadow-2xl select-none"
            style={{ objectFit: 'contain' }}
            draggable={false}
          />
        </AnimatePresence>

        {/* Right arrow */}
        {currentIndex < images.length - 1 && (
          <button
            onClick={goNext}
            className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors z-10"
          >
            <ChevronRight className="w-6 h-6 text-white" />
          </button>
        )}
      </div>

      {/* Caption */}
      {current.caption && (
        <div 
          className="text-center px-6 py-2 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-white/90 text-sm font-medium max-w-lg mx-auto leading-relaxed">
            {current.caption}
          </p>
        </div>
      )}

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div 
          className="flex-shrink-0 px-4 py-3 z-20"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7), transparent)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div 
            ref={thumbStripRef}
            className="flex gap-2 overflow-x-auto scrollbar-hide justify-center"
            style={{ scrollBehavior: 'smooth' }}
          >
            {images.map((img, idx) => (
              <button
                key={idx}
                onClick={() => onNavigate(idx)}
                className={`flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden transition-all duration-200 ${
                  idx === currentIndex 
                    ? 'ring-2 ring-white ring-offset-1 ring-offset-black/50 opacity-100 scale-105' 
                    : 'opacity-50 hover:opacity-75'
                }`}
              >
                <img
                  src={img.src}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
