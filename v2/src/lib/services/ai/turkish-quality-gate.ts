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

  public static validate(text: string): { valid: boolean; reason?: string } {
    if (!text) return { valid: true };

    // Replace Turkish capital letters for regex safety
    const normalized = text
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .toLowerCase();

    for (const regex of this.blacklists) {
      if (regex.test(normalized)) {
        return {
          valid: false,
          reason: `Türkçe dil bilgisi hatası tespit edildi (Eşleşen kural: ${regex.toString()})`
        };
      }
    }

    return { valid: true };
  }
}
