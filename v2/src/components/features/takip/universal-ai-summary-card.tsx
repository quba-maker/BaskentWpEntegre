'use client';

import React from 'react';
import { Sparkles, AlertCircle } from 'lucide-react';
import { 
  type UniversalAISummary, 
  getAISummaryLabels 
} from '@/lib/utils/universal-summary-resolver';

interface UniversalAISummaryCardProps {
  summary: UniversalAISummary;
  className?: string;
}

export function UniversalAISummaryCard({ summary, className = '' }: UniversalAISummaryCardProps) {
  // If there is no summary source at all, hide the card or show an empty state.
  if (summary.source === 'none') {
    return null;
  }

  // Get localized labels based on dynamically resolved entity type
  const labels = getAISummaryLabels(summary.entityType);

  return (
    <div className={`space-y-3.5 ${className}`}>
      {/* Short urgency-aware reason card (Neden Önemli / Fırsat Gerekçesi) */}
      {summary.aiReason && (
        <div 
          className={`px-4 py-3 rounded-2xl border transition-all duration-300 shadow-sm ${
            summary.urgency === 'hot'
              ? 'bg-red-50/70 border-red-200/50 text-red-900/90'
              : summary.urgency === 'high'
              ? 'bg-indigo-50/70 border-indigo-200/50 text-indigo-900/90'
              : 'bg-black/[0.02] border-black/5 text-[#1D1D1F]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <span className="text-base mt-0.5" role="img" aria-label="reason-icon">
              {summary.urgency === 'hot' ? '🔥' : '🎯'}
            </span>
            <div className="space-y-1">
              <span className="block text-[10px] font-bold uppercase tracking-wider opacity-75">
                {labels.reasonTitle}
              </span>
              <p className="text-[11.5px] font-semibold leading-relaxed">
                {summary.aiReason}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main AI Summary (Görüşme Özeti) */}
      {summary.summary && (
        <div 
          className="bg-white/60 backdrop-blur-md rounded-2xl border border-black/5 p-4 space-y-3 shadow-sm"
          style={{ border: '1px solid var(--q-border-default)' }}
        >
          <div className="flex items-center gap-2 pb-2 border-b border-black/[0.04]">
            <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
              {labels.summaryTitle}
            </span>
            {summary.source === 'legacy_fallback' && (
              <span className="text-[9px] font-semibold text-[#86868B] px-1.5 py-0.5 bg-black/[0.04] rounded-md">
                Arşiv Özeti
              </span>
            )}
          </div>
          <p className="text-[13px] text-[#1D1D1F] leading-relaxed font-semibold">
            {summary.summary}
          </p>
        </div>
      )}

      {/* Next Best Action if available */}
      {summary.nextBestAction && (
        <div className="bg-amber-50/50 border border-amber-100/60 rounded-xl p-3 flex gap-2.5 items-start">
          <span className="text-base mt-0.5">💡</span>
          <div className="space-y-0.5 text-[11px]">
            <span className="block font-bold text-amber-800 uppercase tracking-wider text-[9px]">
              {labels.nextActionTitle}
            </span>
            <p className="font-semibold text-amber-900 leading-relaxed">
              {summary.nextBestAction}
            </p>
          </div>
        </div>
      )}

      {/* Missing Information list if available */}
      {summary.missingInfo && summary.missingInfo.length > 0 && (
        <div className="bg-red-50/40 border border-red-150 rounded-xl p-3 flex gap-2.5 items-start">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div className="space-y-1 text-[11px] text-red-900/90">
            <span className="block font-bold text-red-800 uppercase tracking-wider text-[9px]">
              {labels.missingInfoTitle}
            </span>
            <ul className="list-disc list-inside space-y-0.5 font-semibold">
              {summary.missingInfo.map((field, idx) => (
                <li key={idx} className="capitalize">
                  {field.replace(/_/g, ' ')}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
