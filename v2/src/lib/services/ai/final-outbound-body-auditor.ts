/**
 * P0.16-N: FinalOutboundBodyAuditor
 *
 * Mandatory last-mile enforcement applied to the EXACT body sent to 360dialog
 * or any WhatsApp provider — right before sendWhatsAppMessage().
 *
 * Problem it solves:
 *   - Test bot returns orchestratorResult.text directly (already through FinalPipelineEnforcer).
 *   - Live worker post-processes with sanitizePatientFacingMessage() + formatForWhatsApp() AFTER
 *     FinalPipelineEnforcer, potentially undoing normalizer/formatter fixes.
 *   - This auditor runs at the very last step before the send call, guaranteeing parity.
 *
 * Chain:
 *   TurkishFinalQualityNormalizer → WhatsAppFormattingFinalizer → LegacyBlock Kill
 *   → FINAL_OUTBOUND_BODY_AUDIT telemetry
 *
 * Rules:
 *   - No outbound messages, no DB writes, no side effects.
 *   - PII-safe telemetry only.
 *   - Never throws; falls back to original text on any error.
 */

import { TurkishFinalQualityNormalizer } from './turkish-final-quality-normalizer';
import { WhatsAppFormattingFinalizer } from './whatsapp-formatting-finalizer';
import { FinalPipelineEnforcer } from './final-pipeline-enforcer';

export interface FinalOutboundAuditCtx {
  tenantId: string;
  conversationId?: string;
  workerPath?: string;
  responseSource?: string;
  channel?: string;
  replyLanguage?: string;
}

export interface FinalOutboundAuditResult {
  text: string;
  bodyLength: number;
  paragraphCount: number;
  hasNumberedBlocks: boolean;
  normalizerApplied: boolean;
  formatterApplied: boolean;
  containsLegacyClose: boolean;
  containsKnownBadMorphology: boolean;
  rewrote: boolean;
}

// Known bad morphology patterns that should NEVER appear in final outbound body
const KNOWN_BAD_MORPHOLOGY_PATTERNS: RegExp[] = [
  /m[üu]mk[üu]n[üu]z/i,         // mümkünüz
  /plan[ıi]z[ıi]\b/i,           // planızı
  /tahminiz\s+(?:maliyet|et)/i,  // tahminizi maliyet
  /Konya(?:'n[ıi]n[ıi]z|n[ıi]n[ıi]z)/i,  // Konya'nınız
  /s[üu]re[çc]ininiz/i,          // sürecininiz
  /olabilece[ğg]inizie?\s+anl/i, // olabileceğinizi anlıyorum (garbled)
];

// Legacy close phrases that signal the conversation was terminated incorrectly
const LEGACY_CLOSE_PATTERNS: RegExp[] = [
  /rica\s+ederiz[,\s]+(?:iyi\s+g[üu]nler|g[üu]le\s+g[üu]le)/i,
  /iyi\s+g[üu]nler\s+dileriz\.\s*$/i,
  /ba[şs]ka\s+sorunuz\s+olursa\s+(?:bize|burada)/i,
];

export class FinalOutboundBodyAuditor {
  /**
   * Apply mandatory last-mile chain to the final body before 360dialog send.
   * Returns the (potentially rewritten) body and audit metadata.
   */
  public static audit(
    text: string,
    ctx: FinalOutboundAuditCtx
  ): FinalOutboundAuditResult {
    if (!text) {
      return {
        text: '',
        bodyLength: 0,
        paragraphCount: 0,
        hasNumberedBlocks: false,
        normalizerApplied: false,
        formatterApplied: false,
        containsLegacyClose: false,
        containsKnownBadMorphology: false,
        rewrote: false,
      };
    }

    let cleanedText = text.trim();
    const leadingPunctRegex = /^[\s,;.:!\-—–]+/;
    let rewrote = false;
    if (leadingPunctRegex.test(cleanedText)) {
      cleanedText = cleanedText.replace(leadingPunctRegex, '').trim();
      rewrote = true;
    }

    let result = cleanedText;
    let normalizerApplied = false;
    let formatterApplied = false;

    try {
      // Step 1: Turkish Final Quality Normalizer
      const looksTurkish = /[ışğçöüİŞĞÇÖÜ]|\b(?:merhaba|geçmiş\s+olsun|hastanemizde|türkiye|şikayet|randevu|görüşme)\b/i.test(result);
      if (ctx.replyLanguage === 'tr' || (!ctx.replyLanguage && looksTurkish)) {
        const normResult = TurkishFinalQualityNormalizer.normalize(result);
        if (normResult.wasModified) {
          result = normResult.text;
          normalizerApplied = true;
          rewrote = true;
        }
      }

      // Step 2: WhatsApp Formatting Finalizer (paragraph/numbered block)
      // Only apply if channel is whatsapp or unspecified (default is whatsapp for this system)
      const isWhatsApp = !ctx.channel || ctx.channel === 'whatsapp';
      if (isWhatsApp) {
        const fmtResult = WhatsAppFormattingFinalizer.format(result);
        if (fmtResult.wasModified) {
          result = fmtResult.text;
          formatterApplied = true;
          rewrote = true;
        }
      }

      // Step 3: Legacy block kill (catch any "bu ekrandan" that survived)
      const legacyReplacement = FinalPipelineEnforcer.checkLegacyBlock(result);
      if (legacyReplacement !== null) {
        result = legacyReplacement;
        rewrote = true;
      }
    } catch (err) {
      // Non-fatal — use original text
      console.error('[FinalOutboundBodyAuditor] Error in chain, using original text:', err);
      result = text;
    }

    // Metrics
    const paragraphs = result.split(/\n\n+/).filter(p => p.trim().length > 0);
    const hasNumberedBlocks = /^\d+\.\s/m.test(result);
    const containsLegacyClose = LEGACY_CLOSE_PATTERNS.some(p => p.test(result));
    const containsKnownBadMorphology = KNOWN_BAD_MORPHOLOGY_PATTERNS.some(p => p.test(result));

    // Telemetry — FINAL_OUTBOUND_BODY_AUDIT (PII-safe)
    try {
      console.log(JSON.stringify({
        tag: 'FINAL_OUTBOUND_BODY_AUDIT',
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId || 'unknown',
        workerPath: ctx.workerPath || 'unknown',
        responseSource: ctx.responseSource || 'unknown',
        bodyLength: result.length,
        paragraphCount: paragraphs.length,
        hasNumberedBlocks,
        normalizerApplied,
        formatterApplied,
        containsLegacyClose,
        containsKnownBadMorphology,
        rewrote,
      }));
    } catch { /* non-fatal */ }

    // Safety: if known bad morphology still present after normalizer, log as warning
    if (containsKnownBadMorphology) {
      try {
        console.warn(JSON.stringify({
          tag: 'FINAL_OUTBOUND_BAD_MORPHOLOGY_DETECTED',
          tenantId: ctx.tenantId,
          conversationId: ctx.conversationId || 'unknown',
          workerPath: ctx.workerPath || 'unknown',
          // No body content — PII-safe
        }));
      } catch { /* non-fatal */ }
    }

    return {
      text: result,
      bodyLength: result.length,
      paragraphCount: paragraphs.length,
      hasNumberedBlocks,
      normalizerApplied,
      formatterApplied,
      containsLegacyClose,
      containsKnownBadMorphology,
      rewrote,
    };
  }
}
