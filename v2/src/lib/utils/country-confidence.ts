/**
 * Country Confidence Scoring
 *
 * Evaluates multiple signals to determine if the patient's country is
 * trustworthy or needs bot confirmation.
 *
 * Signals:
 *   - formCountry: Country field from the original form submission (most reliable)
 *   - phoneCountry: Country inferred from phone prefix (deterministic but not residence)
 *   - crmCountry:   Country extracted by AI from conversation messages
 *   - confirmed:    Whether country has been previously confirmed by bot interaction
 *
 * Confidence levels:
 *   HIGH   → 2+ signals agree, or already confirmed → accept, do NOT ask
 *   MEDIUM → Only 1 signal available → use as default, ask when natural opportunity arises
 *   LOW    → Signals conflict (e.g. phone=TR but form=Germany) → must ask before proceeding
 */

export type CountryConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface CountryConfidenceResult {
  level: CountryConfidenceLevel;
  resolvedCountry: string | null;
  /** Human-readable reason for debugging / logging */
  reason: string;
  /** Whether bot should ask the patient to confirm their country */
  shouldAsk: boolean;
}

/**
 * Normalise a country string for comparison (lowercase, remove accents, trim).
 */
function normalise(c: string | null | undefined): string {
  if (!c) return '';
  return c
    .toLowerCase()
    .trim()
    .replace(/[ıİ]/g, 'i')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g');
}

/**
 * Evaluate country confidence from available signals.
 */
export function evaluateCountryConfidence(params: {
  formCountry?: string | null;
  phoneCountry?: string | null;
  crmCountry?: string | null;
  confirmed?: boolean;
}): CountryConfidenceResult {
  const { formCountry, phoneCountry, crmCountry, confirmed } = params;

  // Already explicitly confirmed by a previous bot interaction
  if (confirmed) {
    const resolvedCountry = formCountry || crmCountry || phoneCountry || null;
    return {
      level: 'HIGH',
      resolvedCountry,
      reason: 'country_previously_confirmed',
      shouldAsk: false,
    };
  }

  const nForm  = normalise(formCountry);
  const nPhone = normalise(phoneCountry);
  const nCrm   = normalise(crmCountry);

  const signals: string[] = [];
  if (nForm)  signals.push('form');
  if (nPhone) signals.push('phone');
  if (nCrm)   signals.push('crm');

  // ── No signals at all ──
  if (signals.length === 0) {
    return {
      level: 'UNKNOWN',
      resolvedCountry: null,
      reason: 'no_country_signals',
      shouldAsk: true,
    };
  }

  // ── Only 1 signal ──
  if (signals.length === 1) {
    const resolvedCountry = formCountry || crmCountry || phoneCountry || null;
    // Form-only is still fairly reliable (patient filled it in)
    const level: CountryConfidenceLevel = signals[0] === 'form' ? 'MEDIUM' : 'MEDIUM';
    return {
      level,
      resolvedCountry,
      reason: `single_signal_${signals[0]}`,
      shouldAsk: signals[0] !== 'form', // If form filled it in, don't force-ask
    };
  }

  // ── 2+ signals — check for agreement ──
  const presentNorms = [nForm, nPhone, nCrm].filter(Boolean);
  const uniqueValues = new Set(presentNorms);

  if (uniqueValues.size === 1) {
    // All signals agree
    const resolvedCountry = formCountry || crmCountry || phoneCountry || null;
    return {
      level: 'HIGH',
      resolvedCountry,
      reason: `all_signals_agree (${signals.join('+')})`,
      shouldAsk: false,
    };
  }

  // ── Signals conflict ──
  // Form beats phone prefix (form = actual residence, phone = registered country)
  // CRM (what patient said in chat) beats phone prefix
  if (nForm && nPhone && nForm !== nPhone) {
    // Form is actual residence — trust form, but surface conflict
    return {
      level: 'LOW',
      resolvedCountry: formCountry || null, // Use form as best guess
      reason: `conflict_form_vs_phone (form=${formCountry}, phone=${phoneCountry})`,
      shouldAsk: true,
    };
  }

  if (nCrm && nPhone && nCrm !== nPhone) {
    // Patient explicitly stated country in chat — more reliable than prefix
    return {
      level: 'LOW',
      resolvedCountry: crmCountry || null,
      reason: `conflict_crm_vs_phone (crm=${crmCountry}, phone=${phoneCountry})`,
      shouldAsk: true,
    };
  }

  // Partial agreement (some match, some differ)
  const resolvedCountry = formCountry || crmCountry || phoneCountry || null;
  return {
    level: 'MEDIUM',
    resolvedCountry,
    reason: `partial_signal_agreement (${signals.join('+')})`,
    shouldAsk: false,
  };
}
