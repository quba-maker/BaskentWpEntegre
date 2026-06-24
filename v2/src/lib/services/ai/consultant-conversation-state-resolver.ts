/**
 * P0.16-K: ConsultantConversationStateResolver
 *
 * Extracts a lightweight "consultant state summary" from conversation history.
 * No DB migration required — pure runtime resolver over history array.
 *
 * SAFETY:
 * - Never logs raw message content (PII-safe)
 * - Only produces enum/category metadata for telemetry
 * - Runs read-only on history (no side effects)
 */

import { DepartmentAliasResolver } from './department-alias-resolver';

export type ParticipantRelation = 'self' | 'mother' | 'father' | 'spouse' | 'child' | 'relative';

export interface CallbackState {
  requested: boolean;
  proposedTime: string | null;       // e.g. "Pazartesi 20:00"
  timezoneStatus: 'unknown' | 'germany' | 'turkey' | 'abroad' | 'clarified';
  timezoneLabel: string | null;       // e.g. "Almanya saati"
}

export interface ParticipantState {
  relation: ParticipantRelation;
  complaint: string | null;          // e.g. "bel fıtığı"
  department: string | null;         // e.g. "Beyin ve Sinir Cerrahisi"
  location: string | null;           // e.g. "Almanya"
  needs: string[];                   // e.g. ["tedavi süreci", "doktor bilgisi"]
  callback: CallbackState;
}

export interface ConsultantConversationState {
  participants: ParticipantState[];
  hasMultipleParticipants: boolean;
  conversationSummaryLines: string[];  // 8-10 line summary for prompt injection
}

// ─── Pattern constants ────────────────────────────────────────────────────────

const COMPLAINT_PATTERNS: { pattern: RegExp; complaint: string; department: string }[] = [
  { pattern: /bel\s+f[ıi]t[ıi]/gi,       complaint: 'bel fıtığı',    department: 'Beyin Cerrahi' },
  { pattern: /boyun\s+f[ıi]t[ıi]/gi,     complaint: 'boyun fıtığı',  department: 'Beyin Cerrahi' },
  { pattern: /omurga/gi,                  complaint: 'omurga sorunu', department: 'Beyin Cerrahi' },
  { pattern: /diz\s+a[gğ]r[ıi]/gi,       complaint: 'diz ağrısı',    department: 'Ortopedi' },
  { pattern: /kalça\s+a[gğ]r[ıi]/gi,     complaint: 'kalça ağrısı',  department: 'Ortopedi' },
  { pattern: /ameliyat/gi,               complaint: 'ameliyat değerlendirmesi', department: 'Beyin Cerrahi' },
  { pattern: /kardiyoloji/gi,            complaint: 'kardiyoloji',    department: 'Kardiyoloji' },
  { pattern: /kalp\s+sorunu/gi,          complaint: 'kalp sorunu',    department: 'Kardiyoloji' },
  { pattern: /g[öo]z\s+sorunu/gi,        complaint: 'göz sorunu',     department: 'Göz' },
  { pattern: /ortopedi/gi,               complaint: 'ortopedi talebi', department: 'Ortopedi' },
];

const LOCATION_PATTERNS: { pattern: RegExp; location: string; tz: 'germany' | 'abroad' }[] = [
  { pattern: /almanya/gi,   location: 'Almanya',   tz: 'germany' },
  { pattern: /avusturya/gi, location: 'Avusturya', tz: 'abroad' },
  { pattern: /hollanda/gi,  location: 'Hollanda',  tz: 'abroad' },
  { pattern: /ingiltere/gi, location: 'İngiltere', tz: 'abroad' },
  { pattern: /fransa/gi,    location: 'Fransa',    tz: 'abroad' },
  { pattern: /isvi[çc]re/gi, location: 'İsviçre', tz: 'abroad' },
  { pattern: /yurt\s+d[iı][şs][iı]/gi, location: 'Yurt Dışı', tz: 'abroad' },
];

const NEEDS_PATTERNS: { pattern: RegExp; need: string }[] = [
  { pattern: /s[üu]re[çc]/gi,             need: 'tedavi süreci' },
  { pattern: /tedavi\s+plan/gi,           need: 'tedavi planı' },
  { pattern: /geli[şs]\s+plan/gi,         need: 'geliş planı' },
  { pattern: /doktor\s+isim|hekim\s+isim|hangi\s+doktor|hangi\s+hekim/gi, need: 'doktor bilgisi' },
  { pattern: /fiyat|[üu]cret/gi,          need: 'fiyat bilgisi' },
  { pattern: /adres|nerede|konum/gi,      need: 'hastane adresi' },
  { pattern: /randevu/gi,                 need: 'randevu talebi' },
  { pattern: /telefon\s+g[öo]r[üu][şs]|beni\s+ara/gi, need: 'telefon görüşmesi' },
];

