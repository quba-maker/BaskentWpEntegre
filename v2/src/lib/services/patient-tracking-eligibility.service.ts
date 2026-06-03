import { TenantDB } from "@/lib/core/tenant-db";
import { normalizePhoneForMatch, getPhoneLast10 } from "@/lib/utils/phone";

export type PatientTrackingEligibilityReason =
  | "inbound_message_exists"
  | "outbound_sent"
  | "outbound_delivered"
  | "outbound_read"
  | "app_echo_exists"
  | "form_only_no_contact"
  | "draft_only"
  | "failed_outbound"
  | "terminal_stage"
  | "opt_out";

export interface PatientTrackingEligibilityResult {
  isEligibleForPatientTracking: boolean;
  reason: PatientTrackingEligibilityReason;
  firstContactAt?: string;
  lastRealMessageAt?: string;
  contactProofMessageId?: string;
}

export class PatientTrackingEligibilityService {
  /**
   * Evaluates if a patient (based on their opportunity) has genuinely been contacted
   * and thus should appear in the operational "Hasta Takibi" board.
   */
  static async resolveEligibility(
    db: TenantDB,
    opportunityId: string
  ): Promise<PatientTrackingEligibilityResult> {
    // 1. Fetch opportunity to check stage & phone
    const oppQuery = await db.executeSafe({
      text: `SELECT stage, phone_number FROM opportunities WHERE id = $1 AND tenant_id = $2`,
      values: [opportunityId, db.tenantId]
    }) as any[];

    if (oppQuery.length === 0) {
      return { isEligibleForPatientTracking: false, reason: "form_only_no_contact" };
    }

    const opp = oppQuery[0];
    const phone10 = getPhoneLast10(opp.phone_number);

    // Terminal stage check
    if (opp.stage === 'not_qualified' || opp.stage === 'arrived') {
      return { isEligibleForPatientTracking: false, reason: "terminal_stage" };
    }
    
    // Check opt-out (assuming we can check conversations for opt_out status later if needed, but for now just basic terminal stages)

    // 2. Fetch all related messages
    const msgsQuery = await db.executeSafe({
      text: `
        SELECT m.id, m.direction, m.status, m.created_at, m.provider_timestamp,
               m.model_used, m.provider_message_id
        FROM messages m
        LEFT JOIN conversations c ON m.conversation_id = c.id
        WHERE m.tenant_id = $1
          AND (c.phone_number = $2 OR RIGHT(m.phone_number, 10) = $3)
        ORDER BY COALESCE(m.provider_timestamp, m.created_at) ASC
      `,
      values: [db.tenantId, opp.phone_number, phone10]
    }) as any[];

    if (msgsQuery.length === 0) {
      // 3. Check if there are draft outreach logs or failed messages
      const logsQuery = await db.executeSafe({
        text: `SELECT action FROM outreach_logs WHERE opportunity_id = $1 AND tenant_id = $2`,
        values: [opportunityId, db.tenantId]
      }) as any[];

      const hasDrafts = logsQuery.some((l: any) => l.action.includes('draft'));
      if (hasDrafts) {
        return { isEligibleForPatientTracking: false, reason: "draft_only" };
      }
      return { isEligibleForPatientTracking: false, reason: "form_only_no_contact" };
    }

    // Evaluate message history
    let reason: PatientTrackingEligibilityReason | null = null;
    let contactProofMessageId: string | undefined = undefined;
    
    // Sort logic handled by SQL ASC.
    const firstMsg = msgsQuery[0];
    const firstContactAt = firstMsg.provider_timestamp ? new Date(firstMsg.provider_timestamp).toISOString() : firstMsg.created_at.toISOString();
    let lastRealMessageAt: string | undefined = undefined;

    for (const msg of msgsQuery) {
      const msgDate = msg.provider_timestamp ? new Date(msg.provider_timestamp).toISOString() : msg.created_at.toISOString();
      const isAppEcho = msg.direction === 'out' && msg.model_used === null && !msg.provider_message_id?.includes('system');
      
      if (msg.direction === 'in') {
        reason = "inbound_message_exists";
        contactProofMessageId = msg.id;
        lastRealMessageAt = msgDate;
      } else if (msg.direction === 'out') {
        if (['delivered'].includes(msg.status)) {
          // If already inbound exists, don't overwrite reason to a lower priority, but update lastRealMessageAt
          if (reason !== "inbound_message_exists") reason = "outbound_delivered";
          if (!contactProofMessageId) contactProofMessageId = msg.id;
          lastRealMessageAt = msgDate;
        } else if (['read'].includes(msg.status)) {
          if (reason !== "inbound_message_exists") reason = "outbound_read";
          if (!contactProofMessageId) contactProofMessageId = msg.id;
          lastRealMessageAt = msgDate;
        } else if (['sent'].includes(msg.status)) {
          if (!reason || reason === "failed_outbound") {
             reason = isAppEcho ? "app_echo_exists" : "outbound_sent";
             contactProofMessageId = msg.id;
          }
          lastRealMessageAt = msgDate;
        } else if (['failed'].includes(msg.status)) {
          if (!reason) reason = "failed_outbound";
        }
      }
    }

    if (!reason || reason === "failed_outbound") {
      return {
        isEligibleForPatientTracking: false,
        reason: reason || "failed_outbound",
        firstContactAt
      };
    }

    return {
      isEligibleForPatientTracking: true,
      reason,
      firstContactAt,
      lastRealMessageAt,
      contactProofMessageId
    };
  }
}
