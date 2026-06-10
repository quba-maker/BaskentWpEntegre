"use client";

import { FileText } from "lucide-react";

interface ComplaintCardProps {
  complaint?: string | null;
  appointmentPreference?: string | null;
  reportStatus?: string | null;
  department?: string | null;
}

export function ComplaintCard({
  complaint,
  appointmentPreference,
  reportStatus,
  department
}: ComplaintCardProps) {
  // If nothing is provided, return null
  const hasComplaint = complaint && complaint.trim() !== "" && complaint !== "Belirtilmemiş";
  const hasAppPref = appointmentPreference && appointmentPreference.trim() !== "" && appointmentPreference !== "Belirtilmemiş";
  const hasReport = reportStatus && reportStatus !== "none" && reportStatus !== "Belirtilmemiş";
  const hasDept = department && department.trim() !== "";

  if (!hasComplaint && !hasAppPref && !hasReport && !hasDept) return null;

  return (
    <div className="bg-indigo-50/20 rounded-2xl border border-indigo-500/10 p-4 space-y-3 text-left">
      <h4 className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> Şikayet & Tedavi Beklentisi
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        {hasComplaint && (
          <div>
            <span className="block text-[10px] font-bold text-[#86868B] mb-1">Şikayet / Talep</span>
            <p className="text-xs font-semibold text-[#1D1D1F] leading-relaxed bg-white p-3 rounded-xl border border-black/[0.04] break-words">
              {complaint}
            </p>
          </div>
        )}
        {hasAppPref && (
          <div>
            <span className="block text-[10px] font-bold text-[#86868B] mb-1">Randevu Tercihi</span>
            <p className="text-xs font-semibold text-[#1D1D1F] leading-relaxed bg-white p-3 rounded-xl border border-black/[0.04] break-words">
              {appointmentPreference}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-1">
        {hasDept && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-[#86868B]">Önerilen Bölüm:</span>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-indigo-50 text-indigo-700 border-indigo-100">
              {department}
            </span>
          </div>
        )}

        {hasReport && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-[#86868B]">Tıbbi Rapor / MR:</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              reportStatus === "sent" 
                ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                : "bg-amber-50 text-amber-700 border-amber-100"
            }`}>
              {reportStatus === "sent" ? "Gönderildi" : "Bekleniyor"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
