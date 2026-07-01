import { logger } from "@/lib/core/logger";

function normalizeString(str: string): string {
  if (!str) return '';
  return str
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Calculates Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function calculateSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - (distance / maxLen);
}

export class ManualGreetingEchoMatcher {
  private static log = logger.withContext({ module: 'ManualGreetingEchoMatcher' });

  /**
   * Matches an incoming outbound echo to a manual greeting log and confirms it.
   * Returns true if a match was found and confirmed.
   */
  static async matchAndConfirmEcho(
    db: any,
    tenantId: string,
    phoneNumber: string,
    messageContent: string,
    providerMessageId: string,
    internalMessageId: string | null
  ): Promise<boolean> {
    if (!messageContent) return false;
    
    // 1. Idempotency Check
    const existingLog = await db.executeSafe({
      text: `SELECT id FROM outreach_logs WHERE tenant_id = $1 AND action = 'manual_whatsapp_greeting_echo_confirmed' AND metadata->>'provider_message_id' = $2 LIMIT 1`,
      values: [tenantId, providerMessageId]
    }) as any[];
    
    if (existingLog.length > 0) {
      this.log.info(`[ECHO_MATCHER_IDEMPOTENCY_SKIP] Echo already confirmed for provider_message_id=${providerMessageId}`);
      return false;
    }
    
    // 2. Find the most recent 'whatsapp_app_opened_for_greeting' log for this phone number within the last 24 hours.
    const recentOpenLogs = await db.executeSafe({
      text: `
        SELECT ol.id, ol.metadata, ol.created_at, ol.lead_id, ol.conversation_id
        FROM outreach_logs ol
        JOIN leads l ON l.id = ol.lead_id
        WHERE ol.tenant_id = $1 
          AND ol.action = 'whatsapp_app_opened_for_greeting'
          AND RIGHT(l.phone_number, 10) = RIGHT($2, 10)
          AND ol.created_at >= NOW() - INTERVAL '24 hours'
        ORDER BY ol.created_at DESC
        LIMIT 1
      `,
      values: [tenantId, phoneNumber]
    }) as any[];
    
    if (recentOpenLogs.length === 0) {
      this.log.info(`[ECHO_MATCHER_NO_OPEN_LOG] No recent 'whatsapp_app_opened_for_greeting' found for phone`, { phoneNumber });
      return false;
    }
    
    const openLog = recentOpenLogs[0];
    const logMeta = typeof openLog.metadata === 'string' ? JSON.parse(openLog.metadata) : (openLog.metadata || {});
    const expectedContent = logMeta.message_text || '';
    
    if (!expectedContent) {
      this.log.info(`[ECHO_MATCHER_NO_TEXT_IN_LOG] The open log has no expected message_text.`);
      return false;
    }
    
    // 3. Calculate similarity
    const normA = normalizeString(expectedContent);
    const normB = normalizeString(messageContent);
    
    const score = calculateSimilarity(normA, normB);
    const threshold = expectedContent.length > 300 ? 0.70 : 0.85;
    
    this.log.info(`[ECHO_MATCHER_SCORE] Evaluated match: score=${score.toFixed(2)}, threshold=${threshold}`, { providerMessageId });
    
    if (score >= threshold) {
      // 4. Zero-outbound validation: Check if there's any API-sent or already confirmed log
      const duplicateConfirmedLogs = await db.executeSafe({
        text: `SELECT id FROM outreach_logs WHERE tenant_id = $1 AND lead_id = $2 AND action IN ('greeting_sent', 'template_sent', 'form_greeting_template_sent', 'outreach_form_greeting_template_sent', 'manual_whatsapp_greeting_echo_confirmed') LIMIT 1`,
        values: [tenantId, openLog.lead_id]
      }) as any[];
      
      if (duplicateConfirmedLogs.length > 0) {
         this.log.info(`[ECHO_MATCHER_ALREADY_CONFIRMED] Lead ${openLog.lead_id} already has a confirmed/sent log.`);
         return false; 
      }
      
      // 5. Write the confirmed log
      await db.executeSafe({
        text: `INSERT INTO outreach_logs (tenant_id, lead_id, conversation_id, action, channel, actor_id, metadata)
               VALUES ($1, $2, $3, 'manual_whatsapp_greeting_echo_confirmed', 'whatsapp', 'system', $4)`,
        values: [
          tenantId,
          openLog.lead_id,
          openLog.conversation_id,
          JSON.stringify({
            source: "whatsapp_app_echo",
            matched_open_log_id: openLog.id,
            matched_message_id: internalMessageId,
            provider_message_id: providerMessageId,
            match_confidence: "high",
            match_score: parseFloat(score.toFixed(2)),
            zero_api_outbound: true,
            api_sent: false,
            patient_visible: true,
            matched_by: "phone_time_content"
          })
        ]
      });
      
      this.log.info(`[ECHO_MATCHER_SUCCESS] Confirmed manual greeting echo for lead ${openLog.lead_id}`, { score, providerMessageId });
      return true;
    } else {
      this.log.info(`[ECHO_MATCHER_LOW_SCORE] Match failed. Score ${score.toFixed(2)} < Threshold ${threshold}`);
      return false;
    }
  }
}
