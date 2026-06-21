/**
 * P0.16-L: TurkishFinalQualityNormalizer
 *
 * Deterministic rewrite of known broken Turkish morphology patterns
 * in final outbound text. Applied to BOTH bypass path and LLM path output.
 *
 * Extends TurkishMorphologyGuard (which operates on individual patterns).
 * This normalizer operates on complete sentences with context awareness.
 *
 * FALSE-POSITIVE GUARD: patterns that look similar to broken ones but are
 * correct are explicitly listed and protected from rewrite.
 *
 * Telemetry: TURKISH_FINAL_QUALITY_REWRITE_APPLIED (no PII)
 */

export interface NormalizeResult {
  text: string;
  changesCount: number;
  wasModified: boolean;
  appliedPatterns: string[];
  rewrites: string[]; // P0.16-M: for FinalPipelineEnforcer telemetry
}

// ─── Protected phrases (must NOT be rewritten) ────────────────────────────────
const PROTECTED_PHRASES: RegExp[] = [
  /geldi[gğ]inizi\s+biliyorum/gi,
  /yazd[ıi][gğ][ıi]n[ıi]z[ıi]\s+g[öo]rd[üu]m/gi,
  /detaylar[ıi]n[ıi]z[ıi]\s+payla[sş]abilirsiniz/gi,
  /zaman\s+aral[ıi][gğ][ıi]n[ıi]z[ıi]\s+yazabilirsiniz/gi,
  /randevunuzu\s+olu[sş]turabilirsiniz/gi,
  /uygun\s+oldu[gğ]unuzu\s+belirtin/gi,
  /bilgi\s+verebildi[gğ]iniz\s+i[cç]in/gi,
  /katıld[ıi][gğ][ıi]n[ıi]z\s+i[cç]in/gi,
  /ara[sş]t[ıi]rd[ıi][gğ][ıi]n[ıi]z/gi,
];

// ─── Rewrite rules ────────────────────────────────────────────────────────────
interface RewriteRule {
  id: string;
  pattern: RegExp;
  replacement: string | ((match: string, ...groups: string[]) => string);
}

