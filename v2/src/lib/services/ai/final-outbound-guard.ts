import { withTenantDB } from '@/lib/core/tenant-db';

export interface OutboundGuardContext {
  tenantId: string;
  channelId?: string;
  conversationId?: string;
  inboundText?: string;
  intent?: string;
  unifiedContext?: any;
  industry?: string;
}

export class FinalOutboundGuard {
  /**
   * Processes outbound text before sending, applying safe morphology corrections.
   * If a blocked phrase remains after correction, returns a context-driven safe fallback.
   */
  public static process(text: string, context: OutboundGuardContext): string {
    const { tenantId, conversationId, unifiedContext } = context;

    // 0. Log that the guard is applied
    console.log(`[FINAL_OUTBOUND_GUARD_APPLIED] Running guard for tenant: ${tenantId}, conversation: ${conversationId || 'unknown'}`);
    FinalOutboundGuard.logToAudit(tenantId, 'FINAL_OUTBOUND_GUARD_APPLIED', `Outbound guard triggered. Input length: ${text ? text.length : 0}`, text || '', conversationId);

    if (!text || text.trim().length === 0) {
      return text;
    }

    let corrected = text;

    // 1. Safe morphological corrections (case-preserving replacements)
    const corrections = [
      { regex: /adınızızı/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Adınızı' : 'adınızı' },
      { regex: /yaşadığınızızı/gi, repl: (m: string) => m.charAt(0) === 'Y' ? 'Yaşadığınızı' : 'yaşadığınızı' },
      { regex: /anneniziniz/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Annenizin' : 'annenizin' },
      { regex: /anneniziziniz/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Annenizin' : 'annenizin' },
      { regex: /Beyiniz\s+ve\s+Sinir/gi, repl: (m: string) => m.charAt(0) === 'B' ? 'Beyin ve Sinir' : 'beyin ve sinir' },
      { regex: /hekim listesinizi/gi, repl: (m: string) => m.charAt(0) === 'H' ? 'Hekim listesini' : 'hekim listesini' },
      { regex: /Kusura bakmayınız/gi, repl: (m: string) => m.charAt(0) === 'K' ? 'Kusura bakmayın' : 'kusura bakmayın' },
      { regex: /ulaşmıştınızız/gi, repl: (m: string) => m.charAt(0) === 'U' ? 'Ulaşmıştınız' : 'ulaşmıştınız' },
      { regex: /ulaştığınızız/gi, repl: (m: string) => m.charAt(0) === 'U' ? 'Ulaştığınız' : 'ulaştığınız' },
      { regex: /sorularınızızı/gi, repl: (m: string) => m.charAt(0) === 'S' ? 'Sorularınızı' : 'sorularınızı' },
      { regex: /görüyorum\.,/gi, repl: (m: string) => m.charAt(0) === 'G' ? 'Görüyorum.' : 'görüyorum.' }
    ];

    for (const item of corrections) {
      corrected = corrected.replace(item.regex, item.repl as any);
    }

    // 2. Suffix corrections for possessive/suffix doubling (case-preserving)
    corrected = corrected.replace(/inizniz/gi, (m) => m.charAt(0) === 'İ' || m.charAt(0) === 'I' ? 'İniz' : 'iniz');
    corrected = corrected.replace(/ınıznız/gi, (m) => m.charAt(0) === 'I' || m.charAt(0) === 'ı' ? 'Inız' : 'ınız');
    corrected = corrected.replace(/nuznuz/gi, (m) => m.charAt(0) === 'N' ? 'Nuz' : 'nuz');
    corrected = corrected.replace(/nüznüz/gi, (m) => m.charAt(0) === 'N' ? 'Nüz' : 'nüz');
    corrected = corrected.replace(/iniziniz/gi, (m) => m.charAt(0) === 'İ' || m.charAt(0) === 'I' ? 'İniz' : 'iniz');
    corrected = corrected.replace(/niziniz/gi, (m) => m.charAt(0) === 'N' ? 'Nizin' : 'nizin');
    corrected = corrected.replace(/nızınız/gi, (m) => m.charAt(0) === 'N' ? 'Nızın' : 'nızın');
    corrected = corrected.replace(/nuzunuz/gi, (m) => m.charAt(0) === 'N' ? 'Nuzun' : 'nuzun');
    corrected = corrected.replace(/nüzünüz/gi, (m) => m.charAt(0) === 'N' ? 'Nüzün' : 'nüzün');
    corrected = corrected.replace(/inizizi/gi, (m) => m.charAt(0) === 'İ' || m.charAt(0) === 'I' ? 'İnizi' : 'inizi');
    corrected = corrected.replace(/ınızızı/gi, (m) => m.charAt(0) === 'I' || m.charAt(0) === 'ı' ? 'Inızı' : 'ınızı');
    corrected = corrected.replace(/unuzuzu/gi, (m) => m.charAt(0) === 'U' || m.charAt(0) === 'u' ? 'Unuzu' : 'unuzu');
    corrected = corrected.replace(/ünüzüzü/gi, (m) => m.charAt(0) === 'Ü' || m.charAt(0) === 'u' ? 'Ünüzü' : 'ünüzü');
    corrected = corrected.replace(/sizizi/gi, (m) => m.charAt(0) === 'S' ? 'Sizi' : 'sizi');

    const trimmed = corrected.trim();

    // 3. Greeting & incomplete sentence validation checks
    const isShortGreetingOnly = /^(merhaba|selam|günaydın|gunaydin|iyi günler|iyi gunler|tünaydın|tunaydin|merhabalar)[,\s.]*$/i.test(trimmed);
    const isSentenceIncomplete = /[,\s](ve|veya|ama|çünkü|cunku|ise|ile|fakat|ki|de|da)[,\s.]*$/i.test(trimmed) || trimmed.endsWith(',');
    const isExtremelyShort = trimmed.length > 0 && trimmed.length < 3;

    // 4. Blocklist check
    const blockedPatterns = [
      /ulaşmıştınızız/i,
      /ulaştığınızız/i,
      /anneniziniz/i,
      /anneniziziniz/i,
      /beyiniz\s+ve\s+sinir/i,
      /hekim\s+listesinizi/i,
      /sorularınızızı/i,
      /adınızızı/i,
      /yaşadığınızızı/i,
      /kusura\s+bakmayınız/i,
      /görüyorum\.,/i,
      /ınızızı/i,
      /inizini/i,
      /unuzunu/i,
      /ünüzünü/i,
      /tınızız/i,
      /dığınızız/i,
      /sınızız/i,
      /siniziz/i,
      /nıznız/i,
      /nizniz/i,
      /sizizi/i,
      /isimlerinizi paylaşamıyorum/i,
      /mümkünüz/i,
      /hastanınız/i,
      /planızı/i,
      /sorularınızıza/i,
      /uzmanızı/i,
      /sistem detay/i,
      /sistem prompt/i,
      /promptunda/i
    ];

    const lowerText = corrected.toLowerCase();
    
    // Check general reduplication pattern
    const hasSuffixDoublingPattern = 
      /(nız|niz|unuz|ünüz){2,}/i.test(lowerText) ||
      /(ınız|iniz|unuz|ünüz)(ı|i|u|ü)(z|n|s)(ı|i|u|ü)/i.test(lowerText) ||
      /iziniz/i.test(lowerText) ||
      /ınızızı/i.test(lowerText) ||
      /niziniz/i.test(lowerText) ||
      /sizizi/i.test(lowerText) ||
      /nıznız/i.test(lowerText) ||
      /iniziniz/i.test(lowerText);

    const hasBlockedPattern = blockedPatterns.some(regex => regex.test(lowerText)) || hasSuffixDoublingPattern;

    const resolvedIndustry = (context.industry || '').toLowerCase().trim();
    const isHealthcare = resolvedIndustry === 'healthcare' || resolvedIndustry === 'health' || resolvedIndustry === '';

    // Handle Greeting Only scenario
    if (isShortGreetingOnly) {
      const history = unifiedContext?.history || [];
      const hasHistory = Array.isArray(history) && history.length > 0;
      if (!hasHistory) {
        // Safe to send greeting fallback
        const greetingFallback = "Merhaba, size nasıl yardımcı olabilirim?";
        console.log(`[FINAL_OUTBOUND_GUARD_BLOCKED] Short greeting resolved at start. Fallback: "${greetingFallback}"`);
        FinalOutboundGuard.logToAudit(tenantId, 'FINAL_OUTBOUND_GUARD_BLOCKED', `Greeting only at start. Original: "${text}"`, greetingFallback, conversationId);
        return greetingFallback;
      }
      // If we have history, treat it as blocked and do not reset greeting (fall through to deterministic fallback)
    }

    // Trigger fallback if blocked pattern exists, or if sentence is incomplete / extremely short
    if (hasBlockedPattern || isSentenceIncomplete || isExtremelyShort || isShortGreetingOnly) {
      let fallbackText = '';
      if (isHealthcare) {
        fallbackText = 'Kusura bakmayın, cevabımı daha net ifade edeyim. Sağlık talebinizle ilgili sizi doğru ekibe yönlendirebilirim.';
      } else {
        fallbackText = 'Kusura bakmayın, cevabımı daha net ifade edeyim. Talebinizle ilgili sizi doğru ekibe yönlendirebilirim.';
      }

      console.log(`[FINAL_OUTBOUND_GUARD_BLOCKED] Blocked. Reason: hasBlocked=${hasBlockedPattern}, incomplete=${isSentenceIncomplete}, short=${isExtremelyShort}, greeting=${isShortGreetingOnly}. Fallback: "${fallbackText}"`);
      FinalOutboundGuard.logToAudit(tenantId, 'FINAL_OUTBOUND_GUARD_BLOCKED', `Blocked. Original: "${text}"`, fallbackText, conversationId);
      return fallbackText;
    }

    // If corrections were applied, log it
    if (corrected !== text) {
      console.log(`[FINAL_OUTBOUND_GUARD_CORRECTED] Corrected text from "${text}" to "${corrected}"`);
      FinalOutboundGuard.logToAudit(tenantId, 'FINAL_OUTBOUND_GUARD_CORRECTED', `Original: "${text}"`, corrected, conversationId);
    }

    return corrected;
  }

  private static logToAudit(tenantId: string, action: string, reasoning: string, result: string, conversationId?: string) {
    try {
      const db = withTenantDB(tenantId);
      db.executeSafe({
        text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
               VALUES ($1, $2, $3, $4)`,
        values: [
          tenantId,
          action,
          reasoning.substring(0, 500),
          JSON.stringify({
            conversationId: conversationId || 'unknown',
            result: result.substring(0, 500),
            timestamp: new Date().toISOString()
          })
        ]
      }).catch((err: any) => console.error(`Failed to log ${action} to ai_audit_logs`, err));
    } catch (logErr) {
      console.error(`Failed to instantiate db for final outbound guard log (${action})`, logErr);
    }
  }
}
