"use client";

import React, { useState } from "react";
import { Bot, User, Check, RefreshCw, X, ShieldAlert, Sparkles, AlertTriangle, FileText, CheckCircle } from "lucide-react";

interface InboxBotControlBarProps {
  selectedCount: number;
  selectedConversations: any[];
  onSetBotMode: (enabled: boolean) => Promise<{
    success: boolean;
    summary?: {
      processed: number;
      skippedHuman: number;
      skippedOther: number;
    };
    error?: string;
  } | null>;
  onClearSelection: () => void;
  onMarkRead?: () => Promise<void>;
}

export function InboxBotControlBar({
  selectedCount,
  selectedConversations = [],
  onSetBotMode,
  onClearSelection,
  onMarkRead
}: InboxBotControlBarProps) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<{
    processed: number;
    skippedHuman: number;
    skippedOther: number;
    enabled: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (selectedCount === 0) return null;

  // Calculate stats in-memory
  const now = Date.now();
  const botEnabled = selectedConversations.filter(c => c.status === 'bot' || c.autopilot_enabled === true || c.isBotActive === true).length;
  const botDisabled = selectedCount - botEnabled;
  const humanTakedOver = selectedConversations.filter(c => c.status === 'human').length;
  
  const metaOpen = selectedConversations.filter(c => {
    const timeMs = c.last_message_time_ms || (c.last_message_at ? new Date(c.last_message_at).getTime() : 0);
    const direction = c.last_message_direction || c.lastMessageDirection;
    return direction === 'in' && (now - timeMs) < 24 * 60 * 60 * 1000;
  }).length;
  const metaClosed = selectedCount - metaOpen;

  const handleAction = async (enabled: boolean) => {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const result = await onSetBotMode(enabled);
      if (result) {
        if (result.success && result.summary) {
          setSummary({
            ...result.summary,
            enabled
          });
        } else if (result.error) {
          setError(result.error);
        }
      }
    } catch (err) {
      setError("Toplu işlem sırasında bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-[720px] px-4 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-[#1D1D1F] text-white rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.35)] border border-white/10 p-4 flex flex-col gap-3.5">
        
        {/* Header & Close */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-blue-400" />
            <span className="font-bold text-xs uppercase tracking-wider text-gray-400">
              Toplu Bot Yönetimi ({selectedCount} Konuşma Seçildi)
            </span>
          </div>
          <button 
            onClick={() => {
              setSummary(null);
              setError(null);
              onClearSelection();
            }}
            className="p-1 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
            title="Seçimi Kapat"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Breakdown Row */}
        {!summary && !error && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle className="w-3.5 h-3.5" /> Bot Açık: {botEnabled}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-stone-500/10 text-stone-400 border border-stone-500/20">
              <User className="w-3.5 h-3.5" /> Bot Kapalı: {botDisabled}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5" /> İnsan Devralmış: {humanTakedOver}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Sparkles className="w-3.5 h-3.5" /> Meta Açık: {metaOpen}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <FileText className="w-3.5 h-3.5" /> Meta Kapalı: {metaClosed}
            </span>
          </div>
        )}

        {/* Action Panel */}
        {!summary && !error && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-white/10 pt-3">
            <div className="text-[11px] text-gray-400 text-left font-medium leading-relaxed max-w-[380px]">
              <span className="font-bold text-amber-400">💡 Önemli Bilgi:</span> Botu açmak hemen mesaj göndermez. Sadece sonraki uygun hasta mesajlarında botun cevap verebilmesini sağlar.
            </div>
            
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
              <button
                onClick={onClearSelection}
                className="px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Seçimi Kaldır
              </button>
              {onMarkRead && (
                <button
                  disabled={loading}
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await onMarkRead();
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all duration-200 disabled:opacity-50 cursor-pointer active:scale-[0.98]"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  Okundu Yap
                </button>
              )}
              <button
                disabled={loading}
                onClick={() => handleAction(true)}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all duration-200 disabled:opacity-50 cursor-pointer active:scale-[0.98]"
              >
                {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                Botu Aç
              </button>
              <button
                disabled={loading}
                onClick={() => handleAction(false)}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white rounded-xl text-xs font-bold transition-all duration-200 disabled:opacity-50 cursor-pointer active:scale-[0.98]"
              >
                {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <User className="w-3.5 h-3.5" />}
                Botu Kapat
              </button>
            </div>
          </div>
        )}

        {/* Success Summary */}
        {summary && (
          <div className="p-3 bg-white/[0.04] border border-white/5 rounded-xl space-y-2.5 text-left text-xs">
            <div className="font-bold text-emerald-400 flex items-center gap-1.5">
              <Check className="w-4 h-4" /> Toplu Bot Durumu Güncellendi ({summary.enabled ? 'Açıldı' : 'Kapatıldı'})
            </div>
            
            <div className="grid grid-cols-3 gap-2 text-[11px] font-semibold text-gray-300">
              <div className="p-2 bg-white/[0.02] border border-white/5 rounded-lg">
                <span className="block text-[9px] text-gray-500 uppercase tracking-wider">İşlem Yapılan</span>
                <span className="text-white text-sm font-bold">{summary.processed}</span>
              </div>
              <div className="p-2 bg-white/[0.02] border border-white/5 rounded-lg" title="Status human olan temsilci konuşmaları atlandı">
                <span className="block text-[9px] text-gray-500 uppercase tracking-wider">Atlanan (Temsilci)</span>
                <span className="text-blue-400 text-sm font-bold">{summary.skippedHuman}</span>
              </div>
              <div className="p-2 bg-white/[0.02] border border-white/5 rounded-lg" title="Yetkisiz veya eşleşmeyen kanallar atlandı">
                <span className="block text-[9px] text-gray-500 uppercase tracking-wider">Atlanan (Diğer)</span>
                <span className="text-amber-400 text-sm font-bold">{summary.skippedOther}</span>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 italic">
              * Bot açıldı: Sonraki uygun hasta mesajlarında otomatik cevap verebilir.
            </p>
          </div>
        )}

        {/* Error Notification */}
        {error && (
          <div className="p-3 bg-red-950/20 border border-red-500/20 rounded-xl flex items-start gap-2.5 text-left text-xs font-semibold text-red-400">
            <ShieldAlert className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
            <div>
              <span className="block font-bold text-red-300">Hata Oluştu</span>
              {error}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
