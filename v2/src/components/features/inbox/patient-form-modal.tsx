"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Calendar, Globe, Phone, FileText, ChevronDown, ChevronRight, Share2, ClipboardList, Info, HelpCircle } from "lucide-react";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

interface PatientFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  formData: {
    name?: string;
    date?: string;
    raw?: any;
    formComplaint?: string;
    formReportStatus?: string;
    formAppointmentPref?: string;
    formAge?: string;
  } | null;
  patientName: string;
}

export function PatientFormModal({ isOpen, onClose, formData, patientName }: PatientFormModalProps) {
  const [isTechOpen, setIsTechOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!isOpen || !formData || !mounted) return null;

  // Safe parse raw data
  let rawObj: Record<string, any> = {};
  if (formData.raw) {
    try {
      rawObj = typeof formData.raw === "string" ? JSON.parse(formData.raw) : formData.raw;
    } catch (e) {
      console.error("Error parsing form raw data in modal", e);
    }
  }

  // Separate technical UTM / Facebook parameters from user-answered questions
  const techKeys = [
    "id", "leadgen_id", "form_id", "ad_id", "adset_id", "campaign_id", 
    "platform", "is_organic", "created_time", "phone_number_id", 
    "ad_name", "adset_name", "campaign_name", "utm_campaign", "utm_source", 
    "utm_medium", "utm_content", "utm_term", "_all_phones"
  ];

  const userEntries: { key: string; value: any }[] = [];
  const techEntries: { key: string; value: any }[] = [];

  Object.entries(rawObj).forEach(([k, v]) => {
    const isTech = techKeys.includes(k.toLowerCase()) || k.startsWith("_");
    const item = {
      key: k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      value: typeof v === "object" ? JSON.stringify(v) : String(v)
    };

    if (isTech) {
      techEntries.push(item);
    } else {
      // Exclude common personal duplicate keys if they are shown at the top
      const lowercaseKey = k.toLowerCase();
      if (!["full_name", "phone_number", "email", "age", "country"].includes(lowercaseKey)) {
        userEntries.push(item);
      }
    }
  });

  // Basic metadata fields
  const formDate = formData.date || rawObj.created_time || rawObj.timestamp || "Bilinmiyor";
  const platform = rawObj.platform || (rawObj.is_organic ? "Organik" : "Facebook / Meta");
  const phone = rawObj.phone_number || formData.raw?.phone_number || "";
  const country = rawObj.country || "Belirtilmemiş";
  const age = formData.formAge || rawObj.age || rawObj.yas || "Belirtilmemiş";

  return createPortal(
    <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col mx-4 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[0.05] flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-[#1D1D1F]">
                {formData.name || "Doldurulan Form Detayları"}
              </h3>
              <p className="text-[11px] font-semibold text-[#86868B]">
                {patientName}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8ED] flex items-center justify-center text-gray-500 hover:text-black transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-50 p-3 rounded-2xl border border-black/[0.02] text-left">
              <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Tarih</span>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1D1D1F]">
                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                <span className="truncate">{new Date(formDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
            
            <div className="bg-slate-50 p-3 rounded-2xl border border-black/[0.02] text-left">
              <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Kaynak</span>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1D1D1F]">
                <Share2 className="w-3.5 h-3.5 text-indigo-500" />
                <span className="truncate">{platform}</span>
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border border-black/[0.02] text-left">
              <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Telefon</span>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1D1D1F]">
                <Phone className="w-3.5 h-3.5 text-indigo-500" />
                <span className="truncate">{formatPhoneReadable(phone)}</span>
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border border-black/[0.02] text-left">
              <span className="block text-[9px] font-bold text-[#86868B] uppercase tracking-wider mb-1">Ülke / Yaş</span>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1D1D1F]">
                <Globe className="w-3.5 h-3.5 text-indigo-500" />
                <span className="truncate">{country} {age !== "Belirtilmemiş" && `(${age} Yaş)`}</span>
              </div>
            </div>
          </div>

          {/* Primary Operations/Complaints Summary Card */}
          <div className="bg-indigo-50/20 rounded-2xl border border-indigo-500/10 p-4 space-y-3 text-left">
            <h4 className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Şikayet & Tedavi Beklentisi
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div>
                <span className="block text-[10px] font-bold text-[#86868B] mb-1">Şikayet / Talep</span>
                <p className="text-xs font-semibold text-[#1D1D1F] leading-relaxed bg-white p-3 rounded-xl border border-black/[0.04]">
                  {formData.formComplaint || rawObj.complaint || rawObj.sikayet || "Belirtilmemiş"}
                </p>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-[#86868B] mb-1">Randevu Tercihi</span>
                <p className="text-xs font-semibold text-[#1D1D1F] leading-relaxed bg-white p-3 rounded-xl border border-black/[0.04]">
                  {formData.formAppointmentPref || rawObj.appointment_pref || rawObj.randevu_tercihi || "Belirtilmemiş"}
                </p>
              </div>
            </div>
            {formData.formReportStatus && formData.formReportStatus !== "none" && (
              <div className="pt-2 flex items-center gap-2">
                <span className="text-[10px] font-bold text-[#86868B]">Tıbbi Rapor / MR:</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  formData.formReportStatus === "sent" 
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                    : "bg-amber-50 text-amber-700 border-amber-100"
                }`}>
                  {formData.formReportStatus === "sent" ? "Gönderildi" : "Bekleniyor"}
                </span>
              </div>
            )}
          </div>

          {/* User Form Answers */}
          <div className="space-y-3 text-left">
            <h4 className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider border-b border-black/[0.04] pb-1.5">
              📋 Form Yanıtları
            </h4>
            {userEntries.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {userEntries.map((entry, idx) => (
                  <div key={idx} className="p-3 bg-slate-50/50 rounded-xl border border-black/[0.02]">
                    <span className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">
                      {entry.key}
                    </span>
                    <span className="text-xs font-semibold text-[#1D1D1F] leading-relaxed whitespace-pre-wrap">
                      {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-[#86868B] py-2">Detaylı form yanıtı bulunamadı.</p>
            )}
          </div>

          {/* Technical Metadata Accordion */}
          {techEntries.length > 0 && (
            <div className="border border-black/[0.06] rounded-2xl overflow-hidden transition-all duration-300">
              <button
                type="button"
                onClick={() => setIsTechOpen(!isTechOpen)}
                className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100/80 flex items-center justify-between text-left transition-colors cursor-pointer"
              >
                <span className="text-xs font-bold text-[#86868B] flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-slate-400" /> Teknik Entegrasyon & UTM Detayları
                </span>
                {isTechOpen ? (
                  <ChevronDown className="w-4 h-4 text-[#86868B]" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-[#86868B]" />
                )}
              </button>
              
              {isTechOpen && (
                <div className="p-4 bg-slate-50/30 border-t border-black/[0.05] grid grid-cols-1 md:grid-cols-2 gap-3 text-left max-h-[220px] overflow-y-auto">
                  {techEntries.map((entry, idx) => (
                    <div key={idx} className="bg-white p-2.5 rounded-lg border border-black/[0.03] shadow-sm">
                      <span className="block text-[9px] font-bold text-[#86868B] mb-0.5 break-all">
                        {entry.key}
                      </span>
                      <span className="text-[11px] font-medium text-[#1D1D1F] break-all select-all">
                        {entry.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>,
    document.body
  );
}
