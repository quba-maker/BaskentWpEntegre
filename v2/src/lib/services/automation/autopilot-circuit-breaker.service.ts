import { TenantDB } from "@/lib/core/tenant-db";

/**
 * Service to manage conversation-level autopilot circuit breaker.
 * If fallback responses (or quality gate violations) reach 3 consecutive events,
 * the circuit breaker raises a review flag. Hard-disabling autopilot is opt-in.
 * 
 * Safe Fail: If updating the database fails, throws an error to halt the send pipeline immediately.
 */
export class AutopilotCircuitBreakerService {
  
  /**
   * Records a fallback event for a conversation.
   * Increments `consecutive_fallback_count` inside conversation metadata.
   * If it reaches 3, trips the circuit breaker review flag and sets `metadata.human_review_required = true`.
   * By default, autopilot stays enabled so transient model/gateway issues do not silently stop the bot.
   * Set `AUTOPILOT_CIRCUIT_BREAKER_HARD_DISABLE=true` to restore hard handover behavior.
   * 
   * Throws an error if the database update is unsuccessful, halting message transmission.
   */
  public static async recordFallback(
    tenantId: string,
    conversationId: string,
    db: TenantDB
  ): Promise<{ tripped: boolean; consecutiveFallbacks: number }> {
    try {
      // 1. Fetch current conversation details
      const convRows = await db.executeSafe({
        text: `SELECT autopilot_enabled, metadata FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, tenantId]
      }) as any[];

      if (convRows.length === 0) {
        throw new Error(`Conversation not found: ${conversationId}`);
      }

      const conv = convRows[0];
      const metadata = conv.metadata || {};
      const currentFallbacks = (metadata.consecutive_fallback_count || 0) + 1;
      metadata.consecutive_fallback_count = currentFallbacks;

      let tripped = false;

      if (currentFallbacks >= 3) {
        tripped = true;
        // Trip circuit breaker review state
        metadata.consecutive_fallback_count = 0; // reset
        metadata.human_review_required = true;
        metadata.circuit_breaker_tripped_at = new Date().toISOString();
        metadata.circuit_breaker_hard_disabled = process.env.AUTOPILOT_CIRCUIT_BREAKER_HARD_DISABLE === 'true';
        metadata.autopilot_error_kept_enabled = !metadata.circuit_breaker_hard_disabled;

        const updateResult = await db.executeSafe({
          text: `
            UPDATE conversations 
            SET autopilot_enabled = CASE WHEN $4::boolean THEN false ELSE COALESCE(autopilot_enabled, true) END,
                status = CASE WHEN $4::boolean THEN 'human' ELSE status END,
                metadata = $1 
            WHERE id = $2 AND tenant_id = $3
            RETURNING id
          `,
          values: [JSON.stringify(metadata), conversationId, tenantId, metadata.circuit_breaker_hard_disabled]
        }) as any[];

        if (updateResult.length === 0) {
          throw new Error("Failed to write circuit breaker trip state to database (no rows updated)");
        }

        // Log to ai_audit_logs without PII
        await db.executeSafe({
          text: `
            INSERT INTO ai_audit_logs (tenant_id, action, reasoning_summary, result_summary)
            VALUES ($1, $2, $3, $4::jsonb)
          `,
          values: [
            tenantId,
            metadata.circuit_breaker_hard_disabled ? 'CIRCUIT_BREAKER_TRIPPED' : 'CIRCUIT_BREAKER_REVIEW_REQUIRED',
            metadata.circuit_breaker_hard_disabled
              ? 'Autopilot circuit breaker tripped after 3 consecutive fallbacks. Autopilot disabled.'
              : 'Autopilot circuit breaker review flag raised after 3 consecutive fallbacks. Autopilot kept enabled.',
            JSON.stringify({
              conversationId,
              consecutive_fallback_count: currentFallbacks,
              autopilot_disabled: metadata.circuit_breaker_hard_disabled,
              timestamp: new Date().toISOString()
            })
          ]
        }).catch(err => console.error("Failed to log circuit breaker trip to ai_audit_logs", err));

      } else {
        // Just increment fallback count
        const updateResult = await db.executeSafe({
          text: `
            UPDATE conversations 
            SET metadata = $1 
            WHERE id = $2 AND tenant_id = $3
            RETURNING id
          `,
          values: [JSON.stringify(metadata), conversationId, tenantId]
        }) as any[];

        if (updateResult.length === 0) {
          throw new Error("Failed to write consecutive fallback count to database (no rows updated)");
        }
      }

      return { tripped, consecutiveFallbacks: currentFallbacks };
    } catch (err: any) {
      console.error("[CIRCUIT_BREAKER_ERROR] Database update failed:", err);
      throw new Error(`Circuit breaker state update failed: ${err.message || err}`);
    }
  }

  /**
   * Resets the consecutive fallback count to 0.
   * Call this on successful AI LLM response generation.
   */
  public static async recordSuccess(
    tenantId: string,
    conversationId: string,
    db: TenantDB
  ): Promise<void> {
    try {
      const convRows = await db.executeSafe({
        text: `SELECT metadata FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        values: [conversationId, tenantId]
      }) as any[];

      if (convRows.length === 0) return;

      const metadata = convRows[0].metadata || {};
      if (metadata.consecutive_fallback_count && metadata.consecutive_fallback_count > 0) {
        metadata.consecutive_fallback_count = 0;
        await db.executeSafe({
          text: `UPDATE conversations SET metadata = $1 WHERE id = $2 AND tenant_id = $3`,
          values: [JSON.stringify(metadata), conversationId, tenantId]
        });
      }
    } catch (err) {
      console.error("[CIRCUIT_BREAKER_RESET_ERROR]", err);
    }
  }
}
