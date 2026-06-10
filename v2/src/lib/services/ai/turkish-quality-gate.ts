export interface QualityGateOptions {
  ctaOfferedRecently?: boolean;
  angryPatientMode?: boolean;
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
      'fazla kalip gibi olmus',
      'baskent asistaniyim',
      'baskent asistani'
    ];

    for (const cliché of prohibitedClichés) {
      if (cleanText.includes(cliché)) {
        return {
          valid: false,
          reason: `Yasaklı otomatik bot kalıbı/cliché tespit edildi: "${cliché}"`
        };
      }
    }

    // 4. CTA blocking logic under options
    if (options?.ctaOfferedRecently || options?.angryPatientMode) {
      const forbiddenCtaPhrases = [
        'randevu planlayalim',
        'gorusme ayarlayalim',
        'sizi arayalim',
        'paylasir misiniz',
        'turkiye saatiyle',
        'telefon gorusmesi'
      ];

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

    return { valid: true };
  }
}
