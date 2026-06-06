"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import useSWRInfinite from "swr/infinite";
import { Search, MessageCircle, X, FileText, ChevronRight, CheckCircle2, Bot, Save, StickyNote, Sparkles, RefreshCw, ChevronDown, Filter, Zap, Send, Clock, CheckCheck, Edit3, Phone, PhoneOff, PhoneForwarded, XCircle } from "lucide-react";
import { getForms, getCampaignNames, updateLeadNotes, updateLeadStage, syncGoogleSheets } from "@/app/actions/forms";
import { toggleBotStatus } from "@/app/actions/inbox";
import { prepareGreetingDraft, sendGreetingMessage, sendFormGreetingTemplateAction, activateBot, getOutreachHistory, logCallReached, logCallMissed, logCallbackScheduled, logNotInterested, getGreetingTemplates, checkGreetingReadiness, saveGreetingDraftInternal, type OutreachLogEntry } from "@/app/actions/outreach";
import { useInboxStore } from "@/store/inbox-store";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { MapPin, Building2, Calendar, Flame, TrendingUp, User } from "lucide-react";
import { resolvePatientDisplayName, formatPhoneReadable } from "@/lib/utils/patient-name-resolver";
import { resolveCountry, deduplicatePhones, getCountryInfoByName } from "@/lib/utils/country";

// ═══ P1: Outreach status badge config ═══
const OUTREACH_BADGE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  'greeting_sent': { label: 'Mesaj Gönderildi', color: '#25D366', icon: '💬' },
  'form_greeting_template_sent': { label: 'Şablon Gönderildi', color: '#25D366', icon: '💬' },
  'bot_activated': { label: 'Bot Aktif', color: '#007AFF', icon: '🤖' },
  'called_reached': { label: 'Arandı / Ulaşıldı', color: '#0F9D58', icon: '📞' },
  'called_missed': { label: 'Arandı / Ulaşılamadı', color: '#FF9500', icon: '📵' },
  'callback_scheduled': { label: 'Geri Arama Planlandı', color: '#5856D6', icon: '🔄' },
  'not_interested': { label: 'İlgilenmiyor', color: '#FF3B30', icon: '🚫' },
  'lead_created': { label: 'Lead Oluşturuldu', color: '#FF9500', icon: '📋' },
  'opportunity_created': { label: 'Fırsat Oluşturuldu', color: '#30B0C7', icon: '🎯' },
  'notification_sent': { label: 'Bildirim Gönderildi', color: '#86868B', icon: '🔔' },
  'form_greeting_draft_saved_internal': { label: 'Taslak İç Not Kaydedildi', color: '#8E8E93', icon: '📝' },
};

const formatDate = (dateString: string) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
};

const formatTime = (dateString: string) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
};

const isTechnicalKey = (key: string): boolean => {
  const k = key.toLowerCase();
  return (
    k === 'id' ||
    k === 'leadgen_id' ||
    k === 'form_id' ||
    k === 'ad_id' ||
    k === 'adset_id' ||
    k === 'campaign_id' ||
    k === 'platform' ||
    k === 'is_organic' ||
    k === 'created_time' ||
    k === 'phone_number_id' ||
    k === 'ad_name' ||
    k === 'adset_name' ||
    k === 'campaign_name' ||
    k === 'full_name' ||
    k === 'phone_number' ||
    k.startsWith('_') ||
    k.includes('campaign') ||
    k.includes('adset') ||
    k.includes('ad_')
  );
};

// Get best display name: resolved using the patient-name-resolver utility
const getDisplayName = (form: any): string => {
  return resolvePatientDisplayName({
    oppPatientName: form.current_display_name || form.patient_name,
    convPatientName: form.patient_name,
    whatsappProfileName: form.patient_name,
    formPatientName: form.patient_name,
    formRawDataName: form.raw_data?.full_name || form.raw_data?.['full name'] || form.raw_data?.['Full Name'] || form.raw_data?.['full_name']
  });
};

