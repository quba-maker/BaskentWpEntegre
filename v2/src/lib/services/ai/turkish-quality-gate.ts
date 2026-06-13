export interface QualityGateOptions {
  ctaOfferedRecently?: boolean;
  angryPatientMode?: boolean;
  personaName?: string;
  organizationName?: string;
  organizationShortName?: string;
  identityAlreadyIntroduced?: boolean;
  asksIdentity?: boolean;
  asksName?: boolean;
  patientClaimsBot?: boolean;
  patientProvidedAvailability?: boolean;
}

export class TurkishReplyQualityGate {
  private static blacklists = [
    // Duplicated possessive: ağrınızız, ağrınızızınız
    /(?:^|[^a-zıüşğçöü])ağrınızız(?:ınız)?(?:$|[^a-zıüşğçöü])/i,
    // Suffix duplication: ameliyatınızızı
    /(?:^|[^a-zıüşğçöü])ameliyatınızızı(?:$|[^a-zıüşğçöü])/i,
    // Suffix duplication: aklınızızdaki
    /(?:^|[^a-zıüşğçöü])aklınızızdaki(?:$|[^a-zıüşğçöü])/i,
    // Suffix duplication: planızı / planlamasınızı
    /(?:^|[^a-zıüşğçöü])planızı(?:$|[^a-zıüşğçöü])/i,
    /(?:^|[^a-zıüşğçöü])planlamasınızı(?:$|[^a-zıüşğçöü])/i,
    // Suffix duplication: tahminizi (should be tahmininizi)
    /(?:^|[^a-zıüşğçöü])tahminizi(?:$|[^a-zıüşğçöü])/i,
    // Suffix duplication: örneğiniz
    /(?:^|[^a-zıüşğçöü])örneğiniz(?:$|[^a-zıüşğçöü])/i,
    // Suffix duplication: ağrınızın nedeninizi (should be ağrınızın nedenini)
    /(?:^|[^a-zıüşğçöü])ağrınızın nedeninizi(?:$|[^a-zıüşğçöü])/i,
    // Bad locative/possessive combination: uygun olduğu bir zaman (should be uygun olduğunuz)
    /(?:^|[^a-zıüşğçöü])uygun olduğu bir zaman(?:$|[^a-zıüşğçöü])/i
  ];

  // Helper to normalize text by converting to lowercase and stripping Turkish accents
  private static cleanTurkishText(str: string): string {
    return str
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .toLowerCase();
  }

  /**
   * Detects if the patient message provides their date/time availability
   */
  public static detectPatientProvidedAvailability(text: string): boolean {
    if (!text) return false;
    const clean = this.cleanTurkishText(text);

    // Explicit availability phrases
    const explicitPhrases = [
      'telefon gorusmesi icin uygunum',
      'gorusme icin uygunum',
      'arama icin uygunum',
      'su saatte arayin',
      'su saatte arayabilirsiniz',
      'saatte arayabilirsiniz',
      'saatte arayin',
      'saatte arayabilirsin',
      'uygun oldugum saat',
      'uygun oldugum zaman',
      'musait oldugum saat',
      'musait oldugum zaman',
      'telefonla arayabilirsiniz',
      'telefonla arayabilirsin',
      'telefonla arayin',
      'telefonla ulasabilirsiniz',
      'telefonla ulasin'
    ];
    if (explicitPhrases.some(p => clean.includes(p))) {
      return true;
    }

    // Days or relative day markers
    const days = [
      'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi', 'pazar',
      'yarin', 'bugun', 'haftaici', 'haftasonu', 'hafta ici', 'hafta sonu', 'gunu', 'gunleri'
    ];
    
    // Suitability or actions markers
    const suitability = [
      'uygun', 'musait', 'olabilir', 'arayabilirsiniz', 'arayin', 'araya bilirsiniz',
      'arayabilirsin', 'goruselim', 'gorusuruz', 'ulasabilirsiniz', 'ulasin',
      'uygunum', 'musaitim', 'ulasirsaniz', 'ulasabilirseniz', 'seviniriz', 'sevinirim',
      'olur', 'iyi olur', 'gorusmek'
    ];

    const hasDay = days.some(d => clean.includes(d));
    const hasSuitability = suitability.some(s => clean.includes(s));

    // Time indicators: "saat" or digital time formats (e.g. 20:00, 14.30)
    // or digits like 20, 14 with locative suffixes
    const hasTime = clean.includes('saat') || 
                    /(?:\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(?:de|da|te|ta|e|a|ye|ya|sularında|sularinda|gibi|civari|civarinda|civarı|civarında)\b)/.test(clean);

    if (hasDay && hasSuitability) {
      return true;
    }

    if (hasTime && hasSuitability) {
      return true;
    }

    // Pure time patterns with suitability, like "18:00 olabilir", "18.00 uygun", "20:00 de olur"
    const pureTimeSuitability = /(?:\d{1,2}[:.]\d{2}|\b\d{1,2}\b)\s*(?:uygun|musait|olabilir|de olur|da olur|te olur|ta olur|gibi|civari|civarinda|civarı|civarında)/;
    if (pureTimeSuitability.test(clean)) {
      return true;
    }

    return false;
  }

