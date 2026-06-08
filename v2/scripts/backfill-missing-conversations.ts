import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import { parseArgs } from 'util';

dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

// Constants
const TENANT_ID = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
const CHANNEL_ID = '2e7352c1-5db7-4414-baf7-de571a66bfa6';
const BUSINESS_PHONE_NUMBERS = ['905527641397', '203576826173902'];

// Conversation mappings
const TARGET_CONVERSATIONS = [
  { id: '5ab1e196-47cb-4a6e-bf01-78f81f8e4ef9', phone: '905010154242' },
  { id: '646db3ef-879f-49bf-b1bc-6b2527a2a9de', phone: '4917612345678' },
  { id: 'da9816b5-4339-42e7-8e74-6ba9daf3f8f0', phone: '905321112233' }
];

interface ExtractedMessage {
  id: string; // provider message ID
  phoneNumber: string; // customer phone number
  direction: 'in' | 'out';
  content: string;
  mediaType: string | null;
  mediaMetadata: any | null;
  timestamp: Date;
  source: string;
}

// Helpers
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

function buildMediaMetadata(msg: any, source: string): any | null {
  const base: any = {
    is_history_import: source === 'history',
    source: `repair_backfill_${source}`,
    should_trigger_ai: false,
    should_trigger_tasks: false
  };

  const mediaType = extractMediaType(msg);
  if (!mediaType) return base;

  const mediaObj = msg[mediaType];
  if (!mediaObj) return base;

  base.media_unavailable = true;
  base.media_unavailable_reason = 'media_expired_or_unavailable';

  if (mediaObj.mime_type) base.mime_type = mediaObj.mime_type;
  if (mediaObj.filename) base.filename = mediaObj.filename;
  if (mediaObj.caption) base.caption = mediaObj.caption;
  if (mediaObj.sha256) base.sha256 = mediaObj.sha256;

  return base;
}

