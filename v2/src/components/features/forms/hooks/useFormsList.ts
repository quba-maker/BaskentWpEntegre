"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { getForms, syncGoogleSheets, getFormStatusCounts, getFormsSyncMetadata } from "@/app/actions/forms";

export function useFormsList() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [firstContactFilter, setFirstContactFilter] = useState("all");
  const [leadStageFilter, setLeadStageFilter] = useState("all");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  
  const [syncProgress, setSyncProgress] = useState<{
    status: string;
    progress: number;
    message: string;
    stats?: {
      created: number;
      updated: number;
      unchanged: number;
      duplicates: number;
      errors: number;
      duration: string;
      controlRequired?: number;
      skippedUnknownTab?: number;
    };
    telemetry?: {
      authDurationMs: number;
      readDurationMs: number;
      parseDurationMs: number;
      dupDetectionDurationMs: number;
      dbDurationMs: number;
      totalDurationMs: number;
      formsListRevalidateMs?: number;
      statusCountsRevalidateMs?: number;
      syncMetadataRevalidateMs?: number;
    };
  }>({ status: '', progress: 0, message: '' });

  // SWR status counts
  const { data: statusCounts, mutate: mutateCounts } = useSWR(
    ["form-status-counts"],
    () => getFormStatusCounts(),
    { revalidateOnFocus: false }
  );

  // SWR sync metadata
  const { data: syncMetadata, mutate: mutateMetadata } = useSWR(
    ["form-sync-metadata"],
    () => getFormsSyncMetadata(),
    { revalidateOnFocus: false }
  );

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reset selected checkboxes on filter changes
  useEffect(() => {
    setSelectedLeadIds([]);
  }, [debouncedSearch, sourceFilter, firstContactFilter, leadStageFilter]);

  const getKey = (pageIndex: number, previousPageData: any) => {
    if (previousPageData && previousPageData.length < 50) return null;
    return ["forms", pageIndex + 1, debouncedSearch, sourceFilter, firstContactFilter, leadStageFilter];
  };

  const { data, size, setSize, isLoading, mutate } = useSWRInfinite(
    getKey,
    ([_, page, search, source, fContact, lStage]: any) => getForms(page, search, source, fContact, lStage),
    {
      refreshInterval: 300000, // Reduced refresh storm from 90s to 5min (300000ms)
      refreshWhenHidden: false,
      revalidateOnFocus: false // Disabled revalidateOnFocus to prevent storm
    }
  );

  const forms = data ? data.flat() : [];
  const isLoadingMore = isLoading || (size > 0 && data && typeof data[size - 1] === "undefined");
  const isReachingEnd = data && data[data.length - 1]?.length < 50;

  const clearSyncProgress = () => {
    setSyncProgress({ status: '', progress: 0, message: '' });
  };

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      setSyncProgress({ status: 'starting', progress: 10, message: 'Bağlantı kontrol ediliyor...' });
      
      const steps = [
        { progress: 30, message: 'Veriler okunuyor...' },
        { progress: 55, message: 'Kayıtlar karşılaştırılıyor...' },
        { progress: 80, message: 'Form listesi güncelleniyor...' },
        { progress: 95, message: 'Sonuç hazırlanıyor...' }
      ];

      let currentStep = 0;
      const interval = setInterval(() => {
        if (currentStep < steps.length) {
          setSyncProgress({
            status: 'processing',
            progress: steps[currentStep].progress,
            message: steps[currentStep].message
          });
          currentStep++;
        }
      }, 1000);

      const startTime = Date.now();
      const res = await syncGoogleSheets();
      clearInterval(interval);
      const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

      setIsSyncing(false);

      if (res.success) {
        // Measure SWR revalidation times sequentially to prevent race conditions
        const formsListStart = Date.now();
        await setSize(1);
        await mutate();
        const formsListRevalidateMs = Date.now() - formsListStart;

        const countsStart = Date.now();
        await mutateCounts();
        const statusCountsRevalidateMs = Date.now() - countsStart;

        const metaStart = Date.now();
        await mutateMetadata();
        const syncMetadataRevalidateMs = Date.now() - metaStart;

        setSyncProgress({
          status: 'completed',
          progress: 100,
          message: res.message || 'Senkronizasyon tamamlandı.',
          stats: res.stats ? {
            created: res.stats.created || 0,
            updated: res.stats.updated || 0,
            unchanged: res.stats.unchanged || 0,
            duplicates: res.stats.duplicates || 0,
            errors: res.stats.errors || 0,
            controlRequired: res.stats.controlRequired || 0,
            skippedUnknownTab: res.stats.skippedUnknownTab || 0,
            duration: durationSeconds
          } : undefined,
          telemetry: res.telemetry ? {
            ...res.telemetry,
            formsListRevalidateMs,
            statusCountsRevalidateMs,
            syncMetadataRevalidateMs
          } : undefined
        });
      } else {
        const errMsg = res.error || "Senkronizasyon başarısız.";
        setSyncProgress({ status: 'error', progress: 0, message: errMsg });
      }
    } catch (e: any) {
      setIsSyncing(false);
      const errMsg = e?.message || 'Senkronizasyon başlatılamadı.';
      setSyncProgress({ status: 'error', progress: 0, message: errMsg });
    }
  };

  return {
    searchInput,
    setSearchInput,
    debouncedSearch,
    setDebouncedSearch,
    sourceFilter,
    setSourceFilter,
    firstContactFilter,
    setFirstContactFilter,
    leadStageFilter,
    setLeadStageFilter,
    selectedLeadIds,
    setSelectedLeadIds,
    isSyncing,
    setIsSyncing,
    syncProgress,
    setSyncProgress,
    clearSyncProgress,
    handleSync,
    statusCounts,
    syncMetadata,
    forms,
    size,
    setSize,
    isLoading,
    isLoadingMore,
    isReachingEnd,
    mutate
  };
}
