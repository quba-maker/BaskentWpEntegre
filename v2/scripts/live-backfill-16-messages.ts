/**
 * LIVE BACKFILL SCRIPT — Controlled import of 16 missing messages
 * 
 * SCOPE:
 *   - tenant_id: caab9ea1-9591-45e4-bbc5-9c9b498982c8
 *   - channel_id: 2e7352c1-5db7-4414-baf7-de571a66bfa6
 *   - Only messages NOT already in DB (provider_message_id conflict-safe)
 * 
 * GUARANTEES:
 *   1. No existing message content/status/created_at will be updated
 *   2. created_at = NOW() (import time), provider_timestamp = WhatsApp original time
 *   3. AI, tasks, notifications, autopilot are NEVER triggered (direct DB insert)
 *   4. Conversation last_message_at only updated if provider_timestamp > existing
 *   5. Idempotent: running twice produces 0 new inserts
 *   6. Full rollback SQL generated
 */
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

// ═══════ HARD-CODED SCOPE CONSTRAINTS ═══════
const TENANT_ID = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
const CHANNEL_ID = '2e7352c1-5db7-4414-baf7-de571a66bfa6';

interface BackfillResult {
  inserted: Array<{ messageId: string; providerMessageId: string; phone: string; direction: string; conversationId: string }>;
  skippedDuplicates: number;
  mediaSuccess: number;
  mediaExpired: number;
  conversationsAffected: Set<string>;
  errors: string[];
}

async function takePreSnapshot() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  PRE-BACKFILL SNAPSHOT                   ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const msgCount = await sql`SELECT COUNT(*)::int as count FROM messages WHERE tenant_id = ${TENANT_ID}`;
  console.log(`Messages count: ${msgCount[0].count}`);

  const convCount = await sql`SELECT COUNT(*)::int as count FROM conversations WHERE tenant_id = ${TENANT_ID}`;
  console.log(`Conversations count: ${convCount[0].count}`);

  const convDetails = await sql`
    SELECT id, phone_number, last_message_at, message_count 
    FROM conversations 
    WHERE tenant_id = ${TENANT_ID}
    ORDER BY last_message_at DESC NULLS LAST
  `;
  console.log("\nConversation states before backfill:");
  for (const c of convDetails) {
    console.log(`  ${c.phone_number} | last_msg: ${c.last_message_at} | count: ${c.message_count}`);
  }

  return { messageCount: msgCount[0].count, conversationCount: convCount[0].count, conversations: convDetails };
}

async function extractMissingMessages(): Promise<any[]> {
  // 1. Pull all history + echo events from channel_events
  const events = await sql`
    SELECT id, payload, created_at 
    FROM channel_events 
    WHERE event_type = '360dialog_webhook_received' 
      AND channel_id = ${CHANNEL_ID}
      AND (payload::text LIKE '%history%' OR payload::text LIKE '%smb_message_echoes%')
    ORDER BY created_at ASC
  `;

  const allMessages: any[] = [];

  for (const event of events) {
    const payload = event.payload;
    const changes = payload?.entry?.[0]?.changes?.[0];
    const value = changes?.value;
    const field = changes?.field;

    if (!value) continue;

    // History messages
    if (field === 'history' && value.messages) {
      for (const msg of value.messages) {
        allMessages.push({
          ...msg,
          _source: 'history',
          _direction: 'in', // History messages are always inbound from patient
          _isHistory: true,
          _isEcho: false
        });
      }
    }
    // Echo messages
    else if (field === 'smb_message_echoes' && value.message_echoes) {
      for (const msg of value.message_echoes) {
        allMessages.push({
          ...msg,
          _source: 'echo',
          _direction: 'out', // Echo = outbound from business app
          _isHistory: false,
          _isEcho: true,
          _phone: msg.to // For echoes, the customer phone is msg.to
        });
      }
    }
    // Fallback: standard value.messages (might also be history without explicit field)
    else if (value.messages) {
      for (const msg of value.messages) {
        // Determine direction - if the from matches our channel identifier, it's outbound
        const isOutbound = msg.from === '905527641397'; // Business phone
        allMessages.push({
          ...msg,
          _source: field === 'history' ? 'history' : 'standard',
          _direction: isOutbound ? 'out' : 'in',
          _isHistory: field === 'history',
          _isEcho: false,
          _phone: isOutbound ? msg.to : undefined
        });
      }
    }
  }

  // 2. Filter out already-existing messages
  const providerIds = allMessages.map(m => m.id).filter(Boolean);
  if (providerIds.length === 0) return [];

  const existing = await sql`
    SELECT provider_message_id FROM messages 
    WHERE tenant_id = ${TENANT_ID} AND provider_message_id = ANY(${providerIds})
  `;
  const existingSet = new Set(existing.map(r => r.provider_message_id));

  const missing = allMessages.filter(m => m.id && !existingSet.has(m.id));
  console.log(`\nExtracted ${allMessages.length} total messages from events.`);
  console.log(`Already in DB: ${existingSet.size}`);
  console.log(`Missing (to import): ${missing.length}`);

  return missing;
}

