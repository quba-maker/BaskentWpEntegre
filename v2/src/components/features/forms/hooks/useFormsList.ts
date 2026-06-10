"use client";

import { useState, useEffect } from "react";
import useSWRInfinite from "swr/infinite";
import { getForms, syncGoogleSheets } from "@/app/actions/forms";

export function useFormsList() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [firstContactFilter, setFirstContactFilter] = useState("all");
  const [leadStageFilter, setLeadStageFilter] = useState("all");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ status: '', progress: 0, message: '' });

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

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      setSyncProgress({ status: 'starting', progress: 0, message: 'Google Sheets verileri çekiliyor...' });
      
      const timeout = setTimeout(() => {
        setSyncProgress({ status: 'error', progress: 0, message: 'İşlem zaman aşımına uğradı. Tekrar deneyin.' });
        setTimeout(() => setIsSyncing(false), 3000);
      }, 30000);

      const res = await syncGoogleSheets();
      clearTimeout(timeout);
      
      if (res.success) {
        setSyncProgress({ status: 'completed', progress: 100, message: res.message || 'Senkronizasyon tamamlandı.' });
        mutate();
        setTimeout(() => setIsSyncing(false), 2500);
      } else {
        const errMsg = res.error || "Senkronizasyon başarısız.";
        setSyncProgress({ status: 'error', progress: 0, message: errMsg });
        setTimeout(() => setIsSyncing(false), 4000);
      }
    } catch (e: any) {
      setSyncProgress({ status: 'error', progress: 0, message: e?.message || 'Senkronizasyon başlatılamadı.' });
      setTimeout(() => setIsSyncing(false), 4000);
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
    syncProgress,
    handleSync,
    forms,
    size,
    setSize,
    isLoading,
    isLoadingMore,
    isReachingEnd,
    mutate
  };
}
