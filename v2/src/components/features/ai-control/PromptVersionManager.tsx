"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { Brain, RotateCcw, Eye, ChevronUp, CheckCircle2, Hash, User, Clock } from "lucide-react";
import { getBrainVersionHistory, getBrainVersionFull, rollbackBrain } from "@/app/actions/ai-control";

export function PromptVersionManager() {
  const { data: versions, mutate } = useSWR('brain-versions', getBrainVersionHistory);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [fullPrompt, setFullPrompt] = useState<string | null>(null);
  const [loadingRollback, setLoadingRollback] = useState(false);

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5" style={{ color: 'var(--q-purple-alt)' }} />
          <h3 className="text-base font-bold" style={{ color: 'var(--q-text-primary)' }}>Prompt Geçmişi</h3>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full font-medium" 
              style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-secondary)' }}>
          {versions?.length || 0} versiyon
        </span>
      </div>

      {/* Info Box */}
      <div className="p-3 rounded-xl text-[12px]" style={{ background: 'color-mix(in srgb, var(--q-blue) 5%, transparent)', border: '1px solid color-mix(in srgb, var(--q-blue) 15%, var(--q-border-default))', color: 'var(--q-text-secondary)' }}>
        💡 Bot Yönetimi sayfasından sistem promptunu her kaydettiğinizde otomatik olarak bir versiyon oluşturulur. Buradan eski sürümlere geri dönebilirsiniz.
      </div>

      {/* Version List */}
      <div className="space-y-2">
        {(!versions || versions.length === 0) && (
          <div className="p-8 text-center rounded-xl" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
            <Brain className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm font-medium" style={{ color: 'var(--q-text-primary)' }}>
              Henüz prompt versiyonu yok
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--q-text-secondary)' }}>
              Bot Yönetimi sayfasından sistem promptunu kaydettiğinizde burada versiyonlar görünecek.
            </p>
          </div>
        )}

        {versions?.map((v: any) => {
          const isExpanded = expandedVersion === v.version_number;
          const isActive = v.is_active;

          return (
            <div 
              key={v.version_number}
              className="rounded-xl overflow-hidden transition-all"
              style={{ 
                background: 'var(--q-bg-primary)', 
                border: isActive ? '2px solid var(--q-blue)' : '1px solid var(--q-border-default)',
              }}
            >
              {/* Version Header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                       style={{ background: isActive ? 'color-mix(in srgb, var(--q-blue) 10%, transparent)' : 'var(--q-bg-secondary)' }}>
                    <Hash className="w-4 h-4" style={{ color: isActive ? 'var(--q-blue)' : 'var(--q-text-secondary)' }} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold" style={{ color: 'var(--q-text-primary)' }}>
                        v{v.version_number}
                      </span>
                      {isActive && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                              style={{ background: 'color-mix(in srgb, var(--q-green) 12%, transparent)', color: 'var(--q-green)' }}>
                          <CheckCircle2 className="w-2.5 h-2.5 inline mr-0.5" />
                          AKTİF
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--q-text-secondary)' }}>
                      <span className="flex items-center gap-1"><User className="w-3 h-3" />{v.changed_by}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(v.created_at).toLocaleString('tr-TR')}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button 
                    onClick={() => handleViewFull(v.version_number)}
                    className="p-2 rounded-lg hover:bg-black/[0.04] transition-colors cursor-pointer"
                    title="Promptu görüntüle"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  {!isActive && (
                    <button 
                      onClick={() => handleRollback(v.version_number)}
                      disabled={loadingRollback}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                      style={{ background: 'color-mix(in srgb, var(--q-orange) 8%, transparent)', color: 'var(--q-orange)' }}
                      title={`v${v.version_number} sürümüne geri dön`}
                    >
                      <RotateCcw className="w-3 h-3" />
                      Geri Al
                    </button>
                  )}
                </div>
              </div>

              {/* Change Summary */}
              {v.change_summary && (
                <div className="px-4 pb-2">
                  <p className="text-[12px] italic" style={{ color: 'var(--q-text-secondary)' }}>
                    &quot;{v.change_summary}&quot;
                  </p>
                </div>
              )}

              {/* Prompt Preview */}
              {v.prompt_preview && !isExpanded && (
                <div className="px-4 pb-3">
                  <p className="text-[11px] font-mono p-2 rounded-lg truncate" 
                     style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-secondary)' }}>
                    {v.prompt_preview}
                  </p>
                </div>
              )}

              {/* Full Prompt View */}
              {isExpanded && fullPrompt && (
                <div className="mx-4 mb-3 p-4 rounded-lg max-h-[400px] overflow-y-auto"
                     style={{ background: 'var(--q-bg-secondary)', border: '1px solid var(--q-border-default)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--q-text-secondary)' }}>
                      Tam Sistem Promptu — v{v.version_number}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--q-text-secondary)' }}>
                      hash: {String(v.prompt_hash || '').substring(0, 12)}
                    </span>
                  </div>
                  <pre className="text-[12px] font-mono whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--q-text-primary)' }}>
                    {fullPrompt}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
