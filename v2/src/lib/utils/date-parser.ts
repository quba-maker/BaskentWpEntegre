import { parseTurkeyLocalToUtc } from './timezone';

export interface ParsedTimeSuggestion {
  suggested_date: string | null; // "YYYY-MM-DD"
  suggested_time: string | null; // "HH:MM"
  suggested_timezone_basis: 'turkey_time' | 'patient_local_time' | 'unknown';
  needs_date_clarification: boolean;
  needs_timezone_clarification: boolean;
  proposed_date: string | null; // ISO UTC string if complete, otherwise null
  operation_window_valid: boolean;
}

/**
 * Parses Turkish time/date patterns from patient messages deterministically.
 * Uses Turkey timezone (Europe/Istanbul) for all relative calculations.
 */
export function parseDeterministicSuggestion(
  content: string,
  refDate: Date = new Date(),
  previousSuggestedDate: string | Date | null = null,
  lastAssistantMessage: string | null = null
): ParsedTimeSuggestion {
  const normalized = content
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  let time: string | null = null;
  let date: string | null = null;
  let timezoneBasis: 'turkey_time' | 'patient_local_time' | 'unknown' = 'unknown';

  // ────────────────────────────────────────────────────────────────────────
  // 1. Time Extraction
  // ────────────────────────────────────────────────────────────────────────
  // Formats like: "17:00", "17.00", "14:30", "14.30"
  const timeRegex = /\b(\d{1,2})[:.](\d{2})\b/;
  const timeMatch = normalized.match(timeRegex);

  if (timeMatch) {
    const hh = parseInt(timeMatch[1], 10);
    const mm = parseInt(timeMatch[2], 10);
    if (hh >= 0 && hh < 24 && mm >= 0 && mm < 60) {
      time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  } else {
    // Formats like: "saat 17", "17 olur", "akşam 5", "sabah 10", "öğlen 2", "gece 11"
    const hourRegex = /\b(?:saat\s*)?(\d{1,2})(?:\s*olur|\s*uygun|\s*gibi|\s*civari|\s*sularında|\b)/;
    const hourMatch = normalized.match(hourRegex);
    if (hourMatch) {
      let hh = parseInt(hourMatch[1], 10);
      
      const isPm = /\b(akşam|öğleden sonra|gece|öğlen|öğle|akşamüstü|akşamüstü)\b/i.test(normalized);
      const isAm = /\b(sabah|öğleden önce)\b/i.test(normalized);
      
      if (hh >= 1 && hh <= 12) {
        if (isPm) {
          if (hh !== 12) hh += 12;
        } else if (isAm) {
          if (hh === 12) hh = 0;
        } else {
          // If no am/pm meridian specified:
          // In Turkish, "saat 5" or "5 olur" defaults to 17:00 unless marked morning.
          // Single digit <= 7 is PM by default in patient scheduling context.
          if (hh <= 7) {
            hh += 12;
          }
        }
      }
      
      if (hh >= 0 && hh < 24) {
        time = `${String(hh).padStart(2, '0')}:00`;
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 2. Date Extraction (Europe/Istanbul Reference)
  // ────────────────────────────────────────────────────────────────────────
  // Calculate relative date offsets using Europe/Istanbul offsets to avoid server/browser timezone shift.
  // Today's local date in Europe/Istanbul:
  const getTurkeyLocalDate = (d: Date): Date => {
    // Offset for Europe/Istanbul is UTC+3
    const utc = d.getTime() + d.getTimezoneOffset() * 60000;
    const turkeyTime = utc + (3 * 3600000);
    return new Date(turkeyTime);
  };

  const localTrDate = getTurkeyLocalDate(refDate);
  const currentYear = localTrDate.getUTCFullYear();
  const currentMonth = localTrDate.getUTCMonth(); // 0-indexed
  const currentDate = localTrDate.getUTCDate();
  const currentDay = localTrDate.getUTCDay(); // 0 is Sunday, 1 is Monday

  const hasYarin = /\b(yarın|ertesi gün)\b/i.test(normalized);
  const hasBugun = /\b(bugün|bu gün)\b/i.test(normalized);

  const weekdays = [
    { name: 'pazartesi', index: 1 },
    { name: 'salı', index: 2 },
    { name: 'çarşamba', index: 3 },
    { name: 'perşembe', index: 4 },
    { name: 'cuma', index: 5 },
    { name: 'cumartesi', index: 6 },
    { name: 'pazar', index: 0 }
  ];

  let dayOffset = -1;
  for (const wd of weekdays) {
    if (new RegExp(`\\b${wd.name}\\b`, 'i').test(normalized)) {
      let diff = wd.index - currentDay;
      if (diff < 0) {
        diff += 7; // Next week
      } else if (diff === 0) {
        // Today is the same day. If a time is specified, check if it already passed.
        if (time) {
          const [hh, mm] = time.split(':').map(Number);
          const trHour = localTrDate.getUTCHours();
          const trMin = localTrDate.getUTCMinutes();
          if (hh < trHour || (hh === trHour && mm <= trMin)) {
            // Already passed today, shift to next week
            diff = 7;
          }
        } else {
          // If no time is specified, assume next week
          diff = 7;
        }
      }
      dayOffset = diff;
      break;
    }
  }

  if (hasBugun) {
    const d = new Date(Date.UTC(currentYear, currentMonth, currentDate));
    date = d.toISOString().split('T')[0];
  } else if (hasYarin) {
    const d = new Date(Date.UTC(currentYear, currentMonth, currentDate + 1));
    date = d.toISOString().split('T')[0];
  } else if (dayOffset !== -1) {
    const d = new Date(Date.UTC(currentYear, currentMonth, currentDate + dayOffset));
    date = d.toISOString().split('T')[0];
  } else {
    // Specific date parsing, e.g. "5 haziran" or "haziran 5" or "05.06"
    const months = [
      { name: 'ocak', index: 0 },
      { name: 'şubat', index: 1 },
      { name: 'mart', index: 2 },
      { name: 'nisan', index: 3 },
      { name: 'mayıs', index: 4 },
      { name: 'haziran', index: 5 },
      { name: 'temmuz', index: 6 },
      { name: 'ağustos', index: 7 },
      { name: 'eylül', index: 8 },
      { name: 'ekim', index: 9 },
      { name: 'kasım', index: 10 },
      { name: 'aralık', index: 11 }
    ];

    let foundMonth: number | null = null;
    let foundDay: number | null = null;

    for (const m of months) {
      if (new RegExp(`\\b${m.name}\\b`, 'i').test(normalized)) {
        foundMonth = m.index;
        const dayMatch = normalized.match(new RegExp(`(\\d{1,2})\\s+${m.name}|${m.name}\\s+(\\d{1,2})`, 'i'));
        if (dayMatch) {
          foundDay = parseInt(dayMatch[1] || dayMatch[2], 10);
        }
        break;
      }
    }

    if (foundMonth !== null && foundDay !== null && foundDay >= 1 && foundDay <= 31) {
      const d = new Date(Date.UTC(currentYear, foundMonth, foundDay));
      // If selected date is in the past, push to next year
      const trCompare = new Date(Date.UTC(currentYear, currentMonth, currentDate));
      if (d.getTime() < trCompare.getTime()) {
        d.setUTCFullYear(currentYear + 1);
      }
      date = d.toISOString().split('T')[0];
    } else {
      const dotDateMatch = normalized.match(/\b(\d{1,2})[./](\d{1,2})\b/);
      if (dotDateMatch) {
        const dd = parseInt(dotDateMatch[1], 10);
        const mm = parseInt(dotDateMatch[2], 10) - 1;
        if (dd >= 1 && dd <= 31 && mm >= 0 && mm < 12) {
          const d = new Date(Date.UTC(currentYear, mm, dd));
          const trCompare = new Date(Date.UTC(currentYear, currentMonth, currentDate));
          if (d.getTime() < trCompare.getTime()) {
            d.setUTCFullYear(currentYear + 1);
          }
          date = d.toISOString().split('T')[0];
        }
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 3. Fallback to previousSuggestedDate or lastAssistantMessage if time is resolved but date is not
  // ────────────────────────────────────────────────────────────────────────
  if (time && !date && previousSuggestedDate) {
    const prevDate = typeof previousSuggestedDate === 'string' ? new Date(previousSuggestedDate) : previousSuggestedDate;
    if (!isNaN(prevDate.getTime())) {
      date = prevDate.toISOString().split('T')[0];
    }
  }

  if (time && !date && lastAssistantMessage) {
    // Avoid infinite recursion by passing null for lastAssistantMessage
    const assistantDet = parseDeterministicSuggestion(lastAssistantMessage, refDate, null, null);
    if (assistantDet.suggested_date) {
      date = assistantDet.suggested_date;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 4. Timezone Basis Detection
  // ────────────────────────────────────────────────────────────────────────
  // Context-aware checking using current patient message and last assistant message
  const mergedContext = `${normalized} ${lastAssistantMessage ? lastAssistantMessage.toLowerCase() : ''}`;
  
  const hasTurkeyBasis = /\b(türkiye|tr|sizin|konya|hastane|firma|bizim\s+taraf|oranın|istanbul|ts)\b/i.test(mergedContext);
  const hasPatientBasis = /\b(bana|bize|benim|bizim|buradaki|buranın|local|yerel|kendi|saatime|saatimize|almanya|berlin|londra|new york)\b/i.test(mergedContext);

  if (hasTurkeyBasis && !hasPatientBasis) {
    timezoneBasis = 'turkey_time';
  } else if (hasPatientBasis && !hasTurkeyBasis) {
    timezoneBasis = 'patient_local_time';
  } else {
    // If ambiguous or no contextual terms exist, mark it as unknown
    timezoneBasis = 'unknown';
  }

  // ────────────────────────────────────────────────────────────────────────
  // 5. Operation Window Validation (09:00 - 21:00 TR Time)
  // ────────────────────────────────────────────────────────────────────────
  let operationWindowValid = true;
  if (time) {
    const [hh, mm] = time.split(':').map(Number);
    const totalMinutes = hh * 60 + mm;
    if (totalMinutes < 9 * 60 || totalMinutes > 21 * 60) {
      operationWindowValid = false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // 6. Proposed Date Composition (UTC ISO string)
  // ────────────────────────────────────────────────────────────────────────
  let proposedDate: string | null = null;
  if (date && time) {
    try {
      proposedDate = parseTurkeyLocalToUtc(date, time);
    } catch {
      const [hh, mm] = time.split(':').map(Number);
      const d = new Date(date);
      d.setUTCHours(hh - 3, mm, 0, 0); // Convert TR offset (+3) to UTC in fallback
      proposedDate = d.toISOString();
    }
  }

  const needsDateClarification = !date;
  const needsTimezoneClarification = timezoneBasis === 'unknown';

  return {
    suggested_date: date,
    suggested_time: time,
    suggested_timezone_basis: timezoneBasis,
    needs_date_clarification: needsDateClarification,
    needs_timezone_clarification: needsTimezoneClarification,
    proposed_date: proposedDate,
    operation_window_valid: operationWindowValid
  };
}
