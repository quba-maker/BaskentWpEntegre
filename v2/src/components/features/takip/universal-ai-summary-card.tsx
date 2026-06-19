import React, { useState } from 'react';
import { Sparkles, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { 
  type UniversalAISummary, 
  getAISummaryLabels 
} from '@/lib/utils/universal-summary-resolver';

interface UniversalAISummaryCardProps {
  summary: UniversalAISummary;
  className?: string;
  compact?: boolean;
  defaultCollapsed?: boolean;
  maxLines?: number;
}

export function UniversalAISummaryCard({ 
  summary, 
  className = '', 
  compact = false,
  defaultCollapsed = true,
  maxLines = 3
}: UniversalAISummaryCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  // If there is no summary source at all, hide the card or show an empty state.
  if (summary.source === 'none') {
    return null;
  }

  // Get localized labels based on dynamically resolved entity type
  const labels = getAISummaryLabels(summary.entityType);

  // Determine if summary text is long enough to collapse (e.g. over 120 chars)
  const isLongSummary = summary.summary && summary.summary.length > 120;
  const shouldCollapse = compact && isLongSummary;

  return (
    <div className={`space-y-2.5 ${className}`}>
      {/* Short urgency-aware reason card (Neden Önemli / Fırsat Gerekçesi) */}
      {summary.aiReason && (
        <div 
          className={`px-3 py-2.5 rounded-2xl border transition-all duration-300 shadow-sm ${
            summary.urgency === 'hot'
              ? 'bg-red-50/70 border-red-200/50 text-red-900/90'
              : summary.urgency === 'high'
              ? 'bg-indigo-50/70 border-indigo-200/50 text-indigo-900/90'
              : 'bg-black/[0.02] border-black/5 text-[#1D1D1F]'
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="text-sm mt-0.5" role="img" aria-label="reason-icon">
              {summary.urgency === 'hot' ? '🔥' : '🎯'}
            </span>
            <div className="space-y-0.5">
              <span className="block text-[9px] font-bold uppercase tracking-wider opacity-75">
                {labels.reasonTitle}
              </span>
              <p className="text-[11px] font-semibold leading-relaxed">
                {summary.aiReason}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Static Form Summary (Form Özeti) */}
      {summary.formSummary && (
        <div 
          className="bg-stone-50 rounded-2xl border border-black/5 p-3.5 space-y-1.5 shadow-sm text-left"
          style={{ border: '1px solid var(--q-border-default)' }}
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-black/[0.04]">
            <span className="text-[9px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
              📝 Form Özeti
            </span>
          </div>
          <p className="text-[12px] text-[#1D1D1F] leading-relaxed font-semibold">
            {summary.formSummary}
          </p>
        </div>
      )}

      {/* Main AI Summary (Görüşme Özeti) */}
      {summary.summary && (
        <div 
          className="bg-white/60 backdrop-blur-md rounded-2xl border border-black/5 p-3.5 space-y-2 shadow-sm text-left"
          style={{ border: '1px solid var(--q-border-default)' }}
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-black/[0.04]">
            <span className="text-[9px] font-bold text-[#86868B] uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-indigo-600" />
              {labels.summaryTitle}
            </span>
            {summary.source === 'legacy_fallback' && (
              <span className="text-[8px] font-semibold text-[#86868B] px-1.5 py-0.5 bg-black/[0.04] rounded-md">
                Arşiv Özeti
              </span>
            )}
          </div>
          
          <div className="relative">
            <p 
              className="text-[12px] text-[#1D1D1F] leading-relaxed font-semibold transition-all duration-300"
              style={shouldCollapse && isCollapsed ? {
                display: '-webkit-box',
                WebkitLineClamp: maxLines,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              } : undefined}
            >
              {summary.summary}
            </p>
            
            {shouldCollapse && (
              <button
                type="button"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="mt-1.5 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-0.5 cursor-pointer"
              >
                {isCollapsed ? (
                  <>
                    <span>Devamını göster</span>
                    <ChevronDown className="w-3 h-3" />
                  </>
                ) : (
                  <>
                    <span>Daralt</span>
                    <ChevronUp className="w-3 h-3" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Next Best Action if available */}
      {summary.nextBestAction && (
        <div className="bg-amber-50/50 border border-amber-100/60 rounded-xl p-2.5 flex gap-2 items-start text-left">
          <span className="text-sm mt-0.5">💡</span>
          <div className="space-y-0.5 text-[10px]">
            <span className="block font-bold text-amber-800 uppercase tracking-wider text-[8px]">
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
        <div className="bg-red-50/40 border border-red-150 rounded-xl p-2.5 flex gap-2 items-start text-left">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5 text-[10px] text-red-900/90">
            <span className="block font-bold text-red-800 uppercase tracking-wider text-[8px]">
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

