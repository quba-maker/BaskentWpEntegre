"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Filter, X, RefreshCw, CheckCircle2 } from "lucide-react";
import { getCampaignNames } from "@/app/actions/forms";

interface FormFiltersBarProps {
  searchInput: string;
  setSearchInput: (val: string) => void;
  sourceFilter: string;
  setSourceFilter: (val: string) => void;
  firstContactFilter: string;
  setFirstContactFilter: (val: string) => void;
  leadStageFilter: string;
  setLeadStageFilter: (val: string) => void;
  isSyncing: boolean;
  syncProgress: { status: string; progress: number; message: string };
  handleSync: () => void;
  syncMetadata?: { lastManualSync: string | null; lastAutoSync: string | null } | null;
}

export function FormFiltersBar({
  searchInput,
  setSearchInput,
  sourceFilter,
  setSourceFilter,
  firstContactFilter,
  setFirstContactFilter,
  leadStageFilter,
  setLeadStageFilter,
  isSyncing,
  syncProgress,
  handleSync,
  syncMetadata
}: FormFiltersBarProps) {
  const [campaigns, setCampaigns] = useState<string[]>([]);
  
  useEffect(() => {
    getCampaignNames().then(setCampaigns);
  }, []);

  const formatSyncDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('tr-TR', { 
        timeZone: 'Europe/Istanbul',
        day: 'numeric', 
        month: 'short', 
        year: 'numeric',
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch (_) {
      return null;
    }
  };

  const hasActiveFilters = sourceFilter !== 'all' || firstContactFilter !== 'all' || leadStageFilter !== 'all';

  const mFormatted = formatSyncDate(syncMetadata?.lastManualSync);
  const aFormatted = formatSyncDate(syncMetadata?.lastAutoSync);

  return (
    <div className="space-y-4 mb-4">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#1D1D1F]">Form Yönetimi</h1>
          <p className="text-[#86868B] mt-1 text-sm md:text-base font-medium">Tüm kanallardan gelen güncel lead kayıtları</p>
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Sync Button & Progress */}
          <div className="flex items-center gap-3 bg-white/40 p-1.5 rounded-2xl border border-white/40">
            <div className="relative flex items-center">
              {isSyncing ? (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium bg-blue-50 text-blue-600 border-blue-100`}>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="min-w-[120px]">{syncProgress.message || 'Senkronize ediliyor...'}</span>
                </div>
              ) : (
                <button
                  onClick={handleSync}
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#007AFF] text-white rounded-xl hover:bg-[#007AFF]/90 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer border border-black/5 font-semibold text-xs shadow-sm shadow-[#007AFF]/10"
                  title="Korumalı sync aktif (Seçili sekmeler enforcer etkindir)"
                >
                  <RefreshCw className="w-4 h-4" />
                  Senkronize Et
                </button>
              )}
            </div>

            <div className="text-[10px] text-[#86868B] flex flex-col justify-center pr-3 min-w-[140px] select-none leading-tight">
              {!syncMetadata || (!syncMetadata.lastManualSync && !syncMetadata.lastAutoSync) ? (
                <span className="italic font-medium text-slate-400">Henüz senkronizasyon bilgisi yok</span>
              ) : (
                <>
                  {mFormatted && (
                    <span className="font-semibold text-slate-600">Manuel: <span className="font-normal text-slate-500">{mFormatted}</span></span>
                  )}
                  {aFormatted && (
                    <span className="font-semibold text-slate-600 mt-0.5">Otomatik: <span className="font-normal text-slate-500">{aFormatted}</span></span>
                  )}
                  <span className="text-[9px] text-[#86868B] mt-0.5 italic">Türkiye saatiyle</span>
                </>
              )}
            </div>
          </div>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#86868B]" />
            <input 
              type="text" 
              placeholder="İsim, telefon veya e-posta..." 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white/60 backdrop-blur-md border border-white/60 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#007AFF]/40 focus:bg-white transition-all shadow-[0_2px_10px_rgba(0,0,0,0.02)]"
            />
          </div>
        </div>
      </div>
      
      {/* Active Filters Bar */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">Filtreler:</span>
          {sourceFilter !== 'all' && (
            <button 
              onClick={() => setSourceFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#007AFF]/10 text-[#007AFF] text-[11px] font-bold hover:bg-[#007AFF]/20 transition-colors"
            >
              <Filter className="w-3 h-3" />
              {sourceFilter.length > 25 ? sourceFilter.substring(0, 25) + '...' : sourceFilter}
              <X className="w-3 h-3 ml-1" />
            </button>
          )}
          {firstContactFilter !== 'all' && (
            <button 
              onClick={() => setFirstContactFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[11px] font-bold hover:bg-indigo-100 transition-colors border border-indigo-200"
            >
              <Filter className="w-3 h-3" />
              {firstContactFilter}
              <X className="w-3 h-3 ml-1" />
            </button>
          )}
          {leadStageFilter !== 'all' && (
            <button 
              onClick={() => setLeadStageFilter('all')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold hover:opacity-80 transition-colors border bg-slate-50 text-slate-700 border-slate-200"
            >
              {leadStageFilter}
              <X className="w-3 h-3 ml-1" />
            </button>
          )}
          <button 
            onClick={() => { setSourceFilter('all'); setFirstContactFilter('all'); setLeadStageFilter('all'); }}
            className="text-[11px] font-semibold text-[#86868B] hover:text-[#1D1D1F] transition-colors ml-1"
          >
            Tümünü temizle
          </button>
        </div>
      )}
    </div>
  );
}
