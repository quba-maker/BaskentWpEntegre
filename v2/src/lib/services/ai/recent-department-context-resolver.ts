/**
 * P0.16-G: RecentDepartmentContextResolver
 *
 * Scans the last 6-10 messages (both user and AI turns) to determine the
 * active clinical department/complaint from recent conversation context.
 *
 * This runs AFTER current-message alias resolution fails (null) and BEFORE
 * falling back to stale CRM/opportunity department.
 *
 * Priority in orchestrator:
 *   1. Current message alias      (DepartmentAliasResolver)
 *   2. Recent conversation        ← THIS RESOLVER
 *   3. Fresh conversation state   (conversation.metadata.active_department)
 *   4. Stale CRM/opportunity      (opportunity.department)
 *
 * SaaS rules:
 * - No hardcoded hospital/doctor names.
 * - Non-healthcare tenants: returns null (no medical keywords → no match).
 * - Tenant alias config forwarded to DepartmentAliasResolver.
 */

import { DepartmentAliasResolver } from './department-alias-resolver';

export type RecentDeptConfidence = 'high' | 'medium' | 'low';
export type RecentDeptMatchedBy =
  | 'user_complaint_keyword'
  | 'ai_department_reference'
  | 'user_correction_keyword'
  | 'combined_signal';

export interface RecentDepartmentResult {
  department: string;
  source: 'recent_conversation';
  confidence: RecentDeptConfidence;
  matchedBy: RecentDeptMatchedBy;
}

// AI-side department reference patterns (detect when AI has mentioned a dept)
// These are canonical fragments that appear in AI responses like
// "Beyin ve Sinir Cerrahisi bölümü...", "kardiyoloji uzmanı..."
const AI_DEPT_REFERENCE_PATTERNS: { regex: RegExp; canonical: string }[] = [
  { regex: /beyin\s+ve\s+sinir\s+cerrahisi/i, canonical: 'Beyin Cerrahi' },
  { regex: /beyin\s+cerrahisi/i, canonical: 'Beyin Cerrahi' },
  { regex: /nöroşirürji|norosiruji/i, canonical: 'Beyin Cerrahi' },
  { regex: /omurga\s+cerrahisi/i, canonical: 'Beyin Cerrahi' },
  { regex: /kardiyoloji/i, canonical: 'Kardiyoloji' },
  { regex: /kalp\s+damar/i, canonical: 'Kardiyoloji' },
  { regex: /plastik.*?estetik|estetik.*?cerrahi/i, canonical: 'Estetik' },
  { regex: /organ\s+nakli/i, canonical: 'Organ Nakli' },
  { regex: /ortopedi\s+ve\s+travmatoloji|ortopedi\s+uzman/i, canonical: 'Ortopedi' },
  { regex: /göz\s+hastalık|oftalmoloji/i, canonical: 'Göz' },
  { regex: /kulak\s+burun\s+boğaz|kbb\s+uzman/i, canonical: 'KBB' },
  { regex: /gastroenteroloji/i, canonical: 'Gastroenteroloji' },
  { regex: /onkoloji/i, canonical: 'Onkoloji' },
  { regex: /kadın\s+hastalık|jinekoloji/i, canonical: 'Kadın Doğum' },
  { regex: /tüp\s+bebek|ivf\s+merkez/i, canonical: 'Tüp Bebek' },
  { regex: /üroloji|uroloji/i, canonical: 'Üroloji' },
];

// User correction signals — when user explicitly corrects the department
const USER_CORRECTION_PATTERNS: { regex: RegExp; canonical: string }[] = [
  { regex: /kardiyoloji\s+değil.*?(beyin|sinir|omurga|fıtık|fitik)/i, canonical: 'Beyin Cerrahi' },
  { regex: /(beyin|sinir)\s+cerrah.*?bak(mıyor|maz|ıyor)/i, canonical: 'Beyin Cerrahi' },
];

export class RecentDepartmentContextResolver {
  /**
   * Scans the last `windowSize` messages for an active department signal.
   * Returns the highest-confidence match, or null if none found.
   *
   * @param history - Full conversation history (most recent last)
   * @param windowSize - How many messages to look back (default 10)
   * @param tenantAliasConfig - Optional tenant-specific alias map
   */
  public static resolve(
    history: Array<{ role: string; content: string }>,
    windowSize = 10,
    tenantAliasConfig?: Record<string, string> | null
  ): RecentDepartmentResult | null {
    if (!Array.isArray(history) || history.length === 0) return null;

    // Take the most recent `windowSize` messages, excluding the very last user message
    // (that's the current message, already handled by DepartmentAliasResolver)
    const recentWindow = history.slice(-windowSize);

    // Separate AI and user turns for different signal weights
    const userTurns = recentWindow.filter(m => m.role === 'user' && m.content);
    const aiTurns = recentWindow.filter(m => m.role === 'assistant' && m.content);

    // --- Signal 1: User complaint keyword (highest confidence)
    // Scan ALL user turns in the window for complaint keywords (caller already excludes current message)
    for (const msg of [...userTurns].reverse()) {
      const aliasResult = DepartmentAliasResolver.resolve(msg.content, tenantAliasConfig || null);
      if (aliasResult) {
        return {
          department: aliasResult.canonical,
          source: 'recent_conversation',
          confidence: 'high',
          matchedBy: 'user_complaint_keyword'
        };
      }
    }

    // --- Signal 2: User correction keyword (high confidence)
    // e.g. "kardiyoloji değil ki beyin sinir cerrahı bakmıyor mu"
    for (const msg of [...userTurns].reverse()) {
      const text = msg.content;
      for (const pattern of USER_CORRECTION_PATTERNS) {
        if (pattern.regex.test(text)) {
          return {
            department: pattern.canonical,
            source: 'recent_conversation',
            confidence: 'high',
            matchedBy: 'user_correction_keyword'
          };
        }
      }
    }

    // --- Signal 3: AI department reference (medium confidence)
    // e.g. AI previously said "Beyin ve Sinir Cerrahisi bölümü..."
    for (const msg of [...aiTurns].reverse()) {
      const text = msg.content;
      for (const pattern of AI_DEPT_REFERENCE_PATTERNS) {
        if (pattern.regex.test(text)) {
          return {
            department: pattern.canonical,
            source: 'recent_conversation',
            confidence: 'medium',
            matchedBy: 'ai_department_reference'
          };
        }
      }
    }

    return null;
  }

  /**
   * Convenience: resolve with explicit exclusion of a known-stale department.
   * If the resolved department equals staleDept, returns null to prevent re-confirming
   * a department that was already flagged as stale by upstream resolvers.
   *
   * Only used when the caller already knows staleDept is wrong.
   */
  public static resolveExcluding(
    history: Array<{ role: string; content: string }>,
    excludeDept: string | null,
    windowSize = 10,
    tenantAliasConfig?: Record<string, string> | null
  ): RecentDepartmentResult | null {
    const result = this.resolve(history, windowSize, tenantAliasConfig);
    if (!result) return null;
    if (excludeDept && result.department.toLowerCase() === excludeDept.toLowerCase()) {
      // Recent context confirmed the stale dept — that's valid, return it
      return result;
    }
    return result;
  }
}