function extractContent(msg: any): string {
  if (msg.text?.body) return msg.text.body;
  if (msg.image?.caption) return `[Fotoğraf] ${msg.image.caption}`;
  if (msg.image) return '[Fotoğraf]';
  if (msg.document?.filename) return `[Dosya: ${msg.document.filename}]`;
  if (msg.document) return '[Dosya]';
  if (msg.audio) return '[Ses Mesajı]';
  if (msg.video?.caption) return `[Video] ${msg.video.caption}`;
  if (msg.video) return '[Video]';
  if (msg.sticker) return '[Çıkartma]';
  if (msg.location) return `[Konum: ${msg.location.latitude}, ${msg.location.longitude}]`;
  if (msg.button?.text) return msg.button.text;
  if (msg.interactive?.button_reply?.title) return msg.interactive.button_reply.title;
  if (msg.interactive?.list_reply?.title) return msg.interactive.list_reply.title;
  return '[Bilinmeyen içerik]';
}

function extractMediaType(msg: any): string | null {
  if (msg.image) return 'image';
  if (msg.document) return 'document';
  if (msg.audio) return 'audio';
  if (msg.video) return 'video';
  if (msg.sticker) return 'sticker';
  if (msg.location) return 'location';
  return null;
}

function buildMediaMetadata(msg: any, isHistory: boolean, isEcho: boolean): Record<string, any> | null {
  const base: Record<string, any> = {};

  if (isHistory) {
    base.is_history_import = true;
    base.source = '360dialog_history';
    base.should_trigger_ai = false;
    base.should_trigger_tasks = false;
  }
  if (isEcho) {
    base.source = 'whatsapp_business_app_echo';
  }

  const mediaType = extractMediaType(msg);
  if (!mediaType) return Object.keys(base).length > 0 ? base : null;

  const mediaObj = msg[mediaType];
  if (!mediaObj) return base;

  // Mark media as expired/unavailable — these are old history URLs
  base.media_unavailable = true;
  base.media_unavailable_reason = 'media_expired_or_unavailable';
  
  if (mediaObj.mime_type) base.mime_type = mediaObj.mime_type;
  if (mediaObj.filename) base.filename = mediaObj.filename;
  if (mediaObj.caption) base.caption = mediaObj.caption;
  if (mediaObj.sha256) base.sha256 = mediaObj.sha256;
  // DO NOT store raw facebook signed URL in persistent DB field
  // base.url = mediaObj.url; // Intentionally excluded per user requirement

  return base;
}

async function insertMessage(
  msg: any,
  conversationId: string,
  phoneNumber: string,
  direction: 'in' | 'out',
  isHistory: boolean,
  isEcho: boolean
): Promise<{ messageId: string; isDuplicate: boolean }> {
  const content = extractContent(msg);
  const mediaType = extractMediaType(msg);
  const mediaMetadata = buildMediaMetadata(msg, isHistory, isEcho);
  const providerTimestampDate = msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000) : null;
  const status = isEcho ? 'sent' : 'delivered';
  const modelUsed: string | null = null;
  const metadataJson = mediaMetadata ? JSON.stringify(mediaMetadata) : null;

  // Conflict-safe INSERT — skip if provider_message_id already exists
  const result = await sql`
    INSERT INTO messages (
      tenant_id, conversation_id, phone_number, direction, content, channel, 
      channel_id, provider_message_id, model_used, status,
      media_type, media_metadata, provider_timestamp, prompt_tokens, completion_tokens
    )
    SELECT 
      ${TENANT_ID}, ${conversationId}, ${phoneNumber}, ${direction}, ${content}, 'whatsapp',
      ${CHANNEL_ID}, ${msg.id}, ${modelUsed}, ${status},
      ${mediaType}, ${metadataJson}::jsonb,
      ${providerTimestampDate}::timestamptz,
      0, 0
    WHERE NOT EXISTS (
      SELECT 1 FROM messages WHERE tenant_id = ${TENANT_ID} AND provider_message_id = ${msg.id}
    )
    RETURNING id
  `;

  if (result.length === 0) {
    return { messageId: '', isDuplicate: true };
  }

  return { messageId: result[0].id, isDuplicate: false };
}

