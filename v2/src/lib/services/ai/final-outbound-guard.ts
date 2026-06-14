import { withTenantDB } from '@/lib/core/tenant-db';

export interface OutboundGuardContext {
  tenantId: string;
  channelId?: string;
  conversationId?: string;
  inboundText?: string;
  intent?: string;
  unifiedContext?: any;
  industry?: string;
  source?: 'ai' | 'fallback' | 'bypass' | 'recovery' | 'human_intervention' | 'template' | string;
  replyLanguage?: string;
  isHealthcare?: boolean;
  lastUserIntent?: string;
  messageSource?: string;
}

export class FinalOutboundGuard {
  /**
   * Processes outbound text before sending, applying safe morphology corrections.
   * If a blocked phrase remains after correction, returns a context-driven safe fallback.
   */
  public static process(text: string, context: OutboundGuardContext): string {
    const { tenantId, conversationId, unifiedContext } = context;

    const resolvedIndustry = (context.industry || '').toLowerCase().trim();
    const isHealthcare = context.isHealthcare ?? (resolvedIndustry === 'healthcare' || resolvedIndustry === 'health');
    const industryKnown = !!context.industry;

    // 0. Log that the guard is applied
    console.log(JSON.stringify({
      tag: "FINAL_OUTBOUND_GUARD_APPLIED",
      tenantId,
      channelId: context.channelId || 'unknown',
      conversationId: conversationId || 'unknown',
      source: context.source || 'unknown',
      intent: context.intent || 'unknown',
      replyLanguage: context.replyLanguage || 'unknown',
      industryKnown,
      isHealthcare,
      lastUserIntent: context.lastUserIntent || 'unknown',
      messageSource: context.messageSource || 'unknown',
      rawTextLogged: false
    }));

    FinalOutboundGuard.logToAudit(
      tenantId,
      'FINAL_OUTBOUND_GUARD_APPLIED',
      `Outbound guard triggered. Input length: ${text ? text.length : 0}`,
      {
        tag: 'FINAL_OUTBOUND_GUARD_APPLIED',
        tenantId,
        conversationId,
        source: context.source || 'unknown',
        intent: context.intent || 'unknown',
        replyLanguage: context.replyLanguage || 'unknown',
        industryKnown,
        isHealthcare,
        lastUserIntent: context.lastUserIntent || 'unknown',
        messageSource: context.messageSource || 'unknown',
        rawTextLogged: false
      },
      conversationId
    );

    if (!text || text.trim().length === 0) {
      return text;
    }

    let corrected = text;

    // 1. Safe morphological corrections (case-preserving replacements)
    const corrections = [
      { regex: /adınızızı/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Adınızı' : 'adınızı' },
      { regex: /planlamasınızı/gi, repl: (m: string) => m.charAt(0) === 'P' ? 'Planlamasını' : 'planlamasını' },
      { regex: /haklısınızız/gi, repl: (m: string) => m.charAt(0) === 'H' ? 'Haklısınız' : 'haklısınız' },
      { regex: /hekimlerimiziniz/gi, repl: (m: string) => m.charAt(0) === 'H' ? 'Hekimlerimizin' : 'hekimlerimizin' },
      { regex: /listesinizi/gi, repl: (m: string) => m.charAt(0) === 'L' ? 'Listesini' : 'listesini' },
      { regex: /hekim listesinizi/gi, repl: (m: string) => m.charAt(0) === 'H' ? 'Hekim listesini' : 'hekim listesini' },
      { regex: /uzmanızı/gi, repl: (m: string) => m.charAt(0) === 'U' ? 'Uzmanı' : 'uzmanı' },
      { regex: /ulaştığınızızı/gi, repl: (m: string) => m.charAt(0) === 'U' ? 'Ulaştığınızı' : 'ulaştığınızı' },
      { regex: /yaşadığınızızı/gi, repl: (m: string) => m.charAt(0) === 'Y' ? 'Yaşadığınızı' : 'yaşadığınızı' },
      { regex: /anneniziniz/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Annenizin' : 'annenizin' },
      { regex: /anneniziziniz/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Annenizin' : 'annenizin' },
      { regex: /Beyiniz\s+ve\s+Sinir/gi, repl: (m: string) => m.charAt(0) === 'B' ? 'Beyin ve Sinir' : 'beyin ve sinir' },
      { regex: /Kusura bakmayınız/gi, repl: (m: string) => m.charAt(0) === 'K' ? 'Kusura bakmayın' : 'kusura bakmayın' },
      { regex: /ulaşmıştınızız/gi, repl: (m: string) => m.charAt(0) === 'U' ? 'Ulaşmıştınız' : 'ulaşmıştınız' },
      { regex: /ulaştığınızız/gi, repl: (m: string) => m.charAt(0) === 'U' ? 'Ulaştığınız' : 'ulaştığınız' },
      { regex: /sorularınızızı/gi, repl: (m: string) => m.charAt(0) === 'S' ? 'Sorularınızı' : 'sorularınızı' },
      { regex: /aklınızızdaki/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Aklınızdaki' : 'aklınızdaki' },
      { regex: /görüyorum\.,/gi, repl: (m: string) => m.charAt(0) === 'G' ? 'Görüyorum.' : 'görüyorum.' },
      { regex: /size uygun olduğunuz bir zamanızı/gi, repl: () => 'size uygun bir zaman aralığını' },
      { regex: /uygun olduğunuz bir zamanızı/gi, repl: () => 'size uygun bir zaman aralığını' },
      { regex: /bir zamanızı/gi, repl: () => 'uygun bir zaman aralığını' },
      { regex: /zamanızı/gi, repl: (m: string) => m.charAt(0) === 'Z' ? 'Zaman aralığını' : 'zaman aralığını' }
    ];

    for (const item of corrections) {
      corrected = corrected.replace(item.regex, item.repl as any);
    }

    // 2. Suffix corrections for possessive/suffix doubling (case-preserving)
    corrected = corrected.replace(/tınızız/gi, (m) => m.charAt(0) === 'T' ? 'Tınız' : 'tınız');
    corrected = corrected.replace(/dığınızız/gi, (m) => m.charAt(0) === 'D' ? 'Dığınız' : 'dığınız');
    corrected = corrected.replace(/sınızız/gi, (m) => m.charAt(0) === 'S' ? 'Sınız' : 'sınız');
    corrected = corrected.replace(/siniziz/gi, (m) => m.charAt(0) === 'S' ? 'Siniz' : 'siniz');
    corrected = corrected.replace(/inizini/gi, (m) => m.charAt(0) === 'İ' || m.charAt(0) === 'I' ? 'İnizi' : 'inizi');
    corrected = corrected.replace(/unuzunu/gi, (m) => m.charAt(0) === 'U' || m.charAt(0) === 'u' ? 'Unuzu' : 'unuzu');
    corrected = corrected.replace(/ünüzünü/gi, (m) => m.charAt(0) === 'Ü' || m.charAt(0) === 'u' ? 'Ünüzü' : 'ünüzü');
    corrected = corrected.replace(/nıznız/gi, (m) => m.charAt(0) === 'N' ? 'Nız' : 'nız');
    corrected = corrected.replace(/nizniz/gi, (m) => m.charAt(0) === 'N' ? 'Niz' : 'niz');
    corrected = corrected.replace(/sizizi/gi, (m) => m.charAt(0) === 'S' ? 'Sizi' : 'sizi');

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

    const trimmed = corrected.trim();

    // 3. Greeting & incomplete sentence validation checks
    const isShortGreetingOnly = /^(merhaba|selam|günaydın|gunaydin|iyi günler|iyi gunler|tünaydın|tunaydin|merhabalar)[,\s.]*$/i.test(trimmed);
    const isSentenceIncomplete = /[,\s](ve|veya|ama|çünkü|cunku|ise|ile|fakat|ki|de|da)[,\s.]*$/i.test(trimmed) || trimmed.endsWith(',');
    const isExtremelyShort = trimmed.length > 0 && trimmed.length < 3;

    // 4. Blocklist check
    const blockedPatterns = [
      /ulaşmıştınızız/i,
      /ulaştığınızız/i,
      /ulaştığınızızı/i,
      /anneniziniz/i,
      /anneniziziniz/i,
      /beyiniz\s+ve\s+sinir/i,
      /hekim\s+listesinizi/i,
      /hekimlerimiziniz/i,
      /planlamasınızı/i,
      /haklısınızız/i,
      /listesinizi/i,
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
      /isimlerinizi veya detaylı listesinizi/i,
      /isimlerinizi paylaşamıyorum/i,
      /mümkünüz/i,
      /hastanınız/i,
      /planızı/i,
      /sorularınızıza/i,
      /uzmanızı/i,
      /aklınızızdaki/i,
      /sistem detay/i,
      /sistem prompt/i,
      /promptunda/i,
      /ai unavailable/i,
      /circuit_open/i,
      /quota_exhausted/i,
      /quota/i,
      /gemini/i,
      /provider/i,
      /model/i,
      /yapay zeka servis dışı/i,
      /müşteri temsilcisine devredildi/i
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

    // Handle Greeting Only scenario
    if (isShortGreetingOnly) {
      const history = unifiedContext?.history || [];
      const hasHistory = Array.isArray(history) && history.length > 0;
      if (!hasHistory) {
        // Safe to send greeting fallback
        const greetingFallback = "Merhaba, size nasıl yardımcı olabilirim?";
        console.log(JSON.stringify({
          tag: "FINAL_OUTBOUND_GUARD_BLOCKED",
          tenantId,
          conversationId: conversationId || 'unknown',
          intent: context.intent || 'unknown',
          reasons: ['greeting_only_start'],
          rawTextLogged: false,
          fallbackLength: greetingFallback.length
        }));

        FinalOutboundGuard.logToAudit(
          tenantId,
          'FINAL_OUTBOUND_GUARD_BLOCKED',
          `Greeting only at start.`,
          {
            tag: 'FINAL_OUTBOUND_GUARD_BLOCKED',
            tenantId,
            conversationId,
            reason: 'greeting_only_start',
            rawTextLogged: false,
            fallbackLength: greetingFallback.length
          },
          conversationId
        );
        return greetingFallback;
      }
      // If we have history, treat it as blocked and do not reset greeting (fall through to deterministic fallback)
    }

    // Trigger fallback if blocked pattern exists, or if sentence is incomplete / extremely short
    if (hasBlockedPattern || isSentenceIncomplete || isExtremelyShort || isShortGreetingOnly) {
      let fallbackText = '';
      if (tenantId === 'caab9ea1-9591-45e4-bbc5-9c9b498982c8') {
        fallbackText = `Ben *Rüya*, Konya Başkent Hastanesi’nden sizinle ilgileniyorum\n\nSorunuzu yazarsanız size yardımcı olayım 🌿`;
      } else if (isHealthcare) {
        fallbackText = 'Kusura bakmayın, cevabımı daha net ifade edeyim. Sağlık talebinizle ilgili sizi doğru ekibe yönlendirebilirim.';
      } else {
        fallbackText = 'Kusura bakmayın, cevabımı daha net ifade edeyim. Talebinizle ilgili sizi doğru ekibe yönlendirebilirim.';
      }

      const blockReasons: string[] = [];
      if (hasBlockedPattern) blockReasons.push('blocked_pattern');
      if (isSentenceIncomplete) blockReasons.push('sentence_incomplete');
      if (isExtremelyShort) blockReasons.push('extremely_short');
      if (isShortGreetingOnly) blockReasons.push('greeting_only');

      console.log(JSON.stringify({
        tag: "FINAL_OUTBOUND_GUARD_BLOCKED",
        tenantId,
        conversationId: conversationId || 'unknown',
        intent: context.intent || 'unknown',
        reasons: blockReasons,
        rawTextLogged: false,
        fallbackLength: fallbackText.length
      }));

      FinalOutboundGuard.logToAudit(
        tenantId,
        'FINAL_OUTBOUND_GUARD_BLOCKED',
        `Blocked outbound text. Reasons: ${blockReasons.join(', ')}`,
        {
          tag: 'FINAL_OUTBOUND_GUARD_BLOCKED',
          tenantId,
          conversationId,
          intent: context.intent || 'unknown',
          reasons: blockReasons,
          rawTextLogged: false,
          fallbackLength: fallbackText.length
        },
        conversationId
      );
      return fallbackText;
    }

    // If corrections were applied, log it
    if (corrected !== text) {
      const matchedPatterns: string[] = [];
      if (/adınızızı/i.test(text)) matchedPatterns.push('adınızızı');
      if (/yaşadığınızızı/i.test(text)) matchedPatterns.push('yaşadığınızızı');
      if (/anneniziniz/i.test(text)) matchedPatterns.push('anneniziniz');
      if (/anneniziziniz/i.test(text)) matchedPatterns.push('anneniziziniz');
      if (/Beyiniz\s+ve\s+Sinir/i.test(text)) matchedPatterns.push('Beyiniz ve Sinir');
      if (/hekim listesinizi/i.test(text)) matchedPatterns.push('hekim listesinizi');
      if (/Kusura bakmayınız/i.test(text)) matchedPatterns.push('Kusura bakmayınız');
      if (/ulaşmıştınızız/i.test(text)) matchedPatterns.push('ulaşmıştınızız');
      if (/ulaştığınızız/i.test(text)) matchedPatterns.push('ulaştığınızız');
      if (/sorularınızızı/i.test(text)) matchedPatterns.push('sorularınızızı');
      if (/aklınızızdaki/i.test(text)) matchedPatterns.push('aklınızızdaki');
      if (/görüyorum\.,/i.test(text)) matchedPatterns.push('görüyorum.,');
      if (/inizniz/i.test(text)) matchedPatterns.push('inizniz');
      if (/ınıznız/i.test(text)) matchedPatterns.push('ınıznız');
      if (/nuznuz/i.test(text)) matchedPatterns.push('nuznuz');
      if (/nüznüz/i.test(text)) matchedPatterns.push('nüznüz');
      if (/iniziniz/i.test(text)) matchedPatterns.push('iniziniz');
      if (/niziniz/i.test(text)) matchedPatterns.push('niziniz');
      if (/nızınız/i.test(text)) matchedPatterns.push('nızınız');
      if (/nuzunuz/i.test(text)) matchedPatterns.push('nuzunuz');
      if (/nüzünüz/i.test(text)) matchedPatterns.push('nüzünüz');
      if (/inizizi/i.test(text)) matchedPatterns.push('inizizi');
      if (/ınızızı/i.test(text)) matchedPatterns.push('ınızızı');
      if (/unuzuzu/i.test(text)) matchedPatterns.push('unuzuzu');
      if (/ünüzüzü/i.test(text)) matchedPatterns.push('ünüzüzü');
      if (/sizizi/i.test(text)) matchedPatterns.push('sizizi');

      console.log(JSON.stringify({
        tag: "FINAL_OUTBOUND_GUARD_CORRECTED",
        tenantId,
        conversationId: conversationId || 'unknown',
        intent: context.intent || 'unknown',
        patternCount: matchedPatterns.length,
        patterns: matchedPatterns,
        rawTextLogged: false
      }));

      FinalOutboundGuard.logToAudit(
        tenantId,
        'FINAL_OUTBOUND_GUARD_CORRECTED',
        `Corrected morphological patterns. Count: ${matchedPatterns.length}`,
        {
          tag: 'FINAL_OUTBOUND_GUARD_CORRECTED',
          tenantId,
          conversationId,
          intent: context.intent || 'unknown',
          patternCount: matchedPatterns.length,
          patterns: matchedPatterns,
          rawTextLogged: false
        },
        conversationId
      );
    }

    return corrected;
  }

  private static logToAudit(
    tenantId: string,
    action: string,
    reasoning: string,
    resultSummary: Record<string, any>,
    conversationId?: string
  ) {
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
            ...resultSummary,
            timestamp: new Date().toISOString()
          })
        ]
      }).catch((err: any) => console.error(`Failed to log ${action} to ai_audit_logs`, err));
    } catch (logErr) {
      console.error(`Failed to instantiate db for final outbound guard log (${action})`, logErr);
    }
  }
}