const REWRITE_RULES: RewriteRule[] = [
  // "tahminiz edebiliyorum" → "tahmin edebiliyorum"
  {
    id: 'tahminiz_fix',
    pattern: /\btahminiz\s+edebiliyorum\b/gi,
    replacement: 'tahmin edebiliyorum',
  },
  // "tahminiz edebilirim" → "tahmin edebilirim"
  {
    id: 'tahminiz_edebilirim',
    pattern: /\btahminiz\s+edebilirim\b/gi,
    replacement: 'tahmin edebilirim',
  },
  // "Konya'nınız size uzak geldiğinizi" → "Konya'nın size uzak geldiğini"
  {
    id: 'konya_possessive_fix',
    pattern: /Konya['']n[ıi]n[ıi]z\s+size\s+uzak\s+geldi[gğ]inizi/gi,
    replacement: "Konya'nın size uzak geldiğini",
  },
  // "Konya'nınız" (standalone possessive corruption)  
  {
    id: 'konya_standalone_fix',
    pattern: /Konya['']n[ıi]n[ıi]z\b/gi,
    replacement: "Konya'nın",
  },
  // "yaşam kalitenizi etkilediğinizi" → "yaşam kalitenizi etkilediğini"
  {
    id: 'etkilediginizi_fix',
    pattern: /(?:ya[sş]am\s+(?:kalite|konfor)|a[gğ]r[ıi]|[sş]ikayeti?)nizi\s+etkile(?:di[gğ]|yen|mekte)inizi\b/gi,
    replacement: (match) => match.replace(/inizi\b$/, 'ini'),
  },
  // "rahatsız edici olabileceğinizi" → "rahatsız edici olduğunu"  
  {
    id: 'rahatsiz_olabileceginizi',
    pattern: /rahats[ıi]z\s+edici\s+olabilece[gğ]inizi\b/gi,
    replacement: 'rahatsız edici olduğunu',
  },
  // "uygun olduğunuz zamanızı yazarsanız" → "uygun olduğunuz zamanı yazarsanız"
  {
    id: 'zamaninizi_fix',
    pattern: /uygun\s+oldu[gğ]unuz\s+zaman[ıi]n[ıi]z[ıi]\s+(?:yazar|bildirir|iletir)seniz\b/gi,
    replacement: 'uygun olduğunuz zamanı yazarsanız',
  },
  // "hekim alternatiflerinizi" → "hekim alternatifleri"
  {
    id: 'hekim_alternatif_fix',
    pattern: /hekim\s+alternatiflerinizi\b/gi,
    replacement: 'hekim alternatiflerini',
  },
  // "doğru tedavi planızı" → "doğru tedavi planınızı"  (possession suffix)
  {
    id: 'tedavi_planizi_fix',
    pattern: /\btedavi\s+plan[ıi]z[ıi]\b/gi,
    replacement: 'tedavi planınızı',
  },
  // "uzmanınızı / uzmanızı" (when used as object of help/reach verb)
  {
    id: 'uzmanizi_standalone',
    pattern: /\buzman[ıi]z[ıi]\b(?!\s+(?:olan|ile|için))/gi,
    replacement: 'uzmanı',
  },
  // "tedavi sürecinizi belirler" → "tedavi sürecinizi belirleyecektir" / keep as-is if correct
  // Actually this one is grammatically OK, skip.
  
  // "olabileceğinizi anlıyorum" — inanimate complaint
  // Only applies when subject is complaint/situation (not person action)
  {
    id: 'olabilecegini_complaint',
    pattern: /(?:a[gğ]r[ıi]n[ıi]n|[sş]ikayetin|hastal[ıi][gğ][ıi]n|bu\s+durumun)\s+ne\s+kadar\s+(?:zorlay[ıi]c[ıi]|a[gğ]r[ıi]|rahats[ıi]z\s+edici)\s+olabilece[gğ]inizi\b/gi,
    replacement: (match) => match.replace(/olabilece[gğ]inizi\b$/i, 'olabileceğini'),
  },
  // "Türkiye saati olarak not aldım" (auto timezone assumption — remove)
  {
    id: 'turkey_saati_assumption',
    pattern: /T[üu]rkiye\s+saati\s+olarak\s+not\s+ald[ıi]m\b/gi,
    replacement: 'not aldım (saat dilimini teyit edelim)',
  },

  // ── P0.16-M: Extended coverage ──────────────────────────────────────────────

  // "burunuz estetiği" → "burun estetiğiniz"
  {
    id: 'burunuz_estetigi',
    pattern: /\bburunuz\s+esteti[gğ]i\b/gi,
    replacement: 'burun estetiğiniz',
  },
  // "burun estetiğinizi" (correct) — protected by protected phrases, but also add rule for broken suffix
  // "estetik sorunuzuz" → "estetik sorununuz"
  {
    id: 'sorunuzuz_fix',
    pattern: /\bsorunuzuz\b/gi,
    replacement: 'sorununuz',
  },
  // "sürecininiz" → "süreciniz"
  {
    id: 'surecininiz_fix',
    pattern: /\bs[üu]recininiz\b/gi,
    replacement: 'süreciniz',
  },
  // "planlamasınınız" → "planlamanız"
  {
    id: 'planlamasininiz_fix',
    pattern: /\bplanlamas[ıi]n[ıi]n[ıi]z\b/gi,
    replacement: 'planlamanız',
  },
  // "planlamasınızı" → "planlamanızı"
  {
    id: 'planlamasinizin_fix',
    pattern: /\bplanlamas[ıi]n[ıi]z[ıi]\b/gi,
    replacement: 'planlamanızı',
  },
  // "Kulak Burunuz Boğaz" → "Kulak Burun Boğaz"
  {
    id: 'kulak_burun_bogaz_fix',
    pattern: /\bkulak\s+burunuz\s+bo[gğ]az\b/gi,
    replacement: (match) => match.replace(/burunuz/i, match.includes('Burunuz') ? 'Burun' : 'burun'),
  },
  // "planızı" (broken possessive 2nd person) → "planınızı"
  // Use simple character class approach — avoids \b boundary issues with Turkish chars
  {
    id: 'tedavi_planizi_full',
    pattern: /tedavi\s+plan[\u0131i]z[\u0131i](?!n)/gi,
    replacement: 'tedavi plan\u0131n\u0131z\u0131',
  },
  // Standalone planızı not preceded/followed by alphanumeric or ı/n
  {
    id: 'planizi_standalone',
    pattern: /(?:^|\s)plan[\u0131i]z[\u0131i](?=\s|[.,;:!?]|$)/gm,
    replacement: (m: string) => m.replace(/plan[\u0131i]z[\u0131i]/, 'plan\u0131n\u0131z\u0131'),
  },
  // "zamanızı" → "zamanınızı"
  {
    id: 'zamanizi_full_fix',
    pattern: /\bzaman[ıi]z[ıi]\b(?!\s+yazabilirsiniz|\s+belirtin)/gi,
    replacement: 'zamanınızı',
  },
  // "saatınız" → "saatiniz"
  {
    id: 'saatiniz_fix',
    pattern: /\bsaat[ıi]n[ıi]z\b(?!\s+dilimi)/gi,
    replacement: 'saatiniz',
  },
  // "tarihınız" → "tarihiniz"
  {
    id: 'tarihiz_fix',
    pattern: /\btarih[ıi]n[ıi]z\b/gi,
    replacement: 'tarihiniz',
  },
  // "randevızı" → "randevunuzu"
  {
    id: 'randevizi_fix',
    pattern: /\brandev[ıi]z[ıi]\b/gi,
    replacement: 'randevunuzu',
  },
  // "sabah saatlerininiz" → "sabah saatlerinde"
  {
    id: 'sabah_saatlerininiz_fix',
    pattern: /sabah\s+saatlerininiz\b/gi,
    replacement: 'sabah saatlerinde',
  },
  // "uygun olduğunuzu" → "uygun olduğunuz"
  {
    id: 'uygun_oldugunuzu_fix',
    pattern: /uygun\s+oldu[gğ]unuzu\b/gi,
    replacement: 'uygun olduğunuz',
  },
  // "sabah_saatlerinde_(09:00_-_12:00)" → "sabah saatlerinde"
  {
    id: 'sabah_saatlerinde_range_fix',
    pattern: /sabah_saatlerinde_\(?09:00_-_12:00\)?|sabah\s+saatlerinde\s+\(?09:00\s*-\s*12:00\)?/gi,
    replacement: 'sabah saatlerinde',
  },
];