const TIME_SLOT_PATTERN = /(\b(?:pazartesi|sali|çarşamba|persembe|cuma|cumartesi|pazar|yarin|bugun|hafta\s+içi|hafta\s+sonu)\b)?[\s,]*(\d{1,2}[:. ]\d{2}|\d{1,2}\s*(?:de|da|te|ta|e|a|gibi|sular[ıi]nda|akşam|sabah|öğleden\s+sonra))/gi;

// ─── Main resolver ────────────────────────────────────────────────────────────

export class ConsultantConversationStateResolver {

  /**
   * Resolve participant state from conversation history.
   * Call with history[] — returns full ConsultantConversationState.
   *
   * P0.18: extraPatterns allows tenant-specific complaint→department mappings
   * without modifying the built-in COMPLAINT_PATTERNS array.
   * Pass TenantConfigResolver.getExtraComplaintPatterns(brain) here.
   */
  public static resolve(
    history: { role: string; content: string }[],
    extraPatterns?: { pattern: RegExp; complaint: string; department: string }[]
  ): ConsultantConversationState {
    const userMessages = history.filter(m => m.role === 'user' && m.content);
    // P0.18: Merge built-in patterns with any tenant-specific extraPatterns
    const effectivePatterns = extraPatterns && extraPatterns.length > 0
      ? [...COMPLAINT_PATTERNS, ...extraPatterns]
      : COMPLAINT_PATTERNS;

    // ── SELF participant ────────────────────────────────────────────────
    const selfState = this.resolveParticipant('self', userMessages, undefined, effectivePatterns);

    // ── SECONDARY participants: annem, babam, eşim ───────────────────────────
    const participants: ParticipantState[] = [selfState];

    const secondaryRelations: { keyword: string; relation: ParticipantRelation }[] = [
      { keyword: 'annem', relation: 'mother' },
      { keyword: 'babam', relation: 'father' },
      { keyword: 'eşim', relation: 'spouse' },
      { keyword: 'esim',  relation: 'spouse' },
      { keyword: 'yakın', relation: 'relative' },
    ];

    for (const { keyword, relation } of secondaryRelations) {
      const hasSecondary = userMessages.some(m => m.content.toLowerCase().includes(keyword));
      if (hasSecondary) {
        const secState = this.resolveParticipant(relation, userMessages, keyword, effectivePatterns);
        // Only add if secondary has a distinct complaint or department
        if (secState.complaint || secState.department) {
          participants.push(secState);
        }
      }
    }

    const conversationSummaryLines = this.buildSummaryLines(participants);

    try {
      console.log(JSON.stringify({
        tag: 'CONSULTANT_STATE_RESOLVED',
        participantsCount: participants.length,
        hasMultipleParticipants: participants.length > 1,
        selfComplaint: selfState.complaint,
        selfDepartment: selfState.department,
        selfLocation: selfState.location,
        timezoneStatus: selfState.callback.timezoneStatus,
        needsCount: selfState.needs.length,
        callbackRequested: selfState.callback.requested,
        proposedTime: selfState.callback.proposedTime ? '(redacted)' : null,
      }));
    } catch { /* non-fatal */ }

    if (participants.length > 1) {
      try {
        console.log(JSON.stringify({
          tag: 'MULTI_PATIENT_CONTEXT_RESOLVED',
          participantsCount: participants.length,
          relations: participants.map(p => p.relation),
          departments: participants.map(p => p.department),
        }));
      } catch { /* non-fatal */ }
    }

    return {
      participants,
      hasMultipleParticipants: participants.length > 1,
      conversationSummaryLines,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private static resolveParticipant(
    relation: ParticipantRelation,
    userMessages: { role: string; content: string }[],
    secondaryKeyword?: string,
    patterns?: { pattern: RegExp; complaint: string; department: string }[]  // P0.18
  ): ParticipantState {
    // For secondary: look at messages that mention the keyword
    const relevantMessages = secondaryKeyword
      ? userMessages.filter(m => m.content.toLowerCase().includes(secondaryKeyword))
      : userMessages;

    const allText = relevantMessages.map(m => m.content).join(' ');
    const allLower = allText.toLowerCase();

    // Complaint detection
    let complaint: string | null = null;
    let department: string | null = null;
    // P0.18: Use merged patterns (built-in + tenant extra) if provided
    const activePatterns = patterns && patterns.length > 0 ? patterns : COMPLAINT_PATTERNS;

    for (const cp of activePatterns) {
      cp.pattern.lastIndex = 0;
      if (cp.pattern.test(allLower)) {
        // For secondary, skip self-specific complaints (if keyword is secondary)
        if (secondaryKeyword) {
          // Only pick up complaint in messages that mention the secondary
          const secMsgText = relevantMessages.map(m => m.content).join(' ').toLowerCase();
          cp.pattern.lastIndex = 0;  // CRITICAL: reset after first test
          if (cp.pattern.test(secMsgText)) {
            complaint = cp.complaint;
            department = cp.department;
          }
        } else {
          complaint = cp.complaint;
          department = cp.department;
        }
        // Reset regex lastIndex
        cp.pattern.lastIndex = 0;
        if (complaint) break;
      }
      cp.pattern.lastIndex = 0;
    }

    // If no built-in complaint pattern matched, still preserve an explicit
    // department signal from the conversation (Dermatoloji, Kadın Doğum, KBB...).
    // This keeps short follow-ups like "bana isim söyle" tied to the last
    // department the patient actually mentioned.
    if (!department) {
      for (const msg of [...relevantMessages].reverse()) {
        const aliasResult = DepartmentAliasResolver.resolve(msg.content, null);
        if (aliasResult) {
          department = aliasResult.canonical;
          complaint = aliasResult.displayLabel;
          break;
        }
      }
    }

    // Location (only for self)
    let location: string | null = null;
    let tzStatus: CallbackState['timezoneStatus'] = 'unknown';
    let tzLabel: string | null = null;
    if (relation === 'self') {
      for (const lp of LOCATION_PATTERNS) {
        if (lp.pattern.test(allLower)) {
          location = lp.location;
          tzStatus = lp.tz;
          tzLabel = `${lp.location} saati`;
          lp.pattern.lastIndex = 0;
          break;
        }
        lp.pattern.lastIndex = 0;
      }
    }

    // Needs
    const needs: string[] = [];
    for (const np of NEEDS_PATTERNS) {
      if (np.pattern.test(allLower)) {
        if (!needs.includes(np.need)) needs.push(np.need);
        np.pattern.lastIndex = 0;
      }
      np.pattern.lastIndex = 0;
    }

    // Callback / time slot
    let callbackRequested = allLower.includes('ara') || allLower.includes('telefon') || allLower.includes('arayın') || allLower.includes('arayin');
    let proposedTime: string | null = null;

    // Reset and find time slot
    TIME_SLOT_PATTERN.lastIndex = 0;
    const allOriginal = relevantMessages.map(m => m.content).join(' ');
    const timeMatch = TIME_SLOT_PATTERN.exec(allOriginal);
    if (timeMatch) {
      proposedTime = timeMatch[0].trim().replace(/\s+/g, ' ');
      callbackRequested = true;
      // If time found and location is abroad, timezone not yet clarified
      if (location && tzStatus !== 'unknown') {
        tzStatus = location ? tzStatus : 'unknown';
      }
    }

    return {
      relation,
      complaint,
      department,
      location,
      needs,
      callback: {
        requested: callbackRequested,
        proposedTime,
        timezoneStatus: tzStatus,
        timezoneLabel: tzLabel,
      },
    };
  }

  private static buildSummaryLines(participants: ParticipantState[]): string[] {
    const lines: string[] = [];

    for (const p of participants) {
      const relationLabel: Record<ParticipantRelation, string> = {
        self: 'Kullanıcı',
        mother: 'Anne',
        father: 'Baba',
        spouse: 'Eş',
        child: 'Çocuk',
        relative: 'Yakın',
      };
      const label = relationLabel[p.relation];

      if (p.complaint) lines.push(`- ${label}: ${p.complaint}${p.department ? ` → ${p.department}` : ''}`);
      if (p.location)  lines.push(`- ${label} konumu: ${p.location}${p.callback.timezoneLabel ? ` (${p.callback.timezoneLabel})` : ''}`);
      if (p.needs.length > 0) lines.push(`- ${label} talebi: ${p.needs.join(', ')}`);
      if (p.callback.proposedTime) lines.push(`- ${label} önerilen saat: ${p.callback.proposedTime}${p.callback.timezoneStatus !== 'turkey' ? ' (saat dilimi netleşmeli)' : ''}`);
    }

    return lines;
  }

  /**
   * Produces a 8-10 line summary string for injection at the end of system prompt.
   * Returns empty string if history is too short to extract meaningful state.
   */
  public static buildPromptSummary(
    history: { role: string; content: string }[]
  ): string {
    if (!history || history.length < 2) return '';

    const state = this.resolve(history);
    if (state.conversationSummaryLines.length === 0) return '';

    const lines = state.conversationSummaryLines.slice(0, 10);
    return `\n=== KONUŞMA DURUM ÖZETİ ===\n${lines.join('\n')}\n===========================`;
  }
}
