import { withTenantDB } from '@/lib/core/tenant-db';
import { resolveActivePromptIdentityContext } from './active-prompt-context';
import { getTraceContext } from '@/lib/core/trace-context';

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
  promptVersion?: string | number;
  systemPromptText?: string;
  // Telemetry fields
  workerPath?: string;
  responseDedupeKey?: string;
  aggregatedMessageCount?: number;
  fallbackApplied?: boolean;
  fallbackReason?: string;
  doctorDirectoryHit?: boolean;
  topicSwitchApplied?: boolean;
  sandbox?: boolean;
  blocked?: boolean;
  reason?: string;
  safeRecoveryNeeded?: boolean;
  guardVersion?: string;
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

    const traceCtx = getTraceContext();
    const resolvedWorkerPath = context.workerPath || traceCtx?.metadata?.workerPath || "unknown";

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
      rawTextLogged: false,
      orchestratorVersion: "P0.16-orchestrator-v1",
      workerPath: resolvedWorkerPath,
      responseDedupeKey: context.responseDedupeKey || "unknown",
      aggregatedMessageCount: context.aggregatedMessageCount || 0,
      fallbackApplied: context.fallbackApplied || false,
      fallbackReason: context.fallbackReason || "none",
      doctorDirectoryHit: context.doctorDirectoryHit || false,
      topicSwitchApplied: context.topicSwitchApplied || false
    }));

    if (!context.sandbox) {
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
    }

    if (!text || text.trim().length === 0) {
      return text;
    }

    let corrected = text;

    // 1. Safe morphological corrections (case-preserving replacements)
    const corrections = [
      { regex: /adınızızı/gi, repl: (m: string) => m.charAt(0) === 'A' ? 'Adınızı' : 'adınızı' },
      { regex: /planlamasınınız/gi, repl: (m: string) => m.charAt(0) === 'P' ? 'Planlamanız' : 'planlamanız' },
      { regex: /planlamasınızı/gi, repl: (m: string) => m.charAt(0) === 'P' ? 'Planlamanızı' : 'planlamanızı' },
      { regex: /kulak\s+burunuz\s+boğaz/gi, repl: (m: string) => m.charAt(0) === 'K' ? 'Kulak Burun Boğaz' : 'kulak burun boğaz' },
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
    // P0.16-C: Only flag truly incomplete connectors. 'de', 'da', 'ile' are valid Turkish sentence endings.
    const isSentenceIncomplete = /[,\s](ve|veya|ama|çünkü|cunku|ise|fakat|ki)[,\s.]*$/i.test(trimmed) || trimmed.endsWith(',');
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
      /müşteri temsilcisine devredildi/i,
      // P0.16-C Narrowed technical leak patterns
      /ai unavailable/i,
      /quota exceeded/i,
      /\bgemini\b/i,
      /servis dışı/i,
      /\bllm\b/i,
      /language model/i
    ];

    const lowerText = corrected.toLowerCase();
    
    // Check general reduplication pattern
    // P0.16-C: Tightened to avoid false-positives on normal Turkish words.
    // Only match clear suffix-doubling, not substrings in legitimate words.
    const hasSuffixDoublingPattern = 
      /(nız|niz|unuz|ünüz){2,}/i.test(lowerText) ||
      /ınızızı/i.test(lowerText) ||
      /sizizi/i.test(lowerText) ||
      /nıznız/i.test(lowerText) ||
      /iniziniz/i.test(lowerText);

    const hasBlockedPattern = blockedPatterns.some(regex => regex.test(lowerText)) || hasSuffixDoublingPattern;

    if (isShortGreetingOnly) {
      const history = unifiedContext?.history || [];
      const hasHistory = Array.isArray(history) && history.some((m: any) => m.direction === 'out' || m.role === 'assistant');
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
      const mockBrainForIdentity = {
        prompts: {
          systemPrompt: context.systemPromptText,
          metadata: {
            version: context.promptVersion
          }
        },
        context: {
          config: {
            channelId: context.channelId,
            industry: isHealthcare ? 'healthcare' : undefined
          }
        }
      };

      const blockReasons: string[] = [];
      if (hasBlockedPattern) blockReasons.push('blocked_pattern');
      if (isSentenceIncomplete) blockReasons.push('sentence_incomplete');
      if (isExtremelyShort) blockReasons.push('extremely_short');
      if (isShortGreetingOnly) blockReasons.push('greeting_only');

      const blockReasonStr = blockReasons.join(',');
      context.blocked = true;
      context.reason = blockReasonStr;
      context.safeRecoveryNeeded = true;
      context.guardVersion = 'P0.16-guard-v1';

      // Delegate recovery entirely to ContextAwareSafeFallbackResolver
      const { ContextAwareSafeFallbackResolver } = require('./context-aware-safe-fallback');
      const fallbackResult = ContextAwareSafeFallbackResolver.resolve({
        inboundText: context.inboundText || '',
        brain: mockBrainForIdentity as any,
        identityConfig: context.unifiedContext?.identityConfig || context.unifiedContext?.identity || {},
        unifiedContext: context.unifiedContext || {},
        channelId: context.channelId,
        systemPromptText: context.systemPromptText,
        promptVersion: context.promptVersion,
        replyLanguage: context.replyLanguage,
        turkeyVisitIntent: context.unifiedContext?.turkeyVisitIntent,
        formAlreadyAddressed: context.unifiedContext?.formAlreadyAddressed
      });
      const fallbackText = fallbackResult.text;

      // P0.16-C: Log truncated original text for debugging false-positive blocks, but secure it behind an env flag
      const shouldLogRawText = process.env.DEBUG_AI_GUARD_RAW_TEXT === 'true';
      const truncatedOriginal = corrected.length > 120 ? corrected.substring(0, 120) + '...' : corrected;
      console.log(JSON.stringify({
        tag: "FINAL_OUTBOUND_GUARD_BLOCKED",
        tenantId,
        conversationId: conversationId || 'unknown',
        intent: context.intent || 'unknown',
        reasons: blockReasons,
        ...(shouldLogRawText && { rawTextTruncated: truncatedOriginal }),
        rawTextLogged: shouldLogRawText,
        fallbackLength: fallbackText.length,
        orchestratorVersion: "P0.16-orchestrator-v1",
        workerPath: resolvedWorkerPath,
        responseDedupeKey: context.responseDedupeKey || "unknown",
        aggregatedMessageCount: context.aggregatedMessageCount || 0,
        fallbackApplied: true,
        fallbackReason: blockReasonStr,
        doctorDirectoryHit: context.doctorDirectoryHit || false,
        topicSwitchApplied: context.topicSwitchApplied || false,
        blocked: true,
        reason: blockReasonStr,
        safeRecoveryNeeded: true,
        guardVersion: 'P0.16-guard-v1'
      }));

      if (!context.sandbox) {
        FinalOutboundGuard.logToAudit(
          tenantId,
          'FINAL_OUTBOUND_GUARD_BLOCKED',
          `Blocked outbound text. Reasons: ${blockReasonStr}`,
          {
            tag: 'FINAL_OUTBOUND_GUARD_BLOCKED',
            tenantId,
            conversationId,
            intent: context.intent || 'unknown',
            reasons: blockReasons,
            rawTextLogged: false,
            fallbackLength: fallbackText.length,
            orchestratorVersion: "P0.16-orchestrator-v1",
            workerPath: resolvedWorkerPath,
            blocked: true,
            reason: blockReasonStr,
            safeRecoveryNeeded: true,
            guardVersion: 'P0.16-guard-v1'
          },
          conversationId
        );
      }
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

      if (!context.sandbox) {
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
