"use client";

import { useState, useEffect } from "react";
import { useSWRConfig } from "swr";
import { User, MapPin, Building, Activity, Tag, ChevronDown, ChevronRight, Save, X, Plus, ChevronLeft, Check, Loader2, Sparkles, FileText, Brain, Link, Clock, Moon, Calendar, CalendarClock } from "lucide-react";
import { useInboxStore } from "@/store/inbox-store";
import { updateCrmData, addTag, removeTag } from "@/app/actions/inbox";
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
  const { activeContact, mobileView, setMobileView } = useInboxStore();
  const params = useParams();
  const tenantSlug = typeof params?.tenant_slug === 'string' ? params.tenant_slug : 'baskent';
  const { tenant } = useTenant();
  const entityType = getTenantEntityType(tenantSlug, tenant?.profile?.industry);
  const [formOpen, setFormOpen] = useState(false);
  const [aiSummaryOpen, setAiSummaryOpen] = useState(true);
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
        className="w-[340px] h-full z-10 hidden lg:block q-glass"
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
  if (activeContact?.formData?.raw) {
    try {
      const rawObj = typeof activeContact.formData.raw === "string" ? JSON.parse(activeContact.formData.raw) : activeContact.formData.raw;
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
      const rawObj = typeof activeContact.form_raw_data === "string" ? JSON.parse(activeContact.form_raw_data) : activeContact.form_raw_data;
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
  const rawObj = activeContact.formData?.raw || activeContact.form_raw_data;
  if (rawObj) {
    try {
      const parsedRaw = typeof rawObj === "string" ? JSON.parse(rawObj) : rawObj;
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
      className={`w-full lg:w-[340px] h-full flex-col overflow-y-auto z-10 q-glass shadow-sm ${mobileView === "crm" ? "flex absolute inset-0 lg:relative" : "hidden lg:flex"}`}
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
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4 shadow-sm" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.8)" }}>
          <User className="w-10 h-10 opacity-50" style={{ color: "var(--q-text-secondary)" }} />
        </div>
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

        {/* Quick Action Grid Cards */}
        <div className="grid grid-cols-3 gap-2 mt-4 w-full pt-3 border-t border-black/5">
          <a
            href={`./takip?opp=${activeContact.active_opp_id || activeContact.active_opportunity_id || activeContact.opportunity_id || ''}`}
            className="flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98]"
            style={{
              backgroundColor: "rgba(88, 86, 214, 0.04)",
              borderColor: "rgba(88, 86, 214, 0.12)",
              color: "#5856D6"
            }}
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center mb-1.5 transition-all duration-200 group-hover:scale-110"
                 style={{ backgroundColor: "rgba(88, 86, 214, 0.08)" }}>
              <Activity className="w-3.5 h-3.5" />
            </div>
            <span className="text-[10px] font-bold tracking-tight">Takipte Aç</span>
          </a>

          <a
            href={`./takip?opp=${activeContact.active_opp_id || activeContact.active_opportunity_id || activeContact.opportunity_id || ''}&tab=randevu&drawerTab=appointment`}
            className="flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98]"
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
            <span className="text-[10px] font-bold tracking-tight leading-tight">Randevu<br/>Planla</span>
          </a>

          <a
            href={`./forms?phone=${activeContact.id}`}
            className="flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all duration-200 group hover:scale-[1.02] active:scale-[0.98]"
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
            <span className="text-[10px] font-bold tracking-tight">Formlarda Aç</span>
          </a>
        </div>
      </div>

      <div className="p-5 space-y-7 flex-1">
        {/* Core CRM Data */}
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest mb-1.5 block ml-1" style={{ color: "var(--q-text-secondary)" }}>
              Bölüm / Departman
            </label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
                <Building className="w-4 h-4 opacity-80" style={{ color: "var(--q-blue)" }} />
              </div>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 rounded-xl text-[14px] font-semibold outline-none transition-all appearance-none cursor-pointer"
                style={{ background: "rgba(255,255,255,0.6)", border: "1px solid var(--q-border-default)", color: "var(--q-text-primary)", boxShadow: "var(--q-shadow-sm)" }}
              >
                <option value="">Belirtilmemiş</option>
                {["Ortopedi", "Kardiyoloji", "Gastroenteroloji", "Estetik", "Diş", "Diş Estetiği", "Göz", "Tüp Bebek", "Organ Nakli", "Onkoloji", "Obezite", "Nöroloji", "Üroloji", "Dermatoloji", "Genel Cerrahi", "Beyin Cerrahi", "KBB", "Göğüs Hastalıkları", "Endokrinoloji", "Fizik Tedavi", "Çocuk Sağlığı", "Kadın Doğum", "Psikiyatri", "Check-Up"].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            {suggestedDept && (
              <div className="mt-2.5 flex flex-col gap-2.5 p-3.5 rounded-xl border transition-all duration-200"
                   style={{ 
                     backgroundColor: hasConflict ? "rgba(255, 149, 0, 0.04)" : suggestedConfidence === 'medium' ? "rgba(255, 149, 0, 0.04)" : "rgba(175, 82, 222, 0.04)", 
                     borderColor: hasConflict ? "rgba(255, 149, 0, 0.25)" : suggestedConfidence === 'medium' ? "rgba(255, 149, 0, 0.15)" : "rgba(175, 82, 222, 0.15)" 
                   }}>
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 shrink-0 animate-pulse" style={{ color: hasConflict || suggestedConfidence === 'medium' ? "#FF9500" : "#AF52DE" }} />
                    <div className="flex flex-col text-left">
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: hasConflict || suggestedConfidence === 'medium' ? "#FF9500" : "#AF52DE" }}>
                        Önerilen Bölüm
                      </span>
                      <span className="text-[13px] font-semibold" style={{ color: "var(--q-text-primary)" }}>
                        {suggestedDept} {hasConflict ? "— Çakışma Var" : suggestedConfidence === 'medium' ? "— Teyit Edin" : ""}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setDepartment(suggestedDept!);
                      // Automatically trigger manual save to DB + set locks
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
                    className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg cursor-pointer bg-white border transition-all hover:scale-[1.02]"
                    style={{ 
                      color: hasConflict || suggestedConfidence === 'medium' ? "#FF9500" : "#AF52DE",
                      borderColor: hasConflict || suggestedConfidence === 'medium' ? "rgba(255, 149, 0, 0.2)" : "rgba(175, 82, 222, 0.2)"
                    }}
                  >
                    Onayla
                  </button>
                </div>
                {hasConflict && conflictReason && (
                  <span className="text-[11px] font-semibold leading-relaxed text-left pt-1.5 block" style={{ color: "#FF9500", borderTop: "1px solid rgba(255, 149, 0, 0.15)" }}>
                    ⚠️ {conflictReason}
                  </span>
                )}
                {suggestedSource === 'patient_message' && activeContact.last_message && (
                  <span className="text-[11px] font-semibold leading-relaxed text-left block" style={{ color: "var(--q-text-secondary)" }}>
                    Kaynak: Hasta mesajı — "{activeContact.last_message}"
                  </span>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest mb-1.5 block ml-1" style={{ color: "var(--q-text-secondary)" }}>
              Durum
            </label>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-[14px] font-semibold outline-none transition-all appearance-none cursor-pointer"
              style={{ background: "rgba(255,255,255,0.6)", border: "1px solid var(--q-border-default)", color: "var(--q-text-primary)", boxShadow: "var(--q-shadow-sm)" }}
            >
              <option value="new">Yeni Lead</option>
              <option value="contacted">İletişime Geçildi</option>
              <option value="responded">Yanıt Alındı</option>
              <option value="discovery">Keşif / Analiz</option>
              <option value="qualified">Nitelikli</option>
              <option value="appointed">Randevu Aldı</option>
              <option value="lost">Kaybedildi</option>
              {/* Opportunity-system fallback values (shown only if data has opp-stage) */}
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
          </div>

          {/* Universal AI Summary & Opportunity Reason Card */}
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
            return <UniversalAISummaryCard summary={resolvedSummary} className="pt-2" />;
          })()}

          {/* Manuel Notlar Textarea */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-1.5 ml-1">
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold uppercase tracking-widest block" style={{ color: "var(--q-text-secondary)" }}>
                  {entityType === 'patient' ? '✍️ Koordinatör Notları' : '✍️ Manuel Notlar'}
                </label>
              </div>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={entityType === 'patient' ? 'Hastayla ilgili manuel takip notları...' : 'Müşteriyle ilgili manuel notlar...'}
              className="w-full h-32 bg-white/60 border border-black/5 rounded-xl p-3 text-sm text-[#1D1D1F] placeholder:text-[#86868B] focus:ring-2 focus:ring-[#AF52DE]/30 resize-none outline-none transition-all shadow-sm focus:border-[#AF52DE]/40"
              style={{ border: "1px solid var(--q-border-default)" }}
            />
          </div>
        </div>

        {/* Tags */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-bold uppercase tracking-widest ml-1" style={{ color: "var(--q-text-secondary)" }}>
              Etiketler
            </label>
            {!isAddingTag && (
              <button
                onClick={() => setIsAddingTag(true)}
                className="transition-colors text-[11px] font-bold tracking-wide flex items-center gap-0.5 q-press"
                style={{ color: "var(--q-blue)" }}
              >
                <Plus className="w-3 h-3" /> EKLE
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {parsedTags.length > 0 ? (
              parsedTags.map((tag: string, i: number) => (
                <span
                  key={i}
                  className="px-3 py-1 text-xs font-bold rounded-lg flex items-center gap-1 shadow-sm group"
                  style={{ background: "var(--q-blue-bg)", color: "var(--q-blue)", border: "1px solid rgba(0,122,255,0.2)" }}
                >
                  <Tag className="w-3 h-3" /> {formatTag(tag)}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-1 w-3.5 h-3.5 rounded-full flex items-center justify-center opacity-50 hover:opacity-100 transition-all"
                    style={{ background: "var(--q-blue-bg)" }}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))
            ) : (
              !isAddingTag && <span className="text-xs" style={{ color: "var(--q-text-secondary)" }}>Etiket yok</span>
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
                  className="px-3 py-1 text-xs font-bold rounded-lg outline-none w-24"
                  style={{ background: "var(--q-bg-primary)", color: "var(--q-text-primary)", border: "1px solid rgba(0,122,255,0.3)", boxShadow: "var(--q-shadow-sm)" }}
                />
              </form>
            )}
          </div>
        </div>

        {/* Form Bilgileri */}
        {activeContact.formData && (
          <div className="pt-6" style={{ borderTop: "1px solid var(--q-border-default)" }}>
            <label className="text-[10px] font-bold uppercase tracking-widest mb-3 block ml-1" style={{ color: "var(--q-text-secondary)" }}>
              📋 Form Bilgileri
            </label>

            <div className="p-4 space-y-3.5 rounded-2xl text-left" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid var(--q-border-default)", boxShadow: "var(--q-shadow-sm)" }}>
              {activeContact.formComplaint && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--q-text-secondary)" }}>
                    Şikayet
                  </span>
                  <span className="text-[13px] font-semibold leading-relaxed" style={{ color: "var(--q-text-primary)" }}>
                    {activeContact.formComplaint}
                  </span>
                </div>
              )}

              {activeContact.formReportStatus && activeContact.formReportStatus !== 'none' && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--q-text-secondary)" }}>
                    MR / Röntgen Raporu
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg" 
                        style={{ 
                          backgroundColor: activeContact.formReportStatus === 'sent' ? "rgba(52, 199, 89, 0.08)" : "rgba(255, 149, 0, 0.08)",
                          color: activeContact.formReportStatus === 'sent' ? "#34C759" : "#FF9500"
                        }}>
                    {activeContact.formReportStatus === 'sent' ? 'Gönderildi' : activeContact.formReportStatus === 'waiting' ? 'Bekliyor' : activeContact.formReportStatus}
                  </span>
                </div>
              )}

              {activeContact.formAppointmentPref && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--q-text-secondary)" }}>
                    Randevu Tercihi
                  </span>
                  <span className="text-[13px] font-semibold leading-relaxed" style={{ color: "var(--q-text-primary)" }}>
                    {activeContact.formAppointmentPref}
                  </span>
                </div>
              )}

              {activeContact.formAge && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--q-text-secondary)" }}>
                    Yaş
                  </span>
                  <span className="text-[13px] font-semibold" style={{ color: "var(--q-text-primary)" }}>
                    {activeContact.formAge}
                  </span>
                </div>
              )}

              {campaignName && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--q-text-secondary)" }}>
                    Kampanya
                  </span>
                  <span className="text-[13px] font-semibold break-all" style={{ color: "var(--q-text-primary)" }}>
                    {campaignName}
                  </span>
                </div>
              )}

              {activeContact.formData.name && (
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--q-text-secondary)" }}>
                    Form Adı
                  </span>
                  <span className="text-[13px] font-semibold" style={{ color: "var(--q-text-primary)" }}>
                    {activeContact.formData.name}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Form History */}
        {activeContact.formData && (
          <div className="pt-6" style={{ borderTop: "1px solid var(--q-border-default)" }}>
            <label className="text-[10px] font-bold uppercase tracking-widest mb-3 block ml-1" style={{ color: "var(--q-text-secondary)" }}>
              Form Geçmişi
            </label>

            <div className="rounded-2xl overflow-hidden transition-all duration-300" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid var(--q-border-default)", boxShadow: "var(--q-shadow-sm)" }}>
              <button
                onClick={() => setFormOpen(!formOpen)}
                className="w-full px-4 py-3.5 flex items-center justify-between transition-colors cursor-pointer q-list-item"
              >
                <div className="flex flex-col items-start text-left">
                  <span className="text-[14px] font-bold line-clamp-1 pr-2" style={{ color: "var(--q-text-primary)" }}>
                    {activeContact.formData.name || "İsimsiz Form"}
                  </span>
                  <span className="text-[11px] mt-0.5 font-medium tracking-wide" style={{ color: "var(--q-text-secondary)" }}>
                    {activeContact.formData.date}
                  </span>
                </div>
                {formOpen ? (
                  <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "var(--q-text-secondary)" }} />
                ) : (
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--q-text-secondary)" }} />
                )}
              </button>

              {formOpen && formDataEntries.length > 0 && (
                <div className="px-4 pb-4 pt-1 space-y-3 max-h-[300px] overflow-y-auto" style={{ background: "rgba(255,255,255,0.4)", borderTop: "1px solid var(--q-border-default)" }}>
                  {formDataEntries.map((entry, idx) => (
                    <div key={idx} className="p-3 rounded-xl" style={{ background: "var(--q-bg-primary)", border: "1px solid var(--q-border-default)", boxShadow: "var(--q-shadow-sm)" }}>
                      <span className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--q-text-secondary)" }}>
                        {entry.key}
                      </span>
                      <span className="text-[13px] font-semibold leading-relaxed whitespace-pre-wrap" style={{ color: "var(--q-text-primary)" }}>
                        {entry.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {formOpen && formDataEntries.length === 0 && (
                <div className="px-4 pb-4 pt-1" style={{ background: "rgba(255,255,255,0.4)", borderTop: "1px solid var(--q-border-default)" }}>
                  <p className="text-xs text-center italic py-2" style={{ color: "var(--q-text-secondary)" }}>Detaylı yanıt bulunamadı.</p>
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
    </div>
  );
}
