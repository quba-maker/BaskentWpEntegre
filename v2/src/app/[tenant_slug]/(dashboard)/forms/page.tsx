"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import useSWRInfinite from "swr/infinite";
import { Search, MessageCircle, X, FileText, ChevronRight, CheckCircle2, Bot, Save, StickyNote, Sparkles, RefreshCw, ChevronDown, Filter, Zap, Send, Clock, CheckCheck, Edit3, Phone, PhoneOff, PhoneForwarded, XCircle } from "lucide-react";
import { getForms, getCampaignNames, updateLeadNotes, updateLeadStage, syncGoogleSheets } from "@/app/actions/forms";
import { toggleBotStatus } from "@/app/actions/inbox";
import { prepareGreetingDraft, sendGreetingMessage, sendFormGreetingTemplateAction, activateBot, getOutreachHistory, logCallReached, logCallMissed, logCallbackScheduled, logNotInterested, getGreetingTemplates, resolveFirstContactAction, saveGreetingDraftInternal, prepareBulkSmartGreetingDraftsAction, prepareSmartGreetingDraftAction, type OutreachLogEntry } from "@/app/actions/outreach";
import { useInboxStore } from "@/store/inbox-store";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { MapPin, Building2, Calendar, Flame, TrendingUp, User } from "lucide-react";
import { resolvePatientDisplayName, formatPhoneReadable } from "@/lib/utils/patient-name-resolver";
import { resolveCountry, deduplicatePhones, getCountryInfoByName } from "@/lib/utils/country";

// ═══ P1: Outreach status badge config ═══
const OUTREACH_BADGE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  // First Contact status badges:
  'needs_greeting': { label: 'Karşılama Bekliyor', color: '#FF9500', icon: '👋' },
  'waiting_inbox_reply': { label: 'Panelden Cevap Bekliyor', color: '#5856D6', icon: '💬' },
  'whatsapp_opened': { label: 'WhatsApp’ta Açıldı', color: '#007AFF', icon: '📲' },
  'manual_greeting_confirmed': { label: 'Manuel Gönderildi', color: '#34C759', icon: '✅' },
  'inbox_greeting_sent': { label: 'Panelden Gönderildi', color: '#34C759', icon: '✅' },
  'patient_replied': { label: 'Cevap Geldi', color: '#10B981', icon: '↩️' },
  'blocked_or_invalid': { label: 'Sorunlu', color: '#FF3B30', icon: '⚠️' },
  'out_of_scope': { label: 'Kapsam Dışı', color: '#8E8E93', icon: '⛔' },
  'no_reply_waiting': { label: 'Cevap Bekleniyor', color: '#FF3B30', icon: '⏳' },

  // outreach timeline action fallbacks
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
  'smart_greeting_draft_edited': { label: 'Taslak Düzenlendi / Kaydedildi', color: '#8E8E93', icon: '📝' },
  'smart_greeting_draft_prepared': { label: 'Taslak Hazırlandı', color: '#8E8E93', icon: '📝' },
};

