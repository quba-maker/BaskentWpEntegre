"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Calendar, Clock, FileText, Check, Loader2, CalendarClock } from "lucide-react";
import { parseTurkeyLocalToUtc, resolvePatientTimeDisplay } from "@/lib/utils/timezone";
import { createAppointmentTask } from "@/app/actions/patient-tracking";
import { getTzOffsetDiff } from "@/lib/utils/scheduling-context-resolver";

interface AppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  opportunityId: string | null;
  tenantSlug: string;
  patientName: string;
  phoneNumber: string;
  fallback?: { conversationId: string; phoneNumber: string };
  defaultNote?: string;
  onSuccess?: () => void;
  activeContact?: any;
  prefill?: any;
}

export function AppointmentModal({
  isOpen,
  onClose,
  opportunityId,
  tenantSlug,
  patientName,
  phoneNumber,
  fallback,
  defaultNote,
  onSuccess,
  activeContact,
  prefill
}: AppointmentModalProps) {
  const [mounted, setMounted] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState(defaultNote || "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [existingTaskId, setExistingTaskId] = useState<string | null>(null);
  const [durationHours, setDurationHours] = useState<number | null>(null);

  // Reminder states
  const [reminders, setReminders] = useState({
    one_day_before: true,
    same_day: true,
    three_days_before: false,
    seven_days_before: false,
  });

  // Set default date to tomorrow or prefill values
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
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const yyyy = tomorrow.getFullYear();
      const mm = String(tomorrow.getMonth() + 1).padStart(2, "0");
      const dd = String(tomorrow.getDate()).padStart(2, "0");
      setDate(`${yyyy}-${mm}-${dd}`);
      setDurationHours(null);
    }
  }, [prefill, defaultNote]);

  useEffect(() => {
    if (defaultNote && (note === "" || note === defaultNote)) {
      setNote(defaultNote);
    }
  }, [defaultNote]);

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

    const customMetadata: Record<string, any> = {
      zero_outbound_p0: true,
      initiated_from: "crm_panel_inbox"
    };

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
      // 1. Convert local Turkey time to UTC
      const dueAtUtc = parseTurkeyLocalToUtc(date, time);

      // 2. Prepare reminders array
      const remindersList: { type: '1_day_before' | 'same_day' | '3_days_before' | '7_days_before' }[] = [];
      if (reminders.one_day_before) remindersList.push({ type: "1_day_before" });
      if (reminders.same_day) remindersList.push({ type: "same_day" });
      if (reminders.three_days_before) remindersList.push({ type: "3_days_before" });
      if (reminders.seven_days_before) remindersList.push({ type: "7_days_before" });

      // 3. Call the server action createAppointmentTask with clinic_visit (exclude phone_call)
      const res = await createAppointmentTask(opportunityId, dueAtUtc, "clinic_visit", {
        note: note.trim(),
        requireConfirmation: true, // Always true for clinic visits to enforce task confirmation logic
        reminders: remindersList,
        customMetadata,
        fallback,
        force: forceCreate
      });

      if (res.success) {
        setSaveStatus("success");
        if (onSuccess) {
          onSuccess();
        }
      } else if (res.error === 'ACTIVE_TASK_EXISTS') {
        setSaveStatus("idle");
        setShowDuplicateWarning(true);
        setExistingTaskId(res.taskId || null);
      } else {
        setSaveStatus("error");
        setErrorMessage(res.error || "Randevu kaydedilirken bir hata oluştu.");
      }
    } catch (err: any) {
      console.error("Error creating appointment task:", err);
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
          <h3 className="text-sm font-extrabold text-[#1D1D1F]">Aktif Randevu Mevcut</h3>
          <p className="text-xs text-[#86868B] leading-relaxed">
            Bu hasta için halihazırda açık bir klinik randevusu takibi bulunmaktadır. Ne yapmak istersiniz?
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
              Mevcut Randevuyu Güncelle / Ertele
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
                  setErrorMessage(res.error || "Mevcut randevuyu kapatma başarısız.");
                }
              }}
              className="w-full py-2.5 border border-black/5 hover:bg-black/[0.02] text-[#1D1D1F] text-xs font-bold rounded-xl text-center cursor-pointer transition-all"
            >
              Mevcut Randevuyu Kapat ve Yenisini Aç
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
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-[#1D1D1F]">
                Randevu Planla
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
                <h4 className="text-sm font-bold text-[#1D1D1F]">Klinik Randevusu Başarıyla Kaydedildi</h4>
                <p className="text-xs text-[#86868B] max-w-xs mx-auto">
                  Klinik randevusu oluşturuldu. Bu görevi Randevu Yönetimi ekranından inceleyebilirsiniz.
                </p>
              </div>
              <div className="pt-2 flex flex-col gap-2">
                <a
                  href={`/${tenantSlug}/takip?tab=randevu&opp=${opportunityId}`}
                  className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm"
                >
                  Randevu Yönetiminde Aç
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
                    <span>✨ Mesajdan algılanan tarih/saat dolduruldu ({prefill.source === 'message' ? 'Konuşma Geçmişi' : 'Başvuru Formu'})</span>
                  </div>
                  {prefill.warningMessage && (
                    <div className="text-[10px] text-amber-700 font-semibold border-t border-indigo-100/50 pt-1">
                      {prefill.warningMessage}
                    </div>
                  )}
                </div>
              )}

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
                  className="w-full px-4 py-2.5 rounded-xl text-[13px] font-semibold outline-none transition-all bg-white border border-[#E8E8ED] focus:border-emerald-500/50"
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
                  className="w-full px-4 py-2.5 rounded-xl text-[13px] font-semibold outline-none transition-all bg-white border border-[#E8E8ED] focus:border-emerald-500/50"
                  style={{ color: "var(--q-text-primary)", boxShadow: "var(--q-shadow-sm)" }}
                />
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
                  <FileText className="w-3 h-3" /> Randevu Notu
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Klinik randevusu notları (Lokasyon, hekim vb. detaylar)..."
                  className="w-full h-20 px-4 py-3 bg-white border border-[#E8E8ED] rounded-xl text-xs text-[#1D1D1F] placeholder:text-[#86868B] focus:ring-2 focus:ring-emerald-500/20 resize-none outline-none transition-all shadow-sm focus:border-emerald-500/40"
                />
              </div>

              {/* Reminders / Teyit Seçenekleri */}
              <div className="space-y-2 p-3 rounded-2xl border border-slate-100 bg-slate-50/50">
                <span className="block text-[10px] font-bold uppercase tracking-widest text-[#86868B] mb-1">
                  Hatırlatma & Teyit Seçenekleri
                </span>
                
                <div className="space-y-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={reminders.one_day_before}
                      onChange={(e) => setReminders({ ...reminders, one_day_before: e.target.checked })}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-semibold text-gray-700">1 Gün Önce Teyit Hatırlatması</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={reminders.same_day}
                      onChange={(e) => setReminders({ ...reminders, same_day: e.target.checked })}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-semibold text-gray-700">Randevu Günü Hatırlatması</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={reminders.three_days_before}
                      onChange={(e) => setReminders({ ...reminders, three_days_before: e.target.checked })}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-semibold text-gray-700">3 Gün Önce Hatırlatması</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={reminders.seven_days_before}
                      onChange={(e) => setReminders({ ...reminders, seven_days_before: e.target.checked })}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="font-semibold text-gray-700">7 Gün Önce Hatırlatması</span>
                  </label>
                </div>
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
                  className="w-2/3 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-md disabled:opacity-75"
                >
                  {isSaving ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Kaydediliyor...</>
                  ) : (
                    "Randevu Yönetimine Kaydet"
                  )}
                </button>
              </div>

              {/* Immediate Open Link */}
              <div className="text-center pt-1">
                <a
                  href={`/${tenantSlug}/takip?tab=randevu&opp=${opportunityId}`}
                  className="text-[11px] font-bold text-emerald-600 hover:text-emerald-800 transition-colors cursor-pointer"
                >
                  Randevu Yönetiminde Aç
                </a>
              </div>
            </>
          )}
        </form>
      </div>
    </div>,
    document.body
  );
}
