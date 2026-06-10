"use client";

import { Calendar, Share2, Phone, Globe } from "lucide-react";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

interface QuickMetricsGridProps {
  submittedAt?: string;
  platform?: string;
  phone?: string;
  countryName?: string;
  countryFlag?: string;
  isCountryEstimated?: boolean;
}

export function QuickMetricsGrid({
  submittedAt,
  platform,
  phone,
  countryName,
  countryFlag,
  isCountryEstimated
}: QuickMetricsGridProps) {
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "Bilinmiyor";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
      <div className="bg-slate-50 p-3 rounded-2xl border border-black/[0.02]">
        <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Tarih</span>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1D1D1F]">
          <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span className="truncate" title={submittedAt}>{formatDate(submittedAt)}</span>
        </div>
      </div>

      <div className="bg-slate-50 p-3 rounded-2xl border border-black/[0.02]">
        <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Kaynak</span>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1D1D1F]">
          <Share2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span className="truncate" title={platform}>{platform || "Facebook / Meta"}</span>
        </div>
      </div>

      <div className="bg-slate-50 p-3 rounded-2xl border border-black/[0.02]">
        <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Telefon</span>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1D1D1F]">
          <Phone className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span className="truncate" title={phone}>{phone ? formatPhoneReadable(phone) : "Belirtilmemiş"}</span>
        </div>
      </div>

      <div className="bg-slate-50 p-3 rounded-2xl border border-black/[0.02]">
        <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Ülke</span>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1D1D1F]">
          <Globe className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span 
            className="truncate flex items-center gap-1" 
            title={isCountryEstimated ? "Telefon kodundan tahmin edildi" : undefined}
          >
            {countryFlag && <span className="shrink-0">{countryFlag}</span>}
            <span className="truncate">{countryName || "Belirtilmemiş"}</span>
            {isCountryEstimated && countryName && <span className="text-[10px] opacity-60">*</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
