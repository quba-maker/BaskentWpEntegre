"use client";

import React from "react";
import { Sparkles, Bot, AlertTriangle, Check, ExternalLink, Globe, HelpCircle } from "lucide-react";
import { GreetingAutomationDecision } from "@/lib/services/automation/first-contact-decision-resolver";
import { FormDecisionPresenter } from "@/lib/services/forms/form-autopilot-decision-presenter";

interface FormAutopilotStatusCardProps {
  decision: GreetingAutomationDecision | null | undefined;
  loading?: boolean;
  onActionClick?: (action: 'go_to_inbox' | 'prepare_draft' | 'select_template' | 'none') => void;
}

export function FormAutopilotStatusCard({
  decision,
  loading = false,
  onActionClick
}: FormAutopilotStatusCardProps) {
  if (loading) {
    return (
      <div className="w-full bg-white border border-black/5 rounded-2xl p-5 shadow-sm animate-pulse flex flex-col space-y-3">
        <div className="flex items-center justify-between border-b border-black/5 pb-2">
          <div className="h-4 w-32 bg-gray-200 rounded"></div>
          <div className="h-4 w-16 bg-gray-200 rounded-full"></div>
        </div>
        <div className="h-3 w-4/5 bg-gray-200 rounded"></div>
        <div className="h-3 w-2/3 bg-gray-200 rounded"></div>
        <div className="h-9 w-full bg-gray-200 rounded-xl pt-2"></div>
      </div>
    );
  }

  if (!decision) {
    return (
      <div className="w-full bg-white border border-black/5 rounded-2xl p-5 shadow-sm text-left flex items-start gap-3">
        <HelpCircle className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Durum Belirlenemedi</h4>
          <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
            Lead için otopilot/karşılama durum verisi bulunmamaktadır.
          </p>
        </div>
      </div>
    );
  }

  const presentation = FormDecisionPresenter.present(decision);

  const badgeColorClasses = {
    green: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    orange: 'bg-orange-50 text-orange-600 border-orange-200',
    yellow: 'bg-amber-50 text-amber-600 border-amber-200',
    red: 'bg-rose-50 text-rose-600 border-rose-200',
    gray: 'bg-stone-50 text-stone-500 border-stone-200',
    blue: 'bg-blue-50 text-blue-600 border-blue-200'
  };

  const badgeColor = presentation.badgeColor || 'gray';

  return (
    <div className="w-full bg-white border border-black/5 rounded-2xl p-5 shadow-sm text-left space-y-4 transition-all duration-200 hover:shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/5 pb-3">
        <span className="text-xs font-bold text-[#1D1D1F] flex items-center gap-1.5">
          <Bot className="w-4 h-4 text-blue-600" />
          Karşılama Otopilotu
        </span>
        <span 
          className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full border tracking-wider ${badgeColorClasses[badgeColor]}`}
        >
          {presentation.badgeText}
        </span>
      </div>

      {/* Main Info */}
      <div className="space-y-1">
        <h4 className="text-sm font-bold text-[#1D1D1F]">
          {presentation.title}
        </h4>
        <p className="text-[12px] text-[#515154] leading-relaxed font-medium">
          {presentation.description}
        </p>
      </div>

      {/* Language Suggestion */}
      {presentation.showLanguageSuggestion && (
        <div className="flex items-center gap-3 p-3 bg-[#F5F5F7] rounded-xl border border-black/5">
          <Globe className="w-4 h-4 text-blue-500 shrink-0" />
          <div className="flex-1 flex items-center justify-between text-xs">
            <span className="font-bold text-[#1D1D1F]">
              {presentation.suggestedLanguageText}
            </span>
            <span className="text-[11px] font-semibold text-[#86868B]">
              {presentation.languageConfidenceText}
            </span>
          </div>
        </div>
      )}

      {/* Technical details when dry-run / lock etc. is active */}
      {decision.category === 'bot_auto_eligible' && !decision.finalActionAllowed && (
        <div className="p-3 bg-amber-500/[0.04] border border-amber-500/10 rounded-xl flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed text-amber-800 font-semibold">
            <span className="font-bold">Güvenlik Engeli:</span> {decision.userFriendlyReason || decision.reason}
          </div>
        </div>
      )}

      {/* Action Button */}
      {presentation.buttonAction !== 'none' && (
        <button
          onClick={() => onActionClick?.(presentation.buttonAction)}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold text-white shadow-sm transition-all duration-200 active:scale-[0.98] cursor-pointer ${
            presentation.buttonAction === 'go_to_inbox'
              ? 'bg-[#007AFF] hover:bg-[#0056b3] shadow-[0_4px_12px_rgba(0,122,255,0.25)]'
              : presentation.buttonAction === 'prepare_draft'
              ? 'bg-[#25D366] hover:bg-[#1DA851] shadow-[0_4px_12px_rgba(37,211,102,0.25)]'
              : 'bg-amber-500 hover:bg-amber-600 shadow-[0_4px_12px_rgba(245,158,11,0.25)]'
          }`}
        >
          {presentation.buttonAction === 'go_to_inbox' && (
            <>Konuşmaya Git <ExternalLink className="w-4 h-4" /></>
          )}
          {presentation.buttonAction === 'prepare_draft' && (
            <>Taslak Oluştur <Sparkles className="w-4 h-4" /></>
          )}
          {presentation.buttonAction === 'select_template' && (
            <>Şablon Seç <Check className="w-4 h-4" /></>
          )}
        </button>
      )}
    </div>
  );
}
