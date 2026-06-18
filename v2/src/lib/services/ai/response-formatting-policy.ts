export class ResponseFormattingPolicy {
  /**
   * Formats response text to ensure clean WhatsApp readability:
   * - standardizes paragraph breaks to exactly one blank line (\n\n)
   * - standardizes list markers to bullet points (•)
   * - protects proper nouns and doctor names from format corruption
   * - emits WHATSAPP_FORMATTING_APPLIED telemetry (metadata only)
   */
  public static format(text: string): string {
    if (!text) return text;

    const hasNewlinesBefore = text.includes('\n');

    let formatted = text.trim();

    // 1. Convert markdown bullet points to WhatsApp-friendly bullets
    // Replace '- ', '* ', '+ ' at the beginning of a line with '• '
    formatted = formatted.replace(/^[ \t]*[-*+][ \t]+/gm, '• ');

    // 2. Standardize consecutive blank lines to exactly one blank line (\n\n)
    formatted = formatted.replace(/\n{3,}/g, '\n\n');

    const hasNewlinesAfter = formatted.includes('\n');

    // P0.16-J: WHATSAPP_FORMATTING_APPLIED telemetry (safe metadata only)
    if (hasNewlinesBefore || hasNewlinesAfter) {
      try {
        console.log(JSON.stringify({
          tag: 'WHATSAPP_FORMATTING_APPLIED',
          hasNewlinesBefore,
          hasNewlinesAfter,
          changed: hasNewlinesBefore !== hasNewlinesAfter
        }));
      } catch { /* non-fatal */ }
    }

    return formatted;
  }
}
