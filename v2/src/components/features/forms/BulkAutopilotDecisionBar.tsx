"use client";

import React from "react";
import { Bot, Sparkles, AlertTriangle, FileText, CheckCircle, ArrowRight } from "lucide-react";
import { GreetingAutomationDecision } from "@/lib/services/automation/first-contact-decision-resolver";

interface BulkAutopilotDecisionBarProps {
  decisions: GreetingAutomationDecision[];
  onClearSelection?: () => void;
  onNavigateToInbox?: () => void;
}

export function BulkAutopilotDecisionBar({
  decisions,
  onClearSelection,
  onNavigateToInbox
}: BulkAutopilotDecisionBarProps) {
  if (decisions.length === 0) return null;

  const total = decisions.length;
  const botAutoEligible = decisions.filter(d => d.category === 'bot_auto_eligible').length;
  const manualDraftRequired = decisions.filter(d => d.category === 'manual_draft_required').length;
  const manualTemplateRequired = decisions.filter(d => d.category === 'manual_template_required').length;
  const alreadyOpenInbox = decisions.filter(d => d.category === 'already_open_inbox' || d.category === 'already_processed').length;
  const others = total - (botAutoEligible + manualDraftRequired + manualTemplateRequired + alreadyOpenInbox);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-[680px] px-4 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-[#1D1D1F] text-white rounded-2xl shadow-[0_12px_30px_rgba(0,0,0,0.3)] border border-white/10 p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Summary Info */}
        <div className="flex-1 text-left space-y-2.5 w-full">
          <div className="flex items-center gap-2 border-b border-white/10 pb-2">
            <Bot className="w-4 h-4 text-blue-400" />
            <span className="font-bold text-xs uppercase tracking-wider text-gray-400">
              Toplu İlk Temas Otomasyon Analizi ({total} Seçili)
            </span>
          </div>

          {/* Breakdown Pills */}
          <div className="flex flex-wrap gap-1.5">
            {botAutoEligible > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle className="w-3 h-3" /> {botAutoEligible} Otopilot Hazır
              </span>
            )}
            {manualDraftRequired > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20">
                <Sparkles className="w-3 h-3" /> {manualDraftRequired} Taslak Gerekli
              </span>
            )}
            {manualTemplateRequired > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <FileText className="w-3 h-3" /> {manualTemplateRequired} Şablon Gerekli
              </span>
            )}
            {alreadyOpenInbox > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Bot className="w-3 h-3" /> {alreadyOpenInbox} Zaten İletişimde
              </span>
            )}
            {others > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                <AlertTriangle className="w-3 h-3" /> {others} Hata/Uyumsuz
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end border-t md:border-t-0 border-white/10 pt-3 md:pt-0">
          <button
            onClick={onClearSelection}
            className="px-3 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            Seçimi Kaldır
          </button>
          
          {onNavigateToInbox && (botAutoEligible > 0 || alreadyOpenInbox > 0) && (
            <button
              onClick={onNavigateToInbox}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#007AFF] hover:bg-[#0056b3] text-white rounded-xl text-xs font-bold transition-all duration-200 active:scale-[0.98] shadow-md shadow-[#007AFF]/25 cursor-pointer"
            >
              Konuşmalara Git <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
