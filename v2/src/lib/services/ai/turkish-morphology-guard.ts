/**
 * P0.11: TurkishMorphologyGuard
 * Detects and optionally corrects Turkish suffix/possessive deduplication errors
 * in AI-generated responses.
 * 
 * CRITICAL SAFETY RULES:
 * - Only runs on AI-generated final bot responses (qualityGateLocale === 'tr')
 * - NEVER runs on: approved templates, message_templates, user input, system prompts,
 *   tenant/channel prompts, DB-stored messages
 * - If correction is uncertain, returns error without modifying text
 */

export interface MorphologyGuardResult {
  hasMorphologyError: boolean;
  errors: MorphologyError[];
  correctedText?: string;
  correctionApplied: boolean;
  correctionConfidence: 'high' | 'low' | 'none';
}

export interface MorphologyError {
  pattern: string;
  match: string;
  position: number;
  suggestedFix?: string;
}

// Known Turkish suffix deduplication patterns with safe corrections
const KNOWN_DEDUP_PATTERNS: { regex: RegExp; description: string; fix?: (match: string) => string }[] = [
  // Specific live failures / P0.15 additions
  { regex: /şikayetinizin\s+olduğunuzu/gi, description: 'sikayetinizin_oldugunuzu', fix: (m) => m[0] === 'Ş' ? 'Şikayetiniz olduğunu' : 'şikayetiniz olduğunu' },
  { regex: /hangi\s+ülkeniz\s+veya\s+şehriniz\s+saatine\s+göre\s+olsun\??/gi, description: 'ulkeniz_sehriniz_saatine_gore_olsun', fix: (m) => m[0] === 'H' ? 'Hangi ülke veya şehir saatine göre planlayalım?' : 'hangi ülke veya şehir saatine göre planlayalım?' },
  { regex: /planınınız/gi, description: 'planininiz', fix: (m) => m[0] === 'P' ? 'Planınız' : 'planınız' },
  { regex: /hangisininiz/gi, description: 'hangisininiz', fix: (m) => m[0] === 'H' ? 'Hangisinin' : 'hangisinin' },
  { regex: /yaşandığınızı/gi, description: 'yasandiginizi', fix: (m) => m[0] === 'Y' ? 'Yaşandığını' : 'yaşandığını' },
  { regex: /adınızızı/gi, description: 'adınızızı', fix: (m) => m[0] === 'A' ? 'Adınızı' : 'adınızı' },
  { regex: /cevabınızızı/gi, description: 'cevabınızızı', fix: (m) => m[0] === 'C' ? 'Cevabınızı' : 'cevabınızı' },
  { regex: /şikayetiniziniz/gi, description: 'şikayetiniziniz', fix: (m) => m[0] === 'Ş' || m[0] === 'S' ? (m[0] === 'Ş' ? 'Şikayetiniz' : 'Sikayetiniz') : 'şikayetiniz' },
  { regex: /saatiniziniz/gi, description: 'saatiniziniz', fix: (m) => m[0] === 'S' ? 'Saatiniz' : 'saatiniz' },
  { regex: /planızı/gi, description: 'planızı', fix: (m) => m[0] === 'P' ? 'Tedavi planı' : 'tedavi planı' },
  { regex: /mümkünüz/gi, description: 'mümkünüz', fix: (m) => m[0] === 'M' ? 'Mümkün olmuyor' : 'mümkün olmuyor' },
  { regex: /Haklısınızız/gi, description: 'Haklısınızız', fix: (m) => m[0] === 'H' ? 'Haklısınız' : 'haklısınız' },
  { regex: /yetkiniz\s+hekim/gi, description: 'yetkiniz_hekim', fix: () => 'yetkili hekim' },
  { regex: /Beyiniz\s+ve\s+Sinir/gi, description: 'Beyiniz_ve_Sinir', fix: (m) => m[0] === 'B' ? 'Beyin ve Sinir' : 'beyin ve sinir' },
  { regex: /ülkeniziniz/gi, description: 'ulkeniziniz', fix: (m) => m[0] === 'Ü' || m[0] === 'U' ? (m[0] === 'Ü' ? 'Ülkeniz' : 'Ulkeniz') : 'ülkeniz' },
  { regex: /şehriniziniz/gi, description: 'sehriniziniz', fix: (m) => m[0] === 'Ş' || m[0] === 'S' ? (m[0] === 'Ş' ? 'Şehriniz' : 'Sehriniz') : 'şehriniz' },
  { regex: /saatlerimiziniz/gi, description: 'saatlerimiziniz', fix: (m) => m[0] === 'S' ? 'Saatlerimiz' : 'saatlerimiz' },
  { regex: /çalışma\s+saatlerimiziniz/gi, description: 'calisma_saatlerimiziniz', fix: () => 'çalışma saatlerimiz' },
  { regex: /yaşadığınızızı/gi, description: 'yaşadığınızızı', fix: (m) => m[0] === 'Y' ? 'Yaşadığınızı' : 'yaşadığınızı' },
  { regex: /anneniziniz/gi, description: 'anneniziniz', fix: (m) => m[0] === 'A' ? 'Annenizin' : 'annenizin' },
  { regex: /hekim listesinizi/gi, description: 'hekim listesinizi', fix: (m) => m[0] === 'H' ? 'Hekim listesini' : 'hekim listesini' },
  { regex: /hastanınız/gi, description: 'hastanınız', fix: (m) => m[0] === 'H' ? 'Hastanın' : 'hastanın' },
  { regex: /sorularınızıza/gi, description: 'sorularınızıza', fix: (m) => m[0] === 'S' ? 'Sorularınıza' : 'sorularınıza' },
  { regex: /uzmanızı/gi, description: 'uzmanızı', fix: (m) => m[0] === 'U' ? 'Uzmanı' : 'uzmanı' },
  { regex: /aklınızızdaki/gi, description: 'aklınızızdaki', fix: (m) => m[0] === 'A' ? 'Aklınızdaki' : 'aklınızdaki' },
  { regex: /Kusura bakmayınız/gi, description: 'kusura_bakmayiniz', fix: (m) => m[0] === 'K' ? 'Kusura bakmayın' : 'kusura bakmayın' },
  { regex: /size uygun olduğunuz bir zamanızı/gi, description: 'size_uygun_oldugunuz_bir_zamanizi', fix: () => 'size uygun bir zaman aralığını' },
  { regex: /uygun olduğunuz bir zamanızı/gi, description: 'uygun_oldugunuz_bir_zamanizi', fix: () => 'size uygun bir zaman aralığını' },
  { regex: /bir zamanızı/gi, description: 'bir_zamanizi', fix: () => 'uygun bir zaman aralığını' },
  { regex: /zamanızı/gi, description: 'zamanizi_missing_n', fix: (m) => m[0] === 'Z' ? 'Zaman aralığını' : 'zaman aralığını' },
  { regex: /mesafeniniz/gi, description: 'mesafeniniz', fix: (m) => m[0] === 'M' ? 'Mesafeniz' : 'mesafeniz' },
  // P0.16-F: ağrısınınız → ağrınız (possessive suffix doubled on pain nouns)
  { regex: /ağrısınınız/gi, description: 'agrisininiz', fix: (m) => m[0] === 'A' ? 'Ağrınız' : 'ağrınız' },
  { regex: /agrisininiz/gi, description: 'agrisininiz_ascii', fix: (m) => m[0] === 'A' ? 'Ağrınız' : 'ağrınız' },
  // ısınınız → ısınız (heat/warmth suffix doubled)
  { regex: /ısınınız/gi, description: 'isininiz', fix: (m) => m[0] === 'I' ? 'Isınız' : 'ısınız' },
  // General: -sınınız → -nız (possessive doubled on nouns ending in vowel)
  { regex: /(\w+)sınınız/gi, description: 'general_sınınız_doubled', fix: (m) => m.replace(/sınınız$/gi, 'nız') },

  // P0.16-G: Greeting phrase blockers
  // "bölümümüzün ilgilendiğinizi belirtmiştiniz" → remove (robotic, assumes past context in greeting)
  {
    regex: /bölümümüzün\s+ilgilendiğinizi\s+belirtmiştiniz[\.\,]?/gi,
    description: 'bolumumuzun_ilgilendginizi',
    fix: () => ''
  },
  // "ilgilendiğinizi belirtmiştiniz" standalone
  {
    regex: /ilgilendiğinizi\s+belirtmiştiniz[\.\,]?/gi,
    description: 'ilgilendginizi_belirtmiştiniz',
    fix: () => ''
  },
  // "bölümümüzün ilgilendiğinizi" without belirtmiştiniz
  {
    regex: /bölümümüzün\s+ilgilendiğinizi[\.\,]?/gi,
    description: 'bolumumuzun_ilgilendginizi_short',
    fix: () => ''
  },

  // Doubled possessive general patterns
  // nızınız → nız
  { regex: /(\w+)(nızınız|niziniz|nüzünüz|nuzunuz)/gi, description: 'doubled_possessive_niz', fix: (m) => m.replace(/(nızınız|niziniz|nüzünüz|nuzunuz)/gi, (sub) => sub.startsWith('nız') ? 'nız' : sub.startsWith('niz') ? 'niz' : sub.startsWith('nüz') ? 'nüz' : 'nuz') },
  // ınızınız → ınız
  { regex: /(\w+)(ınızınız|inızınız)/gi, description: 'doubled_possessive_iniz', fix: (m) => m.replace(/(ınızınız|inızınız)/gi, 'ınız') },
  // nıznız -> nız
  { regex: /(\w+)(nıznız|nizniz|nüznüz|nuznuz)/gi, description: 'doubled_possessive_nznz', fix: (m) => m.replace(/(nıznız|nizniz|nüznüz|nuznuz)/gi, (sub) => sub.startsWith('nız') ? 'nız' : sub.startsWith('niz') ? 'niz' : sub.startsWith('nüz') ? 'nüz' : 'nuz') },
  // imizimiz → imiz
  { regex: /(\w+)(imizimiz|ımızımız)/gi, description: 'doubled_possessive_imiz', fix: (m) => m.replace(/(imizimiz)/gi, 'imiz').replace(/(ımızımız)/gi, 'ımız') },

  // P0.16-H: Empathy phrase fix
  // "olabileceğinizi biliyoruz" → "olabileceğini biliyoruz"
  // (second-person suffix on verb phrase incorrectly agrees with 2nd person)
  {
    regex: /olabilece\u011finizi\s+biliyoruz/gi,
    description: 'olabilecegginizi_biliyoruz',
    fix: (m) => m[0] === 'O' ? 'Olabileceğini biliyoruz' : 'olabileceğini biliyoruz'
  },
  {
    regex: /olabilece\u011finizi\s+anl[iı]yoruz/gi,
    description: 'olabilecegginizi_anliyoruz',
    fix: (m) => m[0] === 'O' ? 'Olabileceğini anlıyoruz' : 'olabileceğini anlıyoruz'
  },

  // P0.16-H: planızı → planınız  (missing 'n' in possessive suffix)
  // Guard: must NOT match planınız (already correct)
  {
    regex: /\bplan[ıi]z[ıi]\b/gi,
    description: 'planizi_missing_n',
    fix: (m) => {
      // Protect planınız / planınızı (already correct — has double n)
      if (/plan[ıi]n[ıi]z/i.test(m)) return m;
      return m[0] === 'P' ? 'Planınız' : 'planınız';
    }
  },

  // P0.16-H: zamanızı → zamanınız  (missing 'n' in possessive — distinct from zamanızı guard in P0.16-E)
  {
    regex: /\bzaman[ıi]z[ıi]\b/gi,
    description: 'zamanizi_bare_missing_n',
    fix: (m) => {
      if (/zamaN[ıi]n[ıi]z/i.test(m)) return m;
      return m[0] === 'Z' ? 'Zamanınız' : 'zamanınız';
    }
  },

  // P0.16-I: Contextual complaint/empathy phrase patterns
  // These appear when LLM generates empathy text in 3rd-person subject + 2nd-person verb suffix mismatch

  // "şikayetinizin X aydır devam ettiğinizi" → "şikayetinizin X aydır devam ettiğini"
  // "devam ettiğinizi" in context of "şikayet/ağrı/durum" subject → remove 2nd person from verb
  {
    regex: /(?:şikayetinizin|ağrınızın|durumun|hastalığınızın)\s+[\w\s]+?devam\s+ettiğinizi/gi,
    description: 'sik_devam_ettiginizi',
    fix: (m) => m.replace(/ettiğinizi$/i, 'ettiğini')
  },
  // bare "devam ettiğinizi" in complaint context — safe narrow pattern
  {
    regex: /devam\s+ettiğinizi\s+(?:ve|anlıyorum|biliyorum|görüyorum)/gi,
    description: 'devam_ettiginizi_bare',
    fix: (m) => m.replace(/ettiğinizi/i, 'ettiğini')
  },

  // "bacaklarınıza vurduğunuzu" → "bacaklarınıza vurduğunu"
  // (ağrı/şikayet subject, verb in 2nd person wrong)
  {
    regex: /(?:bacaklarınıza|kollarınıza|boynunuza|belinize)\s+[\w\s]*?vurduğunuzu/gi,
    description: 'vuruduggunuzu_bacak',
    fix: (m) => m.replace(/vurduğunuzu$/i, 'vurduğunu')
  },

  // "ne kadar etkilediğinizi tahmin/anlıyoruz" → "ne kadar etkilediğini"
  {
    regex: /ne\s+kadar\s+etkilediğinizi/gi,
    description: 'ne_kadar_etkilediginizi',
    fix: (m) => m[0] === 'N' ? 'Ne kadar etkilediğini' : 'ne kadar etkilediğini'
  },

  // "etkilediğinizi tahminiz edebiliyorum" → "etkilediğini tahmin edebiliyorum"
  {
    regex: /tahminiz\s+edebiliyorum/gi,
    description: 'tahminiz_edebiliyorum',
    fix: (m) => m[0] === 'T' ? 'Tahmin edebiliyorum' : 'tahmin edebiliyorum'
  },
  // also catch "tahminiz ediyorum" variant
  {
    regex: /tahminiz\s+ediyorum/gi,
    description: 'tahminiz_ediyorum',
    fix: (m) => m[0] === 'T' ? 'Tahmin ediyorum' : 'tahmin ediyorum'
  },

  // "Tedavi Planızı" / "Tedavi planızı" — capital T variant (already handled lowercase above)
  {
    regex: /Tedavi\s+Plan[ıi]z[ıi]/g,
    description: 'tedavi_planizi_capital',
    fix: () => 'Tedavi planınız'
  },

  // P0.16-J: “süreçleriniz detaylarınızı” — doubled possessive on both nouns in process context
  {
    regex: /süreçleriniz\s+detaylarınızı/gi,
    description: 'surec_leriniz_detaylarinizi',
    fix: (m) => m[0] === 'S' ? 'Sürecinize dair detayları' : 'sürecinize dair detayları'
  },
  // broader: any "X-leriniz Y-larınızı" combo (doubled possessive pair)
  {
    regex: /\b(\w+)leriniz\s+(\w+)larınızı/gi,
    description: 'doubled_possessive_leriniz_larinizi',
    fix: (m) => m.replace(/leriniz/i, 'inize dair').replace(/larınızı/i, 'ları')
  },

  // P0.16-J: “tedavi yönteminizi belirler” → “tedavi yöntemini belirler”
  // (size-agreement error: hekim 3rd-person determines, not the patient)
  {
    regex: /tedavi\s+yönteminizi\s+belirler/gi,
    description: 'tedavi_yonteminizi_belirler',
    fix: (m) => m[0] === 'T' ? 'Tedavi yöntemini belirler' : 'tedavi yöntemini belirler'
  },
];


