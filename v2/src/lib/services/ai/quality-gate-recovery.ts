import { ContextAwareSafeFallbackResolver } from './context-aware-safe-fallback';
import { withTenantDB } from '@/lib/core/tenant-db';

export interface QualityGateRecoveryParams {
  tenantId: string;
  conversationId: string;
  phoneNumber: string;
  inboundText: string;
  brain: any;
  identityConfig: any;
  unifiedContext: any;
  reason: string;
  channel: string;
  path: 'queue_immediate' | 'queue_delayed' | 'panel_draft' | 'smart_draft';
}

export interface QualityGateRecoveryResult {
  recovered: boolean;
  text?: string;
  reasonNormalized: string;
  isHighRisk: boolean;
}

const LOW_RISK_ALLOWLIST = new Set([
  'generic_fallback_pattern',
  'cta_frequency_brake',
  'forbidden_boilerplate',
  'too_generic',
  'greeting_reset',
  'unhelpful_response',
  'style_quality',
  'prompt_challenge_leak'
]);

const HIGH_RISK_LIST = new Set([
  'medical_unsafe',
  'identity_leak',
  'prompt_leak',
  'technical_disclosure',
  'privacy_violation',
  'kvkk_violation',
  'outbound_risk'
]);

/**
 * Normalizes a Quality Gate reason string to a standard allowlist/risk key.
 */
export function normalizeQualityGateReason(reason: string): string {
  if (!reason) return 'unknown';
  const r = reason.toLowerCase().trim();
  
  if (r.includes('generic_fallback_pattern')) return 'generic_fallback_pattern';
  if (r.includes('prompt_challenge_leak')) return 'prompt_challenge_leak';
  if (r.includes('kritik fren engeli') || r.includes('cta_frequency_brake')) return 'cta_frequency_brake';
  if (r.includes('yasaklı otomatik bot kalıbı') || r.includes('yasakli otomatik bot kalibi') || r.includes('forbidden_boilerplate')) return 'forbidden_boilerplate';
  if (r.includes('too_generic')) return 'too_generic';
  if (r.includes('greeting_reset') || r.includes('kimlik zaten tanıtılmıştı') || r.includes('kimlik zaten tanitilmisti')) return 'greeting_reset';
  if (r.includes('unhelpful_response')) return 'unhelpful_response';
  if (r.includes('style_quality')) return 'style_quality';
  
  // Specific style/grammar failures thrown by TurkishReplyQualityGate
  if (
    r.startsWith('hatalı türkçe ek') || 
    r.startsWith('hatali turkce ek') || 
    r.startsWith('türkçe dil bilgisi hatası') || 
    r.startsWith('turkce dil bilgisi hatasi') ||
    r.includes('hatalı türkçe ek') ||
    r.includes('türkçe dil bilgisi')
  ) {
    return 'style_quality';
  }
  
  // Explicit high risk mapping
  if (r.includes('medical_unsafe')) return 'medical_unsafe';
  if (r.includes('identity_leak')) return 'identity_leak';
  if (r.includes('prompt_leak')) return 'prompt_leak';
  if (r.includes('technical_disclosure')) return 'technical_disclosure';
  if (r.includes('privacy_violation')) return 'privacy_violation';
  if (r.includes('kvkk_violation')) return 'kvkk_violation';
  if (r.includes('outbound_risk')) return 'outbound_risk';
  
  return 'unknown';
}

