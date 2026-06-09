"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Calendar, Clock, FileText, Check, Loader2, Bell } from "lucide-react";
import { parseTurkeyLocalToUtc, resolvePatientTimeDisplay } from "@/lib/utils/timezone";
import { scheduleReminderTaskAction } from "@/app/actions/inbox";

interface FollowUpReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  opportunityId: string | null;
  tenantSlug: string;
  patientName: string;
  phoneNumber: string;
  activeContact: any;
  fallback?: { conversationId: string; phoneNumber: string };
  defaultNote?: string;
  onSuccess?: () => void;
}

export function FollowUpReminderModal({
  isOpen,
  onClose,
  opportunityId,
  tenantSlug,
  patientName,
  phoneNumber,
  activeContact,
  fallback,
  defaultNote,
  onSuccess
}: FollowUpReminderModalProps) {
  const [mounted, setMounted] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState(defaultNote || "Hasta tarih netleşince geri döneceğini belirtti.");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [existingTaskId, setExistingTaskId] = useState<string | null>(null);

  // Calculate dynamic quick dates
  const getQuickDates = () => {
    const now = new Date();
    
    // 1 Week Later
    const oneWeek = new Date();
    oneWeek.setDate(now.getDate() + 7);
    
    // 2 Weeks Later
    const twoWeeks = new Date();
    twoWeeks.setDate(now.getDate() + 14);
    
    // 1 Month Later
    const oneMonth = new Date();
    oneMonth.setMonth(now.getMonth() + 1);
    
    // Start of Next Month
    const startOfNextMonth = new Date();
    startOfNextMonth.setMonth(now.getMonth() + 1);
    startOfNextMonth.setDate(1);

    const format = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    const formatDisplay = (d: Date) => {
      return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    return [
      { label: "1 Hafta Sonra", date: format(oneWeek), display: formatDisplay(oneWeek) },
      { label: "2 Hafta Sonra", date: format(twoWeeks), display: formatDisplay(twoWeeks) },
      { label: "1 Ay Sonra", date: format(oneMonth), display: formatDisplay(oneMonth) },
      { label: "Gelecek Ay Başı", date: format(startOfNextMonth), display: formatDisplay(startOfNextMonth) }
    ];
  };

  const quickDates = getQuickDates();

  useEffect(() => {
    setMounted(true);
    // Default to 1 week later
    setDate(quickDates[0].date);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (defaultNote && note === "Hasta tarih netleşince geri döneceğini belirtti.") {
      setNote(defaultNote);
    }
  }, [defaultNote]);

  if (!isOpen || !mounted) return null;

  // Resolve timezone information
  const tzInfo = resolvePatientTimeDisplay({
    country: activeContact?.country || activeContact?.opp_country,
    city: activeContact?.city || activeContact?.patient_city || activeContact?.opp_metadata?.patient_city || activeContact?.formData?.patient_city || activeContact?.formData?.city,
    timezone: activeContact?.timezone || activeContact?.patient_timezone || activeContact?.opp_metadata?.patient_timezone || activeContact?.metadata?.patient_timezone,
    metadata: activeContact?.metadata,
    oppMetadata: activeContact?.opp_metadata || activeContact?.formData,
    referenceDate: new Date()
  });

  // Calculate patient local time/date for the selected Turkey local time
  let patientLocalDisplay = "";
  if (date && time && tzInfo.patientTimezone && tzInfo.patientTimezone !== "Europe/Istanbul") {
    try {
      const utcString = parseTurkeyLocalToUtc(date, time);
      const plannedDate = new Date(utcString);
      const patTime = plannedDate.toLocaleTimeString("tr-TR", {
        timeZone: tzInfo.patientTimezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
      const patDate = plannedDate.toLocaleDateString("tr-TR", {
        timeZone: tzInfo.patientTimezone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
      patientLocalDisplay = `${patDate} ${patTime}`;
    } catch (err) {
      console.error("Error calculating patient local time for modal:", err);
    }
  }

  const handleSave = async (e: React.FormEvent, forceCreate?: boolean) => {
    if (e) e.preventDefault();
    if (!date || !time) return;

    setIsSaving(true);
    setSaveStatus("idle");
    setErrorMessage("");

    try {
      const dueAtUtc = parseTurkeyLocalToUtc(date, time);
      const res = await scheduleReminderTaskAction(opportunityId, dueAtUtc, note.trim(), fallback, forceCreate);

      if (res && res.success) {
        setSaveStatus("success");
        if (onSuccess) {
          onSuccess();
        }
      } else if (res && res.error === 'ACTIVE_TASK_EXISTS') {
        setSaveStatus("idle");
        setShowDuplicateWarning(true);
        setExistingTaskId(res.taskId || null);
      } else {
        setSaveStatus("error");
        setErrorMessage(res?.error || "Hatırlatma kaydedilirken bir hata oluştu.");
      }
    } catch (err: any) {
      console.error("Error scheduling reminder task:", err);
      setSaveStatus("error");
      setErrorMessage(err.message || "Geçersiz tarih veya saat girişi yapıldı.");
    } finally {
      setIsSaving(false);
    }
  };

  if (showDuplicateWarning && existingTaskId) {
    return createPortal(
      <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-3xl shadow-xl border border-black/5 w-full max-w-md overflow-hidden flex flex-col mx-4 p-6 text-left space-y-4 animate-in zoom-in-95 duration-200">
          <h3 className="text-sm font-extrabold text-[#1D1D1F]">Aktif Takip Mevcut</h3>
          <p className="text-xs text-[#86868B] leading-relaxed">
            Bu hasta için halihazırda açık bir takip hatırlatması bulunmaktadır. Ne yapmak istersiniz?
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={async () => {
                setIsSaving(true);
                const { rescheduleFollowUpTaskAction } = await import("@/app/actions/patient-tracking");
                const dueAtUtc = parseTurkeyLocalToUtc(date, time);
                const res = await rescheduleFollowUpTaskAction(existingTaskId, dueAtUtc, note.trim());
                setIsSaving(false);
                if (res.success) {
                  setSaveStatus("success");
                  setShowDuplicateWarning(false);
                } else {
                  setSaveStatus("error");
                  setErrorMessage(res.error || "Erteleme başarısız.");
                }
              }}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl text-center cursor-pointer transition-all"
            >
              Mevcut Hatırlatmayı Güncelle / Ertele
            </button>
            <button
              type="button"
              onClick={async () => {
                setIsSaving(true);
                const { completeFollowUpTaskAction } = await import("@/app/actions/patient-tracking");
                const res = await completeFollowUpTaskAction(existingTaskId, 'completed', note.trim());
                setIsSaving(false);
                if (res.success) {
                  handleSave(null as any, true);
                  setShowDuplicateWarning(false);
                } else {
                  setSaveStatus("error");
                  setErrorMessage(res.error || "Mevcut hatırlatmayı kapatma başarısız.");
                }
              }}
              className="w-full py-2.5 border border-black/5 hover:bg-black/[0.02] text-[#1D1D1F] text-xs font-bold rounded-xl text-center cursor-pointer transition-all"
            >
              Mevcut Hatırlatmayı Kapat ve Yenisini Aç
            </button>
            <button
              type="button"
              onClick={() => {
                handleSave(null as any, true);
                setShowDuplicateWarning(false);
              }}
              className="w-full py-2.5 text-red-600 hover:text-red-700 hover:bg-red-50 text-xs font-bold rounded-xl text-center cursor-pointer transition-all"
            >
              Yine de Yeni Hatırlatma Oluştur (Mükerrer)
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDuplicateWarning(false);
                onClose();
              }}
              className="w-full py-2 text-[#86868B] text-xs font-bold text-center cursor-pointer hover:text-black transition-all"
            >
              İptal
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-md overflow-hidden flex flex-col mx-4 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[0.05] flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-[#1D1D1F]">
                Takip Hatırlatması Planla
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

        {/* Form Content */}
        <form onSubmit={handleSave} className="p-6 space-y-4 text-left">
          {saveStatus === "success" ? (
            <div className="space-y-4 text-center py-4">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                <Check className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-[#1D1D1F]">Takip Hatırlatması Başarıyla Kaydedildi</h4>
                <p className="text-xs text-[#86868B] max-w-xs mx-auto">
                  Tarih netleşince aranacak/takip edilecek hastalar için görev oluşturuldu.
                </p>
              </div>
              <div className="pt-2 flex flex-col gap-2">
                <a
                  href={`/${tenantSlug}/takip?tab=hatirlatma&opp=${opportunityId}`}
                  className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm"
                >
                  Takip Listesinde Aç
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2 px-4 border border-black/5 hover:bg-black/[0.02] text-[#86868B] hover:text-[#1D1D1F] text-[12px] font-bold rounded-xl cursor-pointer transition-all"
                >
                  Kapat
                </button>
              </div>
            </div>
          ) : (
            <>
              {saveStatus === "error" && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-700 text-xs font-semibold leading-relaxed">
                  ⚠️ {errorMessage}
                </div>
              )}

              {/* Quick Dates Grid */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] ml-1">
                  Hızlı Tarih Seçimi
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {quickDates.map((qd) => (
                    <button
                      key={qd.label}
                      type="button"
                      onClick={() => setDate(qd.date)}
                      className={`px-3 py-2 text-left rounded-xl border transition-all cursor-pointer text-xs flex flex-col ${
                        date === qd.date
                          ? "bg-indigo-50 border-indigo-500 text-indigo-700 font-bold"
                          : "border-black/5 hover:bg-black/[0.02] text-gray-700 font-semibold"
                      }`}
                    >
                      <span>{qd.label}</span>
                      <span className="text-[10px] opacity-70 mt-0.5">{qd.display}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Date & Time Row */}
              <div className="grid grid-cols-2 gap-3">
                {/* Date */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] ml-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Tarih
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-[13px] font-semibold outline-none transition-all bg-white border border-[#E8E8ED] focus:border-indigo-500/50"
                    style={{ color: "var(--q-text-primary)", boxShadow: "var(--q-shadow-sm)" }}
                  />
                </div>

                {/* Time */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] ml-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Saat
                  </label>
                  <input
                    type="time"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-[13px] font-semibold outline-none transition-all bg-white border border-[#E8E8ED] focus:border-indigo-500/50"
                    style={{ color: "var(--q-text-primary)", boxShadow: "var(--q-shadow-sm)" }}
                  />
                </div>
              </div>

              {/* Timezone Information Box */}
              <div className="p-3 rounded-2xl border border-slate-100 bg-slate-50/50 space-y-1">
                <span className="block text-[9px] font-bold uppercase tracking-widest text-[#86868B]">
                  Saat Dilimi Bilgisi
                </span>
                <p className="text-[11px] font-semibold text-gray-700">
                  {tzInfo.needsTimezoneClarification ? (
                    <span className="text-amber-600">⚠️ Hastanın konum/saat bilgisi net değil (Şehir gerekli).</span>
                  ) : tzInfo.isFallback ? (
                    <span className="text-amber-600">⚠️ Hastanın saat dilimi belirsiz. Türkiye saati kullanılacak.</span>
                  ) : (
                    <span>
                      Hasta Konumu: {tzInfo.displayLabel}
                    </span>
                  )}
                </p>
                {patientLocalDisplay && (
                  <div className="text-[10.5px] text-indigo-600 font-bold mt-1 space-y-0.5">
                    <div>Planlanan saat:</div>
                    <div>Türkiye saati: {time}</div>
                    <div>
                      Hasta yerel saati: {patientLocalDisplay.split(" ")[1]} {tzInfo.patientTimezone?.split("/")[1]?.replace(/_/g, " ") || tzInfo.residenceCountryLabel}
                    </div>
                  </div>
                )}
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] ml-1 flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Açıklama / Görev Notu
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Hatırlatma notu..."
                  className="w-full h-20 px-4 py-3 bg-white border border-[#E8E8ED] rounded-xl text-xs text-[#1D1D1F] placeholder:text-[#86868B] focus:ring-2 focus:ring-indigo-500/20 resize-none outline-none transition-all shadow-sm focus:border-indigo-500/40"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-1/3 py-3 border border-black/5 hover:bg-black/[0.02] text-[#86868B] hover:text-[#1D1D1F] text-[13px] font-bold rounded-xl cursor-pointer transition-all"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-2/3 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-md disabled:opacity-75"
                >
                  {isSaving ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Kaydediliyor...</>
                  ) : (
                    "Hatırlatma Oluştur"
                  )}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>,
    document.body
  );
}
