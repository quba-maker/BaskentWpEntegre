"use client";

import React from "react";
import { MessageCircle, Sparkles, AlertTriangle, FileText, CheckCircle, ArrowRight, X } from "lucide-react";
import { GreetingAutomationDecision } from "@/lib/services/automation/first-contact-decision-resolver";

interface BulkAutopilotDecisionBarProps {
  decisions: GreetingAutomationDecision[];
  onClearSelection: () => void;
  onPrepareDrafts: () => void;
  onSendTemplates: () => void;
  onFilterTemplateRequired: () => void;
  onFilterInboxOpen: () => void;
}

export function BulkAutopilotDecisionBar({
  decisions,
  onClearSelection,
  onPrepareDrafts,
  onSendTemplates,
  onFilterTemplateRequired,
  onFilterInboxOpen
}: BulkAutopilotDecisionBarProps) {
  if (!decisions || decisions.length === 0) return null;

  const total = decisions.length;
  const botAutoEligible = decisions.filter(d => (d.baseCategory || d.category) === 'bot_auto_eligible').length;
  const manualDraftRequired = decisions.filter(d => (d.baseCategory || d.category) === 'manual_draft_required').length;
  const manualTemplateRequired = decisions.filter(d => (d.baseCategory || d.category) === 'manual_template_required').length;
  const alreadyOpenInbox = decisions.filter(d => ((d.baseCategory || d.category) as string) === 'already_open_inbox' || ((d.baseCategory || d.category) as string) === 'already_processed').length;
  const notEligible = total - (botAutoEligible + manualDraftRequired + manualTemplateRequired + alreadyOpenInbox);

  const isLiveLocked = decisions.some(d => d.gateState && d.gateState !== 'open');

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-[800px] px-4 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-[#1D1D1F] text-white rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.35)] border border-white/10 p-4 flex flex-col gap-3.5">
        
        {/* Header Summary Info */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-blue-400" />
            <span className="font-bold text-xs uppercase tracking-wider text-gray-400">
              Toplu İlk Temas ({total} Form Seçildi)
            </span>
          </div>
          <button
            onClick={onClearSelection}
            className="p-1 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
            title="Seçimi Kapat"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Breakdown Row */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle className="w-3.5 h-3.5" /> Inbox'ta Yanıt: {botAutoEligible}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <Sparkles className="w-3.5 h-3.5" /> Taslak: {manualDraftRequired}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <FileText className="w-3.5 h-3.5" /> Hazır Şablon: {manualTemplateRequired}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <MessageCircle className="w-3.5 h-3.5" /> Cevap Bekleniyor: {alreadyOpenInbox}
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertTriangle className="w-3.5 h-3.5" /> Uygun Değil: {notEligible}
          </span>
        </div>

        {/* Live lock warning */}
        {isLiveLocked && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-bold leading-normal">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Bu seçimlerde canlı gönderime kapalı kayıtlar var. Sistem uygun olmayan kişiye mesaj göndermez.</span>
          </div>
        )}

        {/* Five Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          {/* Leftside action filters */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onFilterTemplateRequired}
              className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 rounded-xl text-xs font-bold transition-all border border-amber-500/20"
              title="Şablon Gereken Formları Listeler"
            >
              Hazır Şablon Gerekenler
            </button>
            <button
              onClick={onFilterInboxOpen}
              className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 rounded-xl text-xs font-bold transition-all border border-blue-500/20"
              title="Zaten Inbox'ta Açılanları Listeler"
            >
              Cevap Bekleyenler
            </button>
          </div>

          {/* Rightside action triggers */}
          <div className="flex gap-2 items-center">
            <button
              onClick={onClearSelection}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-bold transition-all"
            >
              Seçimi Kaldır
            </button>
            <button
              onClick={onPrepareDrafts}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#007AFF] hover:bg-[#0056b3] text-white rounded-xl text-xs font-bold transition-all active:scale-[0.98] shadow-md shadow-[#007AFF]/25 cursor-pointer"
            >
              Taslak Hazırla <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onSendTemplates}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#34C759] hover:bg-[#248A3D] text-white rounded-xl text-xs font-bold transition-all active:scale-[0.98] shadow-md shadow-[#34C759]/25 cursor-pointer"
            >
              Hazır Şablonla Gönder <FileText className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