  private static escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private static hasSelfIntroduction(text: string, options: QualityGateOptions): boolean {
    const p = options.personaName ? this.cleanTurkishText(options.personaName) : '';
    const org = options.organizationShortName ? this.cleanTurkishText(options.organizationShortName) : '';
    const orgFull = options.organizationName ? this.cleanTurkishText(options.organizationName) : '';

    if (!p && !org && !orgFull) return false;

    const cleanText = this.cleanTurkishText(text);
    const escapedP = p ? this.escapeRegExp(p) : '';
    const escapedOrg = org ? this.escapeRegExp(org) : '';
    const escapedOrgFull = orgFull ? this.escapeRegExp(orgFull) : '';

    const patterns: RegExp[] = [];
    if (escapedP) {
      patterns.push(new RegExp(`\\b(?:ben\\s+${escapedP}|${escapedP}\\s+ben)\\b`, 'i'));
      patterns.push(new RegExp(`\\b${escapedP}(?:yim|yım|um|üm)\\b`, 'i'));
    }
    if (escapedOrg) {
      patterns.push(new RegExp(`\\b${escapedOrg}(?:dan|den|\\'dan|\\'den)?\\s+(?:yazıyorum|yaziyorum|yazmaktayım|yazmaktayim)\\b`, 'i'));
      patterns.push(new RegExp(`\\b${escapedOrg}(?:dan|den|\\'dan|\\'den)?\\s+(?:temsilcisi|asistanı|asistani)\\b`, 'i'));
    }
    if (escapedOrgFull) {
      patterns.push(new RegExp(`\\b${escapedOrgFull}(?:dan|den|\\'dan|\\'den)?\\s+(?:yazıyorum|yaziyorum|yazmaktayım|yazmaktayim)\\b`, 'i'));
      patterns.push(new RegExp(`\\b${escapedOrgFull}(?:dan|den|\\'dan|\\'den)?\\s+(?:temsilcisi|asistanı|asistani)\\b`, 'i'));
    }
    if (escapedP && escapedOrg) {
      patterns.push(new RegExp(`\\b${escapedOrg}(?:dan|den|\\'dan|\\'den)?\\s+(?:ben\\s+)?${escapedP}\\b`, 'i'));
      patterns.push(new RegExp(`\\b${escapedOrg}(?:dan|den|\\'dan|\\'den)?\\s+${escapedP}\\s+ben\\b`, 'i'));
      patterns.push(new RegExp(`\\b${escapedP}\\s+(?:ben\\s+)?${escapedOrg}\\b`, 'i'));
    }

    for (const pattern of patterns) {
      if (pattern.test(cleanText)) {
        return true;
      }
    }
    return false;
  }

