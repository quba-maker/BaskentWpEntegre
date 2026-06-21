export class CallPreferenceLabelResolver {
  /**
   * Resolves database/form call preference strings into clean, human-readable Turkish.
   * e.g., 'sabah_saatlerinde_(09:00_-_12:00)' -> 'sabah saatlerinde'
   */
  public static resolve(raw: string): string {
    if (!raw) return '';
    const clean = raw.toLowerCase().trim();

    if (clean.includes('sabah')) {
      return 'sabah saatlerinde';
    }
    if (clean.includes('ogle') || clean.includes('öğle')) {
      return 'öğle saatlerinde';
    }
    if (clean.includes('aksam') || clean.includes('akşam')) {
      return 'akşam saatlerinde';
    }

    // Fallback: clean underscores and double spaces
    const normalized = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalized.length > 0) {
      return normalized;
    }

    return 'belirttiğiniz saat aralığında';
  }
}
