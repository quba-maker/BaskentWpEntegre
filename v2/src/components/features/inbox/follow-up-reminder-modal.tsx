"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Calendar, Clock, FileText, Check, Loader2, Bell } from "lucide-react";
import { parseTurkeyLocalToUtc, resolvePatientTimeDisplay } from "@/lib/utils/timezone";
import { scheduleReminderTaskAction } from "@/app/actions/inbox";
import { getTzOffsetDiff } from "@/lib/utils/scheduling-context-resolver";

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
  prefill?: any;
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
  onSuccess,
  prefill
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
  const [durationHours, setDurationHours] = useState<number | null>(null);

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
    
    if (prefill?.detected && prefill.date) {
      setDate(prefill.date);
      if (prefill.time) {
        setTime(prefill.time);
      }
      if (prefill.noteHeader) {
        setNote(defaultNote || prefill.noteHeader);
      }
      if (prefill.durationMinutes) {
        setDurationHours(prefill.durationMinutes / 60);
      } else {
        setDurationHours(null);
      }
    } else {
      setDate(quickDates[0].date);
      setDurationHours(null);
    }
  }, [prefill, defaultNote]);

  useEffect(() => {
    if (defaultNote && (note === "Hasta tarih netleşince geri döneceğini belirtti." || note === "")) {
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
  let patientLocalTime = "";
  if (date && time && tzInfo.patientTimezone) {
    try {
      const utcString = parseTurkeyLocalToUtc(date, time);
      const plannedDate = new Date(utcString);
      patientLocalTime = plannedDate.toLocaleTimeString("tr-TR", {
        timeZone: tzInfo.patientTimezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    } catch (err) {
      console.error("Error calculating patient local time for modal:", err);
    }
  }

  // Format ranges if duration is present
  let turkeyDisplay = time;
  let patientDisplay = patientLocalTime;

  if (durationHours !== null) {
    const formatWithDuration = (timeStr: string, dur: number) => {
      if (!timeStr) return "";
      const [h, m] = timeStr.split(":").map(Number);
      const endH = (h + dur) % 24;
      return `${timeStr}-${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    turkeyDisplay = formatWithDuration(time, durationHours);
    patientDisplay = formatWithDuration(patientLocalTime, durationHours);
  }

  const handleSave = async (e: React.FormEvent, forceCreate?: boolean) => {
    if (e) e.preventDefault();
    if (!date || !time) return;

    setIsSaving(true);
    setSaveStatus("idle");
    setErrorMessage("");

    const customMetadata: Record<string, any> = {};
    if (durationHours !== null) {
      const offset = getTzOffsetDiff(date, tzInfo.patientTimezone || "Europe/Istanbul");
      const [h, m] = time.split(":").map(Number);
      const turkeyStart = time;
      const turkeyEnd = `${String((h + durationHours) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      
      const patStartH = (h - offset + 24) % 24;
      const patientLocalStart = `${String(patStartH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const patientLocalEnd = `${String((patStartH + durationHours) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      
      customMetadata.patientLocalStart = patientLocalStart;
      customMetadata.patientLocalEnd = patientLocalEnd;
      customMetadata.turkeyStart = turkeyStart;
      customMetadata.turkeyEnd = turkeyEnd;
      customMetadata.durationMinutes = durationHours * 60;
    }

    try {
      const dueAtUtc = parseTurkeyLocalToUtc(date, time);
      const res = await scheduleReminderTaskAction(opportunityId, dueAtUtc, note.trim(), fallback, forceCreate, customMetadata);

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
                  setErrorMessage(res.error || "Mevcut takibi kapatma başarısız.");
                }
              }}
              className="w-full py-2.5 border border-black/5 hover:bg-black/[0.02] text-[#1D1D1F] text-xs font-bold rounded-xl text-center cursor-pointer transition-all"
            >
              Mevcut Takibi Kapat ve Yenisini Aç
            </button>
            <button
              type="button"
              onClick={() => {
                handleSave(null as any, true);
                setShowDuplicateWarning(false);
              }}
              className="w-full py-2 text-zinc-500 hover:text-zinc-800 text-[11px] font-semibold text-center cursor-pointer pt-1"
            >
              Mükerrer Kayıt Oluştur (Çift Takip)
            </button>
            <button
              type="button"
              onClick={() => setShowDuplicateWarning(false)}
              className="w-full py-2 bg-[#F5F5F7] hover:bg-[#E8E8ED] text-[#1D1D1F] text-xs font-bold rounded-xl text-center cursor-pointer transition-all"
            >
              Vazgeç
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

              {prefill?.detected && (
                <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-[11px] font-bold text-indigo-700 flex flex-col gap-1 animate-in fade-in duration-200">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
                    <span>✨ Mesajdan algılandı</span>
                  </div>
                  {prefill.warningMessage && (
                    <div className="text-[10px] text-amber-700 font-semibold border-t border-indigo-100/50 pt-1">
                      {prefill.warningMessage}
                    </div>
                  )}
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
                      onClick={() => {
                        setDate(qd.date);
                        setDurationHours(null);
                      }}
                      className={`px-3 py-2 text-left rounded-xl border transition-all cursor-pointer text-xs flex flex-col ${
                        !prefill?.detected && date === qd.date
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
                {patientLocalTime && tzInfo.patientTimezone !== "Europe/Istanbul" && (
                  <div className="text-[10.5px] text-[#1D1D1F] font-bold mt-1.5 space-y-0.5 border-t border-black/[0.03] pt-1.5">
                    <div className="text-[#86868B] text-[9px] font-bold uppercase tracking-widest mb-0.5">Planlanan Saat</div>
                    <div className="text-indigo-600">Türkiye saati: {turkeyDisplay}</div>
                    <div className="text-emerald-600">
                      Hasta yerel saati: {patientDisplay} {tzInfo.patientTimezone?.split("/")[1]?.replace(/_/g, " ") || tzInfo.residenceCountryLabel}
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
