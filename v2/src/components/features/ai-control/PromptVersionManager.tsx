"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { Brain, RotateCcw, Eye, ChevronUp, CheckCircle2, Hash, User, Clock } from "lucide-react";
import { getBrainVersionHistory, getBrainVersionFull, rollbackBrain } from "@/app/actions/ai-control";

export function PromptVersionManager() {
  const [activeTab, setActiveTab] = useState('system_prompt_whatsapp');
  const { data: versions, mutate, isLoading } = useSWR(
    ['brain-versions', activeTab], 
    ([_, key]) => getBrainVersionHistory(key as string)
  );
  
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [fullPrompt, setFullPrompt] = useState<string | null>(null);
  const [loadingRollback, setLoadingRollback] = useState(false);

  const tabs = [
    { id: 'system_prompt_whatsapp', label: 'WhatsApp', color: 'var(--q-whatsapp, #25d366)' },
    { id: 'system_prompt_tr', label: 'Sosyal Medya TR', color: 'var(--q-purple, #8b5cf6)' },
    { id: 'system_prompt_foreign', label: 'Uluslararası', color: 'var(--q-blue)' }
  ];

  const handleViewFull = async (versionNumber: number) => {
    if (expandedVersion === versionNumber) {
      setExpandedVersion(null);
      setFullPrompt(null);
      return;
    }
    const full = await getBrainVersionFull(versionNumber);
    setFullPrompt(full?.system_prompt || '');
    setExpandedVersion(versionNumber);
  };

  const handleRollback = async (versionNumber: number) => {
    if (!confirm(`v${versionNumber} sürümüne geri dönülecek. Emin misiniz?`)) return;
    setLoadingRollback(true);
    const result = await rollbackBrain(versionNumber);
    setLoadingRollback(false);
    if (result.success) {
      mutate();
    } else {
      alert(result.error || 'Geri alma başarısız');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-black/[0.04] pb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5" style={{ color: 'var(--q-purple-alt)' }} />
          <h3 className="text-base font-bold" style={{ color: 'var(--q-text-primary)' }}>Prompt Geçmişi</h3>
        </div>
        
        {/* Apple/Stripe Style Minimal Tabs */}
        <div className="flex p-1 rounded-xl" style={{ background: 'var(--q-bg-secondary)' }}>
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setExpandedVersion(null); }}
                className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all ${
                  isActive ? 'shadow-sm bg-white' : 'hover:bg-black/[0.02]'
                }`}
                style={{ 
                  color: isActive ? tab.color : 'var(--q-text-secondary)',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Info Box */}
      <div className="p-3 rounded-xl text-[12px] flex items-start gap-2" 
           style={{ background: 'color-mix(in srgb, var(--q-blue) 5%, transparent)', color: 'var(--q-text-secondary)' }}>
        <span>💡</span>
        <p className="leading-relaxed">
          Sistem promptunu kaydettiğinizde otomatik olarak bir versiyon oluşturulur. Bu sekmede <strong>{tabs.find(t => t.id === activeTab)?.label}</strong> kanalına ait geçmişi görüyorsunuz.
        </p>
      </div>

      {/* Version List */}
      <div className="space-y-3 relative">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50 backdrop-blur-sm rounded-xl">
            <div className="w-5 h-5 border-2 border-black/10 border-t-black/40 rounded-full animate-spin" />
          </div>
        )}

        {(!versions || versions.length === 0) && !isLoading && (
          <div className="p-8 text-center rounded-xl" style={{ border: '1px dashed var(--q-border-default)' }}>
            <RotateCcw className="w-6 h-6 mx-auto mb-2 opacity-20" />
            <p className="text-[13px] font-medium" style={{ color: 'var(--q-text-primary)' }}>
              Bu kanal için geçmiş yok
            </p>
          </div>
        )}

        {versions?.map((v: any, index: number) => {
          const isExpanded = expandedVersion === v.version_number;
          // By default, the first item in the list is the most recent active if the query is ordered properly,
          // but let's rely on v.is_active to be absolutely sure.
          const isCurrent = v.is_active;

          return (
            <div 
              key={v.version_number}
              className="rounded-xl overflow-hidden transition-all duration-200"
              style={{ 
                background: isCurrent ? 'color-mix(in srgb, var(--q-blue) 3%, transparent)' : 'var(--q-bg-primary)', 
                border: isCurrent ? '1px solid color-mix(in srgb, var(--q-blue) 15%, transparent)' : '1px solid var(--q-border-default)',
                opacity: isCurrent ? 1 : 0.8
              }}
            >
              {/* Version Row */}
              <div className="flex items-center justify-between px-4 py-3">
                
                {/* Left: Meta */}
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-center justify-center">
                    <span className="text-[13px] font-bold" style={{ color: isCurrent ? 'var(--q-blue)' : 'var(--q-text-primary)' }}>
                      v{v.version_number}
                    </span>
                    {isCurrent && (
                      <span className="text-[8px] font-bold uppercase mt-0.5 tracking-wide" style={{ color: 'var(--q-blue)' }}>
                        Mevcut
                      </span>
                    )}
                  </div>
                  
                  <div className="w-[1px] h-6 bg-black/[0.05]" />
                  
                  <div className="flex flex-col">
                    <span className="text-[12px] font-medium" style={{ color: 'var(--q-text-primary)' }}>
                      {v.change_summary || 'Güncelleme'}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px]" style={{ color: 'var(--q-text-secondary)' }}>
                      <span className="flex items-center gap-1"><User className="w-2.5 h-2.5" />{v.changed_by}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{new Date(v.created_at).toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <span>•</span>
                      <span className="font-mono opacity-60">{String(v.prompt_hash || '').substring(0, 8)}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-1">
                  {!isCurrent && (
                    <button 
                      onClick={() => handleRollback(v.version_number)}
                      disabled={loadingRollback}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer opacity-0 hover:opacity-100 focus:opacity-100 group-hover:opacity-100 sm:opacity-100 disabled:opacity-50"
                      style={{ background: 'color-mix(in srgb, var(--q-text-primary) 5%, transparent)', color: 'var(--q-text-primary)' }}
                    >
                      Geri Dön
                    </button>
                  )}
                  <button 
                    onClick={() => handleViewFull(v.version_number)}
                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${isExpanded ? 'bg-black/5' : 'hover:bg-black/5'}`}
                  >
                    <ChevronUp className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} style={{ color: 'var(--q-text-secondary)' }} />
                  </button>
                </div>
              </div>

              {/* Collapsed Details View (Lazy Loaded Prompt) */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 animate-in slide-in-from-top-2 duration-200">
                  <div className="w-full h-[1px] mb-3" style={{ background: 'var(--q-border-default)' }} />
                  {fullPrompt === null ? (
                    <div className="text-[11px] py-4 text-center" style={{ color: 'var(--q-text-secondary)' }}>Yükleniyor...</div>
                  ) : (
                    <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed p-3 rounded-lg" 
                         style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-primary)' }}>
                      {fullPrompt}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