  public static stripPersonaIntroduction(text: string, options: QualityGateOptions): string {
    if (!text) return '';
    const p = options.personaName ? this.cleanTurkishText(options.personaName) : '';
    const org = options.organizationShortName ? this.cleanTurkishText(options.organizationShortName) : '';
    const orgFull = options.organizationName ? this.cleanTurkishText(options.organizationName) : '';

    if (!p && !org && !orgFull) return text;

    const cleanText = this.cleanTurkishText(text);
    const escapedP = p ? this.escapeRegExp(p) : '';
    const escapedOrg = org ? this.escapeRegExp(org) : '';
    const escapedOrgFull = orgFull ? this.escapeRegExp(orgFull) : '';

    const greetings = `(?:merhaba|selam|merhabalar|iyi\\s+gunler|iyi\\s+aksamlar|iyi\\s+sabahlar|iyi\\s+gunler\\s+dilerim|iyi\\s+aksamlar\\s+dilerim)`;
    const separators = `(?:[\\s.,:;!?()\'"\\-—–]*)`;

    const identities: string[] = [];
    if (escapedP) {
      identities.push(`(?:ben\\s+)?${escapedP}(?:\\s+ben)?`);
      identities.push(`${escapedP}(?:yim|yim|um|üm)`);
    }
    if (escapedOrg) {
      identities.push(`${escapedOrg}(?:dan|den|\\'dan|\\'den)?(?:\\s+(?:yazıyorum|yaziyorum|yazmaktayım|yazmaktayim))?`);
      identities.push(`${escapedOrg}(?:dan|den|\\'dan|\\'den)?\\s+(?:temsilcisi|asistanı|asistani)`);
    }
    if (escapedOrgFull) {
      identities.push(`${escapedOrgFull}(?:dan|den|\\'dan|\\'den)?(?:\\s+(?:yazıyorum|yaziyorum|yazmaktayım|yazmaktayim))?`);
      identities.push(`${escapedOrgFull}(?:dan|den|\\'dan|\\'den)?\\s+(?:temsilcisi|asistanı|asistani)`);
    }
    if (escapedP && escapedOrg) {
      identities.push(`(?:ben\\s+)?${escapedP}(?:\\s+ben)?(?:\\s*(?:,|ve)\\s*)?${escapedOrg}(?:dan|den|\\'dan|\\'den)?(?:\\s+(?:yazıyorum|yaziyorum|yazmaktayım|yazmaktayim))?`);
      identities.push(`${escapedOrg}(?:dan|den|\\'dan|\\'den)?(?:\\s*(?:,|ve)\\s*)?(?:ben\\s+)?${escapedP}(?:\\s+ben)?`);
    }

    identities.sort((a, b) => b.length - a.length);

    const identityOr = `(?:${identities.join('|')})`;
    const prefixRegex = new RegExp(
      `^(?:${greetings}${separators})?${identityOr}${separators}`,
      'i'
    );

    const match = prefixRegex.exec(cleanText);
    if (match) {
      const matchLength = match[0].length;
      let cleaned = text.substring(matchLength);
      cleaned = cleaned.replace(/^[\s.,:;!?()\'"\\-—–]+/, '');
      return cleaned;
    }

    return text;
  }

  public static validate(text: string, options?: QualityGateOptions): { valid: boolean; reason?: string } {
    if (!text) return { valid: true };

    // Replace Turkish capital letters for regex safety
    const normalized = text
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .toLowerCase();

    // 1. Run legacy blacklists
    for (const regex of this.blacklists) {
      if (regex.test(normalized)) {
        return {
          valid: false,
          reason: `Türkçe dil bilgisi hatası tespit edildi (Eşleşen kural: ${regex.toString()})`
        };
      }
    }

    // 2. Suffix duplication validation (generic checks with exception lists to avoid false-positives)
    const words = normalized.split(/[\s.,;:!?()"\']+/);
    for (const word of words) {
      if (!word) continue;

      // -nızız (e.g. yapınızız, adınızız) -> except yalnızız
      if (word.endsWith('nızız') && word !== 'yalnızız') {
        return { valid: false, reason: `Hatalı Türkçe ek kullanımı ("-nızız"): "${word}"` };
      }
      // -niziniz (e.g. süreciniziniz) -> except deniziniz
      if (word.endsWith('niziniz') && word !== 'deniziniz') {
        return { valid: false, reason: `Hatalı Türkçe ek kullanımı ("-niziniz"): "${word}"` };
      }
      // -miziniz (e.g. hastanemiziniz) -> except ikimiziniz, temiziniz
      if (word.endsWith('miziniz') && !['ikimiziniz', 'temiziniz'].includes(word)) {
        return { valid: false, reason: `Hatalı Türkçe ek kullanımı ("-miziniz"): "${word}"` };
      }
      // -nuzunuz (e.g. çocuğunuzunuz) -> except kılavuzunuz, boynuzunuz, omuzunuz
      if (word.endsWith('nuzunuz') && !['kılavuzunuz', 'kilavuzunuz', 'boynuzunuz', 'omuzunuz'].includes(word)) {
        return { valid: false, reason: `Hatalı Türkçe ek kullanımı ("-nuzunuz"): "${word}"` };
      }
      // -larımızın / -lerimiziniz / -larımızınız
      if (word.endsWith('larımızınız') || word.endsWith('larimiziniz') || word.endsWith('lerimiziniz')) {
        return { valid: false, reason: `Hatalı Türkçe ek kullanımı ("-larımızınız / -lerimiziniz"): "${word}"` };
      }
      // -nızınız / -niziniz
      if (word.endsWith('nızınız') || word.endsWith('niziniz')) {
        if (word !== 'deniziniz') {
          return { valid: false, reason: `Hatalı Türkçe ek kullanımı ("-nızınız / -niziniz"): "${word}"` };
        }
      }
      // -nızızı (e.g. adınızızı, sorularınızızı)
      if (word.endsWith('nızızı') || word.endsWith('nizizi')) {
        return { valid: false, reason: `Hatalı Türkçe ek kullanımı ("-nızızı / -nizizi"): "${word}"` };
      }
    }

    // 3. Prohibited Clichés & Brand Identity Check
    const cleanText = this.cleanTurkishText(normalized);
    const prohibitedClichés = [
      'sorunuzu anladim',
      'sorularinizi anladim',
      'sikayetinizi anladim',
      'talebinizi anladim',
      'nasil yardimci olabilirim',
      'yardimci olmak icin buradayim',
      'surecler hakkinda yardimci oluyorum',
      'surecler hakkinda bilgi veriyorum',
      'sorunuza net doneyim',
      'sorunuza net donelim',
      'fazla kalip gibi olmus'
    ];

    if (options?.organizationShortName) {
      const orgClean = this.cleanTurkishText(options.organizationShortName);
      prohibitedClichés.push(`${orgClean} asistaniyim`);
      prohibitedClichés.push(`${orgClean} asistani`);
    }

    for (const cliché of prohibitedClichés) {
      if (cleanText.includes(cliché)) {
        return {
          valid: false,
          reason: `Yasaklı otomatik bot kalıbı/cliché tespit edildi: "${cliché}"`
        };
      }
    }

    // P0.5: Generic fallback pattern detection
    // Catches context-free combination phrases that indicate the LLM produced a
    // generic non-contextual response. Full phrase match required to avoid false positives.
    const genericFallbackPatterns = [
      'mesajinizi aldim' + '.*' + 'sikayetinizi.*acik',
      'dogru yonlendirebilmem icin.*acik yaz',
      'sikayetinizi acik yazabilir misiniz',
      'sikayetinizi acik yazar misiniz',
      'sikayetinizi biraz daha acik'
    ];
    for (const pattern of genericFallbackPatterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(cleanText)) {
        return {
          valid: false,
          reason: `generic_fallback_pattern: Bağlamsız genel yanıt kalıbı tespit edildi ("${pattern.substring(0, 40)}")`
        };
      }
    }


    // 4. CTA blocking logic under options
    if (options?.ctaOfferedRecently || options?.angryPatientMode) {
      let forbiddenCtaPhrases = [
        'randevu planlayalim',
        'gorusme ayarlayalim',
        'sizi arayalim',
        'paylasir misiniz',
        'turkiye saatiyle',
        'telefon gorusmesi'
      ];

      if (options?.patientProvidedAvailability) {
        forbiddenCtaPhrases = [
          'uygun zaman paylas',
          'randevu planlayalim',
          'arama planlayalim',
          'sizi arayalim mi',
          'gorusme ayarlayalim mi',
          'turkiye saatiyle'
        ];
      }

      for (const phrase of forbiddenCtaPhrases) {
        if (cleanText.includes(phrase)) {
          const modeStr = options.angryPatientMode ? 'Kızgın Hasta Modu' : 'CTA Frekans Freni';
          return {
            valid: false,
            reason: `Kritik Fren Engeli: ${modeStr} aktifken CTA ifadesi kullanılamaz ("${phrase}")`
          };
        }
      }
    }

    // 5. Identity repetition guard
    if (options?.identityAlreadyIntroduced && !options?.asksIdentity && !options?.asksName) {
      if (this.hasSelfIntroduction(text, options)) {
        return {
          valid: false,
          reason: `Kimlik zaten tanıtılmıştı. Aynı konuşma içinde tekrarlanan kendini tanıtma engellendi.`
        };
      }
    }

    return { valid: true };
  }
}
