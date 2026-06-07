import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  
  const db = withTenantDB(TENANT_ID, true);

  console.log("=========================================");
  console.log("🚀 Executing Inbox Inbound Sync Backfill (Safe Version)");
  console.log("=========================================");

  // 1. Fetch unresolved DLQ jobs
  const dlq = await db.executeSafe({
    text: `
      SELECT 
        id, 
        topic, 
        payload::text as raw_payload,
        created_at
      FROM dead_letter_jobs 
      WHERE created_at > '2026-06-06T00:00:00Z'
        AND status = 'unresolved'
      ORDER BY created_at ASC
    `,
    values: []
  }) as any[];

  console.log(`Found ${dlq.length} unresolved jobs to process.`);

  let insertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const job of dlq) {
    try {
      const parsed = JSON.parse(job.raw_payload);
      
      const entry = parsed.payload?.entry?.[0] || parsed.entry?.[0];
      const change = entry?.changes?.[0];
      const val = change?.value;
      const incomingMsg = val?.messages?.[0] || val?.message_echoes?.[0];

      if (!incomingMsg) {
        console.log(`[Job ${job.id}] ❌ No message object found in payload. Skipping.`);
        skippedCount++;
        continue;
      }

      const phoneNumber = val?.contacts?.[0]?.wa_id || incomingMsg.from || '';
      const providerMessageId = incomingMsg.id || '';
      const providerTimestamp = incomingMsg.timestamp ? parseInt(incomingMsg.timestamp, 10) : undefined;
      const msgType = incomingMsg.type || 'text';
      
      let content = '';
      let mediaType: string | null = null;
      let mediaUrl: string | null = null;
      let mediaMetadata: any = null;

      const native: any = {
        provider: '360dialog',
        message_type: msgType,
      };

      const profileName = val?.contacts?.[0]?.profile?.name;
      if (profileName) {
        native.whatsapp_profile_name = profileName;
      }

      if (incomingMsg.context?.id) {
        native.reply_to_provider_message_id = incomingMsg.context.id;
      }

      switch (msgType) {
        case 'text':
          content = incomingMsg.text?.body || '';
          break;
        case 'image':
          mediaType = 'image';
          content = incomingMsg.image?.caption || '';
          mediaMetadata = { mime_type: incomingMsg.image?.mime_type, caption: content };
          break;
        case 'document':
          mediaType = 'document';
          content = incomingMsg.document?.caption || '';
          mediaMetadata = { mime_type: incomingMsg.document?.mime_type, filename: incomingMsg.document?.filename };
          break;
        case 'audio':
          mediaType = 'audio';
          mediaMetadata = { mime_type: incomingMsg.audio?.mime_type };
          content = '';
          break;
        case 'video':
          mediaType = 'video';
          content = incomingMsg.video?.caption || '';
          mediaMetadata = { mime_type: incomingMsg.video?.mime_type, caption: content };
          break;
        case 'location':
          mediaType = 'location';
          mediaMetadata = { latitude: incomingMsg.location?.latitude, longitude: incomingMsg.location?.longitude, name: incomingMsg.location?.name };
          content = incomingMsg.location?.name || '';
          break;
        case 'sticker':
          mediaType = 'sticker';
          mediaMetadata = { mime_type: 'image/webp' };
          content = '';
          break;
        case 'reaction':
          content = incomingMsg.reaction?.emoji || '👍';
          native.reaction_payload = incomingMsg.reaction;
          break;
        default:
          content = incomingMsg.text?.body || '';
          break;
      }

      if (!mediaMetadata) mediaMetadata = {};
      mediaMetadata.native = native;

      const direction = msgType === 'reaction' ? 'system' : 'in';

      console.log(`\nProcessing Job ${job.id}:`);
      console.log(`  Phone: ${phoneNumber} | Type: ${msgType} | Content: "${content}"`);
      console.log(`  Provider Msg ID: ${providerMessageId}`);

      // 1. Duplicate check (idempotency)
      const dupCheck = await db.executeSafe({
        text: `SELECT id FROM messages WHERE tenant_id = $1 AND provider_message_id = $2 LIMIT 1`,
        values: [TENANT_ID, providerMessageId]
      }) as any[];

      if (dupCheck.length > 0) {
        console.log(`  ⚠️ Duplicate detected in messages table. Skipping message insert.`);
        skippedCount++;
        // Still mark the job as resolved since it's already in the DB
        await db.executeSafe({
          text: `UPDATE dead_letter_jobs SET status = 'resolved' WHERE id = $1`,
          values: [job.id]
        });
        console.log(`  ✅ Marked DLQ job ${job.id} as resolved (duplicate).`);
        continue;
      }

      // 2. Target conversation check
      const convCheck = await db.executeSafe({
        text: `SELECT id, phone_number, last_message_at, message_count FROM conversations WHERE phone_number = $1 AND tenant_id = $2 LIMIT 1`,
        values: [phoneNumber, TENANT_ID]
      }) as any[];

      if (convCheck.length === 0) {
        console.log(`  ❌ No conversation found for phone ${phoneNumber}. Skipping job ${job.id}.`);
        errorCount++;
        continue;
      }

      const conversationId = convCheck[0].id;

      // Convert providerTimestamp (seconds) to Date
      const timestampDate = providerTimestamp ? new Date(providerTimestamp * 1000) : new Date();

      // 3. Insert the message
      const insertRes = await db.executeSafe({
        text: `
          INSERT INTO messages (
            tenant_id, conversation_id, phone_number, direction, content, channel, 
            channel_id, group_id, provider_message_id, media_type, media_url, media_metadata, provider_timestamp, status
          ) VALUES ($1, $2, $3, $4, $5, 'whatsapp', $6, $7, $8, $9, $10, $11, $12, 'delivered')
          RETURNING id
        `,
        values: [
          TENANT_ID,
          conversationId,
          phoneNumber,
          direction,
          content,
          parsed.channelId || null,
          parsed.groupId || null,
          providerMessageId,
          mediaType,
          mediaUrl,
          mediaMetadata ? JSON.stringify(mediaMetadata) : null,
          timestampDate
        ]
      }) as any[];

      const messageId = insertRes[0].id;
      console.log(`  ✅ Inserted message ID: ${messageId} into conversation: ${conversationId}`);

      // 4. Query the absolute latest non-system message for this conversation
      const latestMsg = await db.executeSafe({
        text: `
          SELECT 
            content,
            direction,
            COALESCE(provider_timestamp, created_at) as msg_at,
            status,
            channel,
            channel_id,
            model_used
          FROM messages
          WHERE conversation_id = $1 
            AND tenant_id = $2
            AND direction != 'system'
          ORDER BY COALESCE(provider_timestamp, created_at) DESC
          LIMIT 1
        `,
        values: [conversationId, TENANT_ID]
      }) as any[];

      // 5. Update the conversation fields
      if (latestMsg.length > 0) {
        const latest = latestMsg[0];
        await db.executeSafe({
          text: `
            UPDATE conversations
            SET 
              last_message_content = $3,
              last_message_direction = $4,
              last_message_at = $5,
              last_message_status = $6,
              channel = $7,
              channel_id = COALESCE($8, channel_id),
              last_channel = CASE WHEN $4 = 'in' THEN $7 ELSE last_channel END,
              last_message_model = $9,
              message_count = (
                SELECT COUNT(*) 
                FROM messages 
                WHERE conversation_id = $1 
                  AND tenant_id = $2
                  AND direction != 'system'
              )
            WHERE id = $1 AND tenant_id = $2
          `,
          values: [
            conversationId,            // $1
            TENANT_ID,                 // $2
            latest.content,            // $3
            latest.direction,          // $4
            latest.msg_at,             // $5
            latest.status,             // $6
            latest.channel,            // $7
            latest.channel_id || null, // $8
            latest.model_used || null  // $9
          ]
        });
        console.log(`  ✅ Updated conversation last_message to reflect: direction='${latest.direction}', content='${latest.content.substring(0, 30)}...'`);
      } else {
        // Fallback: update message count anyway
        await db.executeSafe({
          text: `
            UPDATE conversations
            SET 
              message_count = (
                SELECT COUNT(*) 
                FROM messages 
                WHERE conversation_id = $1 
                  AND tenant_id = $2
                  AND direction != 'system'
              )
            WHERE id = $1 AND tenant_id = $2
          `,
          values: [conversationId, TENANT_ID]
        });
      }

      // 6. Mark DLQ job as resolved
      await db.executeSafe({
        text: `UPDATE dead_letter_jobs SET status = 'resolved' WHERE id = $1`,
        values: [job.id]
      });
      console.log(`  ✅ Marked DLQ job ${job.id} as resolved.`);
      insertedCount++;

    } catch (err: any) {
      console.error(`  ❌ Failed to process Job ${job.id}:`, err.message);
      errorCount++;
    }
  }

  console.log("\n=========================================");
  console.log("📊 Final Backfill Result:");
  console.log(`  - Total processed: ${dlq.length}`);
  console.log(`  - Successfully inserted: ${insertedCount}`);
  console.log(`  - Skipped/Duplicate: ${skippedCount}`);
  console.log(`  - Errors: ${errorCount}`);
  console.log("=========================================");

  process.exit(0);
}

run().catch(console.error);