// Known bad phrase patterns (no auto-fix, Quality Gate fail)
const BAD_PHRASE_PATTERNS: { regex: RegExp; description: string }[] = [
  { regex: /hangi\s+ülkeniz\s+veya\s+şehriniz\s+saatine/gi, description: 'ulkeniz_sehriniz_saatine' },
  { regex: /görüşme\s+saatiniz\s+hangi\s+ülkeniz/gi, description: 'gorusme_saatiniz_hangi_ulkeniz' },
];

export class TurkishMorphologyGuard {
  /**
   * Checks AI-generated text for Turkish morphology errors.
   * Returns detection results and optional corrections.
   * Protects proper nouns, doctor names and capitalized titles.
   */
  public static check(
    text: string, 
    applyCorrection: boolean = true,
    doctors: string[] = []
  ): MorphologyGuardResult {
    if (!text || text.trim().length === 0) {
      return { hasMorphologyError: false, errors: [], correctionApplied: false, correctionConfidence: 'none' };
    }

    const errors: MorphologyError[] = [];
    let workingText = text;
    let anyFixed = false;

    // 1. Run raw text pre-corrections for mixed proper-noun-suffix cases
    if (applyCorrection) {
      const preFixes = [
        { regex: /Türkiye'niniz/gi, fix: "Türkiye'nin" },
        { regex: /organ\s+naklininiz/gi, fix: "organ naklinin" },
        { regex: /mesafeniniz/gi, fix: "mesafeniz" }
      ];
      for (const pf of preFixes) {
        if (pf.regex.test(workingText)) {
          workingText = workingText.replace(pf.regex, pf.fix);
          anyFixed = true;
        }
      }
    }

    // 2. Extract and protect proper nouns, capitalized titles, and doctor names
    const protectedSpans: string[] = [];
    const addSpan = (val: string) => {
      const idx = protectedSpans.length;
      protectedSpans.push(val);
      return `__PROTECTED_SPAN_${idx}__`;
    };

    // Protect verified doctor names
    for (const doc of doctors) {
      if (doc && doc.length > 2) {
        const escaped = this.escapeRegex(doc);
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
        workingText = workingText.replace(regex, (m) => addSpan(m));
      }
    }

    // Protect capitalized names/titles (e.g. "Prof. Dr. Aytekin GÜVEN", "Dr. Ahmet")
    const titleNameRegex = /\b(?:Prof\.\s+)?(?:Dr\.\s+)?[A-ZÇĞİÖŞÜ][a-zçğışöüA-ZÇĞİÖŞÜ]*\s+[A-ZÇĞİÖŞÜ]+(?:\s+[A-ZÇĞİÖŞÜ]+)*\b/g;
    workingText = workingText.replace(titleNameRegex, (m) => addSpan(m));

    // Protect all-caps words (length >= 3)
    const allCapsRegex = /\b[A-ZÇĞİÖŞÜ]{3,}\b/g;
    workingText = workingText.replace(allCapsRegex, (m) => addSpan(m));

    // Protect specific system proper nouns
    const properNounRegex = /\b(?:Başkent|Ankara|İstanbul|Izmir|Baskent|Istanbul|Türkiye|Turkiye)\b/g;
    workingText = workingText.replace(properNounRegex, (m) => addSpan(m));

    // 3. Check known deduplication patterns on protected text
    for (const pattern of KNOWN_DEDUP_PATTERNS) {
      const matches = workingText.matchAll(new RegExp(pattern.regex.source, 'gi'));
      for (const match of matches) {
        errors.push({
          pattern: pattern.description,
          match: match[0],
          position: match.index || 0,
          suggestedFix: pattern.fix ? pattern.fix(match[0]) : undefined
        });

        if (applyCorrection && pattern.fix) {
          workingText = workingText.replace(new RegExp(this.escapeRegex(match[0]), 'gi'), pattern.fix(match[0]));
          anyFixed = true;
        }
      }
    }

    // 4. Check bad phrase patterns on protected text
    for (const pattern of BAD_PHRASE_PATTERNS) {
      const matches = workingText.matchAll(new RegExp(pattern.regex.source, 'gi'));
      for (const match of matches) {
        errors.push({
          pattern: pattern.description,
          match: match[0],
          position: match.index || 0
        });
      }
    }

    // 5. Generic suffix dedup detector on protected text
    const genericDedup = /(\w{3,})(nız|niz|nüz|nuz|mız|miz|müz|müz)\2/gi;
    const genericMatches = workingText.matchAll(genericDedup);
    for (const match of genericMatches) {
      const alreadyCaught = errors.some(e => e.position === (match.index || 0));
      if (!alreadyCaught) {
        errors.push({
          pattern: 'generic_suffix_dedup',
          match: match[0],
          position: match.index || 0
        });
      }
    }

    // 6. Restore all protected spans
    for (let i = 0; i < protectedSpans.length; i++) {
      const placeholder = `__PROTECTED_SPAN_${i}__`;
      workingText = workingText.replace(placeholder, protectedSpans[i]);
    }

    const hasMorphologyError = errors.length > 0;
    const allHaveFixes = errors.every(e => e.suggestedFix !== undefined);
    const correctionConfidence = !hasMorphologyError ? 'none' : (anyFixed && allHaveFixes ? 'high' : 'low');

    return {
      hasMorphologyError,
      errors,
      correctedText: anyFixed ? workingText : undefined,
      correctionApplied: anyFixed,
      correctionConfidence
    };
  }

  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