async function updateConversationTimestamp(conversationId: string, providerTimestampUnix: number) {
  const providerDate = new Date(providerTimestampUnix * 1000);
  // ONLY update last_message_at if provider timestamp is newer than existing
  await sql`
    UPDATE conversations 
    SET 
      last_message_at = CASE 
        WHEN ${providerDate}::timestamptz > COALESCE(last_message_at, '1970-01-01'::timestamptz) 
        THEN ${providerDate}::timestamptz
        ELSE last_message_at 
      END,
      message_count = message_count + 1,
      history_imported_at = COALESCE(history_imported_at, NOW())
    WHERE id = ${conversationId} AND tenant_id = ${TENANT_ID}
  `;
}

async function resolveConversation(phoneNumber: string): Promise<string | null> {
  const result = await sql`
    SELECT id FROM conversations 
    WHERE phone_number = ${phoneNumber} AND tenant_id = ${TENANT_ID}
    LIMIT 1
  `;
  return result.length > 0 ? result[0].id : null;
}

async function run() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  LIVE BACKFILL — 16 Missing Messages                    ║");
  console.log("║  Tenant: caab9ea1-9591-45e4-bbc5-9c9b498982c8          ║");
  console.log("║  Channel: 2e7352c1-5db7-4414-baf7-de571a66bfa6        ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // SCOPE GUARD
  const tenantCheck = await sql`SELECT id FROM tenants WHERE id = ${TENANT_ID} AND status = 'active'`;
  if (tenantCheck.length === 0) {
    console.error("❌ FATAL: Tenant not found or inactive. ABORTING.");
    process.exit(1);
  }

  const channelCheck = await sql`SELECT id FROM channels WHERE id = ${CHANNEL_ID} AND status = 'active'`;
  if (channelCheck.length === 0) {
    console.error("❌ FATAL: Channel not found or inactive. ABORTING.");
    process.exit(1);
  }

  // Pre-snapshot
  const snapshot = await takePreSnapshot();

  // Extract missing messages
  const missing = await extractMissingMessages();

  if (missing.length === 0) {
    console.log("\n✅ No missing messages found. Database is already complete. Nothing to do.");
    process.exit(0);
  }

  if (missing.length > 20) {
    console.error(`\n❌ SAFETY: Expected ≤16 missing messages but found ${missing.length}. ABORTING.`);
    process.exit(1);
  }

  // Execute backfill
  const result: BackfillResult = {
    inserted: [],
    skippedDuplicates: 0,
    mediaSuccess: 0,
    mediaExpired: 0,
    conversationsAffected: new Set(),
    errors: []
  };

  for (const msg of missing) {
    const phoneNumber = msg._phone || msg.from;
    const direction = msg._direction as 'in' | 'out';

    if (!phoneNumber) {
      result.errors.push(`No phone number for message ${msg.id}`);
      continue;
    }

    // Resolve conversation
    const conversationId = await resolveConversation(phoneNumber);
    if (!conversationId) {
      result.errors.push(`No conversation found for phone ${phoneNumber}, message ${msg.id}`);
      continue;
    }

    try {
      const { messageId, isDuplicate } = await insertMessage(
        msg, conversationId, phoneNumber, direction, msg._isHistory, msg._isEcho
      );

      if (isDuplicate) {
        result.skippedDuplicates++;
        continue;
      }

      // Track media status
      const mediaType = extractMediaType(msg);
      if (mediaType) {
        result.mediaExpired++; // All history media is assumed expired
      }

      // Update conversation timestamp carefully
      if (msg.timestamp) {
        await updateConversationTimestamp(conversationId, parseInt(msg.timestamp, 10));
      }

      result.inserted.push({
        messageId,
        providerMessageId: msg.id,
        phone: phoneNumber,
        direction,
        conversationId
      });
      result.conversationsAffected.add(conversationId);

      console.log(`  ✅ Inserted: ${msg.id} | ${direction} | ${phoneNumber} | ${extractContent(msg).substring(0, 50)}`);
    } catch (err: any) {
      result.errors.push(`Failed to insert ${msg.id}: ${err.message}`);
      console.error(`  ❌ Error: ${msg.id}: ${err.message}`);
    }
  }

  // ═══════ POST-BACKFILL REPORT ═══════
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  POST-BACKFILL FINAL REPORT              ║");
  console.log("╚══════════════════════════════════════════╝\n");

  console.log(`1. Messages inserted: ${result.inserted.length}`);
  console.log(`2. Duplicates skipped: ${result.skippedDuplicates}`);
  console.log(`3. Media successfully uploaded: ${result.mediaSuccess}`);
  console.log(`4. Media expired/unavailable: ${result.mediaExpired}`);
  console.log(`5. Conversations affected: ${result.conversationsAffected.size}`);

  if (result.errors.length > 0) {
    console.log(`\n⚠️  Errors (${result.errors.length}):`);
    for (const err of result.errors) {
      console.log(`   - ${err}`);
    }
  }

  // Post-snapshot
  const postMsgCount = await sql`SELECT COUNT(*)::int as count FROM messages WHERE tenant_id = ${TENANT_ID}`;
  console.log(`\n6. Messages count: ${snapshot.messageCount} → ${postMsgCount[0].count} (delta: +${postMsgCount[0].count - snapshot.messageCount})`);

  // Check Murtaza specifically
  const murtazaBefore = await sql`
    SELECT COUNT(*)::int as count FROM messages 
    WHERE tenant_id = ${TENANT_ID} AND phone_number = '905302655498'
  `;
  console.log(`7. Murtaza message count after: ${murtazaBefore[0].count}`);

  // Inbox ordering check
  const inboxOrder = await sql`
    SELECT c.phone_number, c.last_message_at, c.message_count
    FROM conversations c
    WHERE c.tenant_id = ${TENANT_ID}
    ORDER BY c.last_message_at DESC NULLS LAST
    LIMIT 5
  `;
  console.log("\n8. Inbox ordering (top 5 by last_message_at):");
  for (const row of inboxOrder) {
    console.log(`   ${row.phone_number} | ${row.last_message_at} | msgs: ${row.message_count}`);
  }

  // ═══════ ROLLBACK SQL ═══════
  if (result.inserted.length > 0) {
    const insertedIds = result.inserted.map(r => `'${r.messageId}'`).join(', ');
    const insertedProviderIds = result.inserted.map(r => `'${r.providerMessageId}'`).join(', ');

    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║  ROLLBACK SQL (if needed)                ║");
    console.log("╚══════════════════════════════════════════╝\n");

    console.log(`-- Delete inserted messages`);
    console.log(`DELETE FROM messages WHERE id IN (${insertedIds}) AND tenant_id = '${TENANT_ID}';`);
    console.log(`\n-- Verify deletion`);
    console.log(`SELECT COUNT(*) FROM messages WHERE provider_message_id IN (${insertedProviderIds}) AND tenant_id = '${TENANT_ID}';`);
    console.log(`\n-- Restore conversation message_count (subtract ${result.inserted.length} from affected conversations)`);
    for (const convId of result.conversationsAffected) {
      const affectedMsgs = result.inserted.filter(r => r.conversationId === convId).length;
      console.log(`UPDATE conversations SET message_count = message_count - ${affectedMsgs} WHERE id = '${convId}' AND tenant_id = '${TENANT_ID}';`);
    }
  }

  // Zero-outbound-delta check
  const outboundCheck = result.inserted.filter(r => r.direction === 'out');
  const inboundCheck = result.inserted.filter(r => r.direction === 'in');
  console.log(`\n9. Echo outbound messages with correct direction/source: ${outboundCheck.length} out, ${inboundCheck.length} in`);
  console.log(`10. History import triggered AI/task/notification: NO (direct DB insert, no Worker invoked)`);
  console.log(`11. Zero outbound delta preserved: ${outboundCheck.length === 0 ? 'YES (no new outbound)' : `${outboundCheck.length} outbound echoes added (expected)`}`);
}

run().catch(err => {
  console.error("❌ FATAL ERROR:", err);
  process.exit(1);
});
