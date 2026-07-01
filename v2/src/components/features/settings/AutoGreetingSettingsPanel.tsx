"use client";

import React, { useState, useEffect } from "react";
import { Bot, ShieldAlert, Check, RefreshCw, AlertCircle, Save, Info } from "lucide-react";

export interface ChannelSettings {
  auto_greeting_enabled: boolean;
  dry_run: boolean;
  template_name?: string;
  template_language?: string;
  template_text?: string;
  [key: string]: any;
}

export interface ChannelsConfig {
  [channelId: string]: ChannelSettings;
}

interface AutoGreetingSettingsPanelProps {
  channelsConfig?: ChannelsConfig;
  envLocks?: {
    phaseLockBlocked: boolean;
    globalDisabled: boolean;
    isTenantAllowed: boolean;
    dryRun: boolean;
    allowedTenants: string;
  };
  onSaveChannelConfig?: (channelId: string, settings: Partial<ChannelSettings>) => Promise<{ success: boolean; error?: string }>;
}

interface GreetingTemplate {
  id: string;
  name: string;
  language: string;
  body: string;
  isDefault?: boolean;
}

const DEFAULT_FORM_GREETING_TEMPLATE_NAME = "tr_form_karsilama_v1";
const DEFAULT_FORM_GREETING_TEMPLATE_LANGUAGE = "tr";
const DEFAULT_FORM_GREETING_TEMPLATE_TEXT =
  "Merhaba, ben Rüya. Başkent Üniversitesi Konya Hastanesi’nden sizinle iletişime geçiyorum.\n\nDoldurduğunuz form doğrultusunda sürecinizle ilgili size yardımcı olmak isteriz.\n\nMüsait olduğunuzda buradan bize dönüş yapabilirsiniz 🙏🏻";

function getEffectiveTemplateName(config: any) {
  return config?.template_name || config?.channels?.whatsapp?.template_name || DEFAULT_FORM_GREETING_TEMPLATE_NAME;
}

function getEffectiveTemplateLanguage(config: any) {
  return config?.template_language || config?.channels?.whatsapp?.template_language || DEFAULT_FORM_GREETING_TEMPLATE_LANGUAGE;
}

function getEffectiveTemplateText(config: any) {
  return config?.template_text || config?.channels?.whatsapp?.template_text || DEFAULT_FORM_GREETING_TEMPLATE_TEXT;
}