async function run() {
  const { values } = parseArgs({
    options: {
      commit: { type: 'boolean', default: false }
    }
  });

  const isDryRun = !values.commit;

  console.log("==========================================================");
  console.log(`  INBOX HISTORY INTEGRITY REPAIR P0 | MODE: ${isDryRun ? "DRY-RUN" : "LIVE-WRITE"}`);
  console.log("==========================================================");

  // 1. Pre-execution snapshots
  console.log("\n--- PRE-EXECUTION SNAPSHOTS ---");
  for (const conv of TARGET_CONVERSATIONS) {
    const res = await sql`
      SELECT id, phone_number, message_count, last_message_at, last_message_content
      FROM conversations
      WHERE id = ${conv.id} AND tenant_id = ${TENANT_ID}
    `;
    const msgCount = await sql`
      SELECT COUNT(*)::int as count FROM messages
      WHERE conversation_id = ${conv.id} AND tenant_id = ${TENANT_ID}
    `;
    if (res.length > 0) {
      const c = res[0];
      console.log(`* Conv [${c.phone_number}] (${c.id.substring(0, 8)}...):`);
      console.log(`  - Denormalized message_count: ${c.message_count}`);
      console.log(`  - Actual messages in table  : ${msgCount[0].count}`);
      console.log(`  - Last message content      : "${c.last_message_content || 'none'}"`);
      console.log(`  - Last message at           : ${c.last_message_at}`);
    } else {
      console.log(`* Conv [${conv.phone}] (${conv.id.substring(0, 8)}...): NOT FOUND in conversations table!`);
    }
  }

  // 2. Extract messages from channel_events
  console.log("\n--- EXTRACTING MESSAGES FROM CHANNEL_EVENTS ---");
  
  // We will query all events for the tenant's channel
  const events = await sql`
    SELECT id, payload, created_at
    FROM channel_events
    WHERE channel_id = ${CHANNEL_ID}
      AND event_type = '360dialog_webhook_received'
    ORDER BY created_at ASC
  `;

  console.log(`Found ${events.length} total webhook events for channel.`);

  const extractedMessages: ExtractedMessage[] = [];

  for (const event of events) {
    const payload = event.payload;
    const entries = payload?.entry || [];
    
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value;
        const field = change.field;
        if (!value) continue;

        // A. Nested History format: changes[0].value.history
        if (field === 'history' && Array.isArray(value.history)) {
          for (const histBlock of value.history) {
            const threads = histBlock.threads || [];
            for (const thread of threads) {
              const threadPhone = thread.id || thread.context?.wa_id;
              if (!threadPhone) continue;

              // Check if thread belongs to any of our target phones
              const target = TARGET_CONVERSATIONS.find(tc => tc.phone === threadPhone);
              if (!target) continue;

              const msgs = thread.messages || [];
              for (const msg of msgs) {
                if (!msg.id) continue;
                
                const isOutbound = msg.history_context?.from_me === true || 
                                   msg.from_me === true || 
                                   BUSINESS_PHONE_NUMBERS.includes(msg.from);
                
                extractedMessages.push({
                  id: msg.id,
                  phoneNumber: threadPhone,
                  direction: isOutbound ? 'out' : 'in',
                  content: extractContent(msg),
                  mediaType: extractMediaType(msg),
                  mediaMetadata: buildMediaMetadata(msg, 'history'),
                  timestamp: msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000) : new Date(event.created_at),
                  source: 'history_nested'
                });
              }
            }
          }
        }
        // B. Flat History format: changes[0].field === 'history' && changes[0].value.messages
        else if (field === 'history' && Array.isArray(value.messages)) {
          // Identify phone from contact list or messages
          const contactPhone = value.contacts?.[0]?.wa_id;
          const msgPhone = value.messages[0]?.from;
          const targetPhone = TARGET_CONVERSATIONS.find(tc => tc.phone === contactPhone || tc.phone === msgPhone)?.phone;
          
          if (targetPhone) {
            for (const msg of value.messages) {
              if (!msg.id) continue;
              const isOutbound = msg.history_context?.from_me === true || 
                                 msg.from_me === true || 
                                 BUSINESS_PHONE_NUMBERS.includes(msg.from);
              
              extractedMessages.push({
                id: msg.id,
                phoneNumber: targetPhone,
                direction: isOutbound ? 'out' : 'in',
                content: extractContent(msg),
                mediaType: extractMediaType(msg),
                mediaMetadata: buildMediaMetadata(msg, 'history'),
                timestamp: msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000) : new Date(event.created_at),
                source: 'history_flat'
              });
            }
          }
        }
        // C. Standard messages or echoes
        else if (Array.isArray(value.messages)) {
          for (const msg of value.messages) {
            if (!msg.id) continue;
            
            // Check if matches target phones
            const contactPhone = value.contacts?.[0]?.wa_id;
            const fromPhone = msg.from;
            const toPhone = msg.to;
            
            const matchedConv = TARGET_CONVERSATIONS.find(tc => 
              tc.phone === contactPhone || tc.phone === fromPhone || tc.phone === toPhone
            );
            
            if (matchedConv) {
              const isOutbound = BUSINESS_PHONE_NUMBERS.includes(msg.from);
              extractedMessages.push({
                id: msg.id,
                phoneNumber: matchedConv.phone,
                direction: isOutbound ? 'out' : 'in',
                content: extractContent(msg),
                mediaType: extractMediaType(msg),
                mediaMetadata: buildMediaMetadata(msg, 'standard'),
                timestamp: msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000) : new Date(event.created_at),
                source: 'standard_webhook'
              });
            }
          }
        }
        // D. Message echoes flat
        else if (Array.isArray(value.message_echoes)) {
          for (const msg of value.message_echoes) {
            if (!msg.id) continue;
            
            const matchedConv = TARGET_CONVERSATIONS.find(tc => tc.phone === msg.to || tc.phone === msg.from);
            if (matchedConv) {
              extractedMessages.push({
                id: msg.id,
                phoneNumber: matchedConv.phone,
                direction: 'out',
                content: extractContent(msg),
                mediaType: extractMediaType(msg),
                mediaMetadata: buildMediaMetadata(msg, 'echo'),
                timestamp: msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000) : new Date(event.created_at),
                source: 'echo_webhook'
              });
            }
          }
        }
      }
    }
  }

  // 3. Deduplicate extracted messages
  const dedupedMap = new Map<string, ExtractedMessage>();
  for (const msg of extractedMessages) {
    // Keep chronologically first or keep whichever is already known
    if (!dedupedMap.has(msg.id)) {
      dedupedMap.set(msg.id, msg);
    }
  }
  const uniqueMessages = Array.from(dedupedMap.values());
  console.log(`Extracted ${extractedMessages.length} total messages, reduced to ${uniqueMessages.length} unique messages.`);

  // Group by phone number
  const groupedByPhone = new Map<string, ExtractedMessage[]>();
  for (const msg of uniqueMessages) {
    if (!groupedByPhone.has(msg.phoneNumber)) {
      groupedByPhone.set(msg.phoneNumber, []);
    }
    groupedByPhone.get(msg.phoneNumber)!.push(msg);
  }

  console.log("\n--- EXTRACTION REPORT BY TARGET ---");
  for (const conv of TARGET_CONVERSATIONS) {
    const list = groupedByPhone.get(conv.phone) || [];
    console.log(`* Phone ${conv.phone}: Found ${list.length} messages in events.`);
  }

  // Check which messages do not exist in the messages table
  const messagesToInsert: ExtractedMessage[] = [];
  let duplicateCount = 0;

  if (uniqueMessages.length > 0) {
    const providerIds = uniqueMessages.map(m => m.id);
    const existing = await sql`
      SELECT provider_message_id FROM messages
      WHERE tenant_id = ${TENANT_ID} AND provider_message_id = ANY(${providerIds})
    `;
    const existingSet = new Set(existing.map(r => r.provider_message_id));
    
    for (const msg of uniqueMessages) {
      if (existingSet.has(msg.id)) {
        duplicateCount++;
      } else {
        messagesToInsert.push(msg);
      }
    }
  }

  console.log(`\nDuplicate check against DB:`);
  console.log(`- Already in DB: ${duplicateCount}`);
  console.log(`- New messages to backfill: ${messagesToInsert.length}`);

  if (isDryRun) {
    console.log("\n--- DRY-RUN MESSAGE LIST PREVIEW ---");
    for (const msg of messagesToInsert) {
      console.log(`  [DRY-RUN] To Insert: ID=${msg.id} | Phone=${msg.phoneNumber} | Direction=${msg.direction} | Time=${msg.timestamp.toISOString()} | Content="${msg.content.substring(0, 50)}"`);
    }
    console.log("\nDry-run complete. No database writes were performed.");
    console.log("To execute the live backfill, run this script with the --commit flag.");
    process.exit(0);
  }

  // 4. Live Write Execution
  console.log("\n--- LIVE WRITE: INSERTING MESSAGES ---");
  const insertedList: Array<{ id: string; providerId: string; phone: string }> = [];

  for (const msg of messagesToInsert) {
    const conv = TARGET_CONVERSATIONS.find(tc => tc.phone === msg.phoneNumber)!;
    
    const res = await sql`
      INSERT INTO messages (
        tenant_id, conversation_id, phone_number, direction, content, channel,
        channel_id, provider_message_id, model_used, status,
        media_type, media_metadata, provider_timestamp, prompt_tokens, completion_tokens
      )
      SELECT
        ${TENANT_ID}, ${conv.id}, ${msg.phoneNumber}, ${msg.direction}, ${msg.content}, 'whatsapp',
        ${CHANNEL_ID}, ${msg.id}, null, ${msg.direction === 'out' ? 'sent' : 'delivered'},
        ${msg.mediaType}, ${msg.mediaMetadata ? JSON.stringify(msg.mediaMetadata) : null}::jsonb,
        ${msg.timestamp}::timestamptz,
        0, 0
      WHERE NOT EXISTS (
        SELECT 1 FROM messages WHERE tenant_id = ${TENANT_ID} AND provider_message_id = ${msg.id}
      )
      RETURNING id
    `;

    if (res.length > 0) {
      insertedList.push({ id: res[0].id, providerId: msg.id, phone: msg.phoneNumber });
      console.log(`  [INSERTED] Message id=${res[0].id} | provider_id=${msg.id}`);
    } else {
      console.log(`  [SKIPPED/EXISTS] Message provider_id=${msg.id}`);
    }
  }

  // 5. Sync Conversations counters
  console.log("\n--- LIVE WRITE: SYNCING CONVERSATIONS METADATA ---");
  for (const conv of TARGET_CONVERSATIONS) {
    // Get actual count and latest message details
    const stats = await sql`
      SELECT
        COUNT(*)::int as real_count,
        MAX(provider_timestamp) as last_time
      FROM messages
      WHERE conversation_id = ${conv.id} AND tenant_id = ${TENANT_ID}
    `;

    const realCount = stats[0].real_count;
    const lastTime = stats[0].last_time;

    if (realCount > 0) {
      // Find the last message row content and direction
      const lastMsgRow = await sql`
        SELECT content, direction
        FROM messages
        WHERE conversation_id = ${conv.id} AND tenant_id = ${TENANT_ID}
        ORDER BY provider_timestamp DESC, created_at DESC
        LIMIT 1
      `;
      const lastContent = lastMsgRow[0].content;
      const lastDir = lastMsgRow[0].direction;

      await sql`
        UPDATE conversations
        SET
          message_count = ${realCount},
          last_message_at = ${lastTime}::timestamptz,
          last_message_content = ${lastContent},
          last_message_direction = ${lastDir},
          history_imported_at = COALESCE(history_imported_at, NOW())
        WHERE id = ${conv.id} AND tenant_id = ${TENANT_ID}
      `;
      console.log(`  [UPDATED] Conversation ${conv.phone}: message_count=${realCount}, last_message="${lastContent.substring(0, 30)}", last_at=${lastTime}`);
    } else {
      // No messages in DB, set to 0 and empty metadata
      await sql`
        UPDATE conversations
        SET
          message_count = 0,
          last_message_at = null,
          last_message_content = null,
          last_message_direction = null
        WHERE id = ${conv.id} AND tenant_id = ${TENANT_ID}
      `;
      console.log(`  [CLEARED/RESET] Conversation ${conv.phone}: message_count=0, empty last message metadata.`);
    }
  }

  // 6. Post-execution report
  console.log("\n==========================================================");
  console.log("  POST-BACKFILL FINAL REPORT");
  console.log("==========================================================");
  console.log(`1. Messages Inserted: ${insertedList.length}`);
  console.log(`2. Duplicates Skipped: ${duplicateCount}`);
  console.log(`3. Affected Conversations: ${TARGET_CONVERSATIONS.length}`);

  // Rollback queries
  if (insertedList.length > 0) {
    const insertedIds = insertedList.map(r => `'${r.id}'`).join(', ');
    const insertedProviderIds = insertedList.map(r => `'${r.providerId}'`).join(', ');
    
    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║  ROLLBACK SQL QUERY                      ║");
    console.log("╚══════════════════════════════════════════╝");
    console.log(`DELETE FROM messages WHERE id IN (${insertedIds}) AND tenant_id = '${TENANT_ID}';`);
    console.log(`-- Verify deletion:`);
    console.log(`SELECT COUNT(*) FROM messages WHERE provider_message_id IN (${insertedProviderIds}) AND tenant_id = '${TENANT_ID}';`);
  }
}

run().catch(err => {
  console.error("❌ FATAL ERROR IN REPAIR RUN:", err);
  process.exit(1);
});
