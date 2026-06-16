import { TenantDB } from "@/lib/core/tenant-db";
import { resolveWhatsApp24hWindow } from "../whatsapp-window-resolver";

export type MetaWindowCheckResult = {
  open: boolean;
  reason:
    | 'last_inbound_within_24h'
    | 'no_inbound'
    | 'window_expired'
    | 'not_whatsapp_channel'
    | 'unknown';
  lastInboundAt?: string;
};

/**
 * Checks if the Meta 24-hour customer service window is open.
 * Strictly uses inbound patient messages, excluding reactions, outbounds, system logs.
 */
export async function checkMetaWindow(
  conversationId: string,
  tenantId: string,
  db: TenantDB
): Promise<MetaWindowCheckResult> {
  try {
    const convRows = await db.executeSafe({
      text: `SELECT channel FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      values: [conversationId, tenantId]
    }) as any[];

    if (convRows.length === 0) {
      return { open: false, reason: 'unknown' };
    }

    const conv = convRows[0];
    if (conv.channel !== 'whatsapp') {
      return { open: false, reason: 'not_whatsapp_channel' };
    }

    // Call existing helper that queries direction='in' excluding reactions
    const windowStatus = await resolveWhatsApp24hWindow(conversationId, tenantId, db);

    if (windowStatus.status === 'UNKNOWN') {
      return { open: false, reason: 'no_inbound' };
    }

    if (windowStatus.status === 'CLOSED') {
      return { 
        open: false, 
        reason: 'window_expired', 
        lastInboundAt: windowStatus.lastCustomerInteractionAt 
      };
    }

    // OPEN or CLOSING_SOON are within 24h
    return {
      open: true,
      reason: 'last_inbound_within_24h',
      lastInboundAt: windowStatus.lastCustomerInteractionAt
    };
  } catch {
    return { open: false, reason: 'unknown' };
  }
}
