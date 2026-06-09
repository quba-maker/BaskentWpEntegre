import { TenantDB } from "@/lib/core/tenant-db";

export interface WhatsAppWindowStatus {
  status: 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'UNKNOWN';
  reason: string;
  lastCustomerInteractionAt?: string;
  expiresAt?: string;
  remainingSeconds: number;
  sourceMessageId?: string;
}

/**
 * Calculates the WhatsApp 24-hour message window status for a conversation.
 * 
 * - OPEN: Interaction < 20 hours ago.
 * - CLOSING_SOON: Interaction between 20 and 24 hours ago.
 * - CLOSED: Interaction > 24 hours ago.
 * - UNKNOWN: No inbound interaction found.
 * 
 * IMPORTANT: Excludes reaction messages using standard check:
 * `AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')`
 */
export async function resolveWhatsApp24hWindow(
  conversationId: string,
  tenantId: string,
  db: TenantDB
): Promise<WhatsAppWindowStatus> {
  const rows = await db.executeSafe({
    text: `
      SELECT id, COALESCE(provider_timestamp, created_at) as last_inbound_at, provider_message_id
      FROM messages
      WHERE conversation_id = $1
        AND tenant_id = $2
        AND direction = 'in'
        AND (media_metadata IS NULL OR COALESCE(media_metadata->'native'->>'message_type', '') != 'reaction')
      ORDER BY COALESCE(provider_timestamp, created_at) DESC, id DESC
      LIMIT 1
    `,
    values: [conversationId, tenantId]
  }) as any[];

  if (rows.length === 0) {
    return {
      status: 'UNKNOWN',
      reason: 'Müşteriden gelen mesaj bulunamadı.',
      lastCustomerInteractionAt: undefined,
      expiresAt: undefined,
      remainingSeconds: 0,
      sourceMessageId: undefined
    };
  }

  const row = rows[0];
  const lastInboundAt = row.last_inbound_at;
  const lastCustomerInteractionAt = new Date(lastInboundAt);
  const expiresAt = new Date(lastCustomerInteractionAt.getTime() + 24 * 60 * 60 * 1000);
  const now = new Date();
  
  const remainingMs = expiresAt.getTime() - now.getTime();
  const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const remainingHours = remainingSeconds / 3600;

  let status: 'OPEN' | 'CLOSING_SOON' | 'CLOSED' = 'CLOSED';
  let reason = '24 saatlik müşteri penceresi kapandı.';
  
  if (remainingSeconds > 0) {
    if (remainingHours < 4) {
      status = 'CLOSING_SOON';
      reason = `Müşteri penceresi kapanmak üzere (kalan süre: ${Math.floor(remainingHours)}s ${Math.floor((remainingSeconds % 3600) / 60)}dk).`;
    } else {
      status = 'OPEN';
      reason = `Müşteri penceresi açık (kalan süre: ${Math.floor(remainingHours)}s).`;
    }
  }

  return {
    status,
    reason,
    lastCustomerInteractionAt: lastCustomerInteractionAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    remainingSeconds,
    sourceMessageId: row.id
  };
}
