"use client";

import { useState, useEffect, useRef } from "react";
import { useSWRConfig } from "swr";
import { User, MapPin, Building, Activity, Tag, ChevronDown, ChevronRight, Save, X, Plus, ChevronLeft, Check, Loader2, Sparkles, FileText, Brain, Link, Clock, Moon, Calendar, CalendarClock, PhoneForwarded, MailPlus, Share2, Eye, EyeOff, Send, Copy, AlertTriangle } from "lucide-react";
import { useInboxStore } from "@/store/inbox-store";
import { updateCrmData, addTag, removeTag, prepareFollowUpDraft, sendApprovedFollowUp, checkSecondaryFallback, prepareSecondaryDraft, getCrmPanelBundleAction, prepareFormGreetingDraft, saveBotSteeringDirectiveAction, saveFormGreetingDraftInternalAction, sendFormGreetingFromInboxAction, prepareNoReplyReminderDraftAction, sendNoReplyReminderAction, scheduleReminderTaskAction, prepareInboxBotAssistedDraftAction, sendApprovedInboxBotDraftAction } from "@/app/actions/inbox";
import { CustomerAiBrainPanel } from "@/components/features/ai-observability/CustomerAiBrain";
import { AiTimelinePanel } from "@/components/features/ai-observability/AiTimeline";
import { resolvePatientDisplayName, formatPhoneReadable } from "@/lib/utils/patient-name-resolver";
import { normalizeCountry } from "@/lib/utils/country-normalizer";
import { extractFromPatientMessageDeterministic } from "@/lib/utils/patient-message-extractor";
import { resolveInboxActionIntent } from "@/lib/utils/intent-resolver";
import { resolveDepartmentWithConflict } from "@/lib/utils/crm-conflict-resolver";
import { resolvePatientTimeDisplay } from "@/lib/utils/timezone";
import { useParams } from "next/navigation";
import { resolveUniversalAISummary, getTenantEntityType } from "@/lib/utils/universal-summary-resolver";
import { UniversalAISummaryCard } from "@/components/features/takip/universal-ai-summary-card";
import { useTenant } from "@/components/providers/tenant-provider";
import { PatientFormModal } from "./patient-form-modal";
import { PhoneCallModal } from "./phone-call-modal";
import { AppointmentModal } from "./appointment-modal";
import { FollowUpReminderModal } from "./follow-up-reminder-modal";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Phone } from "lucide-react";

const tagTranslationMap: Record<string, string> = {
  "price_sensitive": "fiyat_odaklı",
  "international_patient": "yurtdışı_hasta",
  "urgent": "acil",
  "new_lead": "yeni_lead",
  "high_potential": "yüksek_potansiyel"
};

function formatTag(tag: string) {
  const t = tag.trim().toLowerCase();
  return tagTranslationMap[t] || tag;
}

const aiLabelTranslation: Record<string, string> = {
  warm: "Ilık",
  hot: "Sıcak",
  cold: "Soğuk",
  neutral: "Nötr",
  positive: "Pozitif",
  negative: "Negatif",
  frustrated: "Kızgın",
  price_sensitive: "Fiyat Duyarlı",
  high: "Yüksek",
  medium: "Orta",
  low: "Düşük",
  engaged: "İlgili",
  interested: "İlgili",
  not_interested: "İlgisiz",
};

function translateAiLabel(label?: string) {
  if (!label) return "";
  const key = label.trim().toLowerCase();
  return aiLabelTranslation[key] || label;
}

// ==========================================
// CONTEXT PANEL — Right-side CRM engine
// Architecture: Contextual CRM engine (not display component)
// Authority: Lead data, tags, pipeline, form history
// Governance: Token-native, skeleton-first, q-glass
// ==========================================

// -- Skeleton --
function CrmSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Profile skeleton */}
      <div className="p-8 flex flex-col items-center" style={{ borderBottom: "1px solid var(--q-border-default)" }}>
        <div className="w-24 h-24 rounded-full q-skeleton mb-5" />
        <div className="h-5 w-32 q-skeleton rounded mb-3" />
        <div className="h-7 w-20 q-skeleton rounded-full" />
      </div>
      {/* Fields skeleton */}
      <div className="p-5 space-y-6">
        <div className="space-y-2"><div className="h-3 w-20 q-skeleton rounded" /><div className="h-10 w-full q-skeleton rounded-xl" /></div>
        <div className="space-y-2"><div className="h-3 w-24 q-skeleton rounded" /><div className="h-10 w-full q-skeleton rounded-xl" /></div>
        <div className="h-20 w-full q-skeleton rounded-2xl" />
      </div>
    </div>
  );
}