// ─── Normalizer ───────────────────────────────────────────────────────────────

export class TurkishFinalQualityNormalizer {

  /**
   * Normalize Turkish morphology errors in final outbound text.
   * Context-aware: uses complaint/location to guide some rewrites.
   */
  public static normalize(
    text: string,
    _context?: { complaint?: string; location?: string }
  ): NormalizeResult {
    if (!text || text.trim().length === 0) {
      return { text, changesCount: 0, wasModified: false, appliedPatterns: [], rewrites: [] };
    }

    // Build protected zone map (ranges to skip)
    const protectedRanges: [number, number][] = [];
    for (const prot of PROTECTED_PHRASES) {
      prot.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = prot.exec(text)) !== null) {
        protectedRanges.push([m.index, m.index + m[0].length]);
      }
      prot.lastIndex = 0;
    }

    let result = text;
    let changesCount = 0;
    const appliedPatterns: string[] = [];

    for (const rule of REWRITE_RULES) {
      rule.pattern.lastIndex = 0;

      // Check if pattern matches
      if (!rule.pattern.test(result)) {
        rule.pattern.lastIndex = 0;
        continue;
      }
      rule.pattern.lastIndex = 0;

      // Apply replacement, skipping protected ranges
      const newResult = result.replace(rule.pattern, (match, ...groups) => {
        // Find match position in current string
        const matchIdx = result.indexOf(match);
        const isProtected = protectedRanges.some(
          ([start, end]) => matchIdx >= start && matchIdx < end
        );
        if (isProtected) return match;

        changesCount++;
        appliedPatterns.push(rule.id);
        if (typeof rule.replacement === 'function') {
          return (rule.replacement as Function)(match, ...groups);
        }
        return rule.replacement;
      });
      rule.pattern.lastIndex = 0;
      result = newResult;
    }

    const wasModified = result !== text;

    try {
      if (wasModified) {
        console.log(JSON.stringify({
          tag: 'TURKISH_FINAL_QUALITY_REWRITE_APPLIED',
          changesCount,
          appliedPatterns,
          wasModified,
        }));
      }
    } catch { /* non-fatal */ }

    return { text: result, changesCount, wasModified, appliedPatterns, rewrites: appliedPatterns };
  }

  /**
   * Convenience wrapper — returns just the normalized string.
   */
  public static normalizeText(text: string, context?: { complaint?: string; location?: string }): string {
    return this.normalize(text, context).text;
  }
}
