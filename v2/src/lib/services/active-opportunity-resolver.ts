import { logger } from "@/lib/core/logger";
import type { TenantDB } from "@/lib/core/tenant-db";

const log = logger.withContext({ module: 'ActiveOpportunityResolver' });

// ══════════════════════════════════════════════════════════
// ActiveOpportunityResolver — Central Source of Truth
// All screens (Inbox, Forms, Takip) resolve opportunities
// through this single service to prevent data inconsistency.
// ══════════════════════════════════════════════════════════

export type LinkConfidence = 
  | 'explicit_active'      // conversations.active_opportunity_id set
  | 'lead_link'            // leads.linked_opportunity_id set
  | 'conversation_latest'  // Latest non-terminal opp for conversation
  | 'single_phone_match'   // Only 1 opp matches phone (safe)
  | 'ambiguous'            // Multiple matches, can't pick safely
  | 'none';                // No opportunity found

export interface ResolvedOpportunity {
  opportunity: any | null;
  linkConfidence: LinkConfidence;
  reason: string;
}

export interface ResolveInput {
  tenantId: string;
  conversationId?: string;
  leadId?: number;
  phoneNumber?: string;
}

export class ActiveOpportunityResolver {
  constructor(private db: TenantDB) {}

  /**
   * Resolve the active opportunity using cascading priority:
   * 1. conversations.active_opportunity_id (explicit, highest trust)
   * 2. leads.linked_opportunity_id (form-level link)
   * 3. conversation_id → latest non-terminal opportunity
   * 4. phone number → single safe match
   * 5. ambiguous or none
   *
   * SECURITY: Every resolution validates tenant_id match.
   */
  async resolve(input: ResolveInput): Promise<ResolvedOpportunity> {
    const { tenantId, conversationId, leadId, phoneNumber } = input;

    // ── Step 1: Explicit active_opportunity_id ──
    if (conversationId) {
      try {
        const rows = await this.db.executeSafe({
          text: `SELECT o.* FROM conversations c
                 JOIN opportunities o ON o.id = c.active_opportunity_id
                 WHERE c.id = $1 
                   AND c.tenant_id = $2
                   AND o.tenant_id = $2
                   AND o.conversation_id = c.id`,
          values: [conversationId, tenantId]
        });
        if (rows.length > 0) {
          return {
            opportunity: rows[0],
            linkConfidence: 'explicit_active',
            reason: 'conversations.active_opportunity_id FK match (tenant+conv verified)'
          };
        }
      } catch (e) {
        log.warn(`[RESOLVER] Step 1 (explicit_active) failed`, { tenantId, conversationId, error: String(e) });
      }
    }

    // ── Step 2: Lead linked_opportunity_id ──
    if (leadId) {
      try {
        const rows = await this.db.executeSafe({
          text: `SELECT o.* FROM leads l
                 JOIN opportunities o ON o.id = l.linked_opportunity_id
                 WHERE l.id = $1 
                   AND l.tenant_id = $2
                   AND o.tenant_id = $2`,
          values: [leadId, tenantId]
        });
        if (rows.length > 0) {
          return {
            opportunity: rows[0],
            linkConfidence: 'lead_link',
            reason: 'leads.linked_opportunity_id FK match (tenant verified)'
          };
        }
      } catch (e) {
        log.warn(`[RESOLVER] Step 2 (lead_link) failed`, { tenantId, leadId, error: String(e) });
      }
    }

    // ── Step 3: Latest non-terminal opp for conversation ──
    if (conversationId) {
      try {
        const rows = await this.db.executeSafe({
          text: `SELECT * FROM opportunities
                 WHERE conversation_id = $1 
                   AND tenant_id = $2
                   AND stage NOT IN ('lost', 'not_qualified', 'arrived')
                 ORDER BY updated_at DESC
                 LIMIT 1`,
          values: [conversationId, tenantId]
        });
        if (rows.length > 0) {
          return {
            opportunity: rows[0],
            linkConfidence: 'conversation_latest',
            reason: 'Latest non-terminal opportunity for conversation_id'
          };
        }
      } catch (e) {
        log.warn(`[RESOLVER] Step 3 (conversation_latest) failed`, { tenantId, conversationId, error: String(e) });
      }
    }

    // ── Step 4: Phone match — only if exactly 1 match (safe) ──
    if (phoneNumber) {
      try {
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        const last10 = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;

        const rows = await this.db.executeSafe({
          text: `SELECT * FROM opportunities
                 WHERE tenant_id = $1
                   AND RIGHT(phone_number, 10) = $2
                   AND stage NOT IN ('lost', 'not_qualified', 'arrived')
                 ORDER BY updated_at DESC`,
          values: [tenantId, last10]
        });

        if (rows.length === 1) {
          return {
            opportunity: rows[0],
            linkConfidence: 'single_phone_match',
            reason: 'Single non-terminal opportunity matching phone suffix'
          };
        }

        if (rows.length > 1) {
          return {
            opportunity: null,
            linkConfidence: 'ambiguous',
            reason: `${rows.length} opportunities match phone — cannot safely pick one`
          };
        }
      } catch (e) {
        log.warn(`[RESOLVER] Step 4 (phone_match) failed`, { tenantId, phoneNumber, error: String(e) });
      }
    }

    // ── Step 5: No match ──
    return {
      opportunity: null,
      linkConfidence: 'none',
      reason: 'No active opportunity found for given identifiers'
    };
  }

  /**
   * Set the active_opportunity_id on a conversation.
   * Validates tenant_id and conversation_id ownership before writing.
   */
  async setActive(tenantId: string, conversationId: string, opportunityId: string): Promise<boolean> {
    try {
      // Security: Verify opp belongs to same tenant AND conversation
      const oppCheck = await this.db.executeSafe({
        text: `SELECT id FROM opportunities 
               WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3`,
        values: [opportunityId, tenantId, conversationId]
      });

      if (oppCheck.length === 0) {
        log.warn(`[RESOLVER] setActive BLOCKED — opportunity ${opportunityId} does not belong to tenant ${tenantId} / conversation ${conversationId}`);
        return false;
      }

      await this.db.executeSafe({
        text: `UPDATE conversations SET active_opportunity_id = $1 WHERE id = $2 AND tenant_id = $3`,
        values: [opportunityId, conversationId, tenantId]
      });

      log.info(`[RESOLVER] Active opportunity set`, { tenantId, conversationId, opportunityId });
      return true;
    } catch (e) {
      log.error(`[RESOLVER] setActive failed`, e instanceof Error ? e : new Error(String(e)));
      return false;
    }
  }

  /**
   * Clear active_opportunity_id (e.g., on reset/privacy request).
   */
  async clearActive(tenantId: string, conversationId: string): Promise<void> {
    await this.db.executeSafe({
      text: `UPDATE conversations SET active_opportunity_id = NULL WHERE id = $1 AND tenant_id = $2`,
      values: [conversationId, tenantId]
    });
  }
}