export function ContextPanel() {
  const activeContact = useInboxStore((state) => state.activeContact);
  const mobileView = useInboxStore((state) => state.mobileView);
  const setMobileView = useInboxStore((state) => state.setMobileView);
  const isSidebarCollapsed = useInboxStore((state) => state.isSidebarCollapsed);
  const params = useParams();
  const tenantSlug = typeof params?.tenant_slug === 'string' ? params.tenant_slug : 'baskent';
  const { tenant } = useTenant();
  const entityType = getTenantEntityType(tenantSlug, tenant?.profile?.industry);
  const [formOpen, setFormOpen] = useState(false);
  const [aiSummaryOpen, setAiSummaryOpen] = useState(true);
  const setActiveModal = useInboxStore((state) => state.setActiveModal);
  const queryClient = useQueryClient();

  const handleModalSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["conversations"] });
    mutate((key) => Array.isArray(key) && key[0] === "conversations");
    window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
  };
  const getInitialNotes = (contact: typeof activeContact) => {
    if (!contact) return "";
    return contact.notes || "";
  };
  const getInitialPatientName = (contact: typeof activeContact) => {
    if (!contact) return "";
    const rawData = contact.formData?.raw || contact.form_raw_data;
    return resolvePatientDisplayName({
      oppRequesterName: contact.opp_requester_name,
      oppPatientName: contact.opp_patient_name,
      convPatientName: contact.patient_name,
      customerDisplayName: contact.customer_display_name,
      whatsappProfileName: contact.wa_profile_name,
      formPatientName: contact.form_patient_name,
      formRawDataName: rawData ? (typeof rawData === 'string' ? (() => {
        try { 
          const parsed = JSON.parse(rawData);
          return parsed.full_name || parsed['full name'] || parsed['Full Name'];
        } catch { return null; }
      })() : (rawData?.full_name || rawData?.['full name'] || rawData?.['Full Name'])) : null,
      phoneFallback: contact.id || contact.phone_number
    });
  };

  const getInitialCountry = (contact: typeof activeContact) => {
    if (!contact) return "";
    const rawVal = contact.country || contact.opp_country || "";
    const norm = normalizeCountry(rawVal, contact.id || contact.phone_number);
    return norm.country || rawVal;
  };

  const [stage, setStage] = useState(activeContact?.stage || "new");
  const [department, setDepartment] = useState(activeContact?.department || "");
  const [country, setCountry] = useState(getInitialCountry(activeContact));
  const [notes, setNotes] = useState(getInitialNotes(activeContact));
  const [patientName, setPatientName] = useState(getInitialPatientName(activeContact));
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [localTime, setLocalTime] = useState<string>("");
  const [isSleeping, setIsSleeping] = useState<boolean>(false);

  // Tag state
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagVal, setNewTagVal] = useState("");
  const { mutate } = useSWRConfig();

  // Follow-up draft states
  const [draftData, setDraftData] = useState<{ draft: string; draftType: string; windowOpen: boolean; noReplyHours: number } | null>(null);
  const [editedMessage, setEditedMessage] = useState("");
  const [isLoadingDraft, setIsLoadingDraft] = useState(false);
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [followUpSuccess, setFollowUpSuccess] = useState<string | null>(null);

  // A1.7b — Secondary fallback states
  const [secondaryEligibility, setSecondaryEligibility] = useState<any>(null);
  const [secondaryChecked, setSecondaryChecked] = useState(false);
  const [isCheckingSecondary, setIsCheckingSecondary] = useState(false);
  const [secondaryDraftData, setSecondaryDraftData] = useState<any>(null);
  const [isLoadingSecondaryDraft, setIsLoadingSecondaryDraft] = useState(false);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);

  // A1.7c — Form greeting states
  const [formGreetingEligibility, setFormGreetingEligibility] = useState<any>(null);
  const [formGreetingChecked, setFormGreetingChecked] = useState(false);
  const [isCheckingFormGreeting, setIsCheckingFormGreeting] = useState(false);
  const [formGreetingDraftData, setFormGreetingDraftData] = useState<any>(null);
  const [isLoadingFormGreetingDraft, setIsLoadingFormGreetingDraft] = useState(false);
  const [formGreetingError, setFormGreetingError] = useState<string | null>(null);
  const [formGreetingEditedMsg, setFormGreetingEditedMsg] = useState<string>("");
  const [formGreetingSavedMsg, setFormGreetingSavedMsg] = useState<boolean>(false);
  const [isSavingFormGreeting, setIsSavingFormGreeting] = useState<boolean>(false);
  const [isSendingFormGreetingFromPanel, setIsSendingFormGreetingFromPanel] = useState<boolean>(false);
  const [formGreetingSentSuccess, setFormGreetingSentSuccess] = useState<boolean>(false);

  // Bot steering states
  const [botDirectiveText, setBotDirectiveText] = useState<string>("");
  const [activeBotDirective, setActiveBotDirective] = useState<string | null>(null);
  const [isBotSteeringOpen, setIsBotSteeringOpen] = useState<boolean>(false);
  const [isSavingBotSteering, setIsSavingBotSteering] = useState<boolean>(false);
  const [botSteeringStatus, setBotSteeringStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [steeringTasks, setSteeringTasks] = useState<any[]>([]);
  const [isLoadingSteeringTasks, setIsLoadingSteeringTasks] = useState<boolean>(false);
  const directiveTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Bota Mesaj Hazırlat states
  const [selectedIntent, setSelectedIntent] = useState<string>("Karşılama");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("Auto");
  const [customDirective, setCustomDirective] = useState<string>("");
  const [assistedDraftText, setAssistedDraftText] = useState<string>("");
  const [formDraftForCopy, setFormDraftForCopy] = useState<string>("");
  const [isGeneratingAssistedDraft, setIsGeneratingAssistedDraft] = useState<boolean>(false);
  const [assistedDraftError, setAssistedDraftError] = useState<string | null>(null);
  const [assistedDraftSuccess, setAssistedDraftSuccess] = useState<boolean>(false);
  const [suggestedTemplates, setSuggestedTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);
  const [isSendingAssistedDraft, setIsSendingAssistedDraft] = useState<boolean>(false);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [isLanguageUnclear, setIsLanguageUnclear] = useState<boolean>(false);

  // No-reply follow up states
  const [noReplyDraftText, setNoReplyDraftText] = useState<string>("");
  const [isPreparingNoReplyDraft, setIsPreparingNoReplyDraft] = useState<boolean>(false);
  const [noReplyDraftError, setNoReplyDraftError] = useState<string | null>(null);
  const [noReplySentSuccess, setNoReplySentSuccess] = useState<boolean>(false);
  const [isSendingNoReply, setIsSendingNoReply] = useState<boolean>(false);

  // Reset local state when contact changes or active opp fields update
  // P1B: Granular deps ensure refresh on opp switch (same contact, different opp fields)
  const contactId = activeContact?.id;
  const contactDept = activeContact?.department;
  const contactCountry = activeContact?.country;
  const contactNotes = activeContact?.notes;
  const contactStage = activeContact?.stage;
  
  useEffect(() => {
    if (activeContact) {
      setStage(activeContact.stage || "new");
      setDepartment(activeContact.department || "");
      setCountry(getInitialCountry(activeContact));
      setNotes(getInitialNotes(activeContact));
      setPatientName(getInitialPatientName(activeContact));
      setIsEditingName(false);
      setIsAddingTag(false);
      setNewTagVal("");
      setSaveStatus("idle");
      setDraftData(null);
      setEditedMessage("");
      setFollowUpError(null);
      setFollowUpSuccess(null);
      // Reset A1.7b/c states
      setSecondaryEligibility(null);
      setSecondaryChecked(false);
      setSecondaryDraftData(null);
      setSecondaryError(null);
      setFormGreetingEligibility(null);
      setFormGreetingChecked(false);
      setFormGreetingDraftData(null);
      setFormGreetingError(null);
      setFormGreetingEditedMsg("");
      setFormGreetingSavedMsg(false);
      setIsSavingFormGreeting(false);
      setIsSendingFormGreetingFromPanel(false);
      setFormGreetingSentSuccess(false);
      setBotDirectiveText("");
      setActiveBotDirective(null);
      setBotSteeringStatus("idle");
      setSteeringTasks([]);
      // Reset no-reply follow up states
      setNoReplyDraftText("");
      setIsPreparingNoReplyDraft(false);
      setNoReplyDraftError(null);
      setNoReplySentSuccess(false);
      setIsSendingNoReply(false);
      // Reset assisted drafting states
      setSelectedIntent("Karşılama");
      setSelectedLanguage("Auto");
      setCustomDirective("");
      setAssistedDraftText("");
      setFormDraftForCopy("");
      setIsGeneratingAssistedDraft(false);
      setAssistedDraftError(null);
      setAssistedDraftSuccess(false);
      setSuggestedTemplates([]);
      setSelectedTemplate(null);
      setIsSendingAssistedDraft(false);
      setDetectedLanguage(null);
      setIsLanguageUnclear(false);
    }
  }, [contactId, contactDept, contactCountry, contactNotes, contactStage, activeContact?.opp_requester_name, activeContact?.opp_patient_name, activeContact?.patient_name]);

  const conversationId = activeContact?.conversation_id || activeContact?.conversationId || activeContact?.id;

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId || "");

  const { data: crmData, isLoading: isCrmLoading } = useQuery({
    queryKey: ['crm-panel', conversationId],
    queryFn: async () => {
      if (!conversationId || !isUuid) return null;
      
      const loadStart = performance.now();
      const res = await getCrmPanelBundleAction(conversationId) as any;
      
      const loadDuration = performance.now() - loadStart;
      const conversationIdPrefix = conversationId.substring(0, 8);
      
      if (typeof window !== "undefined") {
        console.log(`[CRM_PANEL_LOAD_TRACE] conversationIdPrefix=${conversationIdPrefix} durationMs=${loadDuration.toFixed(2)} success=${res.success}`);
      }

      if (!res.success) {
        return {
          botDirective: null,
          steeringTasks: [],
          formGreetingEligibility: null,
          formData: null,
          opportunity: null,
          formFields: null
        };
      }

      return res;
    },
    enabled: !!conversationId && isUuid,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
  });

  const oppId = crmData?.opportunity?.id || activeContact?.active_opp_id || activeContact?.active_opportunity_id || activeContact?.opportunity_id || "";

  // Track isCrmLoading to set local loading indicators
  useEffect(() => {
    if (isCrmLoading) {
      setIsCheckingFormGreeting(true);
      setIsLoadingSteeringTasks(true);
    }
  }, [isCrmLoading]);

  // Bridge query data into existing state variables for downstream UI compatibility
  useEffect(() => {
    if (crmData) {
      setActiveBotDirective(crmData.botDirective);
      setSteeringTasks(crmData.steeringTasks);
      setFormGreetingEligibility(crmData.formGreetingEligibility);
      setFormGreetingChecked(true);
      setIsCheckingFormGreeting(false);
      setIsLoadingSteeringTasks(false);
    } else {
      setActiveBotDirective(null);
      setSteeringTasks([]);
      setFormGreetingEligibility(null);
      setFormGreetingChecked(true);
      setIsCheckingFormGreeting(isCrmLoading);
      setIsLoadingSteeringTasks(isCrmLoading);
    }
  }, [crmData, isCrmLoading]);

  useEffect(() => {
    if (!country) {
      setLocalTime("");
      setIsSleeping(false);
      return;
    }

    const updateClock = () => {
      try {
        const displayRes = resolvePatientTimeDisplay({
          country: country || activeContact.country || activeContact.opp_country,
          city: activeContact.city || activeContact.patient_city || activeContact.opp_metadata?.patient_city || activeContact.formData?.patient_city || activeContact.formData?.city,
          timezone: activeContact.timezone || activeContact.patient_timezone || activeContact.opp_metadata?.patient_timezone || activeContact.metadata?.patient_timezone,
          metadata: activeContact.metadata,
          oppMetadata: activeContact.opp_metadata || activeContact.formData,
          referenceDate: new Date()
        });

        if (displayRes.needsTimezoneClarification) {
          setLocalTime(displayRes.shortBadge || "Konum/saat net değil");
          setIsSleeping(false);
        } else if (displayRes.isFallback) {
          setLocalTime("Saat net değil");
          setIsSleeping(false);
        } else {
          setLocalTime(displayRes.patientLocalTime || "");
          
          if (displayRes.patientLocalTime) {
            const hour = parseInt(displayRes.patientLocalTime.split(":")[0], 10);
            setIsSleeping(hour >= 22 || hour < 8);
          } else {
            setIsSleeping(false);
          }
        }
      } catch (err) {
        console.error("Error formatting timezone clock", err);
        setLocalTime("");
        setIsSleeping(false);
      }
    };

    updateClock();
    const interval = setInterval(updateClock, 10000); // update every 10 seconds
    return () => clearInterval(interval);
  }, [country, activeContact]);

  if (!activeContact) {
    return (
      <div
        className={`h-full z-10 hidden lg:block q-glass transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? "w-[616px]" : "w-[360px]"
        }`}
        style={{ borderLeft: "1px solid var(--q-border-default)" }}
      />
    );
  }

  if (isCrmLoading) {
    return (
      <div
        className={`h-full z-10 hidden lg:block q-glass transition-all duration-300 ease-in-out ${
          isSidebarCollapsed ? "w-[616px]" : "w-[360px]"
        }`}
        style={{ borderLeft: "1px solid var(--q-border-default)" }}
      >
        <CrmSkeleton />
      </div>
    );
  }

  const handleSave = async () => {
    if (isSaving || !activeContact) return;
    setIsSaving(true);
    setSaveStatus("saving");

    const res = await updateCrmData(activeContact.id, stage, department, country, notes, patientName);
    if (res.success) {
      useInboxStore.getState().setActiveContact(activeContact.id, {
        ...activeContact,
        stage, department, country, notes,
        name: patientName,
        opp_patient_name: patientName
      });
      mutate((key) => Array.isArray(key) && key[0] === "conversations");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } else {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }

    setIsSaving(false);
  };

  const handleAddTag = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTagVal.trim() || !activeContact) {
      setIsAddingTag(false);
      return;
    }

    const tagText = newTagVal.trim();
    setNewTagVal("");
    setIsAddingTag(false);

    let currentTags = [...parsedTags];
    if (!currentTags.includes(tagText)) currentTags.push(tagText);

    useInboxStore.getState().setActiveContact(activeContact.id, {
      ...activeContact,
      tags: JSON.stringify(currentTags),
    });

    await addTag(activeContact.id, tagText);
    mutate((key) => Array.isArray(key) && key[0] === "conversations");
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!activeContact) return;
    const newTags = parsedTags.filter((t) => t !== tagToRemove);
    useInboxStore.getState().setActiveContact(activeContact.id, {
      ...activeContact,
      tags: JSON.stringify(newTags),
    });
    await removeTag(activeContact.id, tagToRemove);
    mutate((key) => Array.isArray(key) && key[0] === "conversations");
  };

  // Mapped steering suggestions from the server
  const phoneSuggestion = steeringTasks.find(t => t.appointment_type === 'phone_call') || null;
  const apptSuggestion = steeringTasks.find(t => t.appointment_type === 'clinic_visit') || null;

  // Parse tags
  let parsedTags: string[] = [];
  if (activeContact.tags) {
    try {
      parsedTags = JSON.parse(activeContact.tags);
      if (!Array.isArray(parsedTags)) parsedTags = [String(activeContact.tags)];
    } catch {
      parsedTags = String(activeContact.tags).split(",").map((t) => t.trim());
    }
  }

  // Parse form data
  let formDataEntries: { key: string; value: string }[] = [];
  let campaignName: string | null = null;
  let rawObj: any = null;
  const contactFormData = crmData?.formData || activeContact?.formData;
  if (contactFormData?.raw) {
    try {
      rawObj = typeof contactFormData.raw === "string" ? JSON.parse(contactFormData.raw) : contactFormData.raw;
      campaignName = rawObj.campaign_name || rawObj.campaignName || rawObj.utm_campaign || rawObj.utmCampaign || null;
      const skipKeys = ["id", "leadgen_id", "form_id", "ad_id", "adset_id", "campaign_id", "platform", "is_organic", "created_time", "phone_number_id", "full_name", "phone_number", "_all_phones"];
      formDataEntries = Object.entries(rawObj)
        .filter(([k]) => !skipKeys.includes(k.toLowerCase()))
        .map(([k, v]) => ({
          key: k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
          value: String(v),
        }));
    } catch (e) {
      console.error("Error parsing form data", e);
    }
  } else if (crmData?.form_raw_data || activeContact?.form_raw_data) {
    try {
      const rawSource = crmData?.form_raw_data || activeContact?.form_raw_data;
      rawObj = typeof rawSource === "string" ? JSON.parse(rawSource) : rawSource;
      campaignName = rawObj.campaign_name || rawObj.campaignName || rawObj.utm_campaign || rawObj.utmCampaign || null;
    } catch (_) {}
  }

  // Compute recommendations
  const msgExt = activeContact?.last_message ? extractFromPatientMessageDeterministic(activeContact.last_message) : null;
  const activeOppMetadata = crmData?.opportunity?.opp_metadata || activeContact?.opp_metadata;
  const formFields = crmData?.formFields || {};
  const formDepartment = formFields.formDepartment || activeContact?.formDepartment;
  const formDepartmentSource = formFields.formDepartmentSource || activeContact?.formDepartmentSource;
  const isDeptLocked = activeOppMetadata?.department_locked === true;
  
  const resolvedDeptObj = resolveDepartmentWithConflict({
    existingDept: department || null,
    formCampaignDept: formDepartmentSource === 'campaign_name' || formDepartmentSource === 'form_name' ? formDepartment : null,
    formCampaignConfidence: formDepartmentSource === 'campaign_name' || formDepartmentSource === 'form_name' ? 1.0 : 0.0,
    formComplaintDept: formDepartmentSource === 'complaint_keyword' ? formDepartment : null,
    formComplaintConfidence: formDepartmentSource === 'complaint_keyword' ? 1.0 : 0.0,
    patientMsgDept: msgExt?.departmentCandidate || null,
    patientMsgConfidence: msgExt?.departmentConfidence || 'low',
    isLocked: isDeptLocked
  });

  const suggestedDept = !department ? resolvedDeptObj.suggestedDept : null;
  const suggestedConfidence = resolvedDeptObj.confidence;
  const hasConflict = resolvedDeptObj.hasConflict;
  const conflictReason = resolvedDeptObj.conflictReason;
  const suggestedSource = resolvedDeptObj.source;

  // Parse all phones
  let allPhones: string[] = [];
  const contactRawObj = contactFormData?.raw || crmData?.form_raw_data || activeContact?.form_raw_data;
  if (contactRawObj) {
    try {
      const parsedRaw = typeof contactRawObj === "string" ? JSON.parse(contactRawObj) : contactRawObj;
      if (parsedRaw && parsedRaw._all_phones) {
        const parsedPhones = typeof parsedRaw._all_phones === "string" ? JSON.parse(parsedRaw._all_phones) : parsedRaw._all_phones;
        if (Array.isArray(parsedPhones)) {
          allPhones = parsedPhones.map(String).filter(Boolean);
        }
      }
    } catch (e) {
      console.error("Error parsing all phones from raw_data", e);
    }
  }

  const activePhone = activeContact.id;
  if (allPhones.length === 0) {
    allPhones = [activePhone];
  }

  const primaryPhone = allPhones[0] || activePhone;
  const isSecondaryActive = activePhone !== primaryPhone && allPhones.includes(activePhone);

  const getCleanValue = (val: string | null | undefined) => {
    return (val || "").trim();
  };

  const isStageDirty = getCleanValue(stage) !== getCleanValue(activeContact.stage);
  const isDeptDirty = getCleanValue(department) !== getCleanValue(activeContact.department);
  const isCountryDirty = getCleanValue(country) !== getCleanValue(getInitialCountry(activeContact));
  const isNotesDirty = getCleanValue(notes) !== getCleanValue(activeContact.notes);
  const isNameDirty = getCleanValue(patientName) !== getCleanValue(getInitialPatientName(activeContact));

  const isDirty = isStageDirty || isDeptDirty || isCountryDirty || isNotesDirty || isNameDirty;

  return (
    <div
      key={activeContact.id}
      className={`w-full h-full flex-col overflow-y-auto z-10 q-glass shadow-sm transition-all duration-300 ease-in-out ${
        isSidebarCollapsed ? "lg:w-[616px]" : "lg:w-[360px]"
      } ${mobileView === "crm" ? "flex absolute inset-0 lg:relative" : "hidden lg:flex"}`}
      style={{ borderLeft: "1px solid var(--q-border-default)" }}
    >
      {/* Mobile Header */}
      <div className="lg:hidden flex-none h-[72px] px-4 flex items-center q-glass-strong sticky top-0 z-20" style={{ borderBottom: "1px solid var(--q-border-default)" }}>
        <button
          onClick={() => setMobileView("chat")}
          className="w-8 h-8 flex items-center justify-center rounded-full shadow-sm q-press"
          style={{ background: "rgba(255,255,255,0.5)", border: "1px solid var(--q-border-default)" }}
        >
          <ChevronLeft className="w-5 h-5" style={{ color: "var(--q-text-primary)" }} />
        </button>
        <span className="ml-3 font-semibold" style={{ color: "var(--q-text-primary)" }}>Hasta Profili</span>
      </div>
      <div className="p-4 flex flex-col items-center text-center" style={{ borderBottom: "1px solid var(--q-border-default)" }}>
        {(() => {
          const cleanName = patientName.trim();
          const initials = cleanName
            ? cleanName.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
            : "?";
          
          const colors = [
            { bg: "linear-gradient(135deg, #FF5E3A 0%, #FF2A68 100%)", text: "#FFFFFF" }, // Red/Pink
            { bg: "linear-gradient(135deg, #007AFF 0%, #0051A8 100%)", text: "#FFFFFF" }, // Blue
            { bg: "linear-gradient(135deg, #5856D6 0%, #3533CD 100%)", text: "#FFFFFF" }, // Purple
            { bg: "linear-gradient(135deg, #4CD964 0%, #28A745 100%)", text: "#FFFFFF" }, // Green
            { bg: "linear-gradient(135deg, #FF9500 0%, #FF5E00 100%)", text: "#FFFFFF" }, // Orange
            { bg: "linear-gradient(135deg, #30B0C7 0%, #178097 100%)", text: "#FFFFFF" }, // Teal
          ];
          const index = activeContact.id ? parseInt(activeContact.id.slice(-3)) % colors.length || 0 : initials.charCodeAt(0) % colors.length;
          const avatar = colors[index];

          return (
            <div 
              className="w-12 h-12 rounded-full flex items-center justify-center mb-2 shadow-sm text-sm font-bold select-none transition-transform duration-300 hover:scale-105"
              style={{ background: avatar.bg, color: avatar.text }}
            >
              {initials}
            </div>
          );
        })()}
        {isEditingName ? (
          <div className="flex items-center gap-1.5 justify-center w-full max-w-[180px]">
            <input
              type="text"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setIsEditingName(false);
                if (e.key === "Escape") {
                  setPatientName(getInitialPatientName(activeContact));
                  setIsEditingName(false);
                }
              }}
              className="text-center font-bold text-[13px] px-1.5 py-0.5 rounded-lg w-full outline-none"
              style={{ background: "var(--q-bg-hover)", border: "1px solid var(--q-blue)", color: "var(--q-text-primary)" }}
              autoFocus
            />
            <button
              onClick={() => setIsEditingName(false)}
              className="p-0.5 rounded-md transition-colors hover:bg-black/5 cursor-pointer flex-shrink-0"
              title="Tamam"
            >
              <Check className="w-3.5 h-3.5" style={{ color: "var(--q-green)" }} />
            </button>
          </div>
        ) : (
          <div 
            onClick={() => setIsEditingName(true)}
            className="group flex items-center gap-1 justify-center cursor-pointer rounded-lg px-2 py-0.5 hover:bg-black/[0.04] transition-all max-w-full"
            title="İsmi düzenlemek için tıklayın"
          >
            <h2 className="text-[15px] font-bold tracking-tight truncate max-w-[180px]" style={{ color: "var(--q-text-primary)" }}>
              {patientName || "İsimsiz"}
            </h2>
            <Sparkles className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" style={{ color: "var(--q-blue)" }} />
          </div>
        )}
        <p className="text-[10px] text-[#86868B] font-semibold mt-0.5">
          {formatPhoneReadable(activeContact.id)}
        </p>

        <div className="flex items-center gap-1.5 mt-2 w-full justify-center flex-wrap">
          <div className="relative group">
            <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
              <MapPin className="w-3 h-3" style={{ color: "var(--q-blue)" }} />
            </div>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="pl-6 pr-5 py-0.5 rounded-full text-[10px] font-semibold outline-none transition-all appearance-none cursor-pointer"
              style={{ background: "var(--q-bg-hover)", color: "var(--q-text-primary)", border: "1px solid var(--q-border-default)" }}
            >
              <option value="" disabled>Ülke Seç...</option>
              {(() => {
                const predefined = [
                  "Türkiye", "Almanya", "Finlandiya", "İngiltere", "Fransa", 
                  "Hollanda", "Belçika", "Portekiz", "İspanya", "İtalya", 
                  "İsviçre", "Avusturya", "İsveç", "Danimarka", "Norveç", 
                  "Polonya", "Yunanistan", "Romanya", "Bulgaristan", "Ukrayna", 
                  "Rusya", "Azerbaycan", "Özbekistan", "Kazakistan", "Gürcistan", 
                  "Irak", "Ürdün", "Lübnan", "Suudi Arabistan", "BAE", 
                  "ABD", "Avustralya", "Diğer"
                ];
                const allCountries = [...predefined];
                if (country && !predefined.includes(country)) {
                  allCountries.splice(2, 0, country);
                }
                return allCountries.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ));
              })()}
            </select>
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <ChevronDown className="w-2.5 h-2.5" style={{ color: "var(--q-text-secondary)" }} />
            </div>
          </div>

          {(() => {
            const countryNormal = normalizeCountry(activeContact?.country || activeContact?.opp_country, activeContact?.id || activeContact?.phone_number);
            return countryNormal.countryConfirmationNeeded ? (
              <div className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 bg-amber-50 text-amber-700 border border-amber-200" title="Ülke doğruluğundan emin olun. Teyit gerekebilir.">
                Teyit Gerekli
              </div>
            ) : null;
          })()}

          {localTime && (
            <div 
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all duration-300 ${
                isSleeping 
                  ? "bg-slate-900/5 text-slate-700 border-slate-200" 
                  : "bg-indigo-50 text-indigo-600 border-indigo-100"
              }`}
              title={isSleeping ? "Hasta uyku saatinde (22:00 - 08:00)" : "Hasta aktif saatte"}
            >
              {isSleeping ? (
                <Moon className="w-3 h-3 text-slate-500 animate-pulse" />
              ) : (
                <Clock className="w-3 h-3 text-indigo-500" />
              )}
              <span>{localTime}</span>
            </div>
          )}
        </div>

        {/* Multi-phone list */}
        <div className="w-full text-left mt-2.5 px-2.5 py-2 rounded-2xl border bg-white/40 space-y-1.5" style={{ borderColor: "var(--q-border-default)" }}>
          <span className="block text-[9px] font-bold uppercase tracking-widest text-[#86868B] mb-0.5 px-0.5">Telefon Numaraları</span>
          {allPhones.map((phone, idx) => {
            const isPrimary = idx === 0;
            const isActive = phone === activePhone;
            return (
              <div key={phone} className="flex items-center justify-between px-0.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-500' : 'bg-transparent border border-black/30'}`} />
                  <span className="font-semibold text-[11px]" style={{ color: "var(--q-text-primary)" }}>
                    {formatPhoneReadable(phone)}
                  </span>
                </div>
                <span className={`text-[8px] font-bold px-1.5 py-0.2 rounded-full ${
                  isPrimary 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {isPrimary ? 'Birincil' : 'İkincil'} {isActive && '— Aktif'}
                </span>
              </div>
            );
          })}
        </div>

        {/* Warning badge if active on secondary phone */}
        {isSecondaryActive && (
          <div className="w-full mt-2 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-semibold text-left flex items-start gap-1.5 shadow-sm">
            <span className="text-amber-500 font-bold shrink-0">⚠️</span>
            <p className="leading-snug">Bu konuşma formdaki ikincil numara üzerinden yürütülüyor.</p>
          </div>
        )}

        {/* Task-based Action Required Deep Link Card (Steered by Intent Resolver) */}
        {(() => {
          if (!activeContact) return null;

          const lastMsg = activeContact.last_message || "";
          const lastMsgDir = activeContact.last_message_direction || "";
          
          let resolvedIntent = "no_action";
          if (lastMsgDir === "in") {
            resolvedIntent = resolveInboxActionIntent(lastMsg);
          }

          // If conversation is closed, hide the card
          if (resolvedIntent === "conversation_closed") {
            return null;
          }

          // If date_pending_followup
          if (resolvedIntent === "date_pending_followup") {
            return (
              <div className="w-full mt-2 p-2.5 rounded-xl border space-y-1.5 text-left bg-indigo-50/30 shadow-sm" style={{ borderColor: 'var(--q-blue)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-indigo-500" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-700">Takip Hatırlatması Gerekli</span>
                  </div>
                  <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.2 rounded shadow-sm bg-indigo-100 text-indigo-700">
                    Bekliyor
                  </span>
                </div>
                
                <p className="text-[11px] font-semibold text-gray-700 leading-snug">
                  Hasta tarih netleşince geri döneceğini belirtti.
                </p>

                <button
                  type="button"
                  onClick={() => setActiveModal({ modalType: 'reminder_plan', conversationId: activeContact.conversation_id || activeContact.id, patientName })}
                  className="w-full py-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all shadow-sm"
                >
                  <CalendarClock className="w-3 h-3" />
                  <span>Hatırlatma Planla</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal({ modalType: 'form_detail', conversationId: activeContact.conversation_id || activeContact.id, patientName })}
                  className="w-full py-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all shadow-sm border border-black/5"
                >
                  <FileText className="w-3 h-3" />
                  <span>Form Detayı</span>
                </button>
              </div>
            );
          }

          if (resolvedIntent === "call_request") {
            return (
              <div className="w-full mt-2 p-2.5 rounded-xl border space-y-1.5 text-left bg-indigo-50/30 shadow-sm" style={{ borderColor: 'var(--q-blue)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-indigo-500" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-700">Arama Gerekli</span>
                  </div>
                  <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.2 rounded shadow-sm bg-indigo-100 text-indigo-700">
                    Arama Talebi
                  </span>
                </div>
                
                <p className="text-[11px] font-semibold text-gray-700 leading-snug">
                  Hasta kendisiyle iletişime geçilmesini / aranmayı talep etti.
                </p>

                <button
                  type="button"
                  onClick={() => setActiveModal({ modalType: 'call_plan', conversationId: activeContact.conversation_id || activeContact.id, patientName })}
                  className="w-full py-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all shadow-sm"
                >
                  <PhoneForwarded className="w-3 h-3" />
                  <span>Arama Planla</span>
                </button>
              </div>
            );
          }

          if (resolvedIntent === "appointment_request") {
            return (
              <div className="w-full mt-2 p-2.5 rounded-xl border space-y-1.5 text-left bg-indigo-50/30 shadow-sm" style={{ borderColor: 'var(--q-blue)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-indigo-500" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-700">Randevu Talebi</span>
                  </div>
                  <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.2 rounded shadow-sm bg-emerald-100 text-emerald-700">
                    Randevu
                  </span>
                </div>
                
                <p className="text-[11px] font-semibold text-gray-700 leading-snug">
                  Hasta tedavi veya randevu detayları için uygunluk sordu.
                </p>

                <button
                  type="button"
                  onClick={() => setActiveModal({ modalType: 'appointment_plan', conversationId: activeContact.conversation_id || activeContact.id, patientName })}
                  className="w-full py-1 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all shadow-sm"
                >
                  <Calendar className="w-3 h-3" />
                  <span>Randevu Planla</span>
                </button>
              </div>
            );
          }

          // Default fallback to task-based Action Required card:
          if (activeContact.active_task_type) {
            return (
              <div className="w-full mt-2 p-2.5 rounded-xl border space-y-1.5 text-left bg-indigo-50/30 shadow-sm" style={{ borderColor: 'var(--q-blue)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-indigo-500" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-700">Aksiyon Gerekli</span>
                  </div>
                  <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.2 rounded shadow-sm bg-indigo-100 text-indigo-700">
                    Bekliyor
                  </span>
                </div>
                
                <p className="text-[11px] font-semibold text-gray-700 leading-snug">
                  {(() => {
                    switch (activeContact.active_task_type) {
                      case 'no_reply_followup': return 'Müşteriden yanıt alınamadığı için takip taslağı oluşturuldu.';
                      case 'template_required_task': return '24 saatlik WhatsApp penceresi kapandığı için şablon onayı gerekiyor.';
                      case 'bot_handoff_followup': return 'Bot konuşmayı manuele devretti, takip gerekiyor.';
                      case 'call_patient': return 'Hastanın telefonla aranması gerekiyor.';
                      case 'callback_scheduled': return 'Geri arama randevusu tanımlandı.';
                      case 'follow_up_no_response': return 'Cevap vermeyen hastaya takip araması gerekiyor.';
                      case 'coordinator_review': return 'Koordinatör onayı/incelemesi bekleniyor.';
                      case 'travel_planning': return 'Seyahat planlaması yapılması gerekiyor.';
                      case 'payment_follow_up': return 'Ödeme takibi yapılması gerekiyor.';
                      case 'appointment_reminder': return 'Randevu hatırlatması yapılması gerekiyor.';
                      default: return 'Aktif bir takip görevi bulunuyor.';
                    }
                  })()}
                </p>

                {(() => {
                  const isPhoneTask = [
                    'call_patient', 'callback_scheduled', 'follow_up_no_response',
                    'no_reply_followup', 'template_required_task', 'bot_handoff_followup'
                  ].includes(activeContact.active_task_type);

                  if (isPhoneTask) {
                    return (
                      <a
                        href={`/${tenantSlug}/takip?tab=telefon&opp=${oppId}`}
                        className="w-full py-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all shadow-sm"
                      >
                        <PhoneForwarded className="w-3 h-3" />
                        <span>Telefon Takibinde Aç</span>
                      </a>
                    );
                  }

                  return (
                    <a
                      href={`/${tenantSlug}/takip?tab=randevu&opp=${oppId}`}
                      className="w-full py-1 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all shadow-sm"
                    >
                      <Calendar className="w-3 h-3" />
                      <span>Randevu Yönetiminde Aç</span>
                    </a>
                  );
                })()}
              </div>
            );
          }

          return null;
        })()}

        {/* A1.7b — Secondary Phone Fallback Section */}
        {allPhones.length >= 2 && !isSecondaryActive && (
          <div className="w-full mt-2 p-2.5 rounded-xl border space-y-1.5 bg-white/40 text-left" style={{ borderColor: 'var(--q-border-default)' }}>
            <div className="flex items-center gap-1.5">
              <PhoneForwarded className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-amber-700">İkincil Numara Fallback</span>
            </div>

            {secondaryError && (
              <div className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-lg p-1.5 leading-snug">
                ⚠️ {secondaryError}
              </div>
            )}

            {!secondaryChecked ? (
              <button
                onClick={async () => {
                  setIsCheckingSecondary(true);
                  setSecondaryError(null);
                  try {
                    const res = await checkSecondaryFallback(activeContact.conversation_id || activeContact.id);
                    setSecondaryEligibility(res);
                    setSecondaryChecked(true);
                    if (!res.eligible) {
                      setSecondaryError(res.reason);
                    }
                  } catch {
                     setSecondaryError('Kontrol sırasında hata oluştu.');
                  }
                  setIsCheckingSecondary(false);
                }}
                disabled={isCheckingSecondary}
                className="w-full py-1.5 px-2.5 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-700 text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCheckingSecondary ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /><span>Kontrol Ediliyor...</span></>
                ) : (
                  <><PhoneForwarded className="w-3 h-3" /><span>İkincil Numara Uygunluğunu Kontrol Et</span></>
                )}
              </button>
            ) : secondaryEligibility?.eligible && !secondaryDraftData ? (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold text-amber-800 bg-amber-50/80 border border-amber-200 rounded-lg p-2 leading-snug">
                  ⏳ Birincil numaradan {secondaryEligibility.noReplyHoursPrimary} saattir cevap alınamadı.<br />
                  İkincil numara: <strong>{secondaryEligibility.secondaryPhone}</strong>
                </div>
                <button
                  onClick={async () => {
                    setIsLoadingSecondaryDraft(true);
                    setSecondaryError(null);
                    try {
                      const res = await prepareSecondaryDraft(activeContact.conversation_id || activeContact.id);
                      if (res.success) {
                        setSecondaryDraftData(res);
                      } else {
                        setSecondaryError(res.error || 'Taslak hazırlanamadı.');
                      }
                    } catch {
                      setSecondaryError('Taslak hazırlama hatası.');
                    }
                    setIsLoadingSecondaryDraft(false);
                  }}
                  disabled={isLoadingSecondaryDraft}
                  className="w-full py-1.5 px-2.5 bg-amber-100 border border-amber-300 hover:bg-amber-200 text-amber-800 text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all disabled:opacity-50"
                >
                  {isLoadingSecondaryDraft ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /><span>Taslak Hazırlanıyor...</span></>
                  ) : (
                    <><Sparkles className="w-3 h-3" /><span>İkincil Numara Taslağı Hazırla</span></>
                  )}
                </button>
              </div>
            ) : secondaryDraftData ? (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[9px]">
                  <span className="font-bold text-amber-700 uppercase tracking-wider">Taslak Önizleme</span>
                  <span className={`px-1.5 py-0.2 rounded-full font-bold ${
                    secondaryDraftData.windowOpen ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {secondaryDraftData.windowOpen ? '24s Açık' : '24s Kapalı — Şablon Gerekli'}
                  </span>
                </div>
                {!secondaryDraftData.windowOpen && (
                  <div className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-1.5 leading-snug">
                    ⚠️ İkincil numara için 24 saatlik WhatsApp penceresi kapalı. Onaylı şablon gönderimi bu fazda devre dışıdır.
                  </div>
                )}
                <div className="text-[11px] font-medium text-gray-700 bg-white border border-gray-200 rounded-lg p-2 leading-relaxed">
                  {secondaryDraftData.draft}
                </div>
                <button
                  onClick={() => setSecondaryDraftData(null)}
                  className="w-full py-1 px-2.5 border border-gray-200 hover:bg-gray-50 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer transition-all"
                >
                  Kapat
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Form Greeting Section (Only shown if form connection exists AND is eligible for greeting) */}
        {(activeContact.formData || activeContact.form_raw_data) && formGreetingEligibility?.patientLevelStatus === 'waiting_inbox_reply' && (
          <div className="w-full mt-2.5 p-3 rounded-2xl border bg-white/40 space-y-3 shadow-sm text-left transition-all duration-300" style={{ borderColor: "var(--q-border-default)" }}>
            <div className="flex flex-col gap-1 pb-1.5 border-b border-black/[0.03]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-indigo-500" />
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#86868B]">👋 Karşılama Cevabı Bekliyor</span>
                </div>
                {formGreetingSentSuccess ? (
                  <span className="text-[8px] font-bold text-green-600 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded-full">Gönderildi</span>
                ) : formGreetingSavedMsg ? (
                  <span className="text-[8px] font-bold text-green-600 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded-full">Kaydedildi</span>
                ) : (
                  <span className="text-[8px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-full">Bekliyor</span>
                )}
              </div>
              <p className="text-[11px] text-[#86868B] mt-1">Hasta mesaj attı, henüz karşılama cevabı verilmemiş.</p>
            </div>

            {formGreetingError && (
              <div className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-lg p-2 leading-snug">
                ⚠️ {formGreetingError}
              </div>
            )}

            {formGreetingSavedMsg && (
              <div className="text-[11px] font-semibold text-green-700 bg-green-50/80 border border-green-150 rounded-xl p-2.5 leading-snug flex items-center gap-1.5">
                <Check className="w-4 h-4 text-green-600 shrink-0" />
                <span>Karşılama taslağı iç not olarak kaydedildi.</span>
              </div>
            )}

            {formGreetingSentSuccess && (
              <div className="text-[11px] font-semibold text-green-700 bg-green-50/80 border border-green-150 rounded-xl p-2.5 leading-snug flex items-center gap-1.5">
                <Check className="w-4 h-4 text-green-600 shrink-0" />
                <span>Mesaj başarıyla gönderildi.</span>
              </div>
            )}

            {!formGreetingSavedMsg && !formGreetingSentSuccess && (
              <>
                {!formGreetingDraftData ? (
                  <button
                    onClick={async () => {
                      setIsLoadingFormGreetingDraft(true);
                      setFormGreetingError(null);
                      try {
                        const res = await prepareFormGreetingDraft(activeContact.conversation_id || activeContact.id);
                        if (res.success && res.draft) {
                          setFormGreetingDraftData(res);
                          setFormGreetingEditedMsg(res.draft);
                        } else {
                          setFormGreetingError(res.error || "Taslak hazırlanırken hata oluştu.");
                        }
                      } catch (err: any) {
                        setFormGreetingError(err?.message || "Taslak hazırlama hatası.");
                      } finally {
                        setIsLoadingFormGreetingDraft(false);
                      }
                    }}
                    disabled={isLoadingFormGreetingDraft}
                    className="w-full py-2 px-3 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100/80 text-indigo-700 text-[10px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
                  >
                    {isLoadingFormGreetingDraft ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Taslak Hazırlanıyor...</span></>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5" /><span>Karşılama Hazırla</span></>
                    )}
                  </button>
                ) : (
                  <div className="space-y-2.5">
                    <textarea
                      value={formGreetingEditedMsg}
                      onChange={(e) => setFormGreetingEditedMsg(e.target.value)}
                      disabled={isSavingFormGreeting || isSendingFormGreetingFromPanel}
                      rows={4}
                      className="w-full bg-white/70 border rounded-xl p-2.5 text-[11.5px] text-[#1D1D1F] leading-relaxed resize-none outline-none focus:ring-2 focus:ring-indigo-500/25 transition-all shadow-sm"
                      style={{ borderColor: "var(--q-border-default)" }}
                    />

                    <p className="text-[10px] text-amber-600 bg-amber-50/50 border border-amber-100 p-2 rounded-lg font-medium leading-normal">
                      Bu mesaj hastaya WhatsApp üzerinden gönderilecek.
                    </p>

                    <div className="space-y-2">
                      <button
                        onClick={async () => {
                          if (!formGreetingEditedMsg.trim()) return;
                          setIsSendingFormGreetingFromPanel(true);
                          setFormGreetingError(null);
                          try {
                            const res = await sendFormGreetingFromInboxAction(
                              activeContact.conversation_id || activeContact.id,
                              formGreetingEditedMsg
                            );
                            if (res.success) {
                              setFormGreetingSentSuccess(true);
                              mutate((key) => Array.isArray(key) && key[0] === "conversations");
                            } else {
                              setFormGreetingError("Mesaj panelden gönderilemedi. Hastaya WhatsApp uygulaması üzerinden manuel dönüş yapabilirsiniz.");
                            }
                          } catch (err: any) {
                            setFormGreetingError("Mesaj panelden gönderilemedi. Hastaya WhatsApp uygulaması üzerinden manuel dönüş yapabilirsiniz.");
                          } finally {
                            setIsSendingFormGreetingFromPanel(false);
                          }
                        }}
                        disabled={isSendingFormGreetingFromPanel || isSavingFormGreeting || !formGreetingEditedMsg.trim()}
                        className="w-full py-2 bg-green-600 hover:bg-green-700 text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50 shadow-sm"
                      >
                        {isSendingFormGreetingFromPanel ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Gönderiliyor...</span></>
                        ) : (
                          <><Send className="w-3.5 h-3.5" /><span>Panelden Gönder</span></>
                        )}
                      </button>

                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            if (!formGreetingEditedMsg.trim()) return;
                            setIsSavingFormGreeting(true);
                            setFormGreetingError(null);
                            try {
                              const res = await saveFormGreetingDraftInternalAction(
                                activeContact.conversation_id || activeContact.id,
                                formGreetingEditedMsg
                              );
                              if (res.success) {
                                setFormGreetingSavedMsg(true);
                                mutate((key) => Array.isArray(key) && key[0] === "conversations");
                              } else {
                                setFormGreetingError(res.error || "Kaydetme sırasında hata oluştu.");
                              }
                            } catch (err: any) {
                              setFormGreetingError(err?.message || "Kaydetme hatası.");
                            } finally {
                              setIsSavingFormGreeting(false);
                            }
                          }}
                          disabled={isSendingFormGreetingFromPanel || isSavingFormGreeting || !formGreetingEditedMsg.trim()}
                          className="flex-1 py-1.5 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all disabled:opacity-50"
                        >
                          {isSavingFormGreeting ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Kaydediliyor...</span></>
                          ) : (
                            <span>Not Olarak Kaydet</span>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setFormGreetingDraftData(null);
                            setFormGreetingEditedMsg("");
                            setFormGreetingError(null);
                          }}
                          disabled={isSendingFormGreetingFromPanel || isSavingFormGreeting}
                          className="px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50"
                        >
                          Vazgeç
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Cevap Bekleniyor Section */}
        {activeContact && activeContact.noReplyFollowup?.is_no_reply_eligible && (
          <div className="w-full mt-2.5 p-3 rounded-2xl border bg-white/40 space-y-3 shadow-sm text-left transition-all duration-300" style={{ borderColor: "var(--q-border-default)" }}>
            <div className="flex flex-col gap-1 pb-1.5 border-b border-black/[0.03]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-red-500" />
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#86868B]">⏳ Cevap Bekleniyor</span>
                </div>
                {noReplySentSuccess ? (
                  <span className="text-[8px] font-bold text-green-600 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded-full">Gönderildi</span>
                ) : (
                  <span className="text-[8px] font-bold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded-full">
                    {activeContact.noReplyFollowup?.no_reply_hours ? `${activeContact.noReplyFollowup.no_reply_hours}s geçti` : 'Süre Aşımı'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#86868B] mt-1">Son mesajımıza henüz dönüş yapılmadı.</p>
            </div>

            {noReplyDraftError && (
              <div className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-lg p-2 leading-snug">
                ⚠️ {noReplyDraftError}
              </div>
            )}

            {noReplySentSuccess ? (
              <div className="text-[11px] font-semibold text-green-700 bg-green-50/80 border border-green-150 rounded-xl p-2.5 leading-snug flex items-center gap-1.5">
                <Check className="w-4 h-4 text-green-600 shrink-0" />
                <span>Hatırlatma mesajı başarıyla gönderildi.</span>
              </div>
            ) : (
              <>
                {!noReplyDraftText ? (
                  <button
                    onClick={async () => {
                      setIsPreparingNoReplyDraft(true);
                      setNoReplyDraftError(null);
                      try {
                        const res = await prepareNoReplyReminderDraftAction(activeContact.conversation_id || activeContact.id) as any;
                        if (res?.success && res?.draft) {
                          setNoReplyDraftText(res.draft);
                        } else {
                          setNoReplyDraftError(res?.error || "Taslak hazırlanırken hata oluştu.");
                        }
                      } catch (err: any) {
                        setNoReplyDraftError(err?.message || "Taslak hazırlama hatası.");
                      } finally {
                        setIsPreparingNoReplyDraft(false);
                      }
                    }}
                    disabled={isPreparingNoReplyDraft}
                    className="w-full py-2 px-3 bg-red-50 border border-red-200 hover:bg-red-100/80 text-red-700 text-[10px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
                  >
                    {isPreparingNoReplyDraft ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Taslak Hazırlanıyor...</span></>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5" /><span>Hatırlatma Taslağı Hazırla</span></>
                    )}
                  </button>
                ) : (
                  <div className="space-y-2.5">
                    <textarea
                      value={noReplyDraftText}
                      onChange={(e) => setNoReplyDraftText(e.target.value)}
                      disabled={isSendingNoReply}
                      rows={4}
                      className="w-full bg-white/70 border rounded-xl p-2.5 text-[11.5px] text-[#1D1D1F] leading-relaxed resize-none outline-none focus:ring-2 focus:ring-red-500/25 transition-all shadow-sm"
                      style={{ borderColor: "var(--q-border-default)" }}
                    />

                    {activeContact.noReplyFollowup?.no_reply_hours !== null && activeContact.noReplyFollowup?.no_reply_hours !== undefined && activeContact.noReplyFollowup.no_reply_hours >= 24 && (
                      <p className="text-[10px] text-amber-600 bg-amber-50/50 border border-amber-100 p-2 rounded-lg font-medium leading-normal">
                        ⚠️ 24 saatlik WhatsApp oturumu kapanmış olabilir. Gönderim başarısız olursa WhatsApp uygulaması veya onaylı şablon gerekebilir.
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (!noReplyDraftText.trim()) return;
                          setIsSendingNoReply(true);
                          setNoReplyDraftError(null);
                          try {
                            const res = await sendNoReplyReminderAction(
                              activeContact.conversation_id || activeContact.id,
                              noReplyDraftText
                            ) as any;
                            if (res?.success) {
                              setNoReplySentSuccess(true);
                              mutate((key) => Array.isArray(key) && key[0] === "conversations");
                            } else {
                              setNoReplyDraftError(res?.error || "Gönderim sırasında hata oluştu.");
                            }
                          } catch (err: any) {
                            setNoReplyDraftError(err?.message || "Gönderim hatası.");
                          } finally {
                            setIsSendingNoReply(false);
                          }
                        }}
                        disabled={isSendingNoReply || !noReplyDraftText.trim()}
                        className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50 shadow-sm"
                      >
                        {isSendingNoReply ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Gönderiliyor...</span></>
                        ) : (
                          <><Send className="w-3.5 h-3.5" /><span>Panelden Gönder</span></>
                        )}
                      </button>

                      <button
                        onClick={() => {
                          setNoReplyDraftText("");
                          setNoReplyDraftError(null);
                        }}
                        disabled={isSendingNoReply}
                        className="px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer transition-all disabled:opacity-50"
                      >
                        Vazgeç
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 🤖 Bot İşlemleri Accordion (Visible unconditionally) */}
        <div className="w-full mt-2.5 p-3 rounded-2xl border bg-white/40 space-y-2.5 shadow-sm text-left transition-all duration-300" style={{ borderColor: "var(--q-border-default)" }}>
          <button
            onClick={() => setIsBotSteeringOpen(!isBotSteeringOpen)}
            className="flex items-center justify-between w-full font-extrabold text-[#86868B] transition-colors hover:text-indigo-600 cursor-pointer"
          >
            <div className="flex items-center gap-1.5">
              <Brain className="w-4 h-4 text-indigo-500" />
              <span className="text-[10px] uppercase tracking-widest font-extrabold">🤖 Bot İşlemleri</span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isBotSteeringOpen ? 'rotate-180' : ''}`} />
          </button>

          {isBotSteeringOpen && (
            <div className="pt-2 space-y-4 border-t border-black/[0.03] animate-fade-in text-[11px] text-[#1D1D1F]">
              
              {/* 1. Status Info Card */}
              <div className="p-2.5 rounded-xl bg-[#F5F5F7]/75 border border-black/[0.03] space-y-1.5 shadow-sm">
                <span className="block text-[8px] font-bold text-[#86868B] uppercase tracking-widest mb-1.5">Durum Kartı</span>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 font-medium text-[10.5px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#86868B]">Dil:</span>
                    <span className="font-bold text-[#1D1D1F]">{detectedLanguage || crmData?.whatsapp24hWindow?.detectedLanguage || "Otomatik"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#86868B]">Form:</span>
                    <span className="font-bold text-[#1D1D1F]">{crmData?.formData ? "Var" : "Yok"}</span>
                  </div>
                  <div className="flex items-center justify-between col-span-2 border-t border-black/[0.03] pt-1.5">
                    <span className="text-[#86868B]">24s WhatsApp Penceresi:</span>
                    <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold text-white ${
                      crmData?.whatsapp24hWindow?.status === 'OPEN' ? 'bg-green-600' :
                      crmData?.whatsapp24hWindow?.status === 'CLOSING_SOON' ? 'bg-amber-500' :
                      crmData?.whatsapp24hWindow?.status === 'CLOSED' ? 'bg-red-600' : 'bg-gray-500'
                    }`}>
                      {crmData?.whatsapp24hWindow?.status === 'OPEN' ? 'Açık' :
                       crmData?.whatsapp24hWindow?.status === 'CLOSING_SOON' ? 'Kapanmak Üzere' :
                       crmData?.whatsapp24hWindow?.status === 'CLOSED' ? 'Kapalı' : 'Belirsiz'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between col-span-2">
                    <span className="text-[#86868B]">Gönderim Yolu:</span>
                    <span className="font-bold text-[#1D1D1F]">
                      {crmData?.whatsapp24hWindow?.status === 'OPEN' || crmData?.whatsapp24hWindow?.status === 'CLOSING_SOON' ? "Serbest Mesaj (API)" : "Onaylı Şablon (API)"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between col-span-2 border-t border-black/[0.03] pt-1.5">
                    <span className="text-[#86868B]">Bot Durumu:</span>
                    <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold text-white ${
                      (activeContact?.autopilot_enabled || activeContact?.isBotActive || activeContact?.status === 'bot') ? 'bg-indigo-600' : 'bg-gray-500'
                    }`}>
                      {(activeContact?.autopilot_enabled || activeContact?.isBotActive || activeContact?.status === 'bot') ? 'Botta' : 'Manuel'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. Botu Yönlendir (Mevcut İç Talimat Akışı) */}
              <div className="space-y-2 border-t border-black/[0.03] pt-3">
                <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-widest">1. Botu Yönlendir (İç Talimat)</span>
                
                {activeBotDirective ? (
                  <div className="p-2.5 rounded-xl bg-indigo-50/70 border border-indigo-100 text-indigo-905 text-[11px] font-medium leading-relaxed">
                    <span className="block text-[8px] font-bold text-indigo-500 uppercase tracking-widest mb-0.5">Aktif Bot Yönlendirmesi</span>
                    "{activeBotDirective}"
                  </div>
                ) : (
                  <div className="text-[10px] text-[#86868B] font-medium leading-snug">
                    Botun bir sonraki adımda hastaya vereceği yanıta müdahale edin. Direktif vererek bota yol gösterin.
                  </div>
                )}

                {/* Suggestions Section */}
                {(steeringTasks && steeringTasks.length > 0) && (
                  <div className="space-y-2 p-2 rounded-xl bg-[#F5F5F7]/30 border border-black/[0.03]">
                    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-[#86868B]">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                      <span>💡 Önerilen Bot Yönlendirmeleri</span>
                    </div>
                    
                    <div className="space-y-1.5">
                      {steeringTasks.map((suggestion: any, idx: number) => {
                        if (!suggestion) return null;
                        
                        if (suggestion.isPassive) {
                          return (
                            <div 
                              key={idx}
                              className="px-2.5 py-1.5 rounded-xl border bg-green-50/50 border-green-100 text-green-700 text-[10px] font-semibold flex items-center gap-1.5"
                            >
                              <Check className="w-3.5 h-3.5 text-green-600" />
                              <span>{suggestion.passiveText}</span>
                            </div>
                          );
                        }

                        return (
                          <div 
                            key={idx}
                            className="p-2.5 rounded-xl border bg-white border-[#E5E5EA] flex flex-col gap-2 text-left shadow-sm"
                          >
                            <div className="space-y-0.5">
                              <span className="block text-[10.5px] font-bold text-[#1D1D1F]">{suggestion.suggestionTitle}</span>
                              <span className="block text-[10px] text-[#86868B] leading-relaxed font-medium">"{suggestion.suggestionText}"</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setBotDirectiveText(suggestion.suggestionText || "");
                                directiveTextareaRef.current?.focus();
                              }}
                              className="self-end px-2.5 py-1 bg-[#F5F5F7] hover:bg-[#E5E5EA] text-[#1D1D1F] text-[9.5px] font-bold rounded-lg cursor-pointer transition-all active:scale-95 border border-[#D2D2D7]"
                            >
                              Direktifi Seç
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <textarea
                    ref={directiveTextareaRef}
                    value={botDirectiveText}
                    onChange={(e) => setBotDirectiveText(e.target.value)}
                    placeholder="Örn: Hastanın geliş tarihini netleştir, kararsızsa telefon görüşmesine yönlendir."
                    disabled={isSavingBotSteering}
                    rows={3}
                    className="w-full bg-white/70 border rounded-xl p-2.5 text-[11.5px] text-[#1D1D1F] leading-normal resize-none outline-none focus:ring-2 focus:ring-indigo-500/25 transition-all shadow-sm"
                    style={{ borderColor: "var(--q-border-default)" }}
                  />
                  
                  {botSteeringStatus === "error" && (
                    <div className="text-[10px] font-semibold text-red-600 bg-red-50 p-1.5 rounded-lg">
                      ⚠️ Direktif kaydedilemedi.
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      if (!botDirectiveText.trim()) return;
                      setIsSavingBotSteering(true);
                      setBotSteeringStatus("saving");
                      try {
                        const res = await saveBotSteeringDirectiveAction(
                          activeContact.conversation_id || activeContact.id,
                          botDirectiveText
                        );
                        if (res.success) {
                          setActiveBotDirective(botDirectiveText.trim());
                          setBotDirectiveText("");
                          setBotSteeringStatus("saved");
                          setTimeout(() => setBotSteeringStatus("idle"), 2000);
                          mutate((key) => Array.isArray(key) && key[0] === "conversations");
                          queryClient.invalidateQueries({ queryKey: ['crm-panel', activeContact.conversation_id || activeContact.id] });
                        } else {
                          setBotSteeringStatus("error");
                        }
                      } catch (err) {
                        console.error("Steering error:", err);
                        setBotSteeringStatus("error");
                      } finally {
                        setIsSavingBotSteering(false);
                      }
                    }}
                    disabled={isSavingBotSteering || !botDirectiveText.trim()}
                    className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all disabled:opacity-50"
                  >
                    {isSavingBotSteering ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Kaydediliyor...</span></>
                    ) : botSteeringStatus === "saved" ? (
                      <><Check className="w-3.5 h-3.5" /><span>Kaydedildi!</span></>
                    ) : (
                      <span>Direktifi Kaydet</span>
                    )}
                  </button>
                </div>
              </div>

              {/* 3. Bota Mesaj Hazırlat (Yeni Akış) */}
              <div className="space-y-3.5 border-t border-black/[0.03] pt-4">
                <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-widest">2. Bota Mesaj Hazırlat</span>

                {/* Predefined Intents */}
                <div className="space-y-1">
                  <span className="block text-[10px] text-[#86868B] font-bold">Hazırlama Amacı:</span>
                  <div className="flex flex-wrap gap-1">
                    {[
                      "Karşılama",
                      "Randevuya Yönlendir",
                      "Uygun Gün/Saat Sor",
                      "Fiyat Vermeden Koordinatöre Yönlendir",
                      "Kararsız Hastayı Nazikçe İkna Et",
                      "Rapor/MR İstemeden Geliş Amacını Teyit Et",
                      "Cevap Bekleyen Hastaya Takip Mesajı Hazırla",
                      "Serbest Talimatla Mesaj Hazırla"
                    ].map((intent) => (
                      <button
                        key={intent}
                        type="button"
                        onClick={() => setSelectedIntent(intent)}
                        className={`px-2 py-1 text-[9.5px] font-bold rounded-lg transition-all border ${
                          selectedIntent === intent
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                            : "bg-white border-[#E5E5EA] text-[#1D1D1F] hover:bg-[#F5F5F7]"
                        }`}
                      >
                        {intent}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom instruction input for Serbest Talimat */}
                {selectedIntent === "Serbest Talimatla Mesaj Hazırla" && (
                  <div className="space-y-1 animate-fade-in">
                    <span className="block text-[10px] text-[#86868B] font-bold">Özel Talimat:</span>
                    <input
                      type="text"
                      value={customDirective}
                      onChange={(e) => setCustomDirective(e.target.value)}
                      placeholder="Örn: Hastaya randevu seçeneklerimizi Konya hastanemizin yoğunluğunu belirterek sun."
                      className="w-full bg-white border border-[#D2D2D7] rounded-lg px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                )}

                {/* Target Language Dropdown */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#86868B] font-bold">Hedef Dil:</span>
                  <select
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                    className="bg-white border border-[#D2D2D7] rounded-lg px-2 py-1 text-[10.5px] outline-none text-[#1D1D1F] font-semibold"
                  >
                    {["Auto", "Türkçe", "İngilizce", "Almanca", "Arapça", "Fransızca"].map((lang) => (
                      <option key={lang} value={lang}>{lang}</option>
                    ))}
                  </select>
                </div>

                {/* Action Trigger */}
                <button
                  type="button"
                  onClick={async () => {
                    setIsGeneratingAssistedDraft(true);
                    setAssistedDraftError(null);
                    setAssistedDraftSuccess(false);
                    setSuggestedTemplates([]);
                    setSelectedTemplate(null);
                    setFormDraftForCopy("");
                    try {
                      const res = await prepareInboxBotAssistedDraftAction(
                        activeContact.conversation_id || activeContact.id,
                        selectedIntent,
                        selectedLanguage,
                        selectedIntent === "Serbest Talimatla Mesaj Hazırla" ? customDirective : undefined
                      ) as any;

                      if (res.success) {
                        console.log("[BOT_ASSISTED_DRAFT_SUCCESS] Action response:", res);

                        if (!res.isTemplate && (!res.draftText || !res.draftText.trim())) {
                          console.error("[BOT_ASSISTED_DRAFT_EMPTY] Response has empty draftText");
                          setAssistedDraftError("Taslak metin üretilemedi veya boş döndü. Lütfen tekrar deneyin.");
                          setAssistedDraftSuccess(false);
                          return;
                        }

                        setAssistedDraftSuccess(true);
                        setDetectedLanguage(res.detectedLanguage || null);
                        setIsLanguageUnclear(res.isLanguageUnclear || false);
                        setFormDraftForCopy(res.draftText || "");
                        
                        if (res.isTemplate) {
                          setSuggestedTemplates(res.suggestedTemplates || []);
                          setAssistedDraftText("");
                        } else {
                          setAssistedDraftText(res.draftText || "");
                        }
                      } else {
                        console.error("[BOT_ASSISTED_DRAFT_ERROR] Action failed:", res.error);
                        setAssistedDraftError(res.error || "Taslak hazırlanamadı.");
                        setAssistedDraftSuccess(false);
                      }
                    } catch (err: any) {
                      setAssistedDraftError(err.message || "Taslak hazırlama sırasında hata oluştu.");
                    } finally {
                      setIsGeneratingAssistedDraft(false);
                    }
                  }}
                  disabled={isGeneratingAssistedDraft || (selectedIntent === "Serbest Talimatla Mesaj Hazırla" && !customDirective.trim())}
                  className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer transition-all disabled:opacity-50 shadow-sm"
                >
                  {isGeneratingAssistedDraft ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Taslak Hazırlanıyor...</span></>
                  ) : (
                    <><Sparkles className="w-3.5 h-3.5" /><span>Bota Cevap Hazırlat</span></>
                  )}
                </button>

                {/* Error message */}
                {assistedDraftError && (
                  <div className="text-[10px] font-semibold text-red-600 bg-red-50 p-2 rounded-lg leading-normal">
                    ⚠️ {assistedDraftError}
                  </div>
                )}

                {/* Generated freeform draft / template selections container */}
                {assistedDraftSuccess && (
                  <div className="space-y-3.5 border-t border-black/[0.03] pt-3 animate-fade-in">
                    
                    {/* Detected Language Indicator */}
                    {detectedLanguage && (
                      <div className="flex items-center justify-between text-[9.5px] text-[#86868B] font-semibold">
                        <span>Algılanan Dil: <strong className="text-[#1D1D1F]">{detectedLanguage}</strong></span>
                        {isLanguageUnclear && (
                          <span className="text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded">⚠️ Net Değil</span>
                        )}
                      </div>
                    )}

                    {/* FREEFORM DRAFT RENDER (Only if window is OPEN/CLOSING_SOON) */}
                    {(crmData?.whatsapp24hWindow?.status === 'OPEN' || crmData?.whatsapp24hWindow?.status === 'CLOSING_SOON') && (
                      <div className="space-y-2">
                        <span className="block text-[10px] text-[#86868B] font-bold">Hazırlanan Taslak Metin (Düzenlenebilir):</span>
                        <textarea
                          value={assistedDraftText}
                          onChange={(e) => setAssistedDraftText(e.target.value)}
                          rows={6}
                          className="w-full bg-white border border-[#D2D2D7] rounded-xl p-2.5 text-[11.5px] text-[#1D1D1F] leading-normal outline-none focus:ring-1 focus:ring-indigo-500 shadow-inner"
                        />
                        
                        {/* Send Action */}
                        <button
                          type="button"
                          onClick={async () => {
                            if (!assistedDraftText.trim()) return;
                            setIsSendingAssistedDraft(true);
                            try {
                              const res = await sendApprovedInboxBotDraftAction(
                                activeContact.conversation_id || activeContact.id,
                                assistedDraftText
                              ) as any;
                              if (res.success) {
                                setAssistedDraftText("");
                                setAssistedDraftSuccess(false);
                                mutate((key) => Array.isArray(key) && key[0] === "conversations");
                                const targetConvId = activeContact.conversation_id || activeContact.id;
                                queryClient.invalidateQueries({ queryKey: ['crm-panel', targetConvId] });
                                queryClient.invalidateQueries({ queryKey: ["messages", targetConvId] });
                                if (activeContact.phone_number) {
                                  queryClient.invalidateQueries({ queryKey: ["messages", activeContact.phone_number] });
                                }
                              } else {
                                setAssistedDraftError(res.error || "Mesaj gönderilemedi.");
                              }
                            } catch (err: any) {
                              setAssistedDraftError(err.message || "Gönderim hatası.");
                            } finally {
                              setIsSendingAssistedDraft(false);
                            }
                          }}
                          disabled={isSendingAssistedDraft || !assistedDraftText.trim()}
                          className="w-full py-2 bg-green-600 hover:bg-green-700 text-white text-[10.5px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50 shadow-sm"
                        >
                          {isSendingAssistedDraft ? (
                            <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Gönderiliyor...</span></>
                          ) : (
                            <><Send className="w-3.5 h-3.5" /><span>Taslağı Gönder (API)</span></>
                          )}
                        </button>
                      </div>
                    )}

                    {/* CLOSED/UNKNOWN WINDOW MANIFESTO (Form copy draft + Templates) */}
                    {(crmData?.whatsapp24hWindow?.status === 'CLOSED' || crmData?.whatsapp24hWindow?.status === 'UNKNOWN') && (
                      <div className="space-y-4">
                        
                        {/* 1. Form smart draft for manual copy-paste */}
                        {formDraftForCopy && (
                          <div className="p-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50/35 space-y-2.5 text-left shadow-sm">
                            <div className="flex items-center gap-1.5 text-amber-800">
                              <AlertTriangle className="w-4 h-4 text-amber-600" />
                              <span className="text-[10px] font-bold uppercase tracking-wider">Hazırlanan Form Karşılama Taslağı (Manuel)</span>
                            </div>
                            <p className="text-[9.5px] text-amber-650 leading-relaxed font-medium">
                              WhatsApp 24 saatlik müşteri penceresi kapalı olduğu için bu serbest taslak API ile gönderilemez. Panoya kopyalayarak WhatsApp üzerinden manuel gönderebilirsiniz.
                            </p>
                            <div className="p-2.5 bg-white border border-gray-150 rounded-xl text-[10.5px] leading-relaxed text-[#1D1D1F] select-all whitespace-pre-wrap font-sans shadow-inner max-h-[140px] overflow-y-auto">
                              {formDraftForCopy}
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(formDraftForCopy);
                                }}
                                className="flex-1 py-1.5 bg-amber-100 hover:bg-amber-200 active:scale-95 text-amber-800 text-[10px] font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                <span>Taslağı Kopyala</span>
                              </button>
                              <a
                                href={
                                  typeof window !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                                    ? `https://wa.me/${crmData?.phoneNumber || activeContact.phone_number || activeContact.id}?text=${encodeURIComponent(formDraftForCopy)}`
                                    : `https://web.whatsapp.com/send?phone=${crmData?.phoneNumber || activeContact.phone_number || activeContact.id}&text=${encodeURIComponent(formDraftForCopy)}`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 py-1.5 border border-amber-300 bg-white hover:bg-amber-50 active:scale-95 text-amber-800 text-[10px] font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all text-center"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                                <span>WhatsApp'ta Aç</span>
                              </a>
                            </div>
                          </div>
                        )}

                        {/* 2. Suggested Templates List */}
                        {suggestedTemplates && suggestedTemplates.length > 0 ? (
                          <div className="space-y-3">
                            <div className="p-2 rounded-xl bg-amber-50 border border-amber-100 text-[10px] text-amber-700 font-medium leading-relaxed">
                              ⚠️ 24 saatlik WhatsApp serbest mesajlaşma penceresi kapalı. Sadece Meta onaylı şablonlar gönderilebilir. Lütfen aşağıdan bir şablon seçin.
                            </div>

                            <div className="space-y-2">
                              <span className="block text-[10px] text-[#86868B] font-bold">Önerilen Onaylı Şablonlar (API ile Gönderilebilir):</span>
                              <div className="space-y-2">
                                {suggestedTemplates.map((tpl: any, idx: number) => {
                                  const isSelected = selectedTemplate?.templateId === tpl.templateId;
                                  return (
                                    <div
                                      key={idx}
                                      onClick={() => {
                                        setSelectedTemplate(tpl);
                                        setAssistedDraftText(tpl.filledBody || "");
                                      }}
                                      className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                                        isSelected 
                                          ? "bg-indigo-50/50 border-indigo-300 shadow-sm" 
                                          : "bg-white border-[#E5E5EA] hover:bg-[#F5F5F7]"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-[10px] font-bold text-[#1D1D1F]">{tpl.templateName}</span>
                                        <span className="text-[8.5px] px-1 bg-gray-100 border rounded text-gray-500 font-mono uppercase">{tpl.language}</span>
                                      </div>
                                      <p className="text-[9.5px] text-indigo-700 italic leading-snug mb-2">"{tpl.explanation}"</p>
                                      <div className="p-2.5 bg-gray-50 border rounded-lg text-[9.5px] text-[#86868B] whitespace-pre-wrap font-mono">
                                        {tpl.filledBody}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Warning about provider template approval */}
                            <div className="p-2.5 rounded-lg bg-[#F5F5F7] border border-black/[0.04] text-[9.5px] text-[#86868B] font-medium leading-normal">
                              💡 <strong>Önemli Hatırlatma:</strong> Lütfen seçtiğiniz şablonun WhatsApp/360dialog sağlayıcı panelinde onaylı (Approved) olduğundan emin olun. Onaylanmamış şablonlar WhatsApp API tarafından reddedilir.
                            </div>

                            {selectedTemplate && (
                              <div className="space-y-2 animate-fade-in">
                                <span className="block text-[10px] text-[#86868B] font-bold">Şablon Değişken Değerleri (Düzenlenebilir):</span>
                                <textarea
                                  value={assistedDraftText}
                                  onChange={(e) => setAssistedDraftText(e.target.value)}
                                  rows={5}
                                  className="w-full bg-white border border-[#D2D2D7] rounded-xl p-2.5 text-[11.5px] text-[#1D1D1F] leading-normal outline-none focus:ring-1 focus:ring-indigo-500 shadow-inner"
                                />
                                
                                {/* Send Approved Template */}
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!assistedDraftText.trim() || !selectedTemplate) return;
                                    setIsSendingAssistedDraft(true);
                                    try {
                                      const res = await sendApprovedInboxBotDraftAction(
                                        activeContact.conversation_id || activeContact.id,
                                        assistedDraftText,
                                        selectedTemplate.templateName,
                                        selectedTemplate.language,
                                        selectedTemplate.body
                                      ) as any;
                                      if (res.success) {
                                        setAssistedDraftText("");
                                        setAssistedDraftSuccess(false);
                                        setSelectedTemplate(null);
                                        mutate((key) => Array.isArray(key) && key[0] === "conversations");
                                        const targetConvId = activeContact.conversation_id || activeContact.id;
                                        queryClient.invalidateQueries({ queryKey: ['crm-panel', targetConvId] });
                                        queryClient.invalidateQueries({ queryKey: ["messages", targetConvId] });
                                        if (activeContact.phone_number) {
                                          queryClient.invalidateQueries({ queryKey: ["messages", activeContact.phone_number] });
                                        }
                                      } else {
                                        setAssistedDraftError(res.error || "Şablon mesajı gönderilemedi.");
                                      }
                                    } catch (err: any) {
                                      setAssistedDraftError(err.message || "Şablon gönderim hatası.");
                                    } finally {
                                      setIsSendingAssistedDraft(false);
                                    }
                                  }}
                                  disabled={isSendingAssistedDraft || !assistedDraftText.trim()}
                                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[10.5px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50 shadow-sm"
                                >
                                  {isSendingAssistedDraft ? (
                                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Şablon Gönderiliyor...</span></>
                                  ) : (
                                    <><Send className="w-3.5 h-3.5" /><span>Onaylı Şablonu Gönder (API)</span></>
                                  )}
                                </button>
                              </div>
                            )}

                          </div>
                        ) : (
                          // If no suggested templates found
                          <div className="space-y-2.5">
                            <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-[10px] text-red-700 font-semibold leading-relaxed">
                              ⚠️ Sistemde aktif onaylı şablon bulunamadı. Lütfen Ayarlar &gt; Şablonlar sayfasından şablon ekleyin veya manuel sohbeti açın.
                            </div>
                            <div className="p-2.5 rounded-lg bg-[#F5F5F7] border border-black/[0.04] text-[9.5px] text-[#86868B] font-medium leading-normal">
                              💡 <strong>Önemli Hatırlatma:</strong> Lütfen seçtiğiniz şablonun WhatsApp/360dialog sağlayıcı panelinde onaylı (Approved) olduğundan emin olun.
                            </div>
                          </div>
                        )}

                        {/* WhatsApp'ta Manuel Aç Alternative */}
                        <div className="border-t border-black/[0.03] pt-3 space-y-2">
                          <p className="text-[10px] text-[#86868B] font-medium leading-relaxed">
                            Serbest API mesajı gönderilemez. WhatsApp Business App’te sohbeti açarak manuel yazabilirsiniz. Hasta cevap verirse 24 saatlik pencere yeniden açılır.
                          </p>
                          <a
                            href={
                              typeof window !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                                ? `https://wa.me/${crmData?.phoneNumber || activeContact.phone_number || activeContact.id}?text=${encodeURIComponent(assistedDraftText || selectedTemplate?.filledBody || "")}`
                                : `https://web.whatsapp.com/send?phone=${crmData?.phoneNumber || activeContact.phone_number || activeContact.id}&text=${encodeURIComponent(assistedDraftText || selectedTemplate?.filledBody || "")}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full py-1.5 border border-[#D2D2D7] hover:bg-[#F5F5F7] text-[#1D1D1F] text-[10px] font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>WhatsApp'ta Manuel Aç</span>
                          </a>
                        </div>

                      </div>
                    )}

                  </div>
                )}

              </div>

            </div>
          )}
        </div>

        {/* Quick Action Grid Cards */}
        <div className="grid grid-cols-2 gap-2 mt-2.5 w-full pt-2 border-t border-black/5">
          <button
            type="button"
            onClick={() => setActiveModal({ modalType: 'call_plan', conversationId: activeContact.conversation_id || activeContact.id, patientName })}
            className="flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            style={{
              backgroundColor: "rgba(88, 86, 214, 0.04)",
              borderColor: "rgba(88, 86, 214, 0.12)",
              color: "#5856D6"
            }}
          >
            <div className="w-6 h-6 rounded-full flex items-center justify-center mb-1 transition-all duration-200 group-hover:scale-110"
                 style={{ backgroundColor: "rgba(88, 86, 214, 0.08)" }}>
              <Phone className="w-3 h-3" />
            </div>
            <span className="text-[10px] font-bold tracking-tight">Arama Planla</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModal({ modalType: 'appointment_plan', conversationId: activeContact.conversation_id || activeContact.id, patientName })}
            className="flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            style={{
              backgroundColor: "rgba(52, 199, 89, 0.04)",
              borderColor: "rgba(52, 199, 89, 0.12)",
              color: "#34C759"
            }}
          >
            <div className="w-6 h-6 rounded-full flex items-center justify-center mb-1 transition-all duration-200 group-hover:scale-110"
                 style={{ backgroundColor: "rgba(52, 199, 89, 0.08)" }}>
              <CalendarClock className="w-3 h-3" />
            </div>
            <span className="text-[10px] font-bold tracking-tight leading-tight">Randevu Planla</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModal({ modalType: 'reminder_plan', conversationId: activeContact.conversation_id || activeContact.id, patientName })}
            className="flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            style={{
              backgroundColor: "rgba(0, 122, 255, 0.04)",
              borderColor: "rgba(0, 122, 255, 0.12)",
              color: "#007AFF"
            }}
          >
            <div className="w-6 h-6 rounded-full flex items-center justify-center mb-1 transition-all duration-200 group-hover:scale-110"
                 style={{ backgroundColor: "rgba(0, 122, 255, 0.08)" }}>
              <Clock className="w-3 h-3" />
            </div>
            <span className="text-[10px] font-bold tracking-tight">Hatırlatma Planla</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveModal({ modalType: 'form_detail', conversationId: activeContact.conversation_id || activeContact.id, patientName })}
            className="flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            style={{
              backgroundColor: "rgba(255, 149, 0, 0.04)",
              borderColor: "rgba(255, 149, 0, 0.12)",
              color: "#FF9500"
            }}
          >
            <div className="w-6 h-6 rounded-full flex items-center justify-center mb-1 transition-all duration-200 group-hover:scale-110"
                 style={{ backgroundColor: "rgba(255, 149, 0, 0.08)" }}>
              <FileText className="w-3 h-3" />
            </div>
            <span className="text-[10px] font-bold tracking-tight">Form Detayı</span>
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3.5 flex-1">
        {/* CRM Bilgileri Card */}
        <div className="p-3 rounded-2xl border bg-white/40 space-y-3 shadow-sm text-left" style={{ borderColor: "var(--q-border-default)" }}>
          <div className="flex items-center justify-between pb-1.5 border-b border-black/[0.03]">
            <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#86868B]">CRM Bilgileri</span>
            <span className="text-[8px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.2 rounded-full uppercase tracking-wider">Manuel Takip</span>
          </div>

          {/* Stage & Department Grid */}
          <div className="grid grid-cols-2 gap-2">
            {/* Stage/Durum */}
            <div className="space-y-1 text-left">
              <label className="text-[9px] font-bold uppercase tracking-widest text-[#86868B] ml-1">Durum / Aşama</label>
              <div className="relative">
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="w-full pl-2 pr-6 py-1.5 rounded-lg text-[11px] font-bold outline-none transition-all appearance-none cursor-pointer bg-white/60 border hover:border-indigo-500/30"
                  style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-primary)", boxShadow: "var(--q-shadow-sm)" }}
                >
                  <option value="new">Yeni Lead</option>
                  <option value="contacted">İletişime Geçildi</option>
                  <option value="responded">Yanıt Alındı</option>
                  <option value="discovery">Keşif / Analiz</option>
                  <option value="qualified">Nitelikli</option>
                  <option value="appointed">Randevu Aldı</option>
                  <option value="lost">Kaybedildi</option>
                  {/* Opportunity stage fallbacks */}
                  {stage && !["new","contacted","responded","discovery","qualified","appointed","lost"].includes(stage) && (
                    <>
                      {stage === "new_lead" && <option value="new_lead">Yeni Lead</option>}
                      {stage === "first_contact" && <option value="first_contact">İlk İletişim</option>}
                      {stage === "engaged" && <option value="engaged">Yanıt Alındı</option>}
                      {stage === "report_waiting" && <option value="report_waiting">Rapor Bekleniyor</option>}
                      {stage === "report_received" && <option value="report_received">Rapor Geldi</option>}
                      {stage === "doctor_review" && <option value="doctor_review">Doktor İncelemesi</option>}
                      {stage === "offer_sent" && <option value="offer_sent">Teklif Gönderildi</option>}
                      {stage === "appointment_planning" && <option value="appointment_planning">Randevu Planlanıyor</option>}
                      {stage === "appointment_booked" && <option value="appointment_booked">Randevu Alındı</option>}
                      {stage === "arrived" && <option value="arrived">Geldi</option>}
                      {stage === "not_qualified" && <option value="not_qualified">Uygun Değil</option>}
                    </>
                  )}
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                  <ChevronDown className="w-3.5 h-3.5 text-[#86868B]" />
                </div>
              </div>
            </div>

            {/* Department/Bölüm */}
            <div className="space-y-1 text-left">
              <label className="text-[9px] font-bold uppercase tracking-widest text-[#86868B] ml-1">Bölüm / Departman</label>
              <div className="relative">
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full pl-2 pr-6 py-1.5 rounded-lg text-[11px] font-bold outline-none transition-all appearance-none cursor-pointer bg-white/60 border hover:border-indigo-500/30"
                  style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-primary)", boxShadow: "var(--q-shadow-sm)" }}
                >
                  <option value="">Belirtilmemiş</option>
                  {["Ortopedi", "Kardiyoloji", "Gastroenteroloji", "Estetik", "Diş", "Diş Estetiği", "Göz", "Tüp Bebek", "Organ Nakli", "Onkoloji", "Obezite", "Nöroloji", "Üroloji", "Dermatoloji", "Genel Cerrahi", "Beyin Cerrahi", "KBB", "Göğüs Hastalıkları", "Endokrinoloji", "Fizik Tedavi", "Çocuk Sağlığı", "Kadın Doğum", "Psikiyatri", "Check-Up"].map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                  <ChevronDown className="w-3.5 h-3.5 text-[#86868B]" />
                </div>
              </div>
            </div>
          </div>

          {/* Department Recommendation */}
          {suggestedDept && (
            <div className="mt-2 p-2 flex flex-col gap-1.5 rounded-xl border transition-all duration-200"
                 style={{ 
                   backgroundColor: hasConflict ? "rgba(255, 149, 0, 0.04)" : suggestedConfidence !== 'high' ? "rgba(255, 149, 0, 0.04)" : "rgba(175, 82, 222, 0.04)", 
                   borderColor: hasConflict ? "rgba(255, 149, 0, 0.25)" : suggestedConfidence !== 'high' ? "rgba(255, 149, 0, 0.15)" : "rgba(175, 82, 222, 0.15)" 
                 }}>
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 shrink-0 animate-pulse" style={{ color: hasConflict || suggestedConfidence !== 'high' ? "#FF9500" : "#AF52DE" }} />
                  <div className="flex flex-col text-left">
                    <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: hasConflict || suggestedConfidence !== 'high' ? "#FF9500" : "#AF52DE" }}>
                      Önerilen Bölüm
                    </span>
                    <span className="text-[11px] font-semibold text-[#1D1D1F]">
                      {suggestedDept} {hasConflict ? "— Çakışma Var" : suggestedConfidence !== 'high' ? "— Teyit Edin" : ""}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setDepartment(suggestedDept!);
                    setIsSaving(true);
                    setSaveStatus("saving");
                    const res = await updateCrmData(activeContact.id, stage, suggestedDept!, country, notes, patientName);
                    if (res.success) {
                      useInboxStore.getState().setActiveContact(activeContact.id, {
                        ...activeContact,
                        department: suggestedDept!,
                        name: patientName,
                        opp_patient_name: patientName
                      });
                      mutate((key) => Array.isArray(key) && key[0] === "conversations");
                      setSaveStatus("saved");
                      setTimeout(() => setSaveStatus("idle"), 2000);
                    } else {
                      setSaveStatus("error");
                      setTimeout(() => setSaveStatus("idle"), 3000);
                    }
                    setIsSaving(false);
                  }}
                  className="px-2 py-0.5 text-[9px] font-bold rounded-lg cursor-pointer bg-white border transition-all hover:scale-[1.02]"
                  style={{ 
                    color: hasConflict || suggestedConfidence !== 'high' ? "#FF9500" : "#AF52DE",
                    borderColor: hasConflict || suggestedConfidence !== 'high' ? "rgba(255, 149, 0, 0.2)" : "rgba(175, 82, 222, 0.2)"
                  }}
                >
                  Onayla
                </button>
              </div>
              {hasConflict && conflictReason && (
                <span className="text-[9px] font-semibold leading-relaxed text-left pt-1 block" style={{ color: "#FF9500", borderTop: "1px solid rgba(255, 149, 0, 0.15)" }}>
                  ⚠️ {conflictReason}
                </span>
              )}
              {suggestedSource === 'patient_message' && activeContact.last_message && (
                <span className="text-[9px] font-semibold leading-relaxed text-left block text-[#86868B]">
                  Kaynak: Hasta mesajı — "{activeContact.last_message}"
                </span>
              )}
            </div>
          )}

          {/* AI Summary Card */}
          {(() => {
            const summaryInput = {
              oppSummary: crmData?.opportunity?.opp_summary || activeContact?.opp_summary,
              oppAiReason: crmData?.opportunity?.opp_ai_reason || activeContact?.opp_ai_reason,
              legacyAiSummary: crmData?.opportunity?.legacy_ai_summary || activeContact?.legacy_ai_summary,
              priority: crmData?.opportunity?.opp_priority || activeContact?.opp_priority || activeContact?.priority,
              updatedAt: activeContact?.last_message_at
            };
            const resolvedSummary = resolveUniversalAISummary(
              summaryInput,
              entityType,
              patientName
            );
            return <UniversalAISummaryCard summary={resolvedSummary} compact={true} defaultCollapsed={true} maxLines={3} className="pt-0.5" />;
          })()}

          {/* Notes */}
          <div className="space-y-1 text-left pt-0.5">
            <label className="text-[9px] font-bold uppercase tracking-widest text-[#86868B] ml-1">
              {entityType === 'patient' ? '✍️ Koordinatör Notları' : '✍️ Manuel Notlar'}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={entityType === 'patient' ? 'Hastayla ilgili manuel takip notları...' : 'Müşteriyle ilgili manuel notlar...'}
              className="w-full h-16 bg-white/60 border rounded-xl p-2.5 text-[11.5px] text-[#1D1D1F] placeholder:text-[#86868B] focus:ring-2 focus:ring-[#AF52DE]/20 resize-none outline-none transition-all shadow-sm focus:border-indigo-500/40"
              style={{ borderColor: "var(--q-border-default)" }}
            />
          </div>

          {/* Tags */}
          <div className="space-y-1.5 text-left pt-0.5">
            <div className="flex items-center justify-between">
              <label className="text-[9px] font-bold uppercase tracking-widest text-[#86868B] ml-1">Etiketler</label>
              {!isAddingTag && (
                <button
                  onClick={() => setIsAddingTag(true)}
                  className="transition-colors text-[9px] font-bold tracking-wide flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800 cursor-pointer"
                >
                  <Plus className="w-2.5 h-2.5" /> EKLE
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1">
              {parsedTags.length > 0 ? (
                parsedTags.map((tag: string, i: number) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.2 text-[10px] font-bold rounded-lg flex items-center gap-0.5 shadow-sm group bg-indigo-50 text-indigo-600 border border-indigo-100"
                  >
                    <Tag className="w-2.5 h-2.5 text-indigo-400" /> {formatTag(tag)}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-0.5 w-3 h-3 rounded-full flex items-center justify-center hover:bg-indigo-100 transition-all text-indigo-400 hover:text-indigo-700"
                    >
                      <X className="w-2 h-2" />
                    </button>
                  </span>
                ))
              ) : (
                !isAddingTag && <span className="text-[10px] italic text-[#86868B]">Etiket eklenmemiş</span>
              )}
              {isAddingTag && (
                <form onSubmit={handleAddTag} className="flex items-center">
                  <input
                    autoFocus
                    type="text"
                    value={newTagVal}
                    onChange={(e) => setNewTagVal(e.target.value)}
                    onBlur={() => handleAddTag()}
                    placeholder="Etiket..."
                    className="px-1.5 py-0.2 text-[10px] font-bold rounded-lg outline-none w-16 bg-white border border-indigo-300 focus:border-indigo-500 shadow-sm"
                  />
                </form>
              )}
            </div>
          </div>
        </div>

        {/* Form Geçmişi */}
        {crmData?.formData && (
          <div className="p-2.5 rounded-2xl border bg-white/40 space-y-2 shadow-sm text-left" style={{ borderColor: "var(--q-border-default)" }}>
            <div className="flex items-center justify-between pb-1 border-b border-black/[0.03]">
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#86868B]">Form Geçmişi</span>
              <span className="text-[8px] font-bold text-[#86868B] bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-0.2">1 Form</span>
            </div>
            
            <div 
              onClick={() => setActiveModal({ modalType: 'form_detail', conversationId: activeContact.conversation_id || activeContact.id, patientName })}
              className="p-2 rounded-xl text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer hover:bg-white bg-white/50 border border-black/5 shadow-sm space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold text-[#1D1D1F] line-clamp-1">
                  {crmData.formData?.name || "Başvuru Formu"}
                </span>
                <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-0.2 shrink-0">
                  Detay
                </span>
              </div>
              
              <div className="flex items-center gap-2 text-[9px] text-[#86868B] font-semibold">
                <div className="flex items-center gap-0.5">
                  <Calendar className="w-2.5 h-2.5 text-indigo-400" />
                  <span>{crmData.formData?.date || "Belirtilmemiş"}</span>
                </div>
                {campaignName && (
                  <div className="flex items-center gap-0.5 max-w-[120px]">
                    <Share2 className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                    <span className="truncate">{campaignName}</span>
                  </div>
                )}
              </div>

              {(crmData.formFields?.formComplaint || rawObj?.complaint || rawObj?.sikayet) && (
                <div className="pt-1 border-t border-black/[0.03]">
                  <span className="block text-[8px] font-bold text-[#86868B] uppercase tracking-wider mb-0.5">Şikayet Özeti</span>
                  <p className="text-[10px] font-semibold text-[#1D1D1F] line-clamp-1 leading-snug">
                    {crmData.formFields?.formComplaint || rawObj?.complaint || rawObj?.sikayet}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase 6: AI Activity Timeline */}
        <AiTimelinePanel phoneNumber={activeContact.id} />
      </div>

      {/* Save Button — Only shown in dirty states to optimize dikey alan */}
      {isDirty && (
        <div className="p-3 mt-auto q-glass-strong border-t animate-fade-in" style={{ borderColor: "var(--q-border-default)" }}>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full py-2 rounded-xl text-[12px] font-bold transition-all duration-200 flex items-center justify-center gap-1.5 shadow-md cursor-pointer disabled:opacity-70 q-press text-white"
            style={{
              background: saveStatus === "saved" ? "var(--q-green)" : saveStatus === "error" ? "var(--q-red)" : "var(--q-text-primary)",
            }}
          >
            {saveStatus === "saving" ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Kaydediliyor...</>
            ) : saveStatus === "saved" ? (
              <><Check className="w-3.5 h-3.5" /> Kaydedildi!</>
            ) : saveStatus === "error" ? (
              <><X className="w-3.5 h-3.5" /> Hata oluştu</>
            ) : (
              <><Save className="w-3.5 h-3.5" /> Değişiklikleri Kaydet</>
            )}
          </button>
        </div>
      )}

      {/* Modals removed and integrated to global InboxModalContainer */}
    </div>
  );
}
