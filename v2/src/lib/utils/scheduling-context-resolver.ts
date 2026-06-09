import { resolvePatientTimeDisplay } from "./timezone";

export interface PrefillResult {
  detected: boolean;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMinutes: number | null;
  noteHeader: string;
  source: "message" | "metadata" | "form" | "default";
  patientTimeText?: string;
  turkeyTimeText?: string;
  warningMessage?: string;
}

// Normalize Turkish chars
function normalizeTurkish(str: string): string {
  return str
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim();
}

// Format YYYY-MM-DD for Turkish display (e.g. "1 Ağustos")
export function formatDisplayDate(dateStr: string): string {
  const [yyyy, mm, dd] = dateStr.split("-");
  const monthNames = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
  ];
  const mIndex = parseInt(mm, 10) - 1;
  const dayVal = parseInt(dd, 10);
  return `${dayVal} ${monthNames[mIndex] || ""}`;
}

// Get next occurrence of a specific weekday (0 = Sunday, 1 = Monday, etc.)
function getNextDayOfWeek(date: Date, dayOfWeek: number): Date {
  const resultDate = new Date(date);
  resultDate.setDate(date.getDate() + (7 + dayOfWeek - date.getDay()) % 7);
  if (resultDate.getTime() <= date.getTime()) {
    resultDate.setDate(resultDate.getDate() + 7);
  }
  return resultDate;
}

// Calculate Turkey Time minus Patient Local Time in hours on a specific date (DST-Aware)
export function getTzOffsetDiff(dateStr: string, patientTz: string): number {
  if (!patientTz || patientTz === "Europe/Istanbul") return 0;
  try {
    const dateObj = new Date(`${dateStr}T12:00:00Z`);
    const formatterIstanbul = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Istanbul",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric",
      hour12: false
    });
    const formatterPatient = new Intl.DateTimeFormat("en-US", {
      timeZone: patientTz,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric",
      hour12: false
    });

    const parseParts = (formatter: Intl.DateTimeFormat) => {
      const parts = formatter.formatToParts(dateObj);
      const getVal = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
      let hourVal = getVal("hour");
      if (hourVal === 24) hourVal = 0;
      return Date.UTC(
        getVal("year"),
        getVal("month") - 1,
        getVal("day"),
        hourVal,
        getVal("minute")
      );
    };

    const istMs = parseParts(formatterIstanbul);
    const patMs = parseParts(formatterPatient);
    return (istMs - patMs) / 3600000;
  } catch (err) {
    console.error("[getTzOffsetDiff] Error calculating timezone offset difference:", err);
    return 0;
  }
}

