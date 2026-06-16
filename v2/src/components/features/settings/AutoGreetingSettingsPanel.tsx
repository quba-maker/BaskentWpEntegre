"use client";

import React, { useState } from "react";
import { Bot, Shield, ShieldAlert, Check, RefreshCw, AlertCircle, Save, Info } from "lucide-react";

export interface ChannelSettings {
  auto_greeting_enabled: boolean;
  dry_run: boolean;
  [key: string]: any;
}

export interface ChannelsConfig {
  [channelId: string]: ChannelSettings;
}

interface AutoGreetingSettingsPanelProps {
  channelsConfig: ChannelsConfig;
  envLocks: {
    phaseLockBlocked: boolean;
    globalDisabled: boolean;
    isTenantAllowed: boolean;
    dryRun: boolean;
    allowedTenants: string;
  };
  onSaveChannelConfig: (channelId: string, settings: Partial<ChannelSettings>) => Promise<{ success: boolean; error?: string }>;
}

export function AutoGreetingSettingsPanel({
  channelsConfig,
  envLocks,
  onSaveChannelConfig
}: AutoGreetingSettingsPanelProps) {
  const [configs, setConfigs] = useState<ChannelsConfig>(channelsConfig);
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const [successChannel, setSuccessChannel] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Check if live outbound is locked at environment level
  const isLiveOutboundLocked = 
    envLocks.phaseLockBlocked || 
    envLocks.globalDisabled || 
    !envLocks.isTenantAllowed || 
    envLocks.dryRun;

  const getLockReason = () => {
    const reasons = [];
    if (envLocks.phaseLockBlocked) reasons.push("Phase lock aktif");
    if (envLocks.globalDisabled) reasons.push("Global disabled aktif");
    if (!envLocks.isTenantAllowed) reasons.push("Tenant allowlist dışı");
    if (envLocks.dryRun) reasons.push("Dry-run modu aktif");
    return reasons.length > 0 ? reasons.join(" / ") : "Kilit Yok";
  };

  const handleToggleChange = (channelId: string, key: keyof ChannelSettings, value: boolean) => {
    setConfigs(prev => ({
      ...prev,
      [channelId]: {
        ...prev[channelId],
        [key]: value
      }
    }));
  };

  const handleSave = async (channelId: string) => {
    setSavingChannel(channelId);
    setSuccessChannel(null);
    setErrorText(null);
    try {
      const channelData = configs[channelId] || { auto_greeting_enabled: false, dry_run: true };
      const res = await onSaveChannelConfig(channelId, channelData);
      if (res.success) {
        setSuccessChannel(channelId);
        setTimeout(() => setSuccessChannel(null), 3000);
      } else {
        setErrorText(res.error || "Ayarlar kaydedilirken hata oluştu.");
      }
    } catch (err) {
      setErrorText("Bağlantı hatası oluştu.");
    } finally {
      setSavingChannel(null);
    }
  };

  return (
    <div className="w-full bg-white border border-black/5 rounded-2xl p-5 sm:p-6 shadow-sm space-y-6 text-left">
      
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-black/5 pb-4">
        <Bot className="w-5 h-5 text-blue-600" />
        <div>
          <h3 className="text-base font-bold text-[#1D1D1F]">Otomatik Karşılama Ayarları</h3>
          <p className="text-xs text-[#86868B] font-medium mt-0.5">
            Gelen yeni WhatsApp mesajları için otomatik bot yönetim modülleri.
          </p>
        </div>
      </div>

      {/* Env safety locks (Read Only) */}
      <div className="bg-[#F5F5F7] border border-black/5 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#1D1D1F] flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-amber-500" /> Güvenlik Kilitleri (Environment)
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

      {/* Channel configurations */}
      <div className="space-y-4">
        {Object.keys(configs).map(channelId => {
          const config = configs[channelId] || { auto_greeting_enabled: false, dry_run: true };
          
          return (
            <div key={channelId} className="border border-black/5 rounded-xl p-4 space-y-4 hover:border-black/10 transition-colors">
              <div className="flex items-center justify-between border-b border-black/5 pb-2">
                <span className="text-xs font-bold text-[#1D1D1F] uppercase tracking-wider">
                  Kanal: {channelId}
                </span>
                <span className="text-[10px] text-[#86868B] font-bold">
                  {config.auto_greeting_enabled ? 'Otomatik Cevap Açık' : 'Manuel'}
                </span>
              </div>

              <div className="space-y-3.5">
                {/* 1. Auto greeting setting */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <label className="text-xs font-bold text-[#1D1D1F] cursor-pointer">
                      Yeni gelenleri otomatik cevapla
                    </label>
                    <p className="text-[11px] text-[#86868B] font-medium leading-relaxed">
                      * Bu ayar sadece hasta zaten WhatsApp'tan yazdığında (inbound) çalışır. Yeni form-only lead'ler için otomatik outbound serbest mesaj gönderilmesini açmaz, sadece panelde manuel taslak/template hazırlama akışını açar.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.auto_greeting_enabled}
                    onChange={(e) => handleToggleChange(channelId, 'auto_greeting_enabled', e.target.checked)}
                    className="w-4.5 h-4.5 text-[#007AFF] rounded border-black/10 focus:ring-[#007AFF] cursor-pointer shrink-0 mt-0.5"
                  />
                </div>

                {/* 2. Dry run option */}
                <div className="flex items-start justify-between gap-4 border-t border-black/5 pt-3">
                  <div className="space-y-0.5">
                    <label className="text-xs font-bold text-[#1D1D1F]">
                      Simülasyon Modu (Dry-Run Only)
                    </label>
                    <p className="text-[11px] text-[#86868B] font-medium leading-relaxed">
                      Aktif edildiğinde, bot gerçek mesaj göndermek yerine veri tabanına log yazar ve eylemi simüle eder.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.dry_run}
                    onChange={(e) => handleToggleChange(channelId, 'dry_run', e.target.checked)}
                    className="w-4.5 h-4.5 text-[#007AFF] rounded border-black/10 focus:ring-[#007AFF] cursor-pointer shrink-0 mt-0.5"
                  />
                </div>
              </div>

              {/* Action save button */}
              <div className="flex items-center justify-between pt-2 border-t border-black/5">
                <div className="text-[11px] text-[#86868B] font-medium flex items-center gap-1">
                  <Info className="w-3.5 h-3.5" />
                  Kanal ayarları izole olarak saklanır.
                </div>
                
                <button
                  disabled={savingChannel === channelId}
                  onClick={() => handleSave(channelId)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#007AFF] hover:bg-[#0056b3] text-white rounded-xl text-xs font-bold transition-all duration-200 disabled:opacity-50 cursor-pointer active:scale-[0.98]"
                >
                  {savingChannel === channelId ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Kaydediliyor...</>
                  ) : successChannel === channelId ? (
                    <><Check className="w-3.5 h-3.5" /> Kaydedildi</>
                  ) : (
                    <><Save className="w-3.5 h-3.5" /> Ayarları Kaydet</>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alert details */}
      {errorText && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
          {errorText}
        </div>
      )}

    </div>
  );
}
