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
    <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-none animate-in slide-in-from-bottom-4 duration-300">
      <div className="pointer-events-auto w-full max-w-[920px] bg-white rounded-2xl shadow-[0_18px_55px_rgba(15,23,42,0.16)] border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4 bg-white">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[#1D1D1F]">
              <MessageCircle className="w-4 h-4 text-[#007AFF]" />
              <span className="font-bold text-sm">Toplu İlk Temas</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {total} form seçildi
              </span>
            </div>
            <p className="mt-1 text-xs text-[#86868B]">
              Seçili kayıtlar durumuna göre taslak, hazır şablon veya inbox yanıtı olarak ayrılır.
            </p>
          </div>
          <button
            onClick={onClearSelection}
            className="shrink-0 p-2 hover:bg-slate-100 rounded-xl transition-colors text-[#86868B] hover:text-[#1D1D1F]"
            title="Seçimi kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            <span className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
              <CheckCircle className="w-3.5 h-3.5" /> Inbox yanıtı: {botAutoEligible}
            </span>
            <span className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-bold bg-orange-50 text-orange-700 border border-orange-100">
              <Sparkles className="w-3.5 h-3.5" /> Taslak: {manualDraftRequired}
            </span>
            <span className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-bold bg-amber-50 text-amber-700 border border-amber-100">
              <FileText className="w-3.5 h-3.5" /> Şablon: {manualTemplateRequired}
            </span>
            <span className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-bold bg-blue-50 text-blue-700 border border-blue-100">
              <MessageCircle className="w-3.5 h-3.5" /> Bekleyen: {alreadyOpenInbox}
            </span>
            <span className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl font-bold bg-rose-50 text-rose-700 border border-rose-100">
              <AlertTriangle className="w-3.5 h-3.5" /> Kontrol: {notEligible}
            </span>
          </div>

          {isLiveLocked && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold leading-relaxed">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>Seçimin içinde canlı gönderime uygun olmayan kayıtlar var. Sistem bu kişilere mesaj göndermez.</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onFilterTemplateRequired}
                className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-xl text-xs font-bold transition-all border border-amber-200"
              >
                Şablon gerekenleri göster
              </button>
              <button
                onClick={onFilterInboxOpen}
                className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-xl text-xs font-bold transition-all border border-blue-200"
              >
                Cevap bekleyenleri göster
              </button>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={onClearSelection}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
              >
                Seçimi kaldır
              </button>
              <button
                onClick={onPrepareDrafts}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#007AFF] hover:bg-[#0056b3] text-white rounded-xl text-xs font-bold transition-all active:scale-[0.98] shadow-sm cursor-pointer"
              >
                Taslak hazırla <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onSendTemplates}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#34C759] hover:bg-[#248A3D] text-white rounded-xl text-xs font-bold transition-all active:scale-[0.98] shadow-sm cursor-pointer"
              >
                Hazır şablon gönder <FileText className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