const getCheckboxTooltip = (status: string) => {
  switch (status) {
    case 'waiting_inbox_reply': return "Hasta mesaj attı, Inbox’tan cevaplanmalı.";
    case 'whatsapp_opened': return "WhatsApp’ta açıldı, tekil detaydan tekrar açılabilir.";
    case 'manual_greeting_confirmed':
    case 'inbox_greeting_sent': return "Karşılama yapılmış.";
    case 'patient_replied': return "Hasta cevap verdi, Inbox’tan devam edin.";
    case 'blocked_or_invalid': return "Telefon/veri kontrolü gerekli.";
    case 'out_of_scope': return "İlk temas kapsamı dışında.";
    default: return "";
  }
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
  const [firstContactFilter, setFirstContactFilter] = useState("all");
  const [leadStageFilter, setLeadStageFilter] = useState("all");
  const [selectedPhone, setSelectedPhone] = useState("");
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
  
  const [readiness, setReadiness] = useState<any | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const hasUsableTemplate = readiness?.templateConfigExists === true && readiness?.templateNonCompliant !== true;

  // PHASE 3: Bulk Manual WhatsApp Greeting Queue
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState(false);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [isPreparingQueue, setIsPreparingQueue] = useState(false);

  const normalizePhoneForWaMe = (p: string) => {
    if (!p) return "";
    let c = p.replace(/[\s+\-()]/g, "");
    if (c.startsWith("05") && c.length === 11) return "90" + c.slice(1);
    if (c.startsWith("5") && c.length === 10) return "90" + c;
    return c;
  };

  useEffect(() => {
    setSelectedLeadIds([]);
  }, [debouncedSearch, sourceFilter, firstContactFilter, leadStageFilter]);


  // DIAGNOSTIC LOG FOR RENDER STATE
  useEffect(() => {
    if (selectedForm?.id && process.env.NODE_ENV !== 'production') {
      console.log('[FORM_OUTREACH_CARD_RENDER_STATE]', {
        selectedFormId: selectedForm?.id,
        readiness,
        templateConfigExists: readiness?.templateConfigExists,
        templateName: readiness?.templateName,
        templateLanguage: readiness?.templateLanguage,
        templateNonCompliant: readiness?.templateNonCompliant,
        templateSendable: readiness?.templateSendable,
        hasUsableTemplate,
      });
    }
  }, [selectedForm?.id, readiness, hasUsableTemplate]);

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
    return ["forms", pageIndex + 1, debouncedSearch, sourceFilter, firstContactFilter, leadStageFilter];
  };

  const { data, size, setSize, isLoading, mutate } = useSWRInfinite(
    getKey, 
    ([_, page, search, source, fContact, lStage]: any) => getForms(page, search, source, fContact, lStage), 
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
      setReadinessLoading(true);
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
      
      const phones = getAllPhones(selectedForm);
      setSelectedPhone(phones[0] || selectedForm.phone_number || "");

      loadOutreachTimeline(selectedForm.id);
      getGreetingTemplates().then((t: any[]) => setTemplates(t)).catch(() => setTemplates([]));
      
      resolveFirstContactAction(selectedForm.id)
        .then((res: any) => {
          if (res && res.success && res.resolution) {
            setReadiness(res.resolution);
            
            // Derive greetingSent from phones
            const anySent = res.resolution.phones.some((p: any) => 
               p.hasManualGreetingConfirmed || p.hasInboxGreetingSent || p.hasApiGreetingSent
            );
            if (anySent) {
              setGreetingSent(true);
            }

            if (res.resolution.recommendedPhone?.phone) {
              setSelectedPhone(res.resolution.recommendedPhone.phone);
            }

            if (res.resolution.patientLevelStatus === 'needs_greeting') {
              handlePrepareDraft(selectedForm);
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
      setSelectedPhone("");
    }
  }, [selectedForm?.id, loadOutreachTimeline]);

  // PHASE 2L-P0v2: Step 1 — Prepare SMART greeting draft (NO WhatsApp API call)
  const handlePrepareDraft = async (form: any) => {
    setOutreachLoading('draft');
    setOutreachError(null);
    setOutreachSuccess(null);
    try {
      const result: any = await prepareSmartGreetingDraftAction(form.id);
      if (result.success && result.data?.draftText) {
        setDraftMessage(result.data.draftText);
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

  // PHASE 2L-P0v2: Manual WhatsApp App Sending (Zero-Outbound, Free)
  const handleOpenWhatsAppApp = async (form: any) => {
    if (!draftMessage || draftMessage.trim().length === 0) {
      setOutreachError('Mesaj metni boş olamaz.');
      return;
    }

    const targetPhone = selectedPhone || readiness?.recommendedPhone?.phone || form.phone_number;
    if (!targetPhone) {
      setOutreachError('Telefon numarası eksik.');
      return;
    }

    // 1. Phone Normalization
    let cleanPhone = targetPhone.replace(/[\s+\-()]/g, '');
    if (cleanPhone.startsWith('05')) {
      cleanPhone = '90' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('5') && cleanPhone.length === 10) {
      cleanPhone = '90' + cleanPhone;
    }
    
    if (cleanPhone.length < 10) {
      setOutreachError('Geçerli bir telefon numarası bulunamadı.');
      return;
    }

    // 2. Open WhatsApp immediately to avoid popup blocker
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(draftMessage)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');

    // 3. Log the action asynchronously
    setOutreachLoading('sending');
    setOutreachError(null);
    setOutreachSuccess(null);
    try {
      const { logWhatsappAppOpenedForGreetingAction } = await import('@/app/actions/outreach');
      const result = await logWhatsappAppOpenedForGreetingAction(form.id, draftMessage, { targetPhone });
      
      if (!result.success) {
        setOutreachSuccess('WhatsApp açıldı, ancak sistem logu kaydedilemedi.');
      } else {
        setOutreachSuccess('WhatsApp başarıyla açıldı ve kaydedildi.');
        await loadOutreachTimeline(form.id);
      }
    } catch (err: any) {
      setOutreachSuccess('WhatsApp açıldı, ancak sistem logu kaydedilemedi.');
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
      const result = await saveGreetingDraftInternal(form.id, draftMessage, botNote, selectedPhone || undefined);
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

  // PHASE 3: Bulk Manual Queue Functions
  const handleBulkQueueStart = async () => {
    if (selectedLeadIds.length === 0) return;
    
    console.info('[BULK_QUEUE_CLIENT_START]', {
      selectedLeadIds,
      selectedCount: selectedLeadIds.length,
      currentFilter: firstContactFilter
    });

    setIsPreparingQueue(true);
    setIsQueueModalOpen(true);
    try {
      const result: any = await prepareBulkSmartGreetingDraftsAction(selectedLeadIds);
      const queueItemsRaw = result?.data?.queueItems ?? result?.queueItems ?? [];

      if (!result.success || queueItemsRaw.length === 0) {
        alert("Seçilen kayıtlar toplu karşılama kuyruğuna uygun değil.\nSadece “Karşılama Bekliyor” durumundaki kişiler kuyruğa alınabilir.");
        setIsQueueModalOpen(false);
        return;
      }

      const hasEligible = queueItemsRaw.some((qItem: any) => qItem.isEligible === true);
      if (!hasEligible) {
        alert("Seçilen kayıtlar toplu karşılama kuyruğuna uygun değil.\nSadece “Karşılama Bekliyor” durumundaki kişiler kuyruğa alınabilir.");
        setIsQueueModalOpen(false);
        return;
      }

      const items = queueItemsRaw.map((qItem: any) => {
        const lead = forms.find((f: any) => f.id === qItem.id || f.id === qItem.leadId);
        let status = qItem.status || 'Hazır';
        let reason = qItem.reason || '';

        // Client side missing phone fallback, just in case
        if (!normalizePhoneForWaMe(lead?.phone_number || qItem.phone)) {
          status = 'Eksik Telefon';
          qItem.isEligible = false;
          reason = 'Geçersiz veya eksik telefon numarası';
        }

        return {
          ...qItem,
          patient_name: lead?.patient_name || qItem.name || 'Bilinmiyor',
          phone: lead?.phone_number || qItem.phone || '',
          status,
          reason
        };
      });

      setQueueItems(items);
      setCurrentQueueIndex(0);
    } catch (err) {
      console.error(err);
      setIsQueueModalOpen(false);
    } finally {
      setIsPreparingQueue(false);
    }
  };

  const handleOpenNextInQueue = async (action: 'open' | 'skip') => {
    if (currentQueueIndex >= queueItems.length) return;
    
    const currentItem = queueItems[currentQueueIndex];
    const newItems = [...queueItems];
    
    if (action === 'skip' || currentItem.status !== 'Hazır') {
      newItems[currentQueueIndex].status = currentItem.status !== 'Hazır' ? currentItem.status : 'Atlandı';
      setQueueItems(newItems);
      setCurrentQueueIndex(prev => prev + 1);
      return;
    }

    const cleanPhone = normalizePhoneForWaMe(currentItem.phone);
    const draftText = currentItem.draftText || "Merhaba, doldurduğunuz form doğrultusunda başvurunuzla ilgili sizinle iletişime geçiyoruz.";
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(draftText)}`;
    
    // 1. Synchronous window.open to bypass popup blockers
    window.open(waUrl, '_blank', 'noopener,noreferrer');

    // 2. Mark opened
    newItems[currentQueueIndex].status = "WhatsApp'ta açıldı";
    setQueueItems(newItems);

    // 3. Asynchronous log (zero outbound)
    import('@/app/actions/outreach').then(m => {
      m.logWhatsappAppOpenedForGreetingAction(currentItem.id, draftText, {
        source: 'forms_bulk_manual_queue',
        queue_index: currentQueueIndex + 1,
        queue_total: queueItems.length
      });
    }).catch(console.error);

    setCurrentQueueIndex(prev => prev + 1);
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
      {(sourceFilter !== 'all' || firstContactFilter !== 'all' || leadStageFilter !== 'all') && (
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
          {firstContactFilter !== 'all' && (
            <button 
              onClick={() => setFirstContactFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[11px] font-bold hover:bg-indigo-100 transition-colors border border-indigo-200"
            >
              <Filter className="w-3 h-3" />
              {OUTREACH_BADGE_CONFIG[firstContactFilter]?.label || firstContactFilter}
              <X className="w-3 h-3 ml-1" />
            </button>
          )}
          {leadStageFilter !== 'all' && (
            <button 
              onClick={() => setLeadStageFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold hover:opacity-80 transition-colors border"
              style={{ 
                backgroundColor: `${getStageInfo(leadStageFilter).color}15`,
                color: getStageInfo(leadStageFilter).color,
                borderColor: `${getStageInfo(leadStageFilter).color}30`
              }}
            >
              {getStageInfo(leadStageFilter).label}
              <X className="w-3 h-3 ml-1" />
            </button>
          )}
          <button 
            onClick={() => { setSourceFilter('all'); setFirstContactFilter('all'); setLeadStageFilter('all'); }}
            className="text-[11px] font-semibold text-[#86868B] hover:text-[#1D1D1F] transition-colors ml-1"
          >
            Tümünü temizle
          </button>
        </div>
      )}

      {/* PHASE 3: Sticky Bulk Action Bar */}
      {selectedLeadIds.length > 0 && (
        <div className="mb-4 bg-[#007AFF]/10 border border-[#007AFF]/20 rounded-xl p-3 flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-3 text-[#007AFF]">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-semibold text-sm">{selectedLeadIds.length} kişi seçildi</span>
          </div>
          <button
            onClick={handleBulkQueueStart}
            className="px-4 py-1.5 bg-[#007AFF] text-white text-sm font-semibold rounded-lg hover:bg-[#0056b3] transition-colors shadow-sm"
          >
            Seçilenleri Manuel Karşılama Kuyruğuna Al
          </button>
        </div>
      )}

      {/* Premium Horizontal Tabs for First Contact Status */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5 p-1 bg-black/[0.03] rounded-xl border border-black/5 self-start shadow-sm">
        {[
          { value: 'all', label: 'Tümü', icon: '📁' },
          { value: 'needs_greeting', label: 'Karşılama Bekliyor', icon: '👋' },
          { value: 'waiting_inbox_reply', label: 'Panelden Cevap Bekliyor', icon: '💬' },
          { value: 'whatsapp_opened', label: 'WhatsApp’ta Açıldı', icon: '📲' },
          { value: 'no_reply_waiting', label: 'Cevap Bekleniyor', icon: '⏳' },
          { value: 'sent', label: 'Gönderildi', icon: '✅' },
          { value: 'patient_replied', label: 'Cevap Geldi', icon: '↩️' },
          { value: 'blocked_or_invalid', label: 'Sorunlu', icon: '⚠️' }
        ].map((tab) => {
          const isActive = firstContactFilter === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setFirstContactFilter(tab.value)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer select-none border border-transparent ${
                isActive 
                  ? 'bg-white text-[#1D1D1F] shadow-sm border-black/5' 
                  : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-white/40'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Table Container */}
      <div className="flex-1 overflow-hidden flex flex-col bg-white/40 backdrop-blur-xl border border-white/50 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-white/80 backdrop-blur-md z-10 border-b border-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <tr>
                <th className="py-3 px-4 w-12 text-center border-r border-black/5">
                  <input 
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-300 text-[#007AFF] focus:ring-[#007AFF]"
                    checked={forms.length > 0 && selectedLeadIds.length > 0 && selectedLeadIds.length === Math.min(10, forms.filter((f:any) => f.firstContactStatus === 'needs_greeting' && !f.noReplyFollowup?.is_no_reply_eligible).length)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const selectableIds = forms
                          .filter((f:any) => f.firstContactStatus === 'needs_greeting' && !f.noReplyFollowup?.is_no_reply_eligible)
                          .map((f:any) => f.id)
                          .slice(0, 10);
                        setSelectedLeadIds(selectableIds);
                      } else {
                        setSelectedLeadIds([]);
                      }
                    }}
                  />
                </th>
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
                        leadStageFilter !== 'all' ? 'bg-[#007AFF]/10 text-[#007AFF]' : 'hover:bg-black/5'
                      }`}
                    >
                      Durum
                      <ChevronDown className={`w-3 h-3 transition-transform ${stageDropdown.isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {stageDropdown.isOpen && (
                      <div className="absolute top-full left-0 mt-1 w-52 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50">
                        <button 
                          onClick={() => { setLeadStageFilter('all'); stageDropdown.setIsOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-[12px] font-semibold hover:bg-black/5 transition-colors flex items-center gap-2 ${
                            leadStageFilter === 'all' ? 'text-[#007AFF]' : 'text-[#1D1D1F]'
                          }`}
                        >
                          {leadStageFilter === 'all' && <CheckCircle2 className="w-3.5 h-3.5" />}
                          Tüm Durumlar
                        </button>
                        <div className="h-px bg-black/5 my-1" />
                        {STAGES.map(s => (
                          <button 
                            key={s.value}
                            onClick={() => { setLeadStageFilter(s.value); stageDropdown.setIsOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 transition-colors flex items-center gap-2 ${
                              leadStageFilter === s.value ? 'font-semibold' : ''
                            }`}
                            style={{ color: leadStageFilter === s.value ? s.color : '#1D1D1F' }}
                          >
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.label}
                            {leadStageFilter === s.value && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </th>
                
                <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">İlk Temas</th>
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
                  <td className="py-4 px-4 w-12 text-center border-r border-black/5" onClick={(e) => e.stopPropagation()}>
                    <input 
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300 text-[#007AFF] focus:ring-[#007AFF] disabled:opacity-50 cursor-pointer"
                      disabled={form.firstContactStatus !== 'needs_greeting' || form.noReplyFollowup?.is_no_reply_eligible}
                      title={form.noReplyFollowup?.is_no_reply_eligible ? "Bu kişi cevap bekleyen görüşmede. Inbox’tan takip edin." : getCheckboxTooltip(form.firstContactStatus)}
                      checked={selectedLeadIds.includes(form.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (selectedLeadIds.length >= 10) {
                            alert("En fazla 10 kişi seçebilirsiniz.");
                            return;
                          }
                          setSelectedLeadIds([...selectedLeadIds, form.id]);
                        } else {
                          setSelectedLeadIds(selectedLeadIds.filter(id => id !== form.id));
                        }
                      }}
                    />
                  </td>
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
                  <td className="py-4 px-4 whitespace-nowrap">
                    {(() => {
                      const badgeKey = form.noReplyFollowup?.is_no_reply_eligible ? 'no_reply_waiting' : form.firstContactStatus;
                      const badge = OUTREACH_BADGE_CONFIG[badgeKey];
                      if (!badge) return <span className="text-[11px] text-[#86868B] italic">—</span>;
                      return (
                        <span 
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border uppercase tracking-wide shadow-sm"
                          style={{ 
                            backgroundColor: `${badge.color}15`,
                            color: badge.color,
                            borderColor: `${badge.color}25`
                          }}
                        >
                          <span className="text-[11px]">{badge.icon}</span> {badge.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-4 px-4 text-right">
                    {(() => {
                      let label = 'Detay';
                      let icon = <ChevronRight className="w-3.5 h-3.5" />;
                      let btnClass = "bg-white border border-black/5 hover:bg-black/5 text-[#1D1D1F]";
                      
                      const isNoReply = form.noReplyFollowup?.is_no_reply_eligible;
                      
                      if (isNoReply) {
                        label = 'Inbox’a Git';
                        icon = <MessageCircle className="w-3.5 h-3.5" />;
                        btnClass = "bg-emerald-50 border border-emerald-250 text-emerald-700 hover:bg-emerald-100";
                      } else {
                        switch (form.firstContactStatus) {
                          case 'needs_greeting':
                            label = 'WhatsApp’ta Karşıla';
                            icon = <MessageCircle className="w-3.5 h-3.5" />;
                            btnClass = "bg-[#25D366]/10 border border-[#25D366]/20 text-[#25D366] hover:bg-[#25D366]/20";
                            break;
                          case 'waiting_inbox_reply':
                            label = 'Inbox’ta Karşıla';
                            icon = <MessageCircle className="w-3.5 h-3.5" />;
                            btnClass = "bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100";
                            break;
                          case 'whatsapp_opened':
                            label = 'Tekrar Aç';
                            icon = <MessageCircle className="w-3.5 h-3.5" />;
                            btnClass = "bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100";
                            break;
                          case 'manual_greeting_confirmed':
                          case 'inbox_greeting_sent':
                            label = 'Mesaja Git';
                            icon = <MessageCircle className="w-3.5 h-3.5" />;
                            btnClass = "bg-emerald-50 border border-emerald-250 text-emerald-700 hover:bg-emerald-100";
                            break;
                          case 'patient_replied':
                            label = 'Inbox’a Git';
                            icon = <MessageCircle className="w-3.5 h-3.5" />;
                            btnClass = "bg-emerald-50 border border-emerald-250 text-emerald-700 hover:bg-emerald-100";
                            break;
                          case 'blocked_or_invalid':
                          case 'out_of_scope':
                          default:
                            label = 'Detay';
                            icon = <ChevronRight className="w-3.5 h-3.5" />;
                            btnClass = "bg-white border border-black/5 hover:bg-black/5 text-[#1D1D1F]";
                            break;
                        }
                      }

                      return (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedForm(form);
                            setNotes(form.notes || "");
                            
                            if (['Inbox’ta Karşıla', 'Mesaja Git', 'Inbox’a Git'].includes(label)) {
                              const phone = getAllPhones(form)[0] || form.phone_number;
                              window.location.href = `/${params.tenant_slug}/inbox?phone=${phone}`;
                            } else if (label === 'WhatsApp’ta Karşıla' || label === 'Tekrar Aç') {
                              setIsDraftOpen(true);
                              handlePrepareDraft(form);
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg shadow-sm transition-all text-[11px] font-bold ${btnClass}`}
                        >
                          {icon}
                          <span>{label}</span>
                        </button>
                      );
                    })()}
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

      {selectedForm && (() => {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[FORM_OUTREACH_CARD_RENDER_STATE]', {
            selectedFormId: selectedForm?.id,
            readiness,
            templateConfigExists: readiness?.templateConfigExists,
            templateName: readiness?.templateName,
            templateLanguage: readiness?.templateLanguage,
            templateNonCompliant: readiness?.templateNonCompliant,
            templateSendable: readiness?.templateSendable,
            hasUsableTemplate,
          });
        }
        return null;
      })()}

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
                <div className="space-y-2">
                  {getAllPhones(selectedForm).map((phone, idx) => {
                    const isRecommended = readiness?.recommendedPhone?.phone === phone || (idx === 0 && !readiness?.recommendedPhone);
                    const isSelected = selectedPhone === phone;
                    return (
                      <label 
                        key={phone} 
                        className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all ${
                          isSelected 
                            ? 'border-[#007AFF] bg-[#007AFF]/5 shadow-sm' 
                            : 'border-black/5 hover:bg-black/[0.02]'
                        }`}
                        onClick={() => setSelectedPhone(phone)}
                      >
                        <div className="flex items-center gap-2">
                          <input 
                            type="radio" 
                            name="selected_phone" 
                            checked={isSelected}
                            onChange={() => setSelectedPhone(phone)}
                            className="w-3.5 h-3.5 text-[#007AFF] focus:ring-[#007AFF]" 
                          />
                          <span className="font-semibold text-[13.5px] text-[#1D1D1F]">
                            {formatPhone(phone)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 font-semibold">
                          {isRecommended && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase tracking-wider">
                              Önerilen
                            </span>
                          )}
                          <span className="text-[9.5px] font-medium text-[#86868B]">
                            {idx === 0 ? 'Birincil' : 'İkincil'}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {selectedPhone && (
                  <div className="text-[10.5px] font-semibold text-[#86868B] bg-black/[0.02] p-2 rounded-lg text-center mt-1 border border-black/[0.03]">
                    📲 Karşılama için seçilen numara: <span className="text-[#1D1D1F] font-bold">{formatPhone(selectedPhone)}</span>
                  </div>
                )}
              </div>
              
              {/* PHASE 2L-P0: Outreach Actions */}
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-black/5 bg-gradient-to-r from-[#25D366]/5 to-[#007AFF]/5">
                  <h3 className="text-sm font-bold text-[#1D1D1F] flex items-center gap-2">
                    <Send className="w-4 h-4 text-[#25D366]" />
                    İlk İletişim (Outreach)
                  </h3>
                  <p className="text-[11px] text-[#86868B] font-medium mt-0.5">Karşılama mesajı durumunu ve taslağını yönetin</p>
                </div>
                <div className="p-4 space-y-3">
                  {(() => {
                    const currentStatus = readiness?.patientLevelStatus || selectedForm.firstContactStatus;
                    const badge = OUTREACH_BADGE_CONFIG[currentStatus];
                    
                    const getStatusDesc = (status: string) => {
                      switch (status) {
                        case 'needs_greeting': return "Hasta henüz WhatsApp’tan mesaj atmadı. Hazır taslağı WhatsApp uygulamasında açarak manuel gönderebilirsiniz.";
                        case 'waiting_inbox_reply': return "Hasta WhatsApp’tan mesaj attı. Karşılama cevabını Inbox üzerinden gönderebilirsiniz.";
                        case 'whatsapp_opened': return "Taslak WhatsApp uygulamasında açıldı. Gönderim doğrulaması bekleniyor.";
                        case 'manual_greeting_confirmed':
                        case 'inbox_greeting_sent': return "İlk karşılama tamamlandı.";
                        case 'patient_replied': return "Hasta cevap verdi. Görüşmeyi Inbox üzerinden devam ettirin.";
                        case 'blocked_or_invalid': return "Telefon veya veri kontrolü gerekli.";
                        case 'out_of_scope': return "İlk temas kapsamı dışında.";
                        default: return "";
                      }
                    };

                    return (
                      <div className="space-y-3">
                        {/* Status Badge & Desc */}
                        <div className="text-left space-y-1.5 p-3 bg-black/[0.02] border border-black/[0.04] rounded-xl shadow-sm">
                          {badge && (
                            <span 
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border uppercase"
                              style={{ 
                                backgroundColor: `${badge.color}15`,
                                color: badge.color,
                                borderColor: `${badge.color}30`
                              }}
                            >
                              {badge.icon} {badge.label}
                            </span>
                          )}
                          <p className="text-[12px] text-[#555558] font-medium leading-relaxed">
                            {getStatusDesc(currentStatus)}
                          </p>
                        </div>

                        {/* Error and Success banners */}
                        {outreachError && (
                          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px] font-medium flex items-center gap-2">
                            <X className="w-3.5 h-3.5 shrink-0" />
                            {outreachError}
                          </div>
                        )}
                        {outreachSuccess && (
                          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12px] font-medium flex items-center gap-2">
                            <CheckCheck className="w-3.5 h-3.5 shrink-0" />
                            {outreachSuccess}
                          </div>
                        )}

                        {/* 1. Custom Flow for needs_greeting Status */}
                        {currentStatus === 'needs_greeting' && (
                          <div className="space-y-3 pt-2">
                            {outreachLoading === 'draft' ? (
                              <div className="flex flex-col items-center justify-center py-6 gap-2 bg-[#F5F5F7] rounded-xl border border-black/5">
                                <RefreshCw className="w-5 h-5 text-[#86868B] animate-spin" />
                                <span className="text-[12px] font-semibold text-[#86868B]">Taslak hazırlanıyor...</span>
                              </div>
                            ) : draftMessage !== null ? (
                              <>
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
                                  rows={5}
                                  className="w-full border border-black/10 rounded-xl p-3 text-[13px] text-[#1D1D1F] font-medium resize-none outline-none transition-all leading-relaxed bg-white focus:ring-2 focus:ring-[#25D366]/40 focus:border-[#25D366]/30"
                                  placeholder="Karşılama mesajınızı buraya yazın..."
                                />

                                <div className="space-y-1 text-left">
                                  <label className="block text-[10.5px] font-bold text-[#86868B] uppercase tracking-wider">
                                    🤖 Bota kısa not/direktif ekle (opsiyonel)
                                  </label>
                                  <input
                                    type="text"
                                    value={botNote}
                                    onChange={(e) => setBotNote(e.target.value)}
                                    placeholder="Örn: Geliş tarihini netleştir..."
                                    className="w-full bg-[#F5F5F7] border border-black/10 rounded-xl px-3 py-2 text-[12px] text-[#1D1D1F] font-medium outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all"
                                  />
                                </div>

                                <div className="space-y-2 pt-3 border-t border-black/5">
                                  <button 
                                    onClick={() => handleOpenWhatsAppApp(selectedForm)}
                                    disabled={outreachLoading === 'sending' || !draftMessage?.trim()}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold bg-[#25D366] hover:bg-[#1DA851] text-white shadow-[0_4px_14px_rgba(37,211,102,0.39)] transition-all cursor-pointer disabled:opacity-50"
                                  >
                                    <Send className="w-4 h-4" /> WhatsApp’ta Karşıla
                                  </button>
                                  <button 
                                    onClick={() => handleSaveInternal(selectedForm)}
                                    disabled={outreachLoading === 'sending' || !draftMessage?.trim()}
                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20 cursor-pointer transition-all disabled:opacity-50"
                                  >
                                    {outreachLoading === 'sending' ? (
                                      <><RefreshCw className="w-4 h-4 animate-spin" /> Kaydediliyor...</>
                                    ) : (
                                      <><Save className="w-4 h-4" /> Not Olarak Kaydet</>
                                    )}
                                  </button>
                                </div>
                              </>
                            ) : null}
                          </div>
                        )}

                        {/* 2. Active Greeting Draft Textarea if Open (for non-needs_greeting statuses) */}
                        {isDraftOpen && currentStatus !== 'needs_greeting' && draftMessage !== null && (
                          <div className="space-y-3 pt-2">
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
                              rows={5}
                              className="w-full border border-black/10 rounded-xl p-3 text-[13px] text-[#1D1D1F] font-medium resize-none outline-none transition-all leading-relaxed bg-white focus:ring-2 focus:ring-[#25D366]/40 focus:border-[#25D366]/30"
                              placeholder="Karşılama mesajınızı buraya yazın..."
                            />

                            <div className="space-y-1 text-left">
                              <label className="block text-[10.5px] font-bold text-[#86868B] uppercase tracking-wider">
                                🤖 Bota kısa not/direktif ekle (opsiyonel)
                              </label>
                              <input
                                type="text"
                                value={botNote}
                                onChange={(e) => setBotNote(e.target.value)}
                                placeholder="Örn: Geliş tarihini netleştir..."
                                className="w-full bg-[#F5F5F7] border border-black/10 rounded-xl px-3 py-2 text-[12px] text-[#1D1D1F] font-medium outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all"
                              />
                            </div>

                            <div className="space-y-2 pt-3 border-t border-black/5">
                              <button 
                                onClick={() => handleOpenWhatsAppApp(selectedForm)}
                                disabled={outreachLoading === 'sending' || !draftMessage?.trim()}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold bg-[#25D366] hover:bg-[#1DA851] text-white shadow-[0_4px_14px_rgba(37,211,102,0.39)] transition-all cursor-pointer disabled:opacity-50"
                              >
                                <Send className="w-4 h-4" /> WhatsApp Uygulamasında Aç
                              </button>
                              <button 
                                onClick={() => handleSaveInternal(selectedForm)}
                                disabled={outreachLoading === 'sending' || !draftMessage?.trim()}
                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20 cursor-pointer transition-all disabled:opacity-50"
                              >
                                {outreachLoading === 'sending' ? (
                                  <><RefreshCw className="w-4 h-4 animate-spin" /> Kaydediliyor...</>
                                ) : (
                                  <><Save className="w-4 h-4" /> Taslağı Kaydet</>
                                )}
                              </button>
                              <button 
                                onClick={handleCancelDraft}
                                disabled={outreachLoading === 'sending'}
                                className="w-full py-2.5 rounded-xl text-[13px] font-bold bg-black/[0.04] hover:bg-black/[0.08] text-[#1D1D1F] transition-colors cursor-pointer disabled:opacity-50"
                              >
                                İptal
                              </button>
                            </div>
                          </div>
                        )}

                        {/* 3. Standard Action Button if Draft is NOT Open (exclude needs_greeting) */}
                        {!isDraftOpen && currentStatus !== 'needs_greeting' && ['waiting_inbox_reply', 'whatsapp_opened', 'manual_greeting_confirmed', 'inbox_greeting_sent', 'patient_replied'].includes(currentStatus) && (
                          <div className="flex gap-3 pt-2">
                            <button
                              onClick={() => {
                                if (['waiting_inbox_reply', 'patient_replied', 'manual_greeting_confirmed', 'inbox_greeting_sent'].includes(currentStatus)) {
                                  window.location.href = `/${params.tenant_slug}/inbox?phone=${selectedPhone || selectedForm.phone_number}`;
                                } else {
                                  handlePrepareDraft(selectedForm);
                                }
                              }}
                              disabled={outreachLoading === 'draft' || readinessLoading}
                              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all bg-[#25D366] text-white shadow-[0_4px_14px_rgba(37,211,102,0.39)] hover:bg-[#1DA851] cursor-pointer disabled:opacity-70 disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none"
                            >
                              {readinessLoading ? (
                                <><RefreshCw className="w-4 h-4 animate-spin" /> Yükleniyor...</>
                              ) : outreachLoading === 'draft' ? (
                                <><RefreshCw className="w-4 h-4 animate-spin" /> Hazırlanıyor...</>
                              ) : (
                                <>
                                  {currentStatus === 'whatsapp_opened' && 'Tekrar Aç'}
                                  {currentStatus === 'waiting_inbox_reply' && 'Inbox’ta Karşıla'}
                                  {['manual_greeting_confirmed', 'inbox_greeting_sent'].includes(currentStatus) && 'Mesaja Git'}
                                  {currentStatus === 'patient_replied' && 'Inbox’a Git'}
                                </>
                              )}
                            </button>
                            <button 
                              onClick={() => handleOutreachBotActivate(selectedForm)}
                              disabled={selectedForm.isBotActive || outreachLoading === 'bot' || !greetingSent}
                              title={!greetingSent ? 'Önce selamlama gönderilmeli' : selectedForm.isBotActive ? 'Bot zaten aktif' : 'AI Bota devret'}
                              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all ${
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
                      </div>
                    );
                  })()}

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
                            {(entry.action === 'form_greeting_draft_saved_internal' || entry.action === 'smart_greeting_draft_edited') && (
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

      {/* PHASE 3: Bulk Queue Modal */}
      {isQueueModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between bg-[#F5F5F7]">
              <h3 className="font-semibold text-[#1D1D1F]">
                Manuel Karşılama Kuyruğu ({currentQueueIndex}/{queueItems.length})
              </h3>
              <button 
                onClick={() => setIsQueueModalOpen(false)}
                className="p-1.5 hover:bg-black/5 rounded-lg text-[#86868B] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 flex-1 overflow-y-auto">
              {isPreparingQueue ? (
                <div className="py-8 flex flex-col items-center justify-center text-center">
                  <div className="w-8 h-8 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin mb-3"></div>
                  <p className="text-sm text-[#86868B]">Kuyruk hazırlanıyor, lütfen bekleyin...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {queueItems.map((item, index) => {
                    const isCurrent = index === currentQueueIndex;
                    const isPast = index < currentQueueIndex;
                    
                    return (
                      <div 
                        key={item.id}
                        className={`p-3 rounded-xl border flex flex-col gap-2 transition-all ${
                          isCurrent ? 'bg-[#007AFF]/5 border-[#007AFF]/20 shadow-sm' : 
                          isPast ? 'bg-black/5 border-transparent opacity-70' : 
                          'bg-white border-black/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className={`text-sm font-semibold ${isCurrent ? 'text-[#007AFF]' : 'text-[#1D1D1F]'}`}>
                              {item.patient_name}
                            </span>
                            <span className="text-xs text-[#86868B] mt-0.5">{item.phone}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${
                              item.status === 'Hazır' ? 'bg-emerald-100 text-emerald-700' :
                              item.status === "WhatsApp'ta açıldı" ? 'bg-[#007AFF]/10 text-[#007AFF]' :
                              item.status === 'Atlandı' ? 'bg-gray-100 text-gray-600' :
                              'bg-red-100 text-red-600'
                            }`}>
                              {item.status}
                            </span>
                          </div>
                        </div>

                        {isCurrent && item.draftText && (
                          <div className="mt-1 w-full bg-white/50 p-2.5 rounded-lg border border-black/5">
                            <label className="text-[9px] font-bold text-[#86868B] uppercase tracking-wider block mb-1">
                              Gönderilecek Taslak Mesaj
                            </label>
                            <textarea
                              readOnly
                              value={item.draftText}
                              className="w-full h-20 text-xs p-2 rounded-md border border-black/10 bg-white text-[#1D1D1F] resize-none focus:outline-none focus:ring-1 focus:ring-[#007AFF]"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            
            {!isPreparingQueue && currentQueueIndex < queueItems.length && (
              <div className="p-4 border-t border-black/5 bg-white flex items-center justify-end gap-3">
                <button
                  onClick={() => handleOpenNextInQueue('skip')}
                  className="px-4 py-2 text-sm font-semibold text-[#86868B] hover:bg-black/5 rounded-lg transition-colors"
                >
                  Atla
                </button>
                <button
                  onClick={() => handleOpenNextInQueue('open')}
                  disabled={queueItems[currentQueueIndex].status !== 'Hazır'}
                  className="px-6 py-2 bg-[#007AFF] text-white text-sm font-semibold rounded-lg hover:bg-[#0056b3] transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  Sıradakini WhatsApp'ta Aç
                </button>
              </div>
            )}
            {!isPreparingQueue && currentQueueIndex >= queueItems.length && (
              <div className="p-4 border-t border-black/5 bg-white flex justify-center">
                <button
                  onClick={() => {
                    setIsQueueModalOpen(false);
                    setSelectedLeadIds([]);
                  }}
                  className="px-6 py-2 bg-[#1D1D1F] text-white text-sm font-semibold rounded-lg hover:bg-black transition-colors"
                >
                  Tamamla ve Kapat
                </button>
              </div>
            )}
          </div>
        </div>
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