export class QualityGateRecoveryHelper {
  /**
   * Evaluates Quality Gate failure and runs recovery if the reason is low-risk allowlisted.
   * Centralizes logging, DB state updates, and safe fallback resolution.
   */
  public static async handleFailure(params: QualityGateRecoveryParams): Promise<QualityGateRecoveryResult> {
    const {
      tenantId,
      conversationId,
      phoneNumber,
      inboundText,
      brain,
      identityConfig,
      unifiedContext,
      reason,
      channel,
      path
    } = params;

    const db = withTenantDB(tenantId);
    const reasonNormalized = normalizeQualityGateReason(reason);
    const isLowRisk = LOW_RISK_ALLOWLIST.has(reasonNormalized);
    const isHighRisk = HIGH_RISK_LIST.has(reasonNormalized) || !isLowRisk;

    if (isLowRisk) {
      // Resolve safe deterministic fallback
      const fallbackRes = ContextAwareSafeFallbackResolver.resolve({
        inboundText: inboundText || '',
        brain,
        identityConfig: identityConfig || {},
        unifiedContext: unifiedContext || {}
      });

      // Log recovery action to ai_audit_logs
      await db.executeSafe({
        text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
               VALUES ($1, $2, $3, $4)`,
        values: [
          tenantId,
          'QUALITY_GATE_RECOVERY_APPLIED',
          `Quality Gate low-risk recovery applied for reason: ${reasonNormalized}. Path: ${path}. Original reason: ${reason}`,
          JSON.stringify({
            conversationId,
            phoneNumber,
            path,
            originalReason: reason,
            normalizedReason: reasonNormalized,
            fallbackPath: fallbackRes.finalPath,
            textLength: fallbackRes.text.length,
            timestamp: new Date().toISOString()
          })
        ]
      });

      return {
        recovered: true,
        text: fallbackRes.text,
        reasonNormalized,
        isHighRisk: false
      };
    }

    // High risk or unknown reason -> human handoff
    console.warn(`[QUALITY_GATE_RECOVERY] High-risk or unknown Quality Gate failure. Blocking AI. Reason: ${reasonNormalized} (${reason})`);

    // 1. Takeover conversation to human
    if (conversationId && conversationId !== 'unknown') {
      await db.executeSafe({
        text: `
          UPDATE conversations 
          SET status = 'human', 
              metadata = jsonb_set(
                           jsonb_set(
                             jsonb_set(COALESCE(metadata, '{}'::jsonb), '{ai_response_incomplete}', 'true'),
                             '{quality_gate_handled}', 'true'
                           ),
                           '{retry_attempted}', 'true'
                         )
          WHERE id = $1 AND tenant_id = $2
        `,
        values: [conversationId, tenantId]
      });
    } else {
      await db.executeSafe({
        text: `
          UPDATE conversations 
          SET status = 'human', 
              metadata = jsonb_set(
                           jsonb_set(
                             jsonb_set(COALESCE(metadata, '{}'::jsonb), '{ai_response_incomplete}', 'true'),
                             '{quality_gate_handled}', 'true'
                           ),
                           '{retry_attempted}', 'true'
                         )
          WHERE phone_number = $1 AND tenant_id = $2
        `,
        values: [phoneNumber, tenantId]
      });
    }

    // 1.5. Log human takeover in learning capture service if applicable
    try {
      const { TenantLearningCaptureService } = await import('./tenant-learning-capture.service');
      await TenantLearningCaptureService.logHumanTakeover(db, {
        tenantId,
        conversationId,
        reason: `quality_gate_failed: ${reason}`
      });
    } catch (captureErr) {
      console.error('TenantLearningCaptureService.logHumanTakeover error bypassed', captureErr);
    }

    // 2. Insert non-patient-visible system alert message
    await db.executeSafe({
      text: `
        INSERT INTO messages (tenant_id, conversation_id, phone_number, direction, content, channel, provider_message_id, status)
        VALUES ($1, $2, $3, 'system', $4, $5, 'system_alert', 'delivered')
      `,
      values: [
        tenantId,
        (conversationId && conversationId !== 'unknown') ? conversationId : null,
        phoneNumber,
        `AI yanıtı Türkçe kalite kontrolünü geçemedi, manuel kontrol gerekli. (Quality Gate Blocked - Reason: ${reasonNormalized})`,
        channel || 'whatsapp'
      ]
    });

    // 3. Log recovery failure to audit logs
    await db.executeSafe({
      text: `INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
             VALUES ($1, $2, $3, $4)`,
      values: [
        tenantId,
        'QUALITY_GATE_RECOVERY_FAILED',
        `Quality Gate recovery blocked due to high-risk or unknown reason: ${reasonNormalized}. Original reason: ${reason}`,
        JSON.stringify({
          conversationId,
          phoneNumber,
          path,
          originalReason: reason,
          normalizedReason: reasonNormalized,
          isHighRisk,
          timestamp: new Date().toISOString()
        })
      ]
    });

    return {
      recovered: false,
      reasonNormalized,
      isHighRisk: true
    };
  }
}
