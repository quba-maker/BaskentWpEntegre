/**
 * P0.16-M: FinalPipelineEnforcer
 *
 * Mandatory final pass for ALL response text — bypass, LLM, and legacy paths.
 * Ensures every patient-facing message goes through:
 *   1. TurkishFinalQualityNormalizer  — deterministic morphology rewrite
 *   2. WhatsAppFormattingFinalizer    — paragraph/bullet/numbered-block format
 *
 * Emits FINAL_RESPONSE_SOURCE telemetry so we can trace which path produced each message.
 */

import { TurkishFinalQualityNormalizer } from './turkish-final-quality-normalizer';
import { WhatsAppFormattingFinalizer }    from './whatsapp-formatting-finalizer';

export interface FinalPipelineResult {
  text: string;
  normalizerApplied: boolean;
  formatterApplied: boolean;
  responseSource: string;
}

export interface FinalPipelineContext {
  tenantId?: string;
  conversationId?: string;
  workerPath?: string;
  /** Which code path produced the raw text (e.g. 'bypass', 'llm', 'legacy_fallback') */
  responseSource: string;
  complaint?: string;
  location?: string;
  channel?: string;
  replyLanguage?: string;
}

export class FinalPipelineEnforcer {
  static enforce(text: string, ctx: FinalPipelineContext): FinalPipelineResult {
    if (!text || text.trim().length === 0) {
      return { text, normalizerApplied: false, formatterApplied: false, responseSource: ctx.responseSource };
    }

    let cleanedText = text.trim();
    const leadingPunctRegex = /^[\s,;.:!\-—–]+/;
    if (leadingPunctRegex.test(cleanedText)) {
      cleanedText = cleanedText.replace(leadingPunctRegex, '').trim();
    }

    // 1. Turkish Final Quality Normalizer (strictly gated to replyLanguage === 'tr')
    let normResult = { text: cleanedText, wasModified: false, rewrites: [] as any[] };
    if (ctx.replyLanguage === 'tr') {
      normResult = TurkishFinalQualityNormalizer.normalize(cleanedText, {
        complaint: ctx.complaint,
        location: ctx.location,
      });
    }
    const afterNorm = normResult.text;

    // 2. WhatsApp Formatting Finalizer (only for whatsapp channel or unknown)
    const isWhatsApp = !ctx.channel || ctx.channel === 'whatsapp';
    let afterFmt = afterNorm;
    let formatterApplied = false;
    if (isWhatsApp) {
      const fmtResult = WhatsAppFormattingFinalizer.format(afterNorm);
      afterFmt = fmtResult.text;
      formatterApplied = true;
    }

    // 3. Telemetry
    console.log(JSON.stringify({
      tag: 'FINAL_RESPONSE_SOURCE',
      responseSource: ctx.responseSource,
      tenantId: ctx.tenantId || 'unknown',
      conversationId: ctx.conversationId || 'unknown',
      workerPath: ctx.workerPath || 'unknown',
      normalizerApplied: normResult.wasModified,
      formatterApplied,
    }));

    if (normResult.wasModified) {
      console.log(JSON.stringify({
        tag: 'TURKISH_FINAL_QUALITY_REWRITE_APPLIED',
        tenantId: ctx.tenantId || 'unknown',
        conversationId: ctx.conversationId || 'unknown',
        rewrites: normResult.rewrites || [],
      }));
    }

    if (formatterApplied) {
      console.log(JSON.stringify({
        tag: 'WHATSAPP_FORMATTING_APPLIED',
        tenantId: ctx.tenantId || 'unknown',
        conversationId: ctx.conversationId || 'unknown',
        responseSource: ctx.responseSource,
      }));
    }

    return {
      text: afterFmt,
      normalizerApplied: normResult.wasModified,
      formatterApplied,
      responseSource: ctx.responseSource,
    };
  }

  /**
   * Kill-switch: blocks known legacy strings from reaching patient.
   * Returns replacement text if blocked, null if OK to pass.
   */
  static checkLegacyBlock(text: string): string | null {
    const BLOCKED_LEGACY_PHRASES = [
      'şu an bu ekrandan net doğrulayamıyorum',
      'su an bu ekrandan net dogrulayamiyorum',
      'isim uydurmam doğru olmaz',
      'isim uydurmam dogru olmaz',
    ];
    const lower = text.toLowerCase();
    const hit = BLOCKED_LEGACY_PHRASES.find(p => lower.includes(p));
    if (hit) {
      console.log(JSON.stringify({
        tag: 'LEGACY_PATH_BLOCKED',
        blockedPhrase: hit,
      }));
      return 'Doktor kadromuza dair bilgiyi en doğru şekilde iletebilmek için hasta danışmanımız sizi bilgilendirecektir. Hangi gün ve saat aralığında ulaşılmasını istersiniz?';
    }
    return null;
  }
}
