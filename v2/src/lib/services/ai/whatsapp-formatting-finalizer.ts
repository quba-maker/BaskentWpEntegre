/**
 * P0.16-L: WhatsAppFormattingFinalizer
 *
 * Centralizes all WhatsApp output formatting so both live worker
 * and test bot go through the same formatting chain.
 *
 * Responsibilities:
 * 1. Markdown bullet (* / -) → WhatsApp bullet (•)
 * 2. Markdown bold (**text**) → WhatsApp bold (*text*)
 * 3. Numbered blocks (1. 2. 3.) → ensure \n\n prefix
 * 4. "Tabii, tek tek yanıtlayayım. 1. ..." → break before first block
 * 5. Long run-on sentences → paragraph breaks at sentence boundaries
 * 6. Normalize excessive blank lines (\n\n\n+ → \n\n)
 *
 * Telemetry: WHATSAPP_FORMATTING_APPLIED (non-fatal, no PII)
 */

export interface WhatsAppFormattingResult {
  text: string;
  paragraphCount: number;
  hadNumberedBlocks: boolean;
  hadBullets: boolean;
  wasModified: boolean;
}

export class WhatsAppFormattingFinalizer {

  /**
   * Format text for WhatsApp delivery.
   * Safe to call on any string — returns unchanged if no formatting needed.
   */
  public static format(text: string): WhatsAppFormattingResult {
    if (!text || text.trim().length === 0) {
      return { text, paragraphCount: 0, hadNumberedBlocks: false, hadBullets: false, wasModified: false };
    }

    const original = text;
    let formatted = text;

    // 1. Convert markdown bullets (* -) → • 
    const hadBullets = /^(\s*)[\*\-]\s+/m.test(formatted);
    formatted = formatted.replace(/^(\s*)[\*\-]\s+/gm, '$1• ');

    // 2. Convert **bold** → *bold* (WhatsApp bold)
    formatted = formatted.replace(/\*\*([^*\n]+)\*\*/g, '*$1*');

    // 3. Detect numbered blocks — at start of line OR after '. ' in inline text
    const hadNumberedBlocks = /(?:^|\. )\d+\.\s/m.test(formatted);

    if (hadNumberedBlocks) {
      // 3a. Ensure each numbered block has \n\n before it (except if it's at start)
      formatted = formatted.replace(/([^\n])\n(\d+\.\s)/g, '$1\n\n$2');
      
      // 3b. Handle "...yanıtlayayım. 1. ..." — inline numbered block after intro sentence
      formatted = formatted.replace(/([\.\!\?])\s+(\d+\.\s)/g, '$1\n\n$2');
    }

    // 4. Long run-on sentences — break at sentence boundaries if >250 chars in a paragraph
    formatted = formatted.split('\n\n').map(para => {
      if (para.length > 250 && !para.startsWith('•') && !para.startsWith('*')) {
        // Break at ". " or "! " or "? " boundaries, but only when sentence is ≥60 chars
        return para.replace(/([.!?])\s+(?=[A-ZÇĞİÖŞÜa-zçğışöşü])/g, (match, punct, offset, str) => {
          // Find position of this match
          const before = str.substring(0, offset);
          const lastBreak = Math.max(before.lastIndexOf('\n'), 0);
          const segLen = offset - lastBreak;
          if (segLen > 60) return punct + '\n\n';
          return match;
        });
      }
      return para;
    }).join('\n\n');

    // 5. Normalize excessive blank lines
    formatted = formatted.replace(/\n{3,}/g, '\n\n');

    // 6. Trim trailing whitespace per line
    formatted = formatted.split('\n').map(l => l.trimEnd()).join('\n');

    // 7. Final trim
    formatted = formatted.trim();

    const wasModified = formatted !== original;
    const paragraphCount = formatted.split(/\n\n+/).filter(p => p.trim().length > 0).length;

    try {
      if (wasModified) {
        console.log(JSON.stringify({
          tag: 'WHATSAPP_FORMATTING_APPLIED',
          paragraphCount,
          hadNumberedBlocks,
          hadBullets,
          wasModified,
        }));
      }
    } catch { /* non-fatal */ }

    return { text: formatted, paragraphCount, hadNumberedBlocks, hadBullets, wasModified };
  }

  /**
   * Convenience wrapper — returns just the formatted string.
   * Drop-in replacement for the old formatForWhatsApp() function in worker.ts.
   */
  public static formatText(text: string): string {
    return this.format(text).text;
  }
}
