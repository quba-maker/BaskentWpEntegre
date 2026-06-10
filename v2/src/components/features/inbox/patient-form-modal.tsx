"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Calendar, Globe, Phone, FileText, ChevronDown, ChevronRight, Share2, ClipboardList, Info, HelpCircle } from "lucide-react";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";
import { normalizeCountryName } from "@/lib/utils/country";

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
    formDepartment?: string;
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
  const country = rawObj.country ? normalizeCountryName(rawObj.country) : "Belirtilmemiş";
  const age = formData.formAge || rawObj.age || rawObj.yas || "Belirtilmemiş";

  const { FormDetailViewer } = require("@/components/shared/form-detail-viewer/FormDetailViewer");
  const detailDataMapped = {
    id: "inbox-form",
    identity: {
      name: patientName,
      phoneNumbers: phone ? [phone] : [],
      primaryPhone: phone,
      country: country !== "Belirtilmemiş" ? { name: country } : null
    },
    source: {
      platform: platform,
      formName: formData.name || "Başvuru Formu",
      submittedAt: formDate
    },
    content: {
      complaint: formData.formComplaint || rawObj.complaint || rawObj.sikayet || null,
      appointmentPreference: formData.formAppointmentPref || rawObj.appointment_pref || rawObj.randevu_tercihi || null,
      reportStatus: formData.formReportStatus || null,
      department: formData.formDepartment || rawObj.department || null,
      userAnswers: userEntries.map(e => ({ key: e.key.toLowerCase(), label: e.key, value: String(e.value) })),
      techMetadata: techEntries.map(e => ({ key: e.key.toLowerCase(), label: e.key, value: String(e.value) }))
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col mx-4 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[0.05] flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3 text-left">
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
          <FormDetailViewer data={detailDataMapped} />
        </div>
      </div>
    </div>,
    document.body
  );
}