export function AutoGreetingSettingsPanel({
  channelsConfig: initialChannelsConfig,
  envLocks: initialEnvLocks,
  onSaveChannelConfig
}: AutoGreetingSettingsPanelProps) {
  // Config States
  const [formConfig, setFormConfig] = useState<any>({
    enabled: false,
    dry_run: true,
    rollout_percentage: 100,
    department_mode: "all",
    allowed_departments: [],
    template_name: DEFAULT_FORM_GREETING_TEMPLATE_NAME,
    template_language: DEFAULT_FORM_GREETING_TEMPLATE_LANGUAGE,
    template_text: DEFAULT_FORM_GREETING_TEMPLATE_TEXT
  });

  const [inboundConfig, setInboundConfig] = useState<any>({
    enabled: false,
    dry_run: true,
    rollout_percentage: 100,
    department_mode: "all",
    allowed_departments: []
  });

  const [envLocks, setEnvLocks] = useState<any>(initialEnvLocks || {
    phaseLockBlocked: true,
    globalDisabled: true,
    isTenantAllowed: false,
    dryRun: true,
    allowedTenants: ""
  });

  const [userRole, setUserRole] = useState<string>("viewer");
  const [tenantId, setTenantId] = useState<string>("");
  const [greetingTemplates, setGreetingTemplates] = useState<GreetingTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Input states for department tags
  const [formDeptInput, setFormDeptInput] = useState("");
  const [inboundDeptInput, setInboundDeptInput] = useState("");

  // Saving states
  const [savingForm, setSavingForm] = useState(false);
  const [savingInbound, setSavingInbound] = useState(false);
  const [successForm, setSuccessForm] = useState(false);
  const [successInbound, setSuccessInbound] = useState(false);

  // Double-confirm modal states
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<"form" | "inbound" | null>(null);
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1);

  // Check if live outbound is locked at environment level
  const isLiveOutboundLocked = 
    envLocks.phaseLockBlocked || 
    envLocks.globalDisabled || 
    !envLocks.isTenantAllowed || 
    envLocks.dryRun;

  const getLockReason = () => {
    const reasons = [];
    if (envLocks.phaseLockBlocked) reasons.push("Phase lock aktif (Outbound engelli)");
    if (envLocks.globalDisabled) reasons.push("Global disabled aktif (Bot engelli)");
    if (!envLocks.isTenantAllowed) reasons.push("Tenant allowlist dışı");
    if (envLocks.dryRun) reasons.push("Dry-run modu aktif (Simülasyon)");
    return reasons.length > 0 ? reasons.join(" / ") : "Kilit Yok";
  };

  const hasPermission = userRole === "owner" || userRole === "admin" || userRole === "platform_admin";

  // Load detailed configurations on mount
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setErrorText(null);
      try {
        const { getAutoGreetingSettingsAction } = await import("@/app/actions/settings");
        const res = await getAutoGreetingSettingsAction();
        if (res.success) {
          if (res.formAutopilotConfig) {
            setFormConfig(res.formAutopilotConfig);
          }
          if (res.inboundAutopilotConfig) {
            setInboundConfig(res.inboundAutopilotConfig);
          }
          if (res.envLocks) {
            setEnvLocks(res.envLocks);
          }
          if (res.userRole) {
            setUserRole(res.userRole);
          }
          if (res.tenantId) {
            setTenantId(res.tenantId);
          }
        } else {
          setErrorText(res.error || "Otopilot ayarları yüklenemedi.");
        }

        setTemplatesLoading(true);
        try {
          const { getGreetingTemplates } = await import("@/app/actions/outreach");
          const templates = await getGreetingTemplates();
          setGreetingTemplates(Array.isArray(templates) ? templates : []);
        } catch (templateErr) {
          console.warn("[SETTINGS_UI_TEMPLATES_LOAD_WARN]", templateErr);
          setGreetingTemplates([]);
        } finally {
          setTemplatesLoading(false);
        }
      } catch (err) {
        console.error("[SETTINGS_UI_LOAD_ERROR]", err);
        setErrorText("Otopilot ayarları sunucudan alınamadı.");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleAddDept = (target: "form" | "inbound") => {
    const input = target === "form" ? formDeptInput : inboundDeptInput;
    const clean = input.trim();
    if (!clean) return;

    if (target === "form") {
      if (!formConfig.allowed_departments.includes(clean)) {
        setFormConfig((prev: any) => ({
          ...prev,
          allowed_departments: [...prev.allowed_departments, clean]
        }));
      }
      setFormDeptInput("");
    } else {
      if (!inboundConfig.allowed_departments.includes(clean)) {
        setInboundConfig((prev: any) => ({
          ...prev,
          allowed_departments: [...prev.allowed_departments, clean]
        }));
      }
      setInboundDeptInput("");
    }
  };

  const handleRemoveDept = (target: "form" | "inbound", dept: string) => {
    if (target === "form") {
      setFormConfig((prev: any) => ({
        ...prev,
        allowed_departments: prev.allowed_departments.filter((d: string) => d !== dept)
      }));
    } else {
      setInboundConfig((prev: any) => ({
        ...prev,
        allowed_departments: prev.allowed_departments.filter((d: string) => d !== dept)
      }));
    }
  };

  const handleDeptModeSelect = (target: "form" | "inbound", mode: "all" | "selected") => {
    if (!hasPermission) return;
    if (mode === "all") {
      setConfirmTarget(target);
      setConfirmStep(1);
      setShowConfirmModal(true);
    } else {
      if (target === "form") {
        setFormConfig((prev: any) => ({ ...prev, department_mode: "selected" }));
      } else {
        setInboundConfig((prev: any) => ({ ...prev, department_mode: "selected" }));
      }
    }
  };

  const handleConfirmModal = () => {
    if (confirmStep === 1) {
      setConfirmStep(2);
    } else {
      // Step 2 approved
      if (confirmTarget === "form") {
        setFormConfig((prev: any) => ({ ...prev, department_mode: "all" }));
      } else {
        setInboundConfig((prev: any) => ({ ...prev, department_mode: "all" }));
      }
      setShowConfirmModal(false);
      setConfirmTarget(null);
    }
  };

  const handleCancelModal = () => {
    setShowConfirmModal(false);
    setConfirmTarget(null);
  };

  const handleSaveForm = async () => {
    if (!hasPermission) return;
    setSavingForm(true);
    setErrorText(null);
    setSuccessForm(false);
    try {
      const { saveFormAutopilotSettingsAction } = await import("@/app/actions/settings");
      const templateName = getEffectiveTemplateName(formConfig);
      const templateLanguage = getEffectiveTemplateLanguage(formConfig);
      const templateText = getEffectiveTemplateText(formConfig);
      const res = await saveFormAutopilotSettingsAction(tenantId, {
        enabled: formConfig.enabled,
        dry_run: formConfig.dry_run,
        rollout_percentage: 100,
        department_mode: "all",
        allowed_departments: [],
        template_name: templateName,
        template_language: templateLanguage,
        template_text: templateText
      });
      if (res.success) {
        setSuccessForm(true);
        setTimeout(() => setSuccessForm(false), 3000);
        // Also call onSaveChannelConfig for backward compatibility with pages that update parent layout
        if (onSaveChannelConfig) {
          await onSaveChannelConfig("whatsapp", {
            auto_greeting_enabled: formConfig.enabled,
            dry_run: formConfig.dry_run,
            template_name: templateName,
            template_language: templateLanguage,
            template_text: templateText
          });
        }
      } else {
        setErrorText(res.error || "Form ayarları kaydedilirken hata oluştu.");
      }
    } catch (err) {
      setErrorText("Bağlantı hatası veya yetkisiz işlem.");
    } finally {
      setSavingForm(false);
    }
  };

  const handleSaveInbound = async () => {
    if (!hasPermission) return;
    setSavingInbound(true);
    setErrorText(null);
    setSuccessInbound(false);
    try {
      const { saveInboundAutopilotSettingsAction } = await import("@/app/actions/settings");
      const res = await saveInboundAutopilotSettingsAction(tenantId, {
        enabled: inboundConfig.enabled,
        dry_run: inboundConfig.dry_run,
        rollout_percentage: 100,
        department_mode: "all",
        allowed_departments: []
      });
      if (res.success) {
        setSuccessInbound(true);
        setTimeout(() => setSuccessInbound(false), 3000);
      } else {
        setErrorText(res.error || "Gelen mesaj ayarları kaydedilirken hata oluştu.");
      }
    } catch (err) {
      setErrorText("Bağlantı hatası veya yetkisiz işlem.");
    } finally {
      setSavingInbound(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full bg-white border border-black/5 rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
        <span className="text-xs font-semibold text-slate-500">Ayarlar yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 text-left relative">
      
      {/* Upper permission indicator */}
      {!hasPermission && (
        <div className="p-3.5 bg-amber-500/[0.04] border border-amber-500/10 rounded-xl flex items-start gap-2.5 text-xs text-amber-700 font-semibold mb-4">
          <ShieldAlert className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
          <div>
            <span>Sadece Okuma Yetkisi:</span> Ayarları değiştirmek için yönetici (Admin/Owner) yetkisi gereklidir.
          </div>
        </div>
      )}

      {/* Main card */}
      <div className="w-full bg-white border border-black/5 rounded-2xl p-5 sm:p-6 shadow-sm space-y-6">
        
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-black/5 pb-4">
          <Bot className="w-5 h-5 text-blue-600" />
          <div>
            <h3 className="text-base font-bold text-[#1D1D1F]">Otopilot ve Karşılama Ayarları</h3>
            <p className="text-xs text-[#86868B] font-medium mt-0.5">
              WhatsApp üzerinden hastalarla ilk temas ve gelen mesaj yanıtlama otopilot kontrolleri.
            </p>
          </div>
        </div>

        {/* Section B: Modules settings */}
        <div className="space-y-6">
          
          {/* Card 1: Form Outbound (Greeting) */}
          <div className="border border-black/5 rounded-xl p-4 space-y-4 hover:border-black/10 transition-colors">
            <div className="flex items-center justify-between border-b border-black/5 pb-2">
              <span className="text-xs font-bold text-[#1D1D1F] uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                1. Form Karşılama (Outbound Greeting) Modülü
              </span>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-3.5 bg-[#F5F5F7] border border-black/5 rounded-xl">
                <div className="space-y-0.5">
                  <label className="text-xs font-bold text-[#1D1D1F]">Form Karşılama Otopilotunu Etkinleştir</label>
                  <p className="text-[10px] text-[#86868B] font-medium">İlk form temaslarını otomatik yönetir.</p>
                </div>
                <input
                  type="checkbox"
                  disabled={!hasPermission}
                  checked={formConfig.enabled}
                  onChange={(e) => setFormConfig((prev: any) => ({ ...prev, enabled: e.target.checked }))}
                  className="w-4.5 h-4.5 text-[#007AFF] rounded border-black/10 focus:ring-[#007AFF] cursor-pointer disabled:opacity-50"
                />
              </div>

              <div className="p-3.5 bg-white border border-black/5 rounded-xl space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <label className="text-xs font-bold text-[#1D1D1F]">Otomatik Gönderilecek Şablon</label>
                    <p className="text-[10px] text-[#86868B] font-medium">
                      Yeni form düşünce seçili onaylı WhatsApp şablonu gider. Hasta form özetini WhatsApp sohbetine gönderdiyse şablon tekrarı yapılmaz; sohbet/inbox yanıtı kullanılır.
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-1">
                    {getEffectiveTemplateLanguage(formConfig)}
                  </span>
                </div>

                <select
                  disabled={!hasPermission || templatesLoading}
                  value={`${getEffectiveTemplateName(formConfig)}::${getEffectiveTemplateLanguage(formConfig)}`}
                  onChange={(e) => {
                    const [name, language] = e.target.value.split("::");
                    const selected = greetingTemplates.find((t) => t.name === name && t.language === language);
                    setFormConfig((prev: any) => ({
                      ...prev,
                      template_name: selected?.name || name || DEFAULT_FORM_GREETING_TEMPLATE_NAME,
                      template_language: selected?.language || language || DEFAULT_FORM_GREETING_TEMPLATE_LANGUAGE,
                      template_text: selected?.body || DEFAULT_FORM_GREETING_TEMPLATE_TEXT
                    }));
                  }}
                  className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-[#1D1D1F] disabled:opacity-50"
                >
                  <option value={`${DEFAULT_FORM_GREETING_TEMPLATE_NAME}::${DEFAULT_FORM_GREETING_TEMPLATE_LANGUAGE}`}>
                    {DEFAULT_FORM_GREETING_TEMPLATE_NAME} · {DEFAULT_FORM_GREETING_TEMPLATE_LANGUAGE}
                  </option>
                  {greetingTemplates.map((template) => (
                    <option key={`${template.id}-${template.name}-${template.language}`} value={`${template.name}::${template.language}`}>
                      {template.name} · {template.language}{template.isDefault ? " · varsayılan" : ""}
                    </option>
                  ))}
                </select>

                <div className="rounded-lg bg-[#F5F5F7] border border-black/5 p-3 text-[11px] text-[#3A3A3C] whitespace-pre-line leading-relaxed">
                  {getEffectiveTemplateText(formConfig)}
                </div>
              </div>
            </div>

            {/* Save action button */}
            <div className="flex items-center justify-between pt-3 border-t border-black/5">
              <div className="text-[11px] text-[#86868B] font-medium flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                Form Karşılama ayrı bir DB kaydı olarak yönetilir.
              </div>
              
              <button
                disabled={savingForm || !hasPermission}
                onClick={handleSaveForm}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#007AFF] hover:bg-[#0056b3] text-white rounded-xl text-xs font-bold transition-all duration-200 disabled:opacity-50 cursor-pointer active:scale-[0.98]"
              >
                {savingForm ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Kaydediliyor...</>
                ) : successForm ? (
                  <><Check className="w-3.5 h-3.5 text-emerald-300" /> Kaydedildi</>
                ) : (
                  <><Save className="w-3.5 h-3.5" /> Karşılama Ayarlarını Kaydet</>
                )}
              </button>
            </div>
          </div>

          {/* Card 2: Inbound Autopilot */}
          <div className="border border-black/5 rounded-xl p-4 space-y-4 hover:border-black/10 transition-colors">
            <div className="flex items-center justify-between border-b border-black/5 pb-2">
              <span className="text-xs font-bold text-[#1D1D1F] uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                2. Gelen Mesaj Yanıtlama (Inbound Autopilot) Modülü
              </span>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-3.5 bg-[#F5F5F7] border border-black/5 rounded-xl">
                <div className="space-y-0.5">
                  <label className="text-xs font-bold text-[#1D1D1F]">Gelen Mesaj Otopilotunu Etkinleştir</label>
                  <p className="text-[10px] text-[#86868B] font-medium">Gelen WhatsApp sorularını otomatik yanıtlar.</p>
                </div>
                <input
                  type="checkbox"
                  disabled={!hasPermission}
                  checked={inboundConfig.enabled}
                  onChange={(e) => setInboundConfig((prev: any) => ({
                    ...prev,
                    enabled: e.target.checked,
                    dry_run: e.target.checked ? false : true
                  }))}
                  className="w-4.5 h-4.5 text-[#007AFF] rounded border-black/10 focus:ring-[#007AFF] cursor-pointer disabled:opacity-50"
                />
              </div>
            </div>

            {/* Save action button */}
            <div className="flex items-center justify-between pt-3 border-t border-black/5">
              <div className="text-[11px] text-[#86868B] font-medium flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                Gelen Mesaj yanıtları ayrı bir DB kaydı olarak yönetilir.
              </div>
              
              <button
                disabled={savingInbound || !hasPermission}
                onClick={handleSaveInbound}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#007AFF] hover:bg-[#0056b3] text-white rounded-xl text-xs font-bold transition-all duration-200 disabled:opacity-50 cursor-pointer active:scale-[0.98]"
              >
                {savingInbound ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Kaydediliyor...</>
                ) : successInbound ? (
                  <><Check className="w-3.5 h-3.5 text-emerald-300" /> Kaydedildi</>
                ) : (
                  <><Save className="w-3.5 h-3.5" /> Mesaj Ayarlarını Kaydet</>
                )}
              </button>
            </div>
          </div>

        </div>

        {/* Global error text */}
        {errorText && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium flex items-center gap-2 mt-4 animate-in fade-in duration-200">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
            {errorText}
          </div>
        )}

      </div>
    </div>
  );
}
