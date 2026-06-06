"use client";

import { useState, useEffect } from "react";
import { useSWRConfig } from "swr";
import { User, MapPin, Building, Activity, Tag, ChevronDown, ChevronRight, Save, X, Plus, ChevronLeft, Check, Loader2, Sparkles, FileText, Brain, Link, Clock, Moon, Calendar, CalendarClock, PhoneForwarded, MailPlus, Share2 } from "lucide-react";
import { useInboxStore } from "@/store/inbox-store";
import { updateCrmData, addTag, removeTag, prepareFollowUpDraft, sendApprovedFollowUp, checkSecondaryFallback, prepareSecondaryDraft, checkFormGreetingEligibility, prepareFormGreetingDraft } from "@/app/actions/inbox";
import { CustomerAiBrainPanel } from "@/components/features/ai-observability/CustomerAiBrain";
import { AiTimelinePanel } from "@/components/features/ai-observability/AiTimeline";
import { resolvePatientDisplayName, formatPhoneReadable } from "@/lib/utils/patient-name-resolver";
import { normalizeCountry } from "@/lib/utils/country-normalizer";
import { extractFromPatientMessageDeterministic } from "@/lib/utils/patient-message-extractor";
import { resolveDepartmentWithConflict } from "@/lib/utils/crm-conflict-resolver";
import { resolvePatientTimeDisplay } from "@/lib/utils/timezone";
import { useParams } from "next/navigation";
import { resolveUniversalAISummary, getTenantEntityType } from "@/lib/utils/universal-summary-resolver";
import { UniversalAISummaryCard } from "@/components/features/takip/universal-ai-summary-card";
import { useTenant } from "@/components/providers/tenant-provider";
import { PatientFormModal } from "./patient-form-modal";
import { PhoneCallModal } from "./phone-call-modal";
import { AppointmentModal } from "./appointment-modal";
import { useQueryClient } from "@tanstack/react-query";
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
  const { activeContact, mobileView, setMobileView, isSidebarCollapsed } = useInboxStore();
  const params = useParams();
  const tenantSlug = typeof params?.tenant_slug === 'string' ? params.tenant_slug : 'baskent';
  const { tenant } = useTenant();
  const entityType = getTenantEntityType(tenantSlug, tenant?.profile?.industry);
  const [formOpen, setFormOpen] = useState(false);
  const [aiSummaryOpen, setAiSummaryOpen] = useState(true);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isPhoneCallModalOpen, setIsPhoneCallModalOpen] = useState(false);
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const oppId = activeContact?.active_opp_id || activeContact?.active_opportunity_id || activeContact?.opportunity_id || "";

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
    }
  }, [contactId, contactDept, contactCountry, contactNotes, contactStage, activeContact?.opp_requester_name, activeContact?.opp_patient_name, activeContact?.patient_name]);

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
  if (activeContact?.formData?.raw) {
    try {
      rawObj = typeof activeContact.formData.raw === "string" ? JSON.parse(activeContact.formData.raw) : activeContact.formData.raw;
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
  } else if (activeContact?.form_raw_data) {
    try {
      rawObj = typeof activeContact.form_raw_data === "string" ? JSON.parse(activeContact.form_raw_data) : activeContact.form_raw_data;
      campaignName = rawObj.campaign_name || rawObj.campaignName || rawObj.utm_campaign || rawObj.utmCampaign || null;
    } catch (_) {}
  }

  // Compute recommendations
  const msgExt = activeContact?.last_message ? extractFromPatientMessageDeterministic(activeContact.last_message) : null;
  const isDeptLocked = activeContact?.opp_metadata?.department_locked === true;
  
  const resolvedDeptObj = resolveDepartmentWithConflict({
    existingDept: department || null,
    formCampaignDept: activeContact?.formDepartmentSource === 'campaign_name' || activeContact?.formDepartmentSource === 'form_name' ? activeContact.formDepartment : null,
    formCampaignConfidence: activeContact?.formDepartmentSource === 'campaign_name' || activeContact?.formDepartmentSource === 'form_name' ? 1.0 : 0.0,
    formComplaintDept: activeContact?.formDepartmentSource === 'complaint_keyword' ? activeContact.formDepartment : null,
    formComplaintConfidence: activeContact?.formDepartmentSource === 'complaint_keyword' ? 1.0 : 0.0,
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
  const contactRawObj = activeContact.formData?.raw || activeContact.form_raw_data;
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

      {/* Profile Card */}
      <div className="p-6 flex flex-col items-center text-center" style={{ borderBottom: "1px solid var(--q-border-default)" }}>
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
              className="w-20 h-20 rounded-full flex items-center justify-center mb-4 shadow-md text-xl font-bold select-none transition-transform duration-300 hover:scale-105"
              style={{ background: avatar.bg, color: avatar.text }}
            >
              {initials}
            </div>
          );
        })()}
        {isEditingName ? (
          <div className="flex items-center gap-2 justify-center w-full max-w-[220px]">
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
              className="text-center font-bold text-[15px] px-2 py-1 rounded-lg w-full outline-none"
              style={{ background: "var(--q-bg-hover)", border: "1px solid var(--q-blue)", color: "var(--q-text-primary)" }}
              autoFocus
            />
            <button
              onClick={() => setIsEditingName(false)}
              className="p-1 rounded-md transition-colors hover:bg-black/5 cursor-pointer flex-shrink-0"
              title="Tamam"
            >
              <Check className="w-4 h-4" style={{ color: "var(--q-green)" }} />
            </button>
          </div>
        ) : (
          <div 
            onClick={() => setIsEditingName(true)}
            className="group flex items-center gap-1.5 justify-center cursor-pointer rounded-lg px-2.5 py-0.5 hover:bg-black/[0.04] transition-all"
            title="İsmi düzenlemek için tıklayın"
          >
            <h2 className="text-lg font-bold tracking-tight" style={{ color: "var(--q-text-primary)" }}>
              {patientName || "İsimsiz"}
            </h2>
            <Sparkles className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: "var(--q-blue)" }} />
          </div>
        )}
        <p className="text-[11px] text-[#86868B] font-semibold mt-1">
          {formatPhoneReadable(activeContact.id)}
        </p>

        <div className="flex items-center gap-2 mt-3 w-full justify-center">
          <div className="relative group">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <MapPin className="w-3.5 h-3.5" style={{ color: "var(--q-blue)" }} />
            </div>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="pl-8 pr-6 py-1.5 rounded-full text-xs font-semibold outline-none transition-all appearance-none cursor-pointer"
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
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <ChevronDown className="w-3 h-3" style={{ color: "var(--q-text-secondary)" }} />
            </div>
          </div>

          {(() => {
            const countryNormal = normalizeCountry(activeContact?.country || activeContact?.opp_country, activeContact?.id || activeContact?.phone_number);
            return countryNormal.countryConfirmationNeeded ? (
              <div className="text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200" title="Ülke doğruluğundan emin olun. Teyit gerekebilir.">
                Teyit Gerekli
              </div>
            ) : null;
          })()}

          {localTime && (
            <div 
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all duration-300 ${
                isSleeping 
                  ? "bg-slate-900/5 text-slate-700 border-slate-200" 
                  : "bg-indigo-50 text-indigo-600 border-indigo-100"
              }`}
              title={isSleeping ? "Hasta uyku saatinde (22:00 - 08:00)" : "Hasta aktif saatte"}
            >
              {isSleeping ? (
                <Moon className="w-3.5 h-3.5 text-slate-500 animate-pulse" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-indigo-500" />
              )}
              <span>{localTime}</span>
            </div>
          )}
        </div>

        {/* Multi-phone list */}
        <div className="w-full text-left mt-4 px-3.5 py-3 rounded-2xl border bg-white/40 space-y-2.5" style={{ borderColor: "var(--q-border-default)" }}>
          <span className="block text-[10px] font-bold uppercase tracking-widest text-[#86868B] mb-1 px-0.5">Telefon Numaraları</span>
          {allPhones.map((phone, idx) => {
            const isPrimary = idx === 0;
            const isActive = phone === activePhone;
            return (
              <div key={phone} className="flex items-center justify-between px-0.5 text-xs">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-transparent border border-black/30'}`} />
                  <span className="font-semibold text-[13px]" style={{ color: "var(--q-text-primary)" }}>
                    {formatPhoneReadable(phone)}
                  </span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
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
          <div className="w-full mt-3 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold text-left flex items-start gap-2 shadow-sm">
            <span className="text-amber-500 font-bold shrink-0">⚠️</span>
            <p className="leading-snug">Bu konuşma formdaki ikincil numara üzerinden yürütülüyor.</p>
          </div>
        )}

        {/* Task-based Action Required Deep Link Card */}
        {activeContact.active_task_type && (
          <div className="w-full mt-3 p-3.5 rounded-xl border space-y-2.5 text-left bg-indigo-50/30 shadow-sm" style={{ borderColor: 'var(--q-blue)' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-700">Aksiyon Gerekli</span>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded shadow-sm bg-indigo-100 text-indigo-700">
                Bekliyor
              </span>
            </div>
            
            <p className="text-xs font-semibold text-gray-700 leading-snug">
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
                    className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm"
                  >
                    <PhoneForwarded className="w-3.5 h-3.5" />
                    <span>Telefon Takibinde Aç</span>
                  </a>
                );
              }

              // All other tasks (including isAppointmentTask or unknown fallbacks)
              return (
                <a
                  href={`/${tenantSlug}/takip?tab=randevu&opp=${oppId}`}
                  className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Randevu Yönetiminde Aç</span>
                </a>
              );
            })()}
          </div>
        )}

        {/* A1.7b — Secondary Phone Fallback Section */}
        {allPhones.length >= 2 && !isSecondaryActive && (
          <div className="w-full mt-3 p-3.5 rounded-xl border space-y-2.5 bg-white/40 text-left" style={{ borderColor: 'var(--q-border-default)' }}>
            <div className="flex items-center gap-2">
              <PhoneForwarded className="w-4 h-4 text-amber-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700">İkincil Numara Fallback</span>
            </div>

            {secondaryError && (
              <div className="text-[11px] font-semibold text-red-600 bg-red-50 border border-red-100 rounded-lg p-2 leading-snug">
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
                className="w-full py-2 px-3 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-700 text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCheckingSecondary ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /><span>Kontrol Ediliyor...</span></>
                ) : (
                  <><PhoneForwarded className="w-3 h-3" /><span>İkincil Numara Uygunluğunu Kontrol Et</span></>
                )}
              </button>
            ) : secondaryEligibility?.eligible && !secondaryDraftData ? (
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-amber-800 bg-amber-50/80 border border-amber-200 rounded-lg p-2.5 leading-snug">
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
                  className="w-full py-2 px-3 bg-amber-100 border border-amber-300 hover:bg-amber-200 text-amber-800 text-[11px] font-bold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
                >
                  {isLoadingSecondaryDraft ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /><span>Taslak Hazırlanıyor...</span></>
                  ) : (
                    <><Sparkles className="w-3 h-3" /><span>İkincil Numara Taslağı Hazırla</span></>
                  )}
                </button>
              </div>
            ) : secondaryDraftData ? (
              <div className="space-y-2.5">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="font-bold text-amber-700 uppercase tracking-wider">Taslak Önizleme</span>
                  <span className={`px-2 py-0.5 rounded-full font-bold ${
                    secondaryDraftData.windowOpen ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {secondaryDraftData.windowOpen ? '24s Açık' : '24s Kapalı — Şablon Gerekli'}
                  </span>
                </div>
                {!secondaryDraftData.windowOpen && (
                  <div className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 leading-snug">
                    ⚠️ İkincil numara için 24 saatlik WhatsApp penceresi kapalı. Onaylı şablon gönderimi bu fazda devre dışıdır.
                  </div>
                )}
                <div className="text-[12px] font-medium text-gray-700 bg-white border border-gray-200 rounded-lg p-2.5 leading-relaxed">
                  {secondaryDraftData.draft}
                </div>
                <button
                  onClick={() => setSecondaryDraftData(null)}
                  className="w-full py-1.5 px-3 border border-gray-200 hover:bg-gray-50 text-gray-600 text-[11px] font-bold rounded-lg cursor-pointer transition-all"
                >
                  Kapat
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Quick Action Grid Cards */}
        <div className="grid grid-cols-3 gap-2 mt-4 w-full pt-3 border-t border-black/5">
          <button
            type="button"
            onClick={() => setIsPhoneCallModalOpen(true)}
            className="flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            style={{
              backgroundColor: "rgba(88, 86, 214, 0.04)",
              borderColor: "rgba(88, 86, 214, 0.12)",
              color: "#5856D6"
            }}
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center mb-1.5 transition-all duration-200 group-hover:scale-110"
                 style={{ backgroundColor: "rgba(88, 86, 214, 0.08)" }}>
              <Phone className="w-3.5 h-3.5" />
            </div>
            <span className="text-[10px] font-bold tracking-tight">Arama Planla</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAppointmentModalOpen(true)}
            className="flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            style={{
              backgroundColor: "rgba(52, 199, 89, 0.04)",
              borderColor: "rgba(52, 199, 89, 0.12)",
              color: "#34C759"
            }}
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center mb-1.5 transition-all duration-200 group-hover:scale-110"
                 style={{ backgroundColor: "rgba(52, 199, 89, 0.08)" }}>
              <CalendarClock className="w-3.5 h-3.5" />
            </div>
            <span className="text-[10px] font-bold tracking-tight leading-tight">Randevu Planla</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFormModalOpen(true)}
            className="flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            style={{
              backgroundColor: "rgba(255, 149, 0, 0.04)",
              borderColor: "rgba(255, 149, 0, 0.12)",
              color: "#FF9500"
            }}
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center mb-1.5 transition-all duration-200 group-hover:scale-110"
                 style={{ backgroundColor: "rgba(255, 149, 0, 0.08)" }}>
              <FileText className="w-3.5 h-3.5" />
            </div>
            <span className="text-[10px] font-bold tracking-tight">Form Detayı</span>
          </button>
        </div>
      </div>

      <div className="p-5 space-y-7 flex-1">
        {/* CRM Bilgileri Card */}
        <div className="p-5 rounded-2xl border bg-white/40 space-y-5 shadow-sm text-left" style={{ borderColor: "var(--q-border-default)" }}>
          <div className="flex items-center justify-between pb-2 border-b border-black/[0.03]">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#86868B]">CRM Bilgileri</span>
            <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full uppercase tracking-wider">Manuel Takip</span>
          </div>

          {/* Stage/Durum */}
          <div className="space-y-1.5 text-left">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] ml-1">Durum / Aşama</label>
            <div className="relative">
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-[13px] font-semibold outline-none transition-all appearance-none cursor-pointer bg-white/60 border hover:border-indigo-500/30"
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
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <ChevronDown className="w-4 h-4 text-[#86868B]" />
              </div>
            </div>
          </div>

          {/* Department/Bölüm */}
          <div className="space-y-1.5 text-left">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] ml-1">Bölüm / Departman</label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <Building className="w-4 h-4 text-indigo-500/80" />
              </div>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 rounded-xl text-[13px] font-semibold outline-none transition-all appearance-none cursor-pointer bg-white/60 border hover:border-indigo-500/30"
                style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-primary)", boxShadow: "var(--q-shadow-sm)" }}
              >
                <option value="">Belirtilmemiş</option>
                {["Ortopedi", "Kardiyoloji", "Gastroenteroloji", "Estetik", "Diş", "Diş Estetiği", "Göz", "Tüp Bebek", "Organ Nakli", "Onkoloji", "Obezite", "Nöroloji", "Üroloji", "Dermatoloji", "Genel Cerrahi", "Beyin Cerrahi", "KBB", "Göğüs Hastalıkları", "Endokrinoloji", "Fizik Tedavi", "Çocuk Sağlığı", "Kadın Doğum", "Psikiyatri", "Check-Up"].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <ChevronDown className="w-4 h-4 text-[#86868B]" />
              </div>
            </div>

            {suggestedDept && (
              <div className="mt-2.5 flex flex-col gap-2 p-3 rounded-xl border transition-all duration-200"
                   style={{ 
                     backgroundColor: hasConflict ? "rgba(255, 149, 0, 0.04)" : suggestedConfidence === 'medium' ? "rgba(255, 149, 0, 0.04)" : "rgba(175, 82, 222, 0.04)", 
                     borderColor: hasConflict ? "rgba(255, 149, 0, 0.25)" : suggestedConfidence === 'medium' ? "rgba(255, 149, 0, 0.15)" : "rgba(175, 82, 222, 0.15)" 
                   }}>
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 shrink-0 animate-pulse" style={{ color: hasConflict || suggestedConfidence === 'medium' ? "#FF9500" : "#AF52DE" }} />
                    <div className="flex flex-col text-left">
                      <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: hasConflict || suggestedConfidence === 'medium' ? "#FF9500" : "#AF52DE" }}>
                        Önerilen Bölüm
                      </span>
                      <span className="text-[12px] font-semibold text-[#1D1D1F]">
                        {suggestedDept} {hasConflict ? "— Çakışma Var" : suggestedConfidence === 'medium' ? "— Teyit Edin" : ""}
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
                    className="px-2.5 py-1 text-[10px] font-bold rounded-lg cursor-pointer bg-white border transition-all hover:scale-[1.02]"
                    style={{ 
                      color: hasConflict || suggestedConfidence === 'medium' ? "#FF9500" : "#AF52DE",
                      borderColor: hasConflict || suggestedConfidence === 'medium' ? "rgba(255, 149, 0, 0.2)" : "rgba(175, 82, 222, 0.2)"
                    }}
                  >
                    Onayla
                  </button>
                </div>
                {hasConflict && conflictReason && (
                  <span className="text-[10px] font-semibold leading-relaxed text-left pt-1.5 block" style={{ color: "#FF9500", borderTop: "1px solid rgba(255, 149, 0, 0.15)" }}>
                    ⚠️ {conflictReason}
                  </span>
                )}
                {suggestedSource === 'patient_message' && activeContact.last_message && (
                  <span className="text-[10px] font-semibold leading-relaxed text-left block text-[#86868B]">
                    Kaynak: Hasta mesajı — "{activeContact.last_message}"
                  </span>
                )}
              </div>
            )}
          </div>

          {/* AI Summary Card */}
          {(() => {
            const summaryInput = {
              oppSummary: activeContact?.opp_summary,
              oppAiReason: activeContact?.opp_ai_reason,
              legacyAiSummary: activeContact?.legacy_ai_summary,
              priority: activeContact?.opp_priority || activeContact?.priority,
              updatedAt: activeContact?.last_message_at
            };
            const resolvedSummary = resolveUniversalAISummary(
              summaryInput,
              entityType,
              patientName
            );
            return <UniversalAISummaryCard summary={resolvedSummary} className="pt-1" />;
          })()}

          {/* Notes */}
          <div className="space-y-1.5 text-left pt-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] ml-1">
              {entityType === 'patient' ? '✍️ Koordinatör Notları' : '✍️ Manuel Notlar'}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={entityType === 'patient' ? 'Hastayla ilgili manuel takip notları...' : 'Müşteriyle ilgili manuel notlar...'}
              className="w-full h-24 bg-white/60 border rounded-xl p-3 text-xs text-[#1D1D1F] placeholder:text-[#86868B] focus:ring-2 focus:ring-[#AF52DE]/20 resize-none outline-none transition-all shadow-sm focus:border-indigo-500/40"
              style={{ borderColor: "var(--q-border-default)" }}
            />
          </div>

          {/* Tags */}
          <div className="space-y-2 text-left pt-1">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] ml-1">Etiketler</label>
              {!isAddingTag && (
                <button
                  onClick={() => setIsAddingTag(true)}
                  className="transition-colors text-[10px] font-bold tracking-wide flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> EKLE
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {parsedTags.length > 0 ? (
                parsedTags.map((tag: string, i: number) => (
                  <span
                    key={i}
                    className="px-2.5 py-0.5 text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm group bg-indigo-50 text-indigo-600 border border-indigo-100"
                  >
                    <Tag className="w-3 h-3 text-indigo-400" /> {formatTag(tag)}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-indigo-100 transition-all text-indigo-400 hover:text-indigo-700"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))
              ) : (
                !isAddingTag && <span className="text-[11px] italic text-[#86868B]">Etiket eklenmemiş</span>
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
                    className="px-2 py-0.5 text-xs font-bold rounded-lg outline-none w-20 bg-white border border-indigo-300 focus:border-indigo-500 shadow-sm"
                  />
                </form>
              )}
            </div>
          </div>
        </div>

        {/* Form Geçmişi */}
        {activeContact.formData && (
          <div className="p-4 rounded-2xl border bg-white/40 space-y-3 shadow-sm text-left" style={{ borderColor: "var(--q-border-default)" }}>
            <div className="flex items-center justify-between pb-1 border-b border-black/[0.03]">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#86868B]">Form Geçmişi</span>
              <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5">1 Form</span>
            </div>
            
            <div 
              onClick={() => setIsFormModalOpen(true)}
              className="p-3 rounded-xl text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer hover:bg-white bg-white/50 border border-black/5 shadow-sm space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-[#1D1D1F] line-clamp-1">
                  {activeContact.formData.name || "Estetik ve Tedavi Formu"}
                </span>
                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5 shrink-0">
                  Detayları Gör
                </span>
              </div>
              
              <div className="flex items-center gap-3 text-[10px] text-[#86868B] font-semibold">
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-indigo-400" />
                  <span>{activeContact.formData.date || "Belirtilmemiş"}</span>
                </div>
                {campaignName && (
                  <div className="flex items-center gap-1 max-w-[150px]">
                    <Share2 className="w-3 h-3 text-indigo-400 shrink-0" />
                    <span className="truncate">{campaignName}</span>
                  </div>
                )}
              </div>

              {(activeContact.formComplaint || rawObj?.complaint || rawObj?.sikayet) && (
                <div className="pt-2 border-t border-black/[0.03]">
                  <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-0.5">Şikayet Özeti</span>
                  <p className="text-[11px] font-semibold text-[#1D1D1F] line-clamp-2 leading-relaxed">
                    {activeContact.formComplaint || rawObj?.complaint || rawObj?.sikayet}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase 6: AI Activity Timeline */}
        <AiTimelinePanel phoneNumber={activeContact.id} />
      </div>

      {/* Save Button — Governance-compliant lifecycle */}
      <div className="p-5 mt-auto q-glass-strong" style={{ borderTop: "1px solid var(--q-border-default)" }}>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full py-3 rounded-xl text-[14px] font-bold transition-all duration-200 flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-70 disabled:hover:scale-100 q-press"
          style={{
            background: saveStatus === "saved" ? "var(--q-green)" : saveStatus === "error" ? "var(--q-red)" : "var(--q-text-primary)",
            color: "white",
          }}
        >
          {saveStatus === "saving" ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Kaydediliyor...</>
          ) : saveStatus === "saved" ? (
            <><Check className="w-4 h-4" /> Kaydedildi!</>
          ) : saveStatus === "error" ? (
            <><X className="w-4 h-4" /> Hata oluştu</>
          ) : (
            <><Save className="w-4 h-4" /> Değişiklikleri Kaydet</>
          )}
        </button>
      </div>

      {/* Form Details Popup Modal */}
      {activeContact.formData && (
        <PatientFormModal 
          isOpen={isFormModalOpen}
          onClose={() => setIsFormModalOpen(false)}
          formData={{
            name: activeContact.formData?.name || activeContact.formData?.form_name || "İsimsiz Form",
            date: activeContact.formData?.date || activeContact.formData?.created_time,
            raw: activeContact.formData?.raw || activeContact.form_raw_data,
            formComplaint: activeContact.formComplaint || activeContact.formData?.formComplaint,
            formReportStatus: activeContact.formReportStatus || activeContact.formData?.formReportStatus,
            formAppointmentPref: activeContact.formAppointmentPref || activeContact.formData?.formAppointmentPref,
            formAge: activeContact.formAge || activeContact.formData?.formAge
          }}
          patientName={patientName}
        />
      )}

      {/* Phone Call Planning Modal */}
      {oppId && (
        <PhoneCallModal
          isOpen={isPhoneCallModalOpen}
          onClose={() => setIsPhoneCallModalOpen(false)}
          opportunityId={oppId}
          tenantSlug={tenantSlug}
          patientName={patientName}
          phoneNumber={activeContact.id}
          onSuccess={handleModalSuccess}
        />
      )}

      {/* Appointment Planning Modal */}
      {oppId && (
        <AppointmentModal
          isOpen={isAppointmentModalOpen}
          onClose={() => setIsAppointmentModalOpen(false)}
          opportunityId={oppId}
          tenantSlug={tenantSlug}
          patientName={patientName}
          phoneNumber={activeContact.id}
          onSuccess={handleModalSuccess}
        />
      )}
    </div>
  );
}