// Parse text for date and time mentions
export function parseTextForDateTime(
  text: string,
  refDate: Date = new Date()
): {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMinutes: number | null;
  patientTimeText: string;
  hasDate: boolean;
  hasTime: boolean;
  isTurkeyTime: boolean;
  warningMessage?: string;
} | null {
  const clean = normalizeTurkish(text);
  
  let targetYear = refDate.getFullYear();
  let targetMonth = refDate.getMonth();
  let targetDay = refDate.getDate();
  let targetHour: number | null = null;
  let targetMin = 0;
  
  let endHour: number | null = null;
  let endMin = 0;
  
  let hasDate = false;
  let hasTime = false;
  let warningMessage: string | undefined = undefined;

  // Detect Turkey Time indicator
  const isTurkeyTime = clean.includes("tr saati") || clean.includes("turkiye saati");

  const months = [
    "ocak", "subat", "mart", "nisan", "mayis", "haziran",
    "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"
  ];

  // 1. Explicit Month + Day (e.g., "1 agustos", "15 eylul")
  for (let i = 0; i < months.length; i++) {
    const mName = months[i];
    const regex = new RegExp(`(\\d{1,2})\\s+${mName}(?:\\s+(\\d{4}))?`, "i");
    const match = clean.match(regex);
    if (match) {
      targetDay = parseInt(match[1], 10);
      targetMonth = i;
      hasDate = true;

      if (match[2]) {
        targetYear = parseInt(match[2], 10);
      } else {
        // Ensure closest future date (bump year if date is past in current year)
        const temp = new Date(targetYear, targetMonth, targetDay, 23, 59, 59);
        if (temp.getTime() < refDate.getTime()) {
          targetYear += 1;
        }
      }
      break;
    }
  }

  // 1b. Numerical Date (e.g., "01.08.2026", "1.08", "01/08/2026", "1/8")
  if (!hasDate) {
    const numDateMatch = clean.match(/(?:^|\s)(\d{1,2})[\.\/](\d{1,2})(?:[\.\/](\d{4}))?(?:$|\s)/);
    if (numDateMatch) {
      targetDay = parseInt(numDateMatch[1], 10);
      targetMonth = parseInt(numDateMatch[2], 10) - 1; // 0-indexed
      hasDate = true;
      if (numDateMatch[3]) {
        targetYear = parseInt(numDateMatch[3], 10);
      } else {
        const temp = new Date(targetYear, targetMonth, targetDay, 23, 59, 59);
        if (temp.getTime() < refDate.getTime()) {
          targetYear += 1;
        }
      }
    }
  }

  // 2. Relative Keywords
  if (!hasDate) {
    if (clean.includes("yarin")) {
      const tomorrow = new Date(refDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      targetDay = tomorrow.getDate();
      targetMonth = tomorrow.getMonth();
      targetYear = tomorrow.getFullYear();
      hasDate = true;
    } else if (clean.includes("haftaya sali")) {
      const nextSali = getNextDayOfWeek(refDate, 2);
      targetDay = nextSali.getDate();
      targetMonth = nextSali.getMonth();
      targetYear = nextSali.getFullYear();
      hasDate = true;
    } else if (clean.includes("haftaya carsamba")) {
      const nextCars = getNextDayOfWeek(refDate, 3);
      targetDay = nextCars.getDate();
      targetMonth = nextCars.getMonth();
      targetYear = nextCars.getFullYear();
      hasDate = true;
    } else if (clean.includes("haftaya persembe")) {
      const nextPers = getNextDayOfWeek(refDate, 4);
      targetDay = nextPers.getDate();
      targetMonth = nextPers.getMonth();
      targetYear = nextPers.getFullYear();
      hasDate = true;
    } else if (clean.includes("haftaya cuma")) {
      const nextCuma = getNextDayOfWeek(refDate, 5);
      targetDay = nextCuma.getDate();
      targetMonth = nextCuma.getMonth();
      targetYear = nextCuma.getFullYear();
      hasDate = true;
    } else if (clean.includes("haftaya pazartesi")) {
      const nextPzt = getNextDayOfWeek(refDate, 1);
      targetDay = nextPzt.getDate();
      targetMonth = nextPzt.getMonth();
      targetYear = nextPzt.getFullYear();
      hasDate = true;
    } else if (clean.includes("haftaya")) {
      const nextWeek = new Date(refDate);
      nextWeek.setDate(nextWeek.getDate() + 7);
      targetDay = nextWeek.getDate();
      targetMonth = nextWeek.getMonth();
      targetYear = nextWeek.getFullYear();
      hasDate = true;
    } else {
      // "X hafta sonra"
      const weekMatch = clean.match(/(\d+)\s*hafta\s*sonra/);
      if (weekMatch) {
        const weeks = parseInt(weekMatch[1], 10);
        const target = new Date(refDate);
        target.setDate(target.getDate() + weeks * 7);
        targetDay = target.getDate();
        targetMonth = target.getMonth();
        targetYear = target.getFullYear();
        hasDate = true;
      }
    }
  }

  // 3. Time Detection
  // Match range formats: e.g. "15-16", "15:00-16:00", "15 ila 16"
  const rangeMatch =
    clean.match(/saat\s*(\d{1,2})[\s-:]*(\d{2})?\s*-\s*(\d{1,2})[\s-:]*(\d{2})?/i) ||
    clean.match(/saat\s*(\d{1,2})\s*-\s*(\d{1,2})/i) ||
    clean.match(/(\d{1,2})[\s-:]*(\d{2})?\s*-\s*(\d{1,2})[\s-:]*(\d{2})?\s*gibi/i) ||
    clean.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*gibi/i) ||
    clean.match(/saat\s*(\d{1,2})\s*ila\s*(\d{1,2})/i) ||
    clean.match(/(\d{1,2})\s*ila\s*(\d{1,2})\s*gibi/i);

  if (rangeMatch) {
    targetHour = parseInt(rangeMatch[1], 10);
    if (rangeMatch[2]) {
      targetMin = parseInt(rangeMatch[2], 10);
    }
    
    // If it's a range, the second hour is capture group 3 or group 2 depending on matched format
    if (rangeMatch[3]) {
      endHour = parseInt(rangeMatch[3], 10);
      if (rangeMatch[4]) {
        endMin = parseInt(rangeMatch[4], 10);
      }
    } else if (rangeMatch[2]) {
      endHour = parseInt(rangeMatch[2], 10);
    }
    hasTime = true;
  }

  // Single time formats: e.g., "saat 15", "15:30", "saat 15 gibi"
  if (!hasTime) {
    const timeMatch =
      clean.match(/saat\s*(\d{1,2})[\s:]+(\d{2})/i) ||
      clean.match(/(\d{1,2}):(\d{2})/i) ||
      clean.match(/saat\s*(\d{1,2})\s*gibi/i) ||
      clean.match(/(\d{1,2})\s*gibi/i);
    if (timeMatch) {
      targetHour = parseInt(timeMatch[1], 10);
      if (timeMatch[2]) {
        targetMin = parseInt(timeMatch[2], 10);
      }
      hasTime = true;
    }
  }

  // Time keywords: sabah, ogle, ogleden sonra, aksam
  if (!hasTime) {
    if (clean.includes("sabah")) {
      targetHour = 9;
      hasTime = true;
    } else if (clean.includes("ogleden sonra")) {
      targetHour = 15;
      hasTime = true;
    } else if (clean.includes("ogle")) {
      targetHour = 13;
      hasTime = true;
    } else if (clean.includes("aksam")) {
      targetHour = 18;
      hasTime = true;
    }
  }

  if (!hasDate && !hasTime) {
    return null;
  }

  // Time wrapping: if time specified is in the past for today, default to tomorrow
  if (!hasDate && hasTime && targetHour !== null) {
    const temp = new Date(targetYear, targetMonth, targetDay, targetHour, targetMin, 0);
    if (temp.getTime() < refDate.getTime()) {
      const tomorrow = new Date(refDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      targetDay = tomorrow.getDate();
      targetMonth = tomorrow.getMonth();
      targetYear = tomorrow.getFullYear();
      hasDate = true; // resolved to tomorrow
    }
  }

  const resolvedDate = new Date(targetYear, targetMonth, targetDay, 23, 59, 59);
  if (resolvedDate.getTime() < refDate.getTime()) {
    warningMessage = "⚠️ Belirtilen tarih geçmişte görünüyor.";
  }

  const yyyy = targetYear;
  const mm = String(targetMonth + 1).padStart(2, "0");
  const dd = String(targetDay).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const h = targetHour !== null ? targetHour : 10;
  const timeStr = `${String(h).padStart(2, "0")}:${String(targetMin).padStart(2, "0")}`;

  let patientTimeText = `${String(h).padStart(2, "0")}:${String(targetMin).padStart(2, "0")}`;
  let durationMinutes = null;
  if (endHour !== null) {
    patientTimeText = `${String(h).padStart(2, "0")}:${String(targetMin).padStart(2, "0")}-${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`;
    const startTotal = h * 60 + targetMin;
    const endTotal = endHour * 60 + endMin;
    const diff = endTotal - startTotal;
    if (diff > 0) {
      durationMinutes = diff;
    }
  }

  return {
    date: dateStr,
    time: timeStr,
    durationMinutes,
    patientTimeText,
    hasDate,
    hasTime,
    isTurkeyTime,
    warningMessage
  };
}

// Primary scheduling resolver function
export function resolveSchedulingPrefill(params: {
  messages: any[];
  crmData: any;
  referenceDate?: Date;
}): PrefillResult {
  const refDate = params.referenceDate || new Date();
  const messages = params.messages || [];
  const crm = params.crmData || {};
  
  // Resolve patient timezone and country
  const tzInfo = resolvePatientTimeDisplay({
    country: crm.opportunity?.opp_country || crm.formFields?.formCountry,
    city: crm.opportunity?.opp_metadata?.patient_city || crm.formData?.raw?.patient_city,
    timezone: crm.opportunity?.opp_metadata?.patient_timezone || crm.opportunity?.timezone,
    phoneNumber: crm.phoneNumber,
    referenceDate: refDate
  });

  const patientTz = tzInfo.patientTimezone || "Europe/Istanbul";
  const locationLabel = tzInfo.residenceCountryLabel && tzInfo.residenceCountryLabel !== "Bilinmeyen Ülke" && tzInfo.residenceCountryLabel !== "Türkiye"
    ? tzInfo.residenceCountryLabel
    : "yerel";

  // 1. Son gerçek hasta inbound mesajları
  const patientInboundMessages = messages
    .filter((m: any) => m.direction === "in" && m.content);

  for (const msg of patientInboundMessages) {
    const parsed = parseTextForDateTime(msg.content, refDate);
    if (parsed) {
      const dateStr = parsed.date;
      const parsedTime = parsed.time;
      const isTurkeyTime = parsed.isTurkeyTime;
      const duration = parsed.durationMinutes;

      // Handle timezone offset conversion
      let targetTime = parsedTime;
      let turkeyTimeText = parsed.patientTimeText;
      let warningMessage = parsed.warningMessage;

      if (isTurkeyTime) {
        targetTime = parsedTime;
        turkeyTimeText = parsed.patientTimeText;
        warningMessage = warningMessage || "⚠️ Saat ifadesinde Türkiye saati geçiyor olabilir, lütfen kontrol edin.";
      } else if (patientTz && patientTz !== "Europe/Istanbul") {
        // Convert Patient Local Time to Turkey Local Time
        const offset = getTzOffsetDiff(dateStr, patientTz);
        if (offset !== 0) {
          const shiftTime = (time: string): string => {
            const [h, m] = time.split(":").map(Number);
            let newH = (h + offset) % 24;
            if (newH < 0) newH += 24;
            return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          };

          targetTime = shiftTime(parsedTime);
          if (parsed.patientTimeText.includes("-")) {
            const [start, end] = parsed.patientTimeText.split("-");
            turkeyTimeText = `${shiftTime(start)}-${shiftTime(end)}`;
          } else {
            turkeyTimeText = shiftTime(parsed.patientTimeText);
          }
        }
      }

      const noteHeader = `Hasta ${formatDisplayDate(dateStr)} ${parsed.patientTimeText} ${locationLabel} saatinde aranabileceğini belirtti.`;

      return {
        detected: true,
        date: dateStr,
        time: targetTime,
        durationMinutes: duration,
        noteHeader,
        source: "message",
        patientTimeText: parsed.patientTimeText,
        turkeyTimeText,
        warningMessage
      };
    }
  }

  // 2. Hasta inbound mesajlarından çıkarılmış metadata varsa
  const metadata = crm.opportunity?.opp_metadata || {};
  const metadataDate = metadata.date || metadata.parsed_date || metadata.schedule_date || metadata.planned_date;
  const metadataTime = metadata.time || metadata.parsed_time || metadata.turkeyStart || metadata.patientLocalStart;

  if (metadataDate && metadataTime) {
    const duration = metadata.durationMinutes || (metadata.duration ? parseInt(metadata.duration, 10) : null);
    
    let targetTime = metadataTime;
    let turkeyTimeText = targetTime;
    let patientTimeText = metadata.patientLocalStart || targetTime;
    
    if (metadata.turkeyStart) {
      targetTime = metadata.turkeyStart;
      turkeyTimeText = metadata.turkeyEnd ? `${metadata.turkeyStart}-${metadata.turkeyEnd}` : metadata.turkeyStart;
      patientTimeText = metadata.patientLocalEnd ? `${metadata.patientLocalStart}-${metadata.patientLocalEnd}` : (metadata.patientLocalStart || targetTime);
    }
    
    const noteHeader = `Hasta ${formatDisplayDate(metadataDate)} ${patientTimeText} ${locationLabel} saatinde aranabileceğini belirtti.`;
    
    return {
      detected: true,
      date: metadataDate,
      time: targetTime,
      durationMinutes: duration,
      noteHeader,
      source: "metadata",
      patientTimeText,
      turkeyTimeText
    };
  }

  const metadataText = metadata.patient_schedule_pref || 
                       metadata.appointment_preference || 
                       metadata.schedule_preference || 
                       metadata.patient_schedule ||
                       metadata.schedule_pref;
  if (metadataText && typeof metadataText === 'string') {
    const parsedMeta = parseTextForDateTime(metadataText, refDate);
    if (parsedMeta) {
      const dateStr = parsedMeta.date;
      const parsedTime = parsedMeta.time;
      const isTurkeyTime = parsedMeta.isTurkeyTime;
      const duration = parsedMeta.durationMinutes;

      let targetTime = parsedTime;
      let turkeyTimeText = parsedMeta.patientTimeText;
      let warningMessage = parsedMeta.warningMessage;

      if (isTurkeyTime) {
        targetTime = parsedTime;
        turkeyTimeText = parsedMeta.patientTimeText;
        warningMessage = warningMessage || "⚠️ Saat ifadesinde Türkiye saati geçiyor olabilir, lütfen kontrol edin.";
      } else if (patientTz && patientTz !== "Europe/Istanbul") {
        const offset = getTzOffsetDiff(dateStr, patientTz);
        if (offset !== 0) {
          const shiftTime = (time: string): string => {
            const [h, m] = time.split(":").map(Number);
            let newH = (h + offset) % 24;
            if (newH < 0) newH += 24;
            return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          };

          targetTime = shiftTime(parsedTime);
          if (parsedMeta.patientTimeText.includes("-")) {
            const [start, end] = parsedMeta.patientTimeText.split("-");
            turkeyTimeText = `${shiftTime(start)}-${shiftTime(end)}`;
          } else {
            turkeyTimeText = shiftTime(parsedMeta.patientTimeText);
          }
        }
      }

      const noteHeader = `Hasta ${formatDisplayDate(dateStr)} ${parsedMeta.patientTimeText} ${locationLabel} saatinde aranabileceğini belirtti.`;

      return {
        detected: true,
        date: dateStr,
        time: targetTime,
        durationMinutes: duration,
        noteHeader,
        source: "metadata",
        patientTimeText: parsedMeta.patientTimeText,
        turkeyTimeText,
        warningMessage
      };
    }
  }

  // 3. Form randevu isteği
  const formPref = crm.formFields?.formAppointmentPref;
  if (formPref) {
    const parsedForm = parseTextForDateTime(formPref, refDate);
    if (parsedForm) {
      const dateStr = parsedForm.date;
      const parsedTime = parsedForm.time;
      const duration = parsedForm.durationMinutes;
      const isTurkeyTime = parsedForm.isTurkeyTime;

      let targetTime = parsedTime;
      let turkeyTimeText = parsedForm.patientTimeText;
      let warningMessage = parsedForm.warningMessage;

      if (isTurkeyTime) {
        targetTime = parsedTime;
        turkeyTimeText = parsedForm.patientTimeText;
        warningMessage = warningMessage || "⚠️ Saat ifadesinde Türkiye saati geçiyor olabilir, lütfen kontrol edin.";
      } else if (patientTz && patientTz !== "Europe/Istanbul") {
        const offset = getTzOffsetDiff(dateStr, patientTz);
        if (offset !== 0) {
          const shiftTime = (time: string): string => {
            const [h, m] = time.split(":").map(Number);
            let newH = (h + offset) % 24;
            if (newH < 0) newH += 24;
            return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          };
          targetTime = shiftTime(parsedTime);
          if (parsedForm.patientTimeText.includes("-")) {
            const [start, end] = parsedForm.patientTimeText.split("-");
            turkeyTimeText = `${shiftTime(start)}-${shiftTime(end)}`;
          } else {
            turkeyTimeText = shiftTime(parsedForm.patientTimeText);
          }
        }
      }

      const noteHeader = `Başvuru formundaki randevu isteğine istinaden (${formPref}).`;

      return {
        detected: true,
        date: dateStr,
        time: targetTime,
        durationMinutes: duration,
        noteHeader,
        source: "form",
        patientTimeText: parsedForm.patientTimeText,
        turkeyTimeText,
        warningMessage
      };
    }
  }

  // 4. Hiçbiri yoksa quick default
  return {
    detected: false,
    date: "",
    time: "10:00",
    durationMinutes: null,
    noteHeader: "",
    source: "default"
  };
}