// Get best date: raw_data.created_time > created_at
const getBestDate = (form: any): string => {
  const rd = form.raw_data || {};
  const ct = rd.created_time || rd.Created_Time || rd.timestamp;
  if (ct) {
    const d = new Date(ct);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return form.created_at || '';
};

// Get all phone numbers from raw_data (deduplicated by last 10 digits)
const getAllPhones = (form: any): string[] => {
  const rd = form.raw_data || {};
  let phones: string[] = [];
  try {
    if (rd._all_phones) {
      const parsed = typeof rd._all_phones === 'string' ? JSON.parse(rd._all_phones) : rd._all_phones;
      if (Array.isArray(parsed) && parsed.length > 0) phones = parsed;
    }
  } catch (_) {}
  if (phones.length === 0) phones = [form.phone_number].filter(Boolean);
  return deduplicatePhones(phones);
};

// Format phone display using formatPhoneReadable
const formatPhone = (phone: string): string => {
  return formatPhoneReadable(phone);
};

// Stage definitions
const STAGES = [
  { value: 'new', label: 'Yeni Lead', color: '#007AFF', bg: '#007AFF/10' },
  { value: 'contacted', label: 'İlk İletişim', color: '#FF9500', bg: '#FF9500/10' },
  { value: 'responded', label: 'Cevap Alındı', color: '#34C759', bg: '#34C759/10' },
  { value: 'discovery', label: 'Keşif / Analiz', color: '#5856D6', bg: '#5856D6/10' },
  { value: 'qualified', label: 'Nitelikli', color: '#30B0C7', bg: '#30B0C7/10' },
  { value: 'appointed', label: 'Randevu Aldı', color: '#0F9D58', bg: '#0F9D58/10' },
  { value: 'lost', label: 'Uygun Değil', color: '#8E8E93', bg: '#8E8E93/10' },
] as const;

const getStageInfo = (stage: string) => STAGES.find(s => s.value === stage) || STAGES[0];

// P0C: Resolve country with live CRM priority
const getFormCountry = (form: any): { name: string; flag: string; isEstimated: boolean } | null => {
  // Priority 1: Live CRM data from conversation/opportunity
  if (form.current_country) {
    const isEstimated = !form.country;
    const info = getCountryInfoByName(form.current_country);
    return info ? { ...info, isEstimated } : null;
  }
  // Priority 2: Phone prefix detection (fallback)
  const phones = getAllPhones(form);
  const info = resolveCountry(phones[0] || form.phone_number, form.raw_data);
  return info ? { ...info, isEstimated: true } : null;
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  'hot': { label: 'SICAK', color: '#FF3B30', icon: '🔥' },
  'warm': { label: 'ILIK', color: '#FF9500', icon: '🟡' },
  'cold': { label: 'SOĞUK', color: '#007AFF', icon: '🔵' },
};

// Opportunity stage system (matches /takip) — separate from lead STAGES above
const OPP_STAGES: { value: string; label: string; color: string; icon: string }[] = [
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

const getOppStageInfo = (stage: string) => OPP_STAGES.find(s => s.value === stage) || { value: stage, label: stage, color: '#86868B', icon: '❓' };

// Dropdown hook for outside click
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

export default function FormsPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const tenantId = typeof params.tenant_slug === 'string' ? params.tenant_slug : 'baskent';
  const { setActiveContact } = useInboxStore();
  
  const deepLinkPhone = searchParams.get('phone');
  const deepLinkSearch = searchParams.get('search');
  
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [campaigns, setCampaigns] = useState<string[]>([]);
  
  const [selectedForm, setSelectedForm] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [techOpen, setTechOpen] = useState(false);

  useEffect(() => {
    if (deepLinkPhone) {
      setSearchInput(deepLinkPhone);
      setDebouncedSearch(deepLinkPhone);
    } else if (deepLinkSearch) {
      setSearchInput(deepLinkSearch);
      setDebouncedSearch(deepLinkSearch);
    }
  }, [deepLinkPhone, deepLinkSearch]);

  // PHASE 2L-P0v2: Outreach state — two-step draft→send flow
  const [outreachLoading, setOutreachLoading] = useState<'draft' | 'sending' | 'bot' | 'call_action' | null>(null);
  const [outreachTimeline, setOutreachTimeline] = useState<OutreachLogEntry[]>([]);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [outreachSuccess, setOutreachSuccess] = useState<string | null>(null);
  const [greetingSent, setGreetingSent] = useState(false);
  // Draft state
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [isDraftOpen, setIsDraftOpen] = useState(false);
  // P1: Template selector
  const [templates, setTemplates] = useState<{id: string; name: string; language: string; body: string}[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  // P1: Call action note
  const [callActionNote, setCallActionNote] = useState('');
  const [showCallActions, setShowCallActions] = useState(false);
  const [botNote, setBotNote] = useState('');
  
  // Phase a2.1: unified greeting readiness state
  const [readiness, setReadiness] = useState<{
    draftTemplateAvailable: boolean;
    approvedWhatsappTemplateAvailable: boolean;
    templateConfigExists: boolean;
    templateSendable: boolean;
    templateNonCompliant: boolean;
    complianceWarning: string | null;
    source: 'message_templates' | 'system_hardcoded' | 'none';
    isWithin24hWindow: boolean;
    hardBlockedBecausePatientAlreadyInbound: boolean;
    hasHardDuplicate?: boolean;
    hasSoftDuplicate?: boolean;
    hasUnsupportedVariables?: boolean;
    draftText: string;
    templateName?: string;
    templateLanguage?: string;
    greetingSent: boolean;
  } | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ status: '', progress: 0, message: '' });

  // Header dropdowns
  const campDropdown = useDropdown();
  const stageDropdown = useDropdown();

  useEffect(() => {
    getCampaignNames().then(setCampaigns);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const getKey = (pageIndex: number, previousPageData: any) => {
    if (previousPageData && previousPageData.length < 50) return null;
    return ["forms", pageIndex + 1, debouncedSearch, sourceFilter, stageFilter];
  };

  const { data, size, setSize, isLoading, mutate } = useSWRInfinite(
    getKey, 
    ([_, page, search, source, stage]: any) => getForms(page, search, source, stage), 
    { 
      refreshInterval: 90000,
      refreshWhenHidden: false,
      revalidateOnFocus: true
    }
  );

  const forms = data ? data.flat() : [];
  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === "undefined");
  const isReachingEnd = data && data[data.length - 1]?.length < 50;

  const handleMessageClick = (form: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const displayName = getDisplayName(form);
    setActiveContact(form.phone_number, {
      id: form.phone_number,
      name: displayName,
      channel: "whatsapp",
      stage: form.stage,
      unread: 0
    });
    router.push(`/${tenantId}/inbox`);
  };

  const [isBotHandoffLoading, setIsBotHandoffLoading] = useState(false);

  const handleBotHandoff = async (form: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsBotHandoffLoading(true);
    try {
      // Enable bot for this contact
      await toggleBotStatus(form.phone_number, true);
      // Navigate to inbox with this contact selected
      const displayName = getDisplayName(form);
      setActiveContact(form.phone_number, {
        id: form.phone_number,
        name: displayName,
        channel: "whatsapp",
        stage: form.stage,
        unread: 0,
        isBotActive: true
      });
      router.push(`/${tenantId}/inbox`);
    } catch (err) {
      console.error('Bot handoff failed:', err);
    } finally {
      setIsBotHandoffLoading(false);
    }
  };

  const handleStageChange = async (form: any, newStage: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    // Optimistic update
    mutate(
      data?.map(page => page.map((f: any) => f.id === form.id ? { ...f, stage: newStage } : f)),
      false
    );
    await updateLeadStage(form.id, newStage);
    mutate();
  };

  // PHASE 2L-P0: Load outreach timeline when modal opens
  const loadOutreachTimeline = useCallback(async (leadId: string) => {
    try {
      const history = await getOutreachHistory(leadId);
      setOutreachTimeline(history);
      // Check if greeting was already sent
      const hasGreeting = history.some((h: OutreachLogEntry) => h.action === 'greeting_sent');
      setGreetingSent(hasGreeting);
    } catch (_) {
      setOutreachTimeline([]);
    }
  }, []);

  useEffect(() => {
    if (selectedForm?.id) {
      setOutreachError(null);
      setOutreachSuccess(null);
      setGreetingSent(false);
      setDraftMessage(null);
      setIsDraftOpen(false);
      setCallActionNote('');
      setShowCallActions(false);
      setBotNote('');
      setSelectedTemplateId(null);
      setTechOpen(false);
      setReadiness(null);
      loadOutreachTimeline(selectedForm.id);
      // Load templates for selector
      getGreetingTemplates().then((t: any[]) => setTemplates(t)).catch(() => setTemplates([]));
      
      // Fetch readiness status
      setReadinessLoading(true);
      checkGreetingReadiness(selectedForm.id)
        .then((res) => {
          if (res.success && res.data) {
            setReadiness(res.data);
            if (res.data.greetingSent) {
              setGreetingSent(true);
            }
          } else {
            setReadiness(null);
          }
        })
        .catch(() => setReadiness(null))
        .finally(() => setReadinessLoading(false));
    } else {
      setOutreachTimeline([]);
      setGreetingSent(false);
      setOutreachError(null);
      setOutreachSuccess(null);
      setDraftMessage(null);
      setIsDraftOpen(false);
      setCallActionNote('');
      setShowCallActions(false);
      setBotNote('');
      setSelectedTemplateId(null);
      setTechOpen(false);
      setReadiness(null);
    }
  }, [selectedForm?.id, loadOutreachTimeline]);

  // PHASE 2L-P0v2: Step 1 — Prepare greeting draft (NO WhatsApp API call)
  const handlePrepareDraft = async (form: any) => {
    setOutreachLoading('draft');
    setOutreachError(null);
    setOutreachSuccess(null);
    try {
      const result = await prepareGreetingDraft(form.id);
      if (result.success && result.draft) {
        setDraftMessage(result.draft);
        setIsDraftOpen(true);
      } else {
        setOutreachError(result.error || 'Taslak hazırlanamadı.');
      }
    } catch (err: any) {
      setOutreachError(err?.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      setOutreachLoading(null);
    }
  };

  // PHASE 2L-P0v2: Step 2 — Send coordinator-approved message via WhatsApp
  const handleConfirmSend = async (form: any) => {
    if (!draftMessage || draftMessage.trim().length === 0) {
      setOutreachError('Mesaj metni boş olamaz.');
      return;
    }

    if (!selectedTemplateId) {
      setOutreachError('Lütfen bir WhatsApp şablonu seçin.');
      return;
    }

    const tpl = templates.find(t => t.id === selectedTemplateId);
    if (!tpl) {
      setOutreachError('Seçilen şablon bulunamadı.');
      return;
    }

    // Explicit confirmation gate
    if (!window.confirm("Bu mesaj hastaya WhatsApp üzerinden gönderilecek. Lütfen bu şablonun Meta / 360dialog panelinde onaylı ve aktif olduğundan emin olun. Onaylıyor musunuz?")) {
      return;
    }

    setOutreachLoading('sending');
    setOutreachError(null);
    try {
      const result = await sendFormGreetingTemplateAction(
        form.id, 
        tpl.id, 
        tpl.name, 
        tpl.language || 'tr', 
        draftMessage
      );
      if (result.success) {
        setGreetingSent(true);
        setIsDraftOpen(false);
        setDraftMessage(null);
        setBotNote('');
        setOutreachSuccess('✅ Karşılama mesajı başarıyla gönderildi.');
        // Update stage optimistically
        mutate(
          data?.map(page => page.map((f: any) => f.id === form.id ? { ...f, stage: 'contacted' } : f)),
          false
        );
        setSelectedForm({ ...form, stage: 'contacted' });
        // Refresh timeline
        await loadOutreachTimeline(form.id);
      } else {
        setOutreachError(result.error || 'Mesaj gönderilemedi.');
      }
    } catch (err: any) {
      setOutreachError(err?.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      setOutreachLoading(null);
    }
  };

  // PHASE 2L-P0v2: Safe Alternative — Save Draft as Internal Note (Zero-Outbound)
  const handleSaveInternal = async (form: any) => {
    if (!draftMessage || draftMessage.trim().length === 0) {
      setOutreachError('Mesaj metni boş olamaz.');
      return;
    }
    setOutreachLoading('sending');
    setOutreachError(null);
    setOutreachSuccess(null);
    try {
      const result = await saveGreetingDraftInternal(form.id, draftMessage, botNote);
      if (result.success) {
        setGreetingSent(true);
        setIsDraftOpen(false);
        setDraftMessage(null);
        setBotNote('');
        setOutreachSuccess('✅ Taslak başarıyla iç not olarak kaydedildi.');
        
        // Refresh timeline
        await loadOutreachTimeline(form.id);
      } else {
        setOutreachError(result.error || 'Taslak kaydedilemedi.');
      }
    } catch (err: any) {
      setOutreachError(err?.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      setOutreachLoading(null);
    }
  };

  // PHASE 2L-P0v2: Cancel draft — no message sent, no DB write
  const handleCancelDraft = () => {
    setIsDraftOpen(false);
    setDraftMessage(null);
    setOutreachError(null);
    setSelectedTemplateId(null);
  };

  // ═══ P1: Call action handlers ═══
  const handleCallAction = async (action: 'reached' | 'missed' | 'callback' | 'not_interested', form: any) => {
    setOutreachLoading('call_action');
    setOutreachError(null);
    setOutreachSuccess(null);
    try {
      let result;
      switch (action) {
        case 'reached':
          result = await logCallReached(form.id, callActionNote || undefined);
          break;
        case 'missed':
          result = await logCallMissed(form.id, callActionNote || undefined);
          break;
        case 'callback':
          result = await logCallbackScheduled(form.id, callActionNote || undefined);
          break;
        case 'not_interested':
          result = await logNotInterested(form.id, callActionNote || undefined);
          break;
      }
      if (result?.success) {
        setOutreachSuccess('İşlem başarıyla kaydedildi.');
        setCallActionNote('');
        setShowCallActions(false);
        await loadOutreachTimeline(form.id);
        mutate();
      } else {
        setOutreachError(result?.error || 'İşlem kaydedilemedi.');
      }
    } catch (err: any) {
      setOutreachError(err?.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      setOutreachLoading(null);
    }
  };

  // P1: Template change handler — swap draft text when template selected
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const tpl = templates.find(t => t.id === templateId);
    if (tpl) {
      // Replace placeholders in template body with form data
      let body = tpl.body;
      if (selectedForm) {
        const name = getDisplayName(selectedForm);
        body = body.replace(/\{\{patient_name\}\}/g, name);
        body = body.replace(/\{\{name\}\}/g, name);
      }
      setDraftMessage(body);
    }
  };

  // PHASE 2L-P0: Coordinator activates bot
  const handleOutreachBotActivate = async (form: any) => {
    setOutreachLoading('bot');
    setOutreachError(null);
    try {
      const result = await activateBot(form.id);
      if (result.success) {
        setSelectedForm({ ...form, isBotActive: true });
        mutate(
          data?.map(page => page.map((f: any) => f.id === form.id ? { ...f, isBotActive: true } : f)),
          false
        );
        await loadOutreachTimeline(form.id);
      } else {
        setOutreachError(result.error || 'Bot aktifleştirilemedi.');
      }
    } catch (err: any) {
      setOutreachError(err?.message || 'Beklenmeyen bir hata oluştu.');
    } finally {
      setOutreachLoading(null);
    }
  };

  return (
    <div className="p-4 md:p-8 h-full flex flex-col relative overflow-hidden">
      {/* Background blobs for premium feel */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#007AFF]/5 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#5856D6]/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Header */}
      <div className="mb-6 md:mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#1D1D1F]">Form Yönetimi</h1>
          <p className="text-[#86868B] mt-1 text-sm md:text-base font-medium">Tüm kanallardan gelen güncel lead kayıtları</p>
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Sync Button & Progress */}
          <div className="relative flex items-center">
            {isSyncing ? (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium ${
                syncProgress.status === 'error' 
                  ? 'bg-rose-50 text-rose-600 border-rose-200' 
                  : syncProgress.status === 'completed'
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                  : 'bg-blue-50 text-blue-600 border-blue-100'
              }`}>
                {syncProgress.status === 'error' ? (
                  <X className="w-4 h-4" />
                ) : syncProgress.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                )}
                <span className="min-w-[120px]">{syncProgress.message || 'Senkronize ediliyor...'} {syncProgress.progress > 0 && `${syncProgress.progress}%`}</span>
              </div>
            ) : (
              <button
                onClick={async () => {
                  try {
                    setIsSyncing(true);
                    setSyncProgress({ status: 'starting', progress: 0, message: 'Google Sheets verileri çekiliyor...' });
                    
                    const timeout = setTimeout(() => {
                      setSyncProgress({ status: 'error', progress: 0, message: 'İşlem zaman aşımına uğradı. Tekrar deneyin.' });
                      setTimeout(() => setIsSyncing(false), 3000);
                    }, 30000);

                    const res = await syncGoogleSheets();
                    clearTimeout(timeout);
                    
                    if (res.success) {
                      setSyncProgress({ status: 'completed', progress: 100, message: res.message || 'Senkronizasyon tamamlandı.' });
                      mutate();
                      setTimeout(() => setIsSyncing(false), 2500);
                    } else {
                      const errMsg = res.error || "Senkronizasyon başarısız.";
                      setSyncProgress({ status: 'error', progress: 0, message: errMsg });
                      setTimeout(() => setIsSyncing(false), 4000);
                    }
                  } catch (e: any) {
                    setSyncProgress({ status: 'error', progress: 0, message: e?.message || 'Senkronizasyon başlatılamadı.' });
                    setTimeout(() => setIsSyncing(false), 4000);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/60 backdrop-blur-md border border-white/60 hover:bg-white text-sm font-semibold text-[#1D1D1F] rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Senkronize Et
              </button>
            )}
          </div>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#86868B]" />
            <input 
              type="text" 
              placeholder="İsim, telefon veya e-posta..." 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white/60 backdrop-blur-md border border-white/60 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)]"
            />
          </div>
        </div>
      </div>
      
      {/* Active Filters Bar */}
      {(sourceFilter !== 'all' || stageFilter !== 'all') && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Filtreler:</span>
          {sourceFilter !== 'all' && (
            <button 
              onClick={() => setSourceFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#007AFF]/10 text-[#007AFF] text-[11px] font-bold hover:bg-[#007AFF]/20 transition-colors"
            >
              <Filter className="w-3 h-3" />
              {sourceFilter.length > 25 ? sourceFilter.substring(0, 25) + '...' : sourceFilter}
              <X className="w-3 h-3 ml-1" />
            </button>
          )}
          {stageFilter !== 'all' && (
            <button 
              onClick={() => setStageFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold hover:opacity-80 transition-colors"
              style={{ 
                backgroundColor: `${getStageInfo(stageFilter).color}15`,
                color: getStageInfo(stageFilter).color 
              }}
            >
              {getStageInfo(stageFilter).label}
              <X className="w-3 h-3 ml-1" />
            </button>
          )}
          <button 
            onClick={() => { setSourceFilter('all'); setStageFilter('all'); }}
            className="text-[11px] font-semibold text-[#86868B] hover:text-[#1D1D1F] transition-colors ml-1"
          >
            Tümünü temizle
          </button>
        </div>
      )}

      {/* Table Container */}
      <div className="flex-1 overflow-hidden flex flex-col bg-white/40 backdrop-blur-xl border border-white/50 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-white/80 backdrop-blur-md z-10 border-b border-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <tr>
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Tarih</th>
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Hasta Adı & İletişim</th>
                
                {/* Kampanya / Form — Clickable Filter Header */}
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase relative">
                  <div ref={campDropdown.ref} className="relative inline-block">
                    <button 
                      onClick={() => campDropdown.setIsOpen(!campDropdown.isOpen)}
                      className={`inline-flex items-center gap-1 hover:text-[#1D1D1F] transition-colors cursor-pointer select-none rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 ${
                        sourceFilter !== 'all' ? 'text-[#007AFF] bg-[#007AFF]/10' : 'hover:bg-black/5'
                      }`}
                    >
                      Kampanya / Form
                      <ChevronDown className={`w-3 h-3 transition-transform ${campDropdown.isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {campDropdown.isOpen && (
                      <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50 max-h-[300px] overflow-y-auto">
                        <button 
                          onClick={() => { setSourceFilter('all'); campDropdown.setIsOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-black/5 transition-colors flex items-center gap-2 ${
                            sourceFilter === 'all' ? 'text-[#007AFF]' : 'text-[#1D1D1F]'
                          }`}
                        >
                          {sourceFilter === 'all' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          Tüm Kampanyalar
                        </button>
                        <div className="h-px bg-black/5 my-1" />
                        {campaigns.map((camp, idx) => (
                          <button 
                            key={idx}
                            onClick={() => { setSourceFilter(camp); campDropdown.setIsOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 transition-colors flex items-center gap-2 ${
                              sourceFilter === camp ? 'text-[#007AFF] font-semibold' : 'text-[#1D1D1F]'
                            }`}
                          >
                            {sourceFilter === camp && <CheckCircle2 className="w-3.5 h-3.5" />}
                            <span className="truncate">{camp}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
                
                {/* Durum — Clickable Filter Header */}
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase relative">
                  <div ref={stageDropdown.ref} className="relative inline-block">
                    <button 
                      onClick={() => stageDropdown.setIsOpen(!stageDropdown.isOpen)}
                      className={`inline-flex items-center gap-1 hover:text-[#1D1D1F] transition-colors cursor-pointer select-none rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 ${
                        stageFilter !== 'all' ? 'bg-[#007AFF]/10 text-[#007AFF]' : 'hover:bg-black/5'
                      }`}
                    >
                      Durum
                      <ChevronDown className={`w-3 h-3 transition-transform ${stageDropdown.isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {stageDropdown.isOpen && (
                      <div className="absolute top-full left-0 mt-1 w-52 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50">
                        <button 
                          onClick={() => { setStageFilter('all'); stageDropdown.setIsOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-black/5 transition-colors flex items-center gap-2 ${
                            stageFilter === 'all' ? 'text-[#007AFF]' : 'text-[#1D1D1F]'
                          }`}
                        >
                          {stageFilter === 'all' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          Tüm Durumlar
                        </button>
                        <div className="h-px bg-black/5 my-1" />
                        {STAGES.map(s => (
                          <button 
                            key={s.value}
                            onClick={() => { setStageFilter(s.value); stageDropdown.setIsOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 transition-colors flex items-center gap-2 ${
                              stageFilter === s.value ? 'font-semibold' : ''
                            }`}
                            style={{ color: stageFilter === s.value ? s.color : '#1D1D1F' }}
                          >
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.label}
                            {stageFilter === s.value && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
                
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Geri Dönüş</th>
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase text-right">Aksiyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {forms.map((form: any) => {
                const displayName = getDisplayName(form);
                const bestDate = getBestDate(form);
                const allPhones = getAllPhones(form);
                const primaryPhone = allPhones[0] || form.phone_number;
                const extraPhones = allPhones.slice(1);
                const country = getFormCountry(form);
                const stageInfo = getStageInfo(form.stage);
                
                return (
                <tr 
                  key={form.id} 
                  onClick={() => {
                    setSelectedForm(form);
                    setNotes(form.notes || "");
                  }}
                  className="hover:bg-white/50 transition-colors group cursor-pointer"
                >
                  <td className="py-4 px-4 whitespace-nowrap">
                    <div className="text-[13px] font-semibold text-[#1D1D1F]">
                      {formatDate(bestDate)}
                    </div>
                    <div className="text-[11px] font-medium text-[#86868B] mt-0.5">
                      {formatTime(bestDate)}
                    </div>
                  </td>
                  <td className="py-4 px-4 min-w-[200px] max-w-[280px] whitespace-normal align-middle">
                    <div className="font-bold text-[14px] text-[#1D1D1F] flex flex-wrap items-center gap-1.5 leading-snug">
                      <span className="break-words whitespace-pre-wrap">
                        {displayName}
                      </span>
                      {country && (
                        <span 
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold text-[#86868B] shrink-0 border"
                          style={{
                            backgroundColor: country.isEstimated ? 'rgba(0,0,0,0.01)' : 'rgba(0,0,0,0.04)',
                            borderStyle: country.isEstimated ? 'dashed' : 'solid',
                            borderColor: country.isEstimated ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.05)'
                          }}
                          title={country.isEstimated ? "Tahmini Ülke" : undefined}
                        >
                          {country.flag} {country.name}
                        </span>
                      )}
                      {form.isBotActive && (
                        <span className="px-1.5 py-0.5 shrink-0 bg-[#0F9D58]/10 text-[#0F9D58] border border-[#0F9D58]/20 rounded text-[10px] font-bold uppercase flex items-center gap-1" title="Bot İlgileniyor">
                          <Bot className="w-3 h-3 animate-pulse" /> Bot
                        </span>
                      )}
                      {/* C8: Outreach status badge */}
                      {form.last_outreach_action && !form.isBotActive && (() => {
                        const badge = OUTREACH_BADGE_CONFIG[form.last_outreach_action];
                        if (!badge) return null;
                        return (
                          <span 
                            className="px-1.5 py-0.5 shrink-0 rounded text-[10px] font-bold uppercase flex items-center gap-1 border"
                            style={{ 
                              backgroundColor: `${badge.color}15`,
                              color: badge.color,
                              borderColor: `${badge.color}30`
                            }}
                            title={`Son outreach: ${badge.label}`}
                          >
                            <span className="text-[9px]">{badge.icon}</span> {badge.label}
                          </span>
                        );
                      })()}
                      {form.notes && form.notes.trim() !== '' && (
                        <span className="px-1.5 py-0.5 shrink-0 bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/20 rounded text-[10px] font-bold uppercase flex items-center gap-1" title="Not Eklendi">
                          <StickyNote className="w-3 h-3" /> Notlu
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[12px] font-medium text-[#86868B]">{formatPhone(primaryPhone)}</span>
                      {extraPhones.length > 0 && (
                        <span 
                          className="text-[10px] font-bold text-[#007AFF] bg-[#007AFF]/10 px-1.5 py-0.5 rounded cursor-pointer hover:bg-[#007AFF]/20 transition-colors"
                          title={extraPhones.map(formatPhone).join(', ')}
                          onClick={(e) => {
                            e.stopPropagation();
                            alert(`Diğer numaralar:\n${extraPhones.map(formatPhone).join('\n')}`);
                          }}
                        >
                          +{extraPhones.length} numara
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-black/5 shadow-sm">
                      {form.form_name.toLowerCase().includes("facebook") ? (
                        <div className="w-2 h-2 rounded-full bg-[#1877F2]" />
                      ) : form.form_name.toLowerCase().includes("instagram") ? (
                        <div className="w-2 h-2 rounded-full bg-[#E1306C]" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-gray-400" />
                      )}
                      <span className="text-[12px] font-semibold text-[#1D1D1F] max-w-[150px] truncate" title={form.form_name}>
                        {form.form_name}
                      </span>
                    </div>
                  </td>
                  <td className="py-4 px-4 whitespace-nowrap">
                    <InlineStageSelector 
                      currentStage={form.stage} 
                      stageInfo={stageInfo}
                      onStageChange={(newStage) => handleStageChange(form, newStage)}
                    />
                  </td>
                  <td className="py-4 px-4">
                    {form.notes && form.notes.trim() !== '' ? (
                      <span className="text-[12px] text-[#1D1D1F] font-medium line-clamp-2 max-w-[200px]" title={form.notes}>
                        {form.notes.length > 60 ? form.notes.substring(0, 60) + '…' : form.notes}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#C7C7CC] italic">—</span>
                    )}
                  </td>
                  <td className="py-4 px-4 text-right">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedForm(form);
                        setNotes(form.notes || "");
                        setIsDraftOpen(true);
                        handlePrepareDraft(form);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-black/5 rounded-lg shadow-sm hover:bg-[#25D366]/10 hover:border-[#25D366]/20 hover:text-[#25D366] transition-all text-[13px] font-semibold text-[#1D1D1F]"
                    >
                      <MessageCircle className="w-4 h-4" />
                      <span className="hidden md:inline">Mesaj Gönder</span>
                    </button>
                  </td>
                </tr>
                );
              })}
              
              {forms.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[#86868B] font-medium">
                    Henüz kayıt bulunmuyor.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Footer / Load More */}
        <div className="p-3 border-t border-black/5 bg-white/40 flex justify-center">
          {!isReachingEnd && forms.length > 0 && (
            <button
              onClick={() => setSize(size + 1)}
              disabled={isLoadingMore}
              className="px-6 py-2 text-sm font-semibold text-[#007AFF] bg-white border border-[#007AFF]/20 rounded-full shadow-sm hover:bg-[#007AFF]/5 transition-all disabled:opacity-50"
            >
              {isLoadingMore ? "Yükleniyor..." : "Daha Fazla Kayıt Yükle"}
            </button>
          )}
          {isReachingEnd && forms.length > 0 && (
            <span className="text-[12px] font-medium text-[#86868B]">Tüm kayıtlar yüklendi.</span>
          )}
        </div>
      </div>

      {/* Centered Detail Modal */}
      {selectedForm && (
        <>
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity animate-in fade-in"
            onClick={() => setSelectedForm(null)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
            <div className="w-full max-w-[500px] bg-[#F5F5F7] rounded-[28px] shadow-[0_20px_40px_rgba(0,0,0,0.2)] flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200 pointer-events-auto border border-white/20">
              {/* Header */}
              <div className="px-6 py-5 bg-white border-b border-black/5 flex items-center justify-between shrink-0 rounded-t-[28px]">
                <div className="pr-4 w-full">
                  <h2 className="text-xl font-bold text-[#1D1D1F] flex flex-wrap items-center gap-2 leading-snug">
                    <span className="break-words whitespace-pre-wrap max-w-full">{getDisplayName(selectedForm)}</span>
                    {(() => {
                      const c = getFormCountry(selectedForm);
                      if (!c) return null;
                      return (
                        <span 
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[12px] font-semibold shrink-0"
                          style={{
                            color: 'var(--q-text-secondary)',
                            backgroundColor: c.isEstimated ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.04)',
                            border: c.isEstimated ? '1px dashed var(--q-border-default)' : 'none'
                          }}
                          title={c.isEstimated ? "Tahmini ülke (telefon numarasından)" : undefined}
                        >
                          {c.flag} {c.name}
                        </span>
                      );
                    })()}
                  </h2>
                  <p className="text-[#86868B] text-sm font-medium mt-1 break-words">{formatPhone(selectedForm.phone_number)}</p>
                </div>
                <button 
                  onClick={() => setSelectedForm(null)}
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors"
                >
                  <X className="w-5 h-5 text-[#1D1D1F]" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">

              {/* Phone Numbers List */}
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-2.5 text-left">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-[#86868B] mb-1">Telefon Numaraları</span>
                {getAllPhones(selectedForm).map((phone, idx) => {
                  const isPrimary = idx === 0;
                  const isLastOutreachTarget = selectedForm.last_outreach_action && selectedForm.phone_number === phone;
                  return (
                    <div key={phone} className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[13px] text-[#1D1D1F]">
                        {formatPhone(phone)}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isPrimary 
                          ? 'bg-blue-100 text-blue-700' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {isPrimary ? 'Birincil' : 'İkincil'} {isLastOutreachTarget && '— Denendi'}
                      </span>
                    </div>
                  );
                })}
              </div>
              
              {/* PHASE 2L-P0: Outreach Actions */}
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-black/5 bg-gradient-to-r from-[#25D366]/5 to-[#007AFF]/5">
                  <h3 className="text-sm font-bold text-[#1D1D1F] flex items-center gap-2">
                    <Send className="w-4 h-4 text-[#25D366]" />
                    İlk İletişim (Outreach)
                  </h3>
                  <p className="text-[11px] text-[#86868B] font-medium mt-0.5">Koordinatör onayı ile karşılama mesajı gönder</p>
                </div>
                <div className="p-4 space-y-3">
                  {/* WhatsApp Window & Template Required Status */}
                  {/* Readiness loading or state badges */}
                  {readinessLoading ? (
                    <div className="flex gap-2 flex-wrap mb-1">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-gray-50 text-gray-500 border border-gray-200 animate-pulse">
                        ⏳ Uygunluk durumu kontrol ediliyor...
                      </span>
                    </div>
                  ) : readiness ? (
                    <div className="space-y-2.5 mb-1 text-left">
                      <div className="flex gap-2 flex-wrap">
                        {readiness.isWithin24hWindow ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            🟢 24s pencere açık: Taslak hazırlanabilir
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            ⏳ 24s pencere kapalı: WhatsApp template gerekli
                          </span>
                        )}

                        {readiness.templateConfigExists ? (
                          readiness.templateNonCompliant ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              ⚠️ Şablon uygun değil
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              🟢 Sistemde aktif şablon var: {readiness.templateName || 'Belirsiz'}
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            ⚠️ Şablon tanımlanmamış
                          </span>
                        )}
                        
                        {readiness.hardBlockedBecausePatientAlreadyInbound && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            ⚠️ Hasta zaten mesaj attı
                          </span>
                        )}

                        {selectedForm && ((Date.now() - new Date(getBestDate(selectedForm)).getTime()) / (1000 * 60 * 60) > 72) && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                            ⏳ Karşılama süresi geçmiş. Manuel takip önerilir.
                          </span>
                        )}
                      </div>

                      {/* Compliance warning message if template is non-compliant */}
                      {readiness.templateNonCompliant && (
                        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold flex items-start gap-2.5 leading-relaxed">
                          <span className="text-sm shrink-0">⚠️</span>
                          <div>
                            <p className="font-bold text-amber-900">Şablon Standartlara Aykırı</p>
                            <p className="text-amber-700 font-medium">Bu şablon hasta mesaj standartlarına uygun değil ({readiness.complianceWarning}). Gönderim yapılamaz.</p>
                          </div>
                        </div>
                      )}

                      {/* 24h closed warning + Template config missing/present warning */}
                      {!readiness.isWithin24hWindow && !readiness.hardBlockedBecausePatientAlreadyInbound && (
                        <div className={`p-3 rounded-xl border text-[11px] font-semibold flex items-start gap-2.5 leading-relaxed ${readiness.templateConfigExists ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                          <span className="text-sm shrink-0">⏳</span>
                          <div>
                            <p className={`font-bold ${readiness.templateConfigExists ? 'text-blue-900' : 'text-amber-900'}`}>WhatsApp Şablonu Gerekli</p>
                            {readiness.templateConfigExists ? (
                              <p className="text-blue-700 font-medium">Şablon sistemde tanımlı. Provider panelinde onaylı olduğundan emin olun. (Kullanılacak şablon: {readiness.templateName})</p>
                            ) : (
                              <p className="text-amber-700 font-medium">Form Yönetimi / Şablon ayarlarından greeting template ekleyin.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : !selectedForm.has_inbound_messages && (
                    <div className="flex gap-2 flex-wrap mb-1">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        ⏳ 24s pencere kapalı: WhatsApp template gerekli
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                        📋 Şablon (Template) Gerekli
                      </span>
                      {selectedForm && ((Date.now() - new Date(getBestDate(selectedForm)).getTime()) / (1000 * 60 * 60) > 72) && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                          ⏳ Karşılama süresi geçmiş. Manuel takip önerilir.
                        </span>
                      )}
                    </div>
                  )}

                  {/* Known Inbound Guard Hard Block */}
                  {(selectedForm.has_inbound_messages || (readiness && readiness.hardBlockedBecausePatientAlreadyInbound)) && (
                    <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-start gap-2.5 shadow-sm text-left">
                      <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-bold text-red-900">Karşılama Engellendi</p>
                        <p className="text-red-700 leading-snug font-medium">Bu hasta daha önce sistemdeki numaralarımızdan biri üzerinden bizimle iletişime geçmiştir. Tekrar karşılama mesajı gönderilmesi engellenmiştir.</p>
                      </div>
                    </div>
                  )}

                  {/* Error Banner */}
                  {outreachError && (
                    <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px] font-medium flex items-center gap-2">
                      <X className="w-3.5 h-3.5 shrink-0" />
                      {outreachError}
                    </div>
                  )}

                  {/* Success Banner */}
                  {outreachSuccess && (
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12px] font-medium flex items-center gap-2">
                      <CheckCheck className="w-3.5 h-3.5 shrink-0" />
                      {outreachSuccess}
                    </div>
                  )}

                  {/* Draft Textarea — visible after "Karşılama Hazırla" clicked */}
                  {isDraftOpen && draftMessage !== null && (() => {
                    const originalTpl = templates.find((t: any) => t.id === selectedTemplateId);
                    const isVariableless = originalTpl ? !originalTpl.body.includes('{{') : true;
                    return (
                      <div className="space-y-3">
                        <div className="flex flex-col mb-1 text-left">
                          <div className="flex items-center gap-2">
                            <Edit3 className="w-3.5 h-3.5 text-[#007AFF]" />
                            <span className="text-[11px] font-bold text-[#007AFF] uppercase tracking-wider">Şablon Önizlemesi</span>
                          </div>
                          <span className="text-[10px] text-[#86868B] mt-0.5 leading-relaxed">
                            Bu alan seçili WhatsApp şablonunun önizlemesidir. Gerçek gönderimde onaylı template adı kullanılır.
                          </span>
                        </div>
                        {/* C12: Template selector dropdown */}
                        {templates.length > 1 && (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-[#86868B] shrink-0">Şablon:</span>
                            <select
                               value={selectedTemplateId || ''}
                               onChange={(e) => handleTemplateSelect(e.target.value)}
                               className="flex-1 text-[12px] font-medium bg-[#F5F5F7] border border-black/10 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all cursor-pointer appearance-none"
                            >
                              <option value="" disabled>Şablon seçin…</option>
                              {templates.map((tpl: any) => (
                                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <textarea
                          value={draftMessage}
                          onChange={(e) => setDraftMessage(e.target.value)}
                          readOnly={isVariableless}
                          rows={5}
                          className={`w-full border border-black/10 rounded-xl p-3 text-[13px] text-[#1D1D1F] font-medium resize-none outline-none transition-all leading-relaxed ${
                            isVariableless
                              ? 'bg-[#F5F5F7] text-[#86868B] cursor-not-allowed'
                              : 'bg-white focus:ring-2 focus:ring-[#25D366]/40 focus:border-[#25D366]/30'
                          }`}
                          placeholder="Karşılama mesajınızı buraya yazın..."
                        />

                        {/* Bota Kısa Not/Direktif */}
                        <div className="space-y-1 text-left">
                          <label className="block text-[10.5px] font-bold text-[#86868B] uppercase tracking-wider">
                            🤖 Bota kısa not/direktif ekle (opsiyonel)
                          </label>
                          <input
                            type="text"
                            value={botNote}
                            onChange={(e) => setBotNote(e.target.value)}
                            placeholder="Örn: Hastanın geliş tarihini netleştir, kararsızsa telefon görüşmesine yönlendir."
                            className="w-full bg-[#F5F5F7] border border-black/10 rounded-xl px-3 py-2 text-[12px] text-[#1D1D1F] font-medium outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all"
                          />
                          {!selectedForm.linked_conversation_id && (
                            <span className="block text-[10px] text-amber-600 font-semibold leading-relaxed mt-0.5">
                              ⚠️ Bu lead için henüz sohbet oluşmadı. Bot notu sadece iç kayıt olarak saklanır.
                            </span>
                          )}
                        </div>

                        {/* Warning and Action Buttons */}
                        <div className="space-y-2.5 pt-2 border-t border-black/5">
                          {/* Primary Safe Action */}
                          <button 
                            onClick={() => handleSaveInternal(selectedForm)}
                            disabled={outreachLoading === 'sending' || !draftMessage?.trim()}
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold bg-[#007AFF] text-white shadow-[0_4px_14px_rgba(0,122,255,0.3)] hover:bg-[#0056b3] cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {outreachLoading === 'sending' ? (
                              <><RefreshCw className="w-4 h-4 animate-spin" /> Kaydediliyor...</>
                            ) : (
                              <><Save className="w-4 h-4" /> Taslağı İç Not Olarak Kaydet</>
                            )}
                          </button>

                          {/* Soft / Hard Readiness Warnings */}
                          {readiness && readiness.greetingSent && !readiness.hardBlockedBecausePatientAlreadyInbound && (
                            <div className="text-[10px] font-bold text-[#FF9500] text-center bg-orange-50 border border-orange-100 rounded-lg py-1 px-2.5">
                              ⚠️ Bu kişiye daha önce mesaj gönderilmiş olabilir.
                            </div>
                          )}
                          {readiness && !readiness.templateSendable && readiness.templateNonCompliant && (
                            <div className="text-[10px] font-bold text-[#FF3B30] text-center bg-red-50 border border-red-100 rounded-lg py-1 px-2.5">
                              ⛔ Şablon Uyumsuz: {readiness.complianceWarning}
                            </div>
                          )}

                          {/* WhatsApp Outbound Warning */}
                          <div className="text-[10px] font-bold text-[#FF3B30] text-center bg-red-50 border border-red-100 rounded-lg py-1 px-2.5">
                            ⚠️ Bu buton hastaya gerçek WhatsApp template mesajı gönderir.
                          </div>

                          <div className="flex gap-2">
                            <button 
                              onClick={() => handleConfirmSend(selectedForm)}
                              disabled={
                                outreachLoading === 'sending' || 
                                !draftMessage?.trim() || 
                                (readiness !== null && !readiness.templateSendable)
                              }
                              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[12px] font-bold bg-[#F5F5F7] hover:bg-rose-50 hover:text-rose-600 text-[#1D1D1F] border border-[#D2D2D7] hover:border-rose-200 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Send className="w-3.5 h-3.5" /> WhatsApp Şablonu ile Gönder
                            </button>
                            <button 
                              onClick={handleCancelDraft}
                              disabled={outreachLoading === 'sending'}
                              className="px-4 py-2 rounded-xl text-[12px] font-bold bg-black/[0.04] hover:bg-black/[0.08] text-[#1D1D1F] transition-colors cursor-pointer disabled:opacity-50"
                            >
                              İptal
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Action Buttons — Primary Row */}
                  {!isDraftOpen && (
                    <div className="flex gap-3">
                      <button 
                        onClick={() => handlePrepareDraft(selectedForm)}
                        disabled={
                          greetingSent || 
                          outreachLoading === 'draft' || 
                          readinessLoading ||
                          selectedForm.stage !== 'new' || 
                          !!selectedForm.has_inbound_messages ||
                          (readiness !== null && !readiness.templateSendable)
                        }
                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${
                          selectedForm.has_inbound_messages || (readiness && readiness.hardBlockedBecausePatientAlreadyInbound)
                            ? 'bg-red-50 text-red-600 border border-red-200 cursor-not-allowed'
                            : greetingSent 
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
                            : selectedForm.stage !== 'new'
                            ? 'bg-gray-100 text-[#86868B] cursor-not-allowed'
                            : readinessLoading
                            ? 'bg-gray-100 text-[#86868B] cursor-not-allowed animate-pulse'
                            : (readiness && !readiness.templateSendable)
                            ? 'bg-amber-50 text-amber-600 border border-amber-200 cursor-not-allowed'
                            : 'bg-[#25D366] text-white shadow-[0_4px_14px_rgba(37,211,102,0.39)] hover:bg-[#1DA851] cursor-pointer'
                        } disabled:opacity-70`}
                      >
                        {selectedForm.has_inbound_messages || (readiness && readiness.hardBlockedBecausePatientAlreadyInbound) ? (
                          <><XCircle className="w-5 h-5" /> Zaten Bize Yazdı</>
                        ) : greetingSent ? (
                          <><CheckCheck className="w-5 h-5" /> Selamlama Gönderildi</>
                        ) : outreachLoading === 'draft' ? (
                          <><RefreshCw className="w-4 h-4 animate-spin" /> Hazırlanıyor...</>
                        ) : readinessLoading ? (
                          <><RefreshCw className="w-4 h-4 animate-spin" /> Yükleniyor...</>
                        ) : selectedForm.stage !== 'new' ? (
                          <><CheckCircle2 className="w-5 h-5" /> Zaten İletişime Geçildi</>
                        ) : (readiness && !readiness.templateSendable) ? (
                          readiness.templateNonCompliant ? (
                            <><XCircle className="w-5 h-5" /> Uyumsuz Şablon</>
                          ) : (
                            <><Clock className="w-5 h-5" /> Şablon Eklenmeli</>
                          )
                        ) : (
                          <><Edit3 className="w-5 h-5" /> Karşılama Hazırla</>
                        )}
                      </button>
                      <button 
                        onClick={() => handleOutreachBotActivate(selectedForm)}
                        disabled={selectedForm.isBotActive || outreachLoading === 'bot' || !greetingSent}
                        title={!greetingSent ? 'Önce selamlama gönderilmeli' : selectedForm.isBotActive ? 'Bot zaten aktif' : 'AI Bota devret'}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${
                          selectedForm.isBotActive
                            ? 'bg-[#0F9D58]/10 text-[#0F9D58] border border-[#0F9D58]/20 cursor-default'
                            : !greetingSent
                            ? 'bg-gray-100 text-[#86868B] cursor-not-allowed'
                            : 'bg-[#007AFF] text-white shadow-[0_4px_14px_rgba(0,122,255,0.3)] hover:bg-[#0056b3] cursor-pointer'
                        } disabled:opacity-70`}
                      >
                        {selectedForm.isBotActive ? (
                          <><Bot className="w-5 h-5 animate-pulse" /> Bot Aktif</>
                        ) : outreachLoading === 'bot' ? (
                          <><RefreshCw className="w-4 h-4 animate-spin" /> Aktifleştiriliyor...</>
                        ) : (
                          <><Zap className="w-5 h-5" /> Bota Devret</>
                        )}
                      </button>
                    </div>
                  )}

                  {/* C9: Expanded Call Action Buttons */}
                  {!isDraftOpen && (
                    <div className="space-y-2">
                      <button
                        onClick={() => setShowCallActions(!showCallActions)}
                        className="w-full flex items-center justify-center gap-2 py-2 bg-black/[0.03] hover:bg-black/[0.06] rounded-xl text-[12px] font-semibold text-[#86868B] transition-colors cursor-pointer"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        {showCallActions ? 'Arama Aksiyonlarını Gizle' : 'Arama Aksiyonları'}
                        <ChevronDown className={`w-3 h-3 transition-transform ${showCallActions ? 'rotate-180' : ''}`} />
                      </button>
                      {showCallActions && (
                        <div className="space-y-2 animate-in slide-in-from-top-1 duration-150">
                          {/* Call action note */}
                          <input
                            type="text"
                            value={callActionNote}
                            onChange={(e) => setCallActionNote(e.target.value)}
                            placeholder="Kısa not (opsiyonel)…"
                            className="w-full bg-[#F5F5F7] border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1D1D1F] font-medium outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={() => handleCallAction('reached', selectedForm)}
                              disabled={outreachLoading === 'call_action'}
                              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-[#0F9D58]/10 text-[#0F9D58] border border-[#0F9D58]/20 hover:bg-[#0F9D58]/20 transition-all cursor-pointer disabled:opacity-50"
                            >
                              <Phone className="w-3.5 h-3.5" /> Ulaşıldı
                            </button>
                            <button
                              onClick={() => handleCallAction('missed', selectedForm)}
                              disabled={outreachLoading === 'call_action'}
                              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-[#FF9500]/10 text-[#FF9500] border border-[#FF9500]/20 hover:bg-[#FF9500]/20 transition-all cursor-pointer disabled:opacity-50"
                            >
                              <PhoneOff className="w-3.5 h-3.5" /> Ulaşılamadı
                            </button>
                            <button
                              onClick={() => handleCallAction('callback', selectedForm)}
                              disabled={outreachLoading === 'call_action'}
                              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-[#5856D6]/10 text-[#5856D6] border border-[#5856D6]/20 hover:bg-[#5856D6]/20 transition-all cursor-pointer disabled:opacity-50"
                            >
                              <PhoneForwarded className="w-3.5 h-3.5" /> Geri Arama
                            </button>
                            <button
                              onClick={() => {
                                if (!window.confirm('Bu lead "İlgilenmiyor" olarak işaretlenecek ve takip süreci kapatılacak. Emin misiniz?')) return;
                                handleCallAction('not_interested', selectedForm);
                              }}
                              disabled={outreachLoading === 'call_action'}
                              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-[#FF3B30]/10 text-[#FF3B30] border border-[#FF3B30]/20 hover:bg-[#FF3B30]/20 transition-all cursor-pointer disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" /> İlgilenmiyor
                            </button>
                          </div>
                          {outreachLoading === 'call_action' && (
                            <div className="flex items-center justify-center gap-2 py-2 text-[11px] font-medium text-[#86868B]">
                              <RefreshCw className="w-3 h-3 animate-spin" /> Kaydediliyor…
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Deep Links Section */}
                  {!isDraftOpen && (
                    <div className="pt-3 border-t border-black/5 space-y-2">
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-[#86868B] mb-2 text-center">
                        Operasyonel Yönlendirmeler
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {selectedForm.linked_conversation_id ? (
                          <button
                            onClick={(e) => handleMessageClick(selectedForm, e as any)}
                            className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-blue-200 bg-blue-50/30 text-blue-600 text-center transition-all duration-200 hover:bg-blue-50 active:scale-[0.98] cursor-pointer"
                          >
                            <MessageCircle className="w-4 h-4 mb-1 text-[#25D366]" />
                            <span className="text-[9px] font-bold leading-tight">Konuşmaya Git</span>
                          </button>
                        ) : (
                          <button
                            disabled
                            className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-400 text-center cursor-not-allowed opacity-60"
                          >
                            <MessageCircle className="w-4 h-4 mb-1" />
                            <span className="text-[9px] font-bold leading-tight">Sohbet Yok</span>
                          </button>
                        )}

                        <a
                          href={`./takip?tab=telefon&opp=${selectedForm.linked_opportunity_id || ''}`}
                          className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-indigo-200 bg-indigo-50/30 text-indigo-600 text-center transition-all duration-200 hover:bg-indigo-50 active:scale-[0.98]"
                        >
                          <PhoneForwarded className="w-4 h-4 mb-1" />
                          <span className="text-[9px] font-bold leading-tight">Telefon Takibi</span>
                        </a>

                        <a
                          href={`./takip?tab=randevu&opp=${selectedForm.linked_opportunity_id || ''}`}
                          className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/30 text-emerald-600 text-center transition-all duration-200 hover:bg-emerald-50 active:scale-[0.98]"
                        >
                          <Calendar className="w-4 h-4 mb-1" />
                          <span className="text-[9px] font-bold leading-tight">Randevu Planla</span>
                        </a>
                      </div>
                    </div>
                  )}
                </div>

                {/* Outreach Timeline */}
                {outreachTimeline.length > 0 && (
                  <div className="border-t border-black/5 px-5 py-3">
                    <h4 className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Outreach Geçmişi
                    </h4>
                    <div className="space-y-2">
                      {outreachTimeline.map((entry) => {
                        const badgeInfo = OUTREACH_BADGE_CONFIG[entry.action];
                        const dotColor = badgeInfo?.color || '#86868B';
                        const displayLabel = badgeInfo 
                          ? `${badgeInfo.icon} ${badgeInfo.label}` 
                          : entry.action;
                        return (
                        <div key={entry.id} className="flex items-start gap-2.5">
                          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: dotColor }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold text-[#1D1D1F]">
                              {displayLabel}
                            </p>
                            {entry.action === 'form_greeting_draft_saved_internal' && (
                              <span className="text-[10px] text-[#86868B] font-semibold block mt-0.5">
                                🔒 Hasta görmez. WhatsApp gönderilmedi.
                              </span>
                            )}
                            {((entry as any).metadata?.note || (entry as any).metadata?.message_text || (entry as any).metadata?.coordinator_note) && (
                              <div className="text-[11px] text-[#1D1D1F] font-medium mt-1 p-2 bg-[#F5F5F7] rounded-xl border border-black/5 leading-relaxed space-y-1 text-left">
                                {(entry as any).metadata?.message_text && (
                                  <div>
                                    <span className="block text-[9.5px] font-bold text-[#86868B] uppercase tracking-wider mb-0.5">Kaydedilen Taslak:</span>
                                    <p className="italic">"{(entry as any).metadata.message_text}"</p>
                                  </div>
                                )}
                                {(entry as any).metadata?.coordinator_note && (
                                  <div className="pt-1.5 border-t border-black/5">
                                    <span className="block text-[9.5px] font-bold text-[#86868B] uppercase tracking-wider mb-0.5">Bota Kısa Not/Direktif:</span>
                                    <p className="text-[#007AFF] font-semibold">🤖 "{(entry as any).metadata.coordinator_note}"</p>
                                  </div>
                                )}
                                {!(entry as any).metadata?.message_text && (entry as any).metadata?.note && (
                                  <p className="italic">"{(entry as any).metadata.note}"</p>
                                )}
                              </div>
                            )}
                            <p className="text-[11px] text-[#86868B] font-medium mt-1">
                              {entry.actor_name} · {new Date(entry.created_at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}
                            </p>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Meta Info */}
              <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-black/5 flex flex-col items-center justify-center font-bold text-[#1D1D1F] text-xs">
                    {getDisplayName(selectedForm).charAt(0).toUpperCase()}
                  </div>
                  <div className="w-full pr-2">
                    <div className="flex items-center gap-2 flex-wrap leading-snug">
                      <p className="text-sm font-bold text-[#1D1D1F] break-words whitespace-pre-wrap max-w-full">
                        {getDisplayName(selectedForm)}
                      </p>
                      {(() => {
                        const c = getFormCountry(selectedForm);
                        return c ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/[0.04] text-[11px] font-semibold text-[#86868B] shrink-0">
                            {c.flag} {c.name}
                          </span>
                        ) : null;
                      })()}
                      {selectedForm.isBotActive && (
                        <span className="px-1.5 py-0.5 shrink-0 bg-[#0F9D58]/10 text-[#0F9D58] border border-[#0F9D58]/20 rounded text-[10px] font-bold uppercase flex items-center gap-1" title="Bot İlgileniyor">
                          <Bot className="w-3 h-3 animate-pulse" /> Bot
                        </span>
                      )}
                      {selectedForm.notes && selectedForm.notes.trim() !== '' && (
                        <span className="px-1.5 py-0.5 shrink-0 bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/20 rounded text-[10px] font-bold uppercase flex items-center gap-1" title="Not Eklendi">
                          <StickyNote className="w-3 h-3" /> Notlu
                        </span>
                      )}
                    </div>
                    {/* Multi-phone display */}
                    {(() => {
                      const phones = getAllPhones(selectedForm);
                      return (
                        <div className="mt-1.5 space-y-1">
                          {phones.map((ph: string, idx: number) => (
                            <p key={idx} className="text-xs text-[#86868B] font-medium break-words flex items-center gap-1.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${idx === 0 ? 'bg-[#25D366]' : 'bg-[#86868B]'}`} />
                              {formatPhone(ph)}
                              {idx === 0 && <span className="text-[10px] text-[#25D366] font-semibold">(Birincil)</span>}
                            </p>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-black/5">
                  <div>
                    <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">Tarih</p>
                    <p className="text-[14px] font-semibold text-[#1D1D1F] mt-1">{formatDate(getBestDate(selectedForm))}</p>
                    <p className="text-[12px] text-[#86868B] font-medium">{formatTime(getBestDate(selectedForm))}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider">Durum</p>
                    <div className="mt-1">
                      <InlineStageSelector 
                        currentStage={selectedForm.stage}
                        stageInfo={getStageInfo(selectedForm.stage)}
                        onStageChange={(newStage) => {
                          handleStageChange(selectedForm, newStage);
                          setSelectedForm({ ...selectedForm, stage: newStage });
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* P1B: Güncel Takip Bilgisi (from active opportunity) */}
              {(selectedForm.current_country || selectedForm.current_department || selectedForm.current_stage || selectedForm.current_travel_date || selectedForm.current_display_name) && (
                <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-4 h-4 text-[#007AFF]" />
                    <h3 className="text-sm font-bold text-[#1D1D1F]">Güncel Takip Bilgisi</h3>
                    {selectedForm.link_confidence && selectedForm.link_confidence !== 'none' && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#007AFF]/10 text-[#007AFF]">
                        {selectedForm.link_confidence === 'customer_id' ? 'Kimlik Eşleşmesi' : 'Telefon Eşleşmesi'}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {/* P1B: Current identity from active opportunity */}
                    {selectedForm.current_display_name && (
                      <div className="col-span-2">
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider flex items-center gap-1"><User className="w-3 h-3" /> Güncel İsim</p>
                        <p className="text-[14px] font-semibold text-[#1D1D1F] mt-1">{selectedForm.current_display_name}
                          {selectedForm.patient_relation && (
                            <span className="ml-2 text-[11px] font-medium text-[#86868B]">({selectedForm.patient_relation})</span>
                          )}
                        </p>
                      </div>
                    )}
                    {(() => {
                      const country = getFormCountry(selectedForm);
                      if (!country) return null;
                      return (
                        <div>
                          <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider flex items-center gap-1"><MapPin className="w-3 h-3" /> Ülke</p>
                          <p className="text-[14px] font-semibold text-[#1D1D1F] mt-1 flex items-center gap-1.5">
                            <span 
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold text-[#86868B] border"
                              style={{
                                backgroundColor: country.isEstimated ? 'rgba(0,0,0,0.01)' : 'rgba(0,0,0,0.04)',
                                borderStyle: country.isEstimated ? 'dashed' : 'solid',
                                borderColor: country.isEstimated ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.05)'
                              }}
                              title={country.isEstimated ? "Tahmini Ülke" : undefined}
                            >
                              {country.flag} {country.name}
                            </span>
                          </p>
                        </div>
                      );
                    })()}
                    {selectedForm.current_department && (
                      <div>
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider flex items-center gap-1"><Building2 className="w-3 h-3" /> Bölüm</p>
                        <p className="text-[14px] font-semibold text-[#1D1D1F] mt-1">{selectedForm.current_department}</p>
                      </div>
                    )}
                    {selectedForm.current_travel_date && (
                      <div>
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider flex items-center gap-1"><Calendar className="w-3 h-3" /> Geliş Tarihi</p>
                        <p className="text-[14px] font-semibold text-[#1D1D1F] mt-1">
                          {new Date(selectedForm.current_travel_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                      </div>
                    )}
                    {selectedForm.current_priority && (() => {
                      const p = PRIORITY_CONFIG[selectedForm.current_priority];
                      return p ? (
                        <div>
                          <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider flex items-center gap-1"><Flame className="w-3 h-3" /> Öncelik</p>
                          <p className="text-[14px] font-bold mt-1" style={{ color: p.color }}>{p.icon} {p.label}</p>
                        </div>
                      ) : null;
                    })()}
                    {selectedForm.current_stage && (() => {
                      const si = getOppStageInfo(selectedForm.current_stage);
                      return (
                        <div className="col-span-2">
                          <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-1">Opportunity Durumu</p>
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border"
                            style={{ backgroundColor: `${si.color}12`, borderColor: `${si.color}25`, color: si.color }}>
                            <span>{si.icon}</span>
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: si.color }} />
                            {si.label}
                          </span>
                        </div>
                      );
                    })()}
                    {/* P1B: Opp-scoped summary */}
                    {selectedForm.current_ai_summary ? (
                      <div className="col-span-2 mt-1 pt-3 border-t border-black/5">
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI Özet</p>
                        <p className="text-[12px] text-[#1D1D1F] font-medium leading-relaxed">{selectedForm.current_ai_summary}</p>
                      </div>
                    ) : selectedForm.linked_opportunity_id ? (
                      <div className="col-span-2 mt-1 pt-3 border-t border-black/5">
                        <p className="text-[11px] font-medium text-[#86868B] italic">Bu fırsat için henüz AI özeti yok.</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {/* AI Summary / Notes */}
              <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-[#1D1D1F] flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#0F9D58]" /> 
                    Görüşme Notları & AI Özeti
                  </h3>
                  <button 
                    onClick={async () => {
                      setIsSavingNotes(true);
                      await updateLeadNotes(selectedForm.id, notes);
                      mutate(); // SWR mutate
                      setIsSavingNotes(false);
                    }}
                    disabled={isSavingNotes}
                    className="text-[#007AFF] text-xs font-bold uppercase tracking-wider hover:text-[#0056b3] transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <Save className="w-3 h-3" />
                    {isSavingNotes ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                </div>
                <textarea 
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Botun görüşme özeti buraya düşer veya manuel olarak kendi satış notlarınızı alabilirsiniz..."
                  className="w-full h-28 bg-[#F5F5F7] border-none rounded-xl p-3 text-sm text-[#1D1D1F] placeholder:text-[#86868B] focus:ring-2 focus:ring-[#007AFF]/40 resize-none outline-none transition-all"
                />

                {/* AI Taslak Önerisi (Frosted Cam Efektli Kutu) */}
                {(!notes || notes.trim() === "") && selectedForm.ai_summary && (
                  <div className="mt-3 p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] backdrop-blur-md relative overflow-hidden transition-all duration-300 shadow-sm text-left">
                    <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600 animate-pulse" /> Yapay Zeka Önerisi
                      </span>
                    </div>
                    <p className="text-[12px] text-emerald-950 font-medium leading-relaxed italic mb-3">
                      "{selectedForm.ai_summary}"
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        const aiText = selectedForm.ai_summary;
                        setNotes(aiText);
                        setIsSavingNotes(true);
                        const res = await updateLeadNotes(selectedForm.id, aiText);
                        if (res.success) {
                          mutate();
                        }
                        setIsSavingNotes(false);
                      }}
                      disabled={isSavingNotes}
                      className="w-full py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white transition-all flex items-center justify-center gap-1.5 shadow-md cursor-pointer disabled:opacity-50"
                    >
                      <FileText className="w-3.5 h-3.5" /> Nota Aktar ve Kaydet
                    </button>
                  </div>
                )}
                {/* Safe empty state: No AI summary available for this form */}
                {(!notes || notes.trim() === "") && !selectedForm.ai_summary && (
                  <div className="mt-3 p-3 rounded-xl border border-black/5 bg-[#F5F5F7] text-center">
                    <p className="text-[11px] font-medium text-[#86868B]">
                      Bu form için henüz AI özeti yok. WhatsApp üzerinden görüşme başladığında otomatik oluşturulacaktır.
                    </p>
                  </div>
                )}
              </div>

              {/* Form Data (raw_data) */}
              <div className="bg-white rounded-2xl p-1 border border-black/5 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-black/5 bg-[#F5F5F7]">
                  <h3 className="text-sm font-bold text-[#1D1D1F]">Form Yanıtları</h3>
                </div>
                <div className="divide-y divide-black/5">
                  {(() => {
                    const entries = Object.entries(selectedForm.raw_data || {});
                    const operationalEntries = entries.filter(([k]) => !isTechnicalKey(k));
                    const technicalEntries = entries.filter(([k]) => isTechnicalKey(k));

                    return (
                      <>
                        {operationalEntries.map(([key, value]: [string, any], index) => {
                          if (!value || typeof value === 'object') return null;
                          return (
                            <div key={index} className="px-4 py-3 flex flex-col">
                              <span className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-1">{key}</span>
                              <span className="text-[14px] font-medium text-[#1D1D1F] break-words whitespace-pre-wrap">{String(value)}</span>
                            </div>
                          );
                        })}
                        {operationalEntries.length === 0 && (
                          <div className="px-4 py-6 text-center text-[#86868B] text-sm font-medium">
                            Bu formda ek veri bulunmuyor.
                          </div>
                        )}

                        {/* Collapsed Technical Ad Data Accordion */}
                        {technicalEntries.length > 0 && (
                          <div className="border-t border-black/5 bg-[#F5F5F7]/30">
                            <button
                              type="button"
                              onClick={() => setTechOpen(!techOpen)}
                              className="w-full px-4 py-3 flex items-center justify-between text-left transition-colors hover:bg-black/[0.02]"
                            >
                              <span className="text-xs font-bold text-[#86868B] uppercase tracking-wider">Teknik Reklam Verileri</span>
                              {techOpen ? (
                                <ChevronDown className="w-4 h-4 text-[#86868B]" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-[#86868B]" />
                              )}
                            </button>
                            {techOpen && (
                              <div className="divide-y divide-black/5 border-t border-black/5 bg-white/50">
                                {technicalEntries.map(([key, value]: [string, any], index) => {
                                  if (!value || typeof value === 'object') return null;
                                  return (
                                    <div key={index} className="px-4 py-2.5 flex flex-col">
                                      <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-0.5">{key}</span>
                                      <span className="text-xs font-semibold text-[#555] break-all">{String(value)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

            </div>
          </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Inline Stage Selector Component ───
function InlineStageSelector({ currentStage, stageInfo, onStageChange }: { 
  currentStage: string; 
  stageInfo: { value: string; label: string; color: string };
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
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stageInfo.color }} />
        {stageInfo.label}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      
      {dropdown.isOpen && (
        <div 
          className="absolute top-full left-0 mt-1 w-48 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50"
          onClick={(e) => e.stopPropagation()}
        >
          {STAGES.map(s => (
            <button
              key={s.value}
              onClick={() => { onStageChange(s.value); dropdown.setIsOpen(false); }}
              className={`w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 transition-colors flex items-center gap-2 ${
                currentStage === s.value ? 'font-semibold' : ''
              }`}
              style={{ color: currentStage === s.value ? s.color : '#1D1D1F' }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
              {currentStage === s.value && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" style={{ color: s.color }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
