import React, { useState } from "react";
import { Shield, ShieldAlert, CheckCircle, AlertTriangle, Copy, Check, Info } from "lucide-react";
import { type RuntimeReadinessReport } from "@/app/actions/learning-approval";

interface LearningRuntimeStatusCardProps {
  readiness: RuntimeReadinessReport | null;
  loading: boolean;
  tenantSlug: string;
}

export default function LearningRuntimeStatusCard({
  readiness,
  loading,
  tenantSlug
}: LearningRuntimeStatusCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!readiness) return;
    const envSnippet = `LEARNING_RUNTIME_ENABLED=true\nLEARNING_RUNTIME_TENANT_ALLOWLIST=${readiness.selectedChannelId ? (readiness.selectedChannelId.split(':')[0] || 'tenant_id') : 'tenant_id'}\nLEARNING_RUNTIME_CHANNEL_ALLOWLIST=${readiness.selectedChannelId}`;
    
    // In our system we want current tenant ID: we can construct it or pass it.
    // Wait, the env allows current tenant ID and channel ID. Let's construct a cleaner version.
    const realSnippet = `LEARNING_RUNTIME_ENABLED=true\nLEARNING_RUNTIME_TENANT_ALLOWLIST=<current_tenant_id>\nLEARNING_RUNTIME_CHANNEL_ALLOWLIST=${readiness.selectedChannelId}`;
    
    navigator.clipboard.writeText(realSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If no channel is selected
  if (!readiness) {
    return (
      <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm flex items-center gap-3">
        <div className="p-3 bg-slate-100 text-slate-400 rounded-2xl">
          <Shield className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-xs font-bold text-[#1D1D1F]">Runtime Öğrenme Kilidi</h3>
          <p className="text-[11px] text-[#86868B] font-semibold mt-0.5">
            Kanal seçilmeden runtime unlock önerisi üretilemez. Lütfen yukarıdaki filtrelerden bir kanal seçin.
          </p>
        </div>
      </div>
    );
  }

  const {
    runtimeEnabled,
    tenantAllowed,
    channelAllowed,
    effectiveEnabled,
    safeCandidateCount,
    selectedChannelName,
    canRecommendUnlock,
    reason
  } = readiness;

  // Determine colors and states
  const isActive = effectiveEnabled;
  const isReady = canRecommendUnlock;

  let title = "Runtime Öğrenme: Kapalı";
  let description = "Runtime öğrenme şu anda kapalı. Bot onaylı adayları canlı cevaplarında kullanmıyor.";
  let statusColor = "text-slate-500 bg-slate-50 border-slate-200";

  if (isActive) {
    title = "Runtime Öğrenme: Aktif";
    description = "Runtime öğrenme bu kanal için aktif. Onaylanmış kural adayları bot promptuna ekleniyor.";
    statusColor = "text-emerald-700 bg-emerald-50 border-emerald-200";
  } else if (isReady) {
    title = "Runtime Öğrenme: Kilitli (Açılmaya Hazır)";
    description = "Bu kanalda güvenli onaylı adaylar var. Unlock için env ayarları güncellenmeli ve canlı onay alınmalıdır.";
    statusColor = "text-amber-700 bg-amber-50 border-amber-200";
  } else {
    title = "Runtime Öğrenme: Kilitli (Hazır Değil)";
    description = "Bu kanalda runtime'a alınabilecek güvenli onaylı aday bulunmuyor. Kilidi açmak şu an önerilmez.";
    statusColor = "text-rose-700 bg-rose-50 border-rose-200";
  }

  // Construct env text snippet with tenant code placeholder
  const envText = `LEARNING_RUNTIME_ENABLED=true\nLEARNING_RUNTIME_TENANT_ALLOWLIST=tenant_uuid_here\nLEARNING_RUNTIME_CHANNEL_ALLOWLIST=${readiness.selectedChannelId}`;

  return (
    <div className="bg-white border border-black/5 rounded-2xl p-5 shadow-sm space-y-4">
      {/* 1. Header & Status Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl border ${isActive ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
            {isActive ? <CheckCircle className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-[12px] font-black text-[#1D1D1F] tracking-tight">Runtime Öğrenme Durumu</h4>
              <span className={`px-2 py-0.5 rounded-lg border text-[9px] font-black uppercase ${statusColor}`}>
                {isActive ? "AKTİF" : isReady ? "AÇMAYA HAZIR" : "KAPALI"}
              </span>
            </div>
            <p className="text-[10px] text-[#86868B] font-semibold mt-0.5">
              Seçili Kanal: <span className="text-[#1D1D1F] font-bold">{selectedChannelName}</span>
            </p>
          </div>
        </div>
      </div>

      {/* 2. Status Description Message */}
      <div className="text-[11px] font-semibold leading-relaxed p-3 bg-slate-50 rounded-xl text-[#1D1D1F] border border-black/5 flex items-start gap-2">
        <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <div>{description}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 3. Setup Checklist */}
        <div className="space-y-2">
          <h5 className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Açma Şartları Kontrolü</h5>
          <div className="bg-slate-50/50 rounded-2xl p-3.5 border border-black/5 space-y-2 text-[11px] font-semibold text-[#1D1D1F]">
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">✅</span>
              <span>P1.3 kodu hazır</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">✅</span>
              <span>Runtime resolver hazır</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">✅</span>
              <span>Prompt DB mutasyonu yok</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">✅</span>
              <span>Outbound iletişimi kapalı</span>
            </div>
            <div className="flex items-center gap-2">
              {safeCandidateCount > 0 ? (
                <span className="text-emerald-500">✅</span>
              ) : (
                <span className="text-slate-300">⬜</span>
              )}
              <span className={safeCandidateCount > 0 ? "" : "text-[#86868B]"}>
                En az 1 güvenli approved low-risk aday ({safeCandidateCount} adet)
              </span>
            </div>
            <div className="flex items-center gap-2">
              {tenantAllowed ? (
                <span className="text-emerald-500">✅</span>
              ) : (
                <span className="text-slate-300">⬜</span>
              )}
              <span className={tenantAllowed ? "" : "text-[#86868B]"}>Tenant allowlist eşleşmesi</span>
            </div>
            <div className="flex items-center gap-2">
              {channelAllowed ? (
                <span className="text-emerald-500">✅</span>
              ) : (
                <span className="text-slate-300">⬜</span>
              )}
              <span className={channelAllowed ? "" : "text-[#86868B]"}>Channel allowlist eşleşmesi</span>
            </div>
            <div className="flex items-center gap-2">
              {runtimeEnabled ? (
                <span className="text-emerald-500">✅</span>
              ) : (
                <span className="text-slate-300">⬜</span>
              )}
              <span className={runtimeEnabled ? "" : "text-[#86868B]"}>LEARNING_RUNTIME_ENABLED=true</span>
            </div>
          </div>
        </div>

        {/* 4. Clipboard Env Snippet */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Gerekli Çevre Değişkenleri (Vercel Env)</h5>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:text-indigo-700 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-500">Kopyalandı!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Kopyala</span>
                </>
              )}
            </button>
          </div>
          
          <div className="relative bg-[#1D1D1F] rounded-2xl p-4 border border-black/10 shadow-inner">
            <pre className="text-[10px] font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed select-all">
              {`LEARNING_RUNTIME_ENABLED=true
LEARNING_RUNTIME_TENANT_ALLOWLIST=tenant_id_gireceksiniz
LEARNING_RUNTIME_CHANNEL_ALLOWLIST=${readiness.selectedChannelId}`}
            </pre>
            <div className="text-[9px] text-slate-500 font-semibold mt-3 flex items-start gap-1">
              <Info className="w-3 h-3 text-slate-600 shrink-0 mt-0.5" />
              <span>Bu alan sadece bilgilendirme amaçlıdır. Canlı ayarları değiştirmek için Vercel panelini kullanmalısınız.</span>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Warning / Action suggestion */}
      {!isActive && safeCandidateCount === 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-[10px] font-semibold text-rose-900 leading-relaxed">
            <span className="font-bold">Öneri:</span> Şu an bu kanalda runtime'a alınabilecek onaylanmış güvenli aday bulunmuyor. 
            Bu durumdayken kilidi açmak gereksizdir. Lütfen önce değerlendirme bekleyen adayları inceleyip onaylayın.
          </div>
        </div>
      )}
    </div>
  );
}
