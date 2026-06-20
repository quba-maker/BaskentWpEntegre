"use client";

import React, { useState, useEffect } from "react";
import { Bot, Shield, ShieldAlert, Check, RefreshCw, AlertCircle, Save, Info, Plus, X } from "lucide-react";

export interface ChannelSettings {
  auto_greeting_enabled: boolean;
  dry_run: boolean;
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

export function AutoGreetingSettingsPanel({
  channelsConfig: initialChannelsConfig,
  envLocks: initialEnvLocks,
  onSaveChannelConfig
}: AutoGreetingSettingsPanelProps) {
  // Config States
  const [formConfig, setFormConfig] = useState<any>({
    enabled: false,
    dry_run: true,
    rollout_percentage: 0,
    department_mode: "selected",
    allowed_departments: []
  });

  const [inboundConfig, setInboundConfig] = useState<any>({
    enabled: false,
    dry_run: true,
    rollout_percentage: 0,
    department_mode: "selected",
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
      const res = await saveFormAutopilotSettingsAction(tenantId, {
        enabled: formConfig.enabled,
        dry_run: formConfig.dry_run,
        rollout_percentage: Number(formConfig.rollout_percentage),
        department_mode: formConfig.department_mode,
        allowed_departments: formConfig.allowed_departments
      });
      if (res.success) {
        setSuccessForm(true);
        setTimeout(() => setSuccessForm(false), 3000);
        // Also call onSaveChannelConfig for backward compatibility with pages that update parent layout
        if (onSaveChannelConfig) {
          await onSaveChannelConfig("whatsapp", {
            auto_greeting_enabled: formConfig.enabled,
            dry_run: formConfig.dry_run
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
        rollout_percentage: Number(inboundConfig.rollout_percentage),
        department_mode: inboundConfig.department_mode,
        allowed_departments: inboundConfig.allowed_departments
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
            <h3 className="text-base font-bold text-[#1D1D1F]">Kademeli Otopilot ve Karşılama Ayarları</h3>
            <p className="text-xs text-[#86868B] font-medium mt-0.5">
              WhatsApp üzerinden hastalarla ilk temas ve gelen mesaj yanıtlama otopilot kontrolleri.
            </p>
          </div>
        </div>

        {/* Section A: Güvenlik Kilitleri (Env - Read Only) */}
        <div className="bg-[#F5F5F7] border border-black/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#1D1D1F] flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-amber-500" /> A) Güvenlik Kilitleri (Environment - Salt Okunur)
            </span>
            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${isLiveOutboundLocked ? 'bg-red-50 text-red-600 border-red-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>
              {isLiveOutboundLocked ? 'GÖNDERİM KİLİTLİ' : 'AÇIK'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-semibold text-[#515154]">
            <div className="p-2.5 bg-white border border-black/5 rounded-lg space-y-1">
              <span className="block text-[9px] text-[#86868B] uppercase tracking-wider">FORM_AUTOPILOT_PHASE_LOCK_OUTBOUND_BLOCKED</span>
              <span className="text-[#1D1D1F]">{envLocks.phaseLockBlocked ? 'TRUE (Kilitli)' : 'FALSE (Açık)'}</span>
            </div>
            <div className="p-2.5 bg-white border border-black/5 rounded-lg space-y-1">
              <span className="block text-[9px] text-[#86868B] uppercase tracking-wider">FORM_AUTOPILOT_GLOBAL_DISABLED</span>
              <span className="text-[#1D1D1F]">{envLocks.globalDisabled ? 'TRUE (Engelli)' : 'FALSE (Serbest)'}</span>
            </div>
            <div className="p-2.5 bg-white border border-black/5 rounded-lg space-y-1">
              <span className="block text-[9px] text-[#86868B] uppercase tracking-wider">FORM_AUTOPILOT_DRY_RUN</span>
              <span className="text-[#1D1D1F]">{envLocks.dryRun ? 'TRUE (Sadece Dry-run)' : 'FALSE (Canlı)'}</span>
            </div>
            <div className="p-2.5 bg-white border border-black/5 rounded-lg space-y-1">
              <span className="block text-[9px] text-[#86868B] uppercase tracking-wider">Kurum Yetkilendirmesi (Allowlist)</span>
              <span className={envLocks.isTenantAllowed ? 'text-emerald-600' : 'text-rose-500'}>
                {envLocks.isTenantAllowed ? 'İzin Verildi' : 'İzin Yok'}
              </span>
            </div>
          </div>

          {isLiveOutboundLocked && (
            <div className="p-3 bg-red-500/[0.03] border border-red-500/10 rounded-lg flex items-start gap-2 text-[11px] font-semibold text-rose-800">
              <ShieldAlert className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <div>
                <span className="font-bold">Canlı Gönderim:</span> Kilitli <br />
                <span className="font-medium text-[#86868B]">Sebep: {getLockReason()}</span>
              </div>
            </div>
          )}
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
              {/* Enabled & Dry-run toggles */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 bg-[#F5F5F7] border border-black/5 rounded-xl">
                  <div className="space-y-0.5">
                    <label className="text-xs font-bold text-[#1D1D1F]">Form Otopilotunu Etkinleştir</label>
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

                <div className="flex items-center justify-between p-3 bg-[#F5F5F7] border border-black/5 rounded-xl">
                  <div className="space-y-0.5">
                    <label className="text-xs font-bold text-[#1D1D1F]">Simülasyon Modu (Dry-Run)</label>
                    <p className="text-[10px] text-[#86868B] font-medium">Log kaydeder, gerçek mesaj göndermez.</p>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!hasPermission}
                    checked={formConfig.dry_run}
                    onChange={(e) => setFormConfig((prev: any) => ({ ...prev, dry_run: e.target.checked }))}
                    className="w-4.5 h-4.5 text-[#007AFF] rounded border-black/10 focus:ring-[#007AFF] cursor-pointer disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Rollout slider */}
              <div className="space-y-1.5 p-3 bg-[#F5F5F7] border border-black/5 rounded-xl">
                <div className="flex justify-between items-center text-xs font-bold text-[#1D1D1F]">
                  <span>Kademeli Rollout Oranı</span>
                  <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">{formConfig.rollout_percentage}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  disabled={!hasPermission}
                  value={formConfig.rollout_percentage}
                  onChange={(e) => setFormConfig((prev: any) => ({ ...prev, rollout_percentage: parseInt(e.target.value) }))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
                />
                <p className="text-[10px] text-[#86868B] font-semibold mt-1">Tenant ve konuşma bazlı deterministik rollout oranı.</p>
              </div>

              {/* Department settings */}
              <div className="space-y-3 p-3 bg-[#F5F5F7] border border-black/5 rounded-xl">
                <div className="space-y-0.5">
                  <label className="text-xs font-bold text-[#1D1D1F]">İzin Verilen Branş Modu</label>
                  <p className="text-[10px] text-[#86868B] font-medium">Hangi branşlardaki formların otopilota gireceğini kısıtlayın.</p>
                </div>

                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-[#1D1D1F]">
                    <input
                      type="radio"
                      name="form_dept_mode"
                      value="selected"
                      disabled={!hasPermission}
                      checked={formConfig.department_mode === "selected"}
                      onChange={() => handleDeptModeSelect("form", "selected")}
                      className="w-4 h-4 text-[#007AFF] border-black/10 focus:ring-[#007AFF]"
                    />
                    Belirli Branşlar
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-[#1D1D1F]">
                    <input
                      type="radio"
                      name="form_dept_mode"
                      value="all"
                      disabled={!hasPermission}
                      checked={formConfig.department_mode === "all"}
                      onChange={() => handleDeptModeSelect("form", "all")}
                      className="w-4 h-4 text-[#007AFF] border-black/10 focus:ring-[#007AFF]"
                    />
                    Tüm Branşlar (Onay Gerekir)
                  </label>
                </div>

                {formConfig.department_mode === "selected" && (
                  <div className="space-y-2 pt-2 border-t border-black/5">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Branş adı (Örn: Göz, Kardiyoloji)"
                        disabled={!hasPermission}
                        value={formDeptInput}
                        onChange={(e) => setFormDeptInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddDept("form");
                          }
                        }}
                        className="flex-1 text-xs px-3 py-1.5 bg-white border border-black/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={!hasPermission}
                        onClick={() => handleAddDept("form")}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {formConfig.allowed_departments.length === 0 ? (
                        <span className="text-[10px] text-rose-500 font-bold bg-rose-50 border border-rose-100 rounded px-2 py-0.5">
                          ⚠️ Liste boş: Otopilot hiçbir branşta çalışmayacak (Korumalı mod).
                        </span>
                      ) : (
                        formConfig.allowed_departments.map((dept: string) => (
                          <span
                            key={dept}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded px-2 py-0.5"
                          >
                            {dept}
                            {hasPermission && (
                              <button
                                type="button"
                                onClick={() => handleRemoveDept("form", dept)}
                                className="hover:text-red-500 text-slate-400 shrink-0"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                )}
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
              {/* Enabled & Dry-run toggles */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-3 bg-[#F5F5F7] border border-black/5 rounded-xl">
                  <div className="space-y-0.5">
                    <label className="text-xs font-bold text-[#1D1D1F]">Gelen Mesaj Otopilotunu Etkinleştir</label>
                    <p className="text-[10px] text-[#86868B] font-medium">Gelen WhatsApp sorularını otomatik yanıtlar.</p>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!hasPermission}
                    checked={inboundConfig.enabled}
                    onChange={(e) => setInboundConfig((prev: any) => ({ ...prev, enabled: e.target.checked }))}
                    className="w-4.5 h-4.5 text-[#007AFF] rounded border-black/10 focus:ring-[#007AFF] cursor-pointer disabled:opacity-50"
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-[#F5F5F7] border border-black/5 rounded-xl">
                  <div className="space-y-0.5">
                    <label className="text-xs font-bold text-[#1D1D1F]">Simülasyon Modu (Dry-Run)</label>
                    <p className="text-[10px] text-[#86868B] font-medium">Log kaydeder, gerçek mesaj göndermez.</p>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!hasPermission}
                    checked={inboundConfig.dry_run}
                    onChange={(e) => setInboundConfig((prev: any) => ({ ...prev, dry_run: e.target.checked }))}
                    className="w-4.5 h-4.5 text-[#007AFF] rounded border-black/10 focus:ring-[#007AFF] cursor-pointer disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Rollout slider */}
              <div className="space-y-1.5 p-3 bg-[#F5F5F7] border border-black/5 rounded-xl">
                <div className="flex justify-between items-center text-xs font-bold text-[#1D1D1F]">
                  <span>Kademeli Rollout Oranı</span>
                  <span className="text-[#34C759] bg-[#34C759]/[0.06] px-2 py-0.5 rounded-md border border-[#34C759]/20">{inboundConfig.rollout_percentage}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  disabled={!hasPermission}
                  value={inboundConfig.rollout_percentage}
                  onChange={(e) => setInboundConfig((prev: any) => ({ ...prev, rollout_percentage: parseInt(e.target.value) }))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#34C759] disabled:opacity-50"
                />
                <p className="text-[10px] text-[#86868B] font-semibold mt-1">Gelen mesajlar için deterministik rollout oranı.</p>
              </div>

              {/* Department settings */}
              <div className="space-y-3 p-3 bg-[#F5F5F7] border border-black/5 rounded-xl">
                <div className="space-y-0.5">
                  <label className="text-xs font-bold text-[#1D1D1F]">İzin Verilen Branş Modu</label>
                  <p className="text-[10px] text-[#86868B] font-medium">Hangi branşlardaki hastalar için otopilotun aktif olacağını seçin.</p>
                </div>

                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-[#1D1D1F]">
                    <input
                      type="radio"
                      name="inbound_dept_mode"
                      value="selected"
                      disabled={!hasPermission}
                      checked={inboundConfig.department_mode === "selected"}
                      onChange={() => handleDeptModeSelect("inbound", "selected")}
                      className="w-4 h-4 text-[#007AFF] border-black/10 focus:ring-[#007AFF]"
                    />
                    Belirli Branşlar
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer text-[#1D1D1F]">
                    <input
                      type="radio"
                      name="inbound_dept_mode"
                      value="all"
                      disabled={!hasPermission}
                      checked={inboundConfig.department_mode === "all"}
                      onChange={() => handleDeptModeSelect("inbound", "all")}
                      className="w-4 h-4 text-[#007AFF] border-black/10 focus:ring-[#007AFF]"
                    />
                    Tüm Branşlar (Onay Gerekir)
                  </label>
                </div>

                {inboundConfig.department_mode === "selected" && (
                  <div className="space-y-2 pt-2 border-t border-black/5">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Branş adı (Örn: Göz, Kardiyoloji)"
                        disabled={!hasPermission}
                        value={inboundDeptInput}
                        onChange={(e) => setInboundDeptInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddDept("inbound");
                          }
                        }}
                        className="flex-1 text-xs px-3 py-1.5 bg-white border border-black/10 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <button
                        type="button"
                        disabled={!hasPermission}
                        onClick={() => handleAddDept("inbound")}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {inboundConfig.allowed_departments.length === 0 ? (
                        <span className="text-[10px] text-rose-500 font-bold bg-rose-50 border border-rose-100 rounded px-2 py-0.5">
                          ⚠️ Liste boş: Otopilot hiçbir branşta çalışmayacak (Korumalı mod).
                        </span>
                      ) : (
                        inboundConfig.allowed_departments.map((dept: string) => (
                          <span
                            key={dept}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200 rounded px-2 py-0.5"
                          >
                            {dept}
                            {hasPermission && (
                              <button
                                type="button"
                                onClick={() => handleRemoveDept("inbound", dept)}
                                className="hover:text-red-500 text-slate-400 shrink-0"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                )}
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

      {/* Double confirmation premium Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[999] animate-in fade-in duration-200 p-4">
          <div className="bg-white border border-black/10 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200 text-left">
            <div className="flex items-center gap-3 text-amber-500 border-b border-black/5 pb-3">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h4 className="text-sm font-bold text-[#1D1D1F]">
                {confirmStep === 1 ? "Dikkat: Tüm Branşları Canlı Otopilota Alma" : "Kritik Son Onay"}
              </h4>
            </div>

            <div className="text-xs text-slate-700 font-semibold space-y-2 leading-relaxed">
              {confirmStep === 1 ? (
                <p>
                  Otopilot branş filtresini <strong>"Tüm Branşlar"</strong> moduna almak üzeresiniz. Bu işlem, branş kısıtlamalarını tamamen kaldırır. 
                  İlgili otopilot modülü, rollout yüzdesi dahilindeki tüm yeni form veya gelen mesajlarda otomatik olarak devreye girecektir.
                </p>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-rose-600 font-bold">
                    ⚠️ DİKKAT: BU İŞLEM YÜKSEK RİSK İÇERMEKTEDİR!
                  </p>
                  <p>
                    Canlı otopilotta herhangi bir branş ayrımı olmaksızın tüm hastalar otomatik yanıt almaya başlayacaktır. 
                    Devre kesici (circuit breaker) ve kademeli rollout korumaları aktif kalacaktır ancak yanlış branş yönlendirmeleri oluşabilir.
                  </p>
                  <p>
                    Bu işlemi kesinlikle onaylıyor musunuz?
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-black/5">
              <button
                type="button"
                onClick={handleCancelModal}
                className="px-4 py-2 border border-black/10 hover:bg-slate-50 text-[#515154] rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                İptal Et
              </button>
              <button
                type="button"
                onClick={handleConfirmModal}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95"
              >
                {confirmStep === 1 ? "Evet, Devam Et" : "Kesinlikle Onaylıyorum"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

