/**
 * P0.11: RepeatGuard
 * Detects when the bot is repeating the same response pattern.
 * Lightweight, LLM-independent analysis of recent assistant messages.
 */

export interface RepeatGuardResult {
  isRepeating: boolean;
  repeatCount: number;
  repeatedPattern?: string;
}

export class RepeatGuard {
  /**
   * Checks the last N assistant messages for repetition.
   * Uses normalized text comparison with similarity threshold.
   */
  public static check(
    history: { role: string; content: string }[],
    windowSize: number = 4
  ): RepeatGuardResult {
    const assistantMessages = history
      .filter(m => m.role === 'assistant' && m.content && m.content.trim().length > 0)
      .slice(-windowSize)
      .map(m => this.normalize(m.content));

    if (assistantMessages.length < 2) {
      return { isRepeating: false, repeatCount: 0 };
    }

    // Check for exact or near-exact matches
    const latest = assistantMessages[assistantMessages.length - 1];
    let matchCount = 0;
    let matchedPattern = '';

    for (let i = 0; i < assistantMessages.length - 1; i++) {
      const similarity = this.similarity(latest, assistantMessages[i]);
      if (similarity >= 0.60) {
        matchCount++;
        if (!matchedPattern) {
          matchedPattern = assistantMessages[i].substring(0, 80);
        }
      }
    }

    // 2+ similar messages in the window = repeating
    const isRepeating = matchCount >= 1; // latest + 1 match = 2 total
    return {
      isRepeating,
      repeatCount: isRepeating ? matchCount + 1 : 0,
      repeatedPattern: isRepeating ? matchedPattern : undefined
    };
  }

  /**
   * Normalizes text for comparison: lowercase, strip punctuation/emoji, collapse whitespace
   */
  private static normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation and emoji
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculates Jaccard similarity between two normalized strings using word ngrams.
   * Returns 0.0 - 1.0
   */
  private static similarity(a: string, b: string): number {
    // For very short strings (≤30 chars), use exact match
    if (a.length <= 30 || b.length <= 30) {
      return a === b ? 1.0 : 0.0;
    }

    const wordsA = new Set(a.split(' ').filter(w => w.length > 1));
    const wordsB = new Set(b.split(' ').filter(w => w.length > 1));

    if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
    if (wordsA.size === 0 || wordsB.size === 0) return 0.0;

    let intersection = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return union > 0 ? intersection / union : 0.0;
  }
}
