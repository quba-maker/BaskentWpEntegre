/**
 * P0.16-L: ConversationFrameResolver
 *
 * Extends ConsultantConversationStateResolver with:
 * - duration extraction ("5 aydır", "2 haftadır")
 * - symptom severity ("bacaklarıma geliyor", "yürüyemiyorum")
 * - objection list (distance_objection, cannot_travel, cost_concern)
 *
 * Backward-compat: wraps ConsultantConversationStateResolver.
 * No DB access — pure runtime resolver over history array.
 * PII-safe: logs only enum/metadata, never raw message content.
 */

import { ConsultantConversationStateResolver, ConsultantConversationState } from './consultant-conversation-state-resolver';

export type ConversationObjection =
  | 'distance_objection'
  | 'cannot_travel'
  | 'cost_concern'
  | 'no_companion'
  | 'time_concern';

export interface ConversationFrame extends ConsultantConversationState {
  /** e.g. "5 ay", "2 hafta", "uzun zaman" */
  complainDuration: string | null;
  /** e.g. ["bacaklarıma yayılıyor", "yürüyemiyorum"] */
  symptomSeverityFlags: string[];
  /** objections detected across full conversation */
  objections: ConversationObjection[];
  /** true if user indicates they're traveling with someone */
  hasCompanion: boolean;
  /** number of distinct participants (self + others) */
  participantCount: number;
}

// ─── Pattern constants ────────────────────────────────────────────────────────

const DURATION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /(\d+)\s*ay(?:d[ıi]r|dır)/gi,          label: '$1 ay' },
  { pattern: /(\d+)\s*hafta(?:d[ıi]r|dır)/gi,       label: '$1 hafta' },
  { pattern: /(\d+)\s*g[üu]n(?:d[üu]r|dür)/gi,      label: '$1 gün' },
  { pattern: /(\d+)\s*y[ıi]ld[ıi]r/gi,              label: '$1 yıl' },
  { pattern: /uzun\s+zamand[ıi]r/gi,                 label: 'uzun süre' },
  { pattern: /bir\s+s[üu]red[ıi]r/gi,               label: 'bir süredir' },
  { pattern: /epeydir/gi,                             label: 'epeydir' },
];

const SEVERITY_PATTERNS: { pattern: RegExp; flag: string }[] = [
  { pattern: /bacaklar[ıi]ma\s+(?:yay[ıi]l|geliyor|vurdu)/gi, flag: 'bacaklara_yayılıyor' },
  { pattern: /y[üu]r[üu]yemiyorum/gi,              flag: 'yürüyemiyor' },
  { pattern: /ayakta\s+duramıyorum/gi,              flag: 'ayakta_duramıyor' },
  { pattern: /uyuyamıyorum/gi,                       flag: 'uyuyamiyor' },
  { pattern: /çok\s+şiddetli/gi,                    flag: 'şiddetli_ağrı' },
  { pattern: /dayanılamaz/gi,                        flag: 'dayanılmaz' },
  { pattern: /uyuşma/gi,                             flag: 'uyuşma' },
  { pattern: /karıncalanma/gi,                       flag: 'karıncalanma' },
];

const OBJECTION_PATTERNS: { pattern: RegExp; objection: ConversationObjection }[] = [
  { pattern: /konya\s+(?:çok\s+)?uzak|çok\s+uzak|mesafe\s+sorunu/gi,  objection: 'distance_objection' },
  { pattern: /gelemem|gidemem|gelemiyorum|gidemiyorum|gelmem\s+zor/gi, objection: 'cannot_travel' },
  { pattern: /pahal[ıi]|maliyet|b[üu]t[cç]e|karş[ıi]layamam/gi,       objection: 'cost_concern' },
  { pattern: /yanımda\s+kim(?:se)?\s+yok|yalnız\s+gelem/gi,            objection: 'no_companion' },
  { pattern: /vakit\s+(?:yok|bulamıyorum)|zaman\s+(?:yok|bulamıyorum)/gi, objection: 'time_concern' },
];

const COMPANION_PATTERNS = [
  /e[şs]imle\s+(?:birlikte|gelece|gidece)/gi,
  /annemle\s+(?:birlikte|gelece)/gi,
  /ailemle/gi,
  /biz\s+gelece[gğ]iz|ikimiz/gi,
  /ayn[ıi]\s+d[öo]nemde\s+gelece[gğ]iz/gi,
];

// ─── Main resolver ────────────────────────────────────────────────────────────

export class ConversationFrameResolver {

  /**
   * Resolve full conversation frame from history.
   * Wraps ConsultantConversationStateResolver and adds frame-level fields.
   */
  public static resolve(history: { role: string; content: string }[]): ConversationFrame {
    const base = ConsultantConversationStateResolver.resolve(history);
    const userMessages = history.filter(m => m.role === 'user' && m.content);
    const allText = userMessages.map(m => m.content).join(' ');
    const allLower = allText.toLowerCase();

    // Duration
    let complainDuration: string | null = null;
    for (const dp of DURATION_PATTERNS) {
      dp.pattern.lastIndex = 0;
      const match = dp.pattern.exec(allText);
      if (match) {
        complainDuration = dp.label.replace('$1', match[1] || '');
        dp.pattern.lastIndex = 0;
        break;
      }
      dp.pattern.lastIndex = 0;
    }

    // Severity flags
    const symptomSeverityFlags: string[] = [];
    for (const sp of SEVERITY_PATTERNS) {
      sp.pattern.lastIndex = 0;
      if (sp.pattern.test(allText)) {
        symptomSeverityFlags.push(sp.flag);
      }
      sp.pattern.lastIndex = 0;
    }

    // Objections
    const objections: ConversationObjection[] = [];
    for (const op of OBJECTION_PATTERNS) {
      op.pattern.lastIndex = 0;
      if (op.pattern.test(allText)) {
        if (!objections.includes(op.objection)) {
          objections.push(op.objection);
        }
      }
      op.pattern.lastIndex = 0;
    }

    // Companion
    const hasCompanion = COMPANION_PATTERNS.some(p => {
      p.lastIndex = 0;
      const r = p.test(allText);
      p.lastIndex = 0;
      return r;
    });

    const frame: ConversationFrame = {
      ...base,
      complainDuration,
      symptomSeverityFlags,
      objections,
      hasCompanion,
      participantCount: base.participants.length,
    };

    try {
      console.log(JSON.stringify({
        tag: 'CONVERSATION_FRAME_RESOLVED',
        participantCount: frame.participantCount,
        hasMultipleParticipants: frame.hasMultipleParticipants,
        complainDuration: frame.complainDuration,
        symptomSeverityCount: symptomSeverityFlags.length,
        objections: frame.objections,
        hasCompanion,
      }));
    } catch { /* non-fatal */ }

    return frame;
  }

  /**
   * Get a short summary of objections for objection handler prompts.
   * Returns null if no objections.
   */
  public static getObjectionSummary(frame: ConversationFrame): string | null {
    if (frame.objections.length === 0) return null;
    const labels: Record<ConversationObjection, string> = {
      distance_objection: 'uzaklık',
      cannot_travel:      'seyahat edememe',
      cost_concern:       'maliyet endişesi',
      no_companion:       'refakatçi yok',
      time_concern:       'zaman sorunu',
    };
    return frame.objections.map(o => labels[o]).join(', ');
  }
}
