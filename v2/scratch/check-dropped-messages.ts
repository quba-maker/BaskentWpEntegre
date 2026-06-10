import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("==================================================");
  console.log("🔍 Checking for Dropped Webhook Messages (Last 7 Days)");
  console.log("==================================================");

  // 1. Fetch channel_events from the last 7 days
  const events = await db.executeSafe({
    text: `
      SELECT id, event_type, created_at, payload 
      FROM channel_events 
      WHERE created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
    `
  }) as any[];

  console.log(`Found ${events.length} channel events in the last 7 days.`);

  let parsedCount = 0;
  let missingCount = 0;

  for (const event of events) {
    const payload = event.payload;
    if (!payload) continue;

    // Extract messages and status list from payload
    let messagesList: any[] = [];
    let contactsList: any[] = [];

    if (payload.messages?.[0]) {
      messagesList = payload.messages;
      contactsList = payload.contacts || [];
    } else if (payload.entry?.[0]?.changes?.[0]?.value) {
      const value = payload.entry[0].changes[0].value;
      contactsList = value.contacts || [];
      if (value.messages?.[0]) {
        messagesList = value.messages;
      } else if (value.message_echoes?.[0]) {
        messagesList = value.message_echoes;
      }
    }

    if (messagesList.length === 0) continue;

    parsedCount++;

    for (const msg of messagesList) {
      const msgId = msg.id;
      const from = msg.from;
      const to = msg.to;
      const timestamp = msg.timestamp;
      const body = msg.text?.body || `[Type: ${msg.type}]`;

      // Check if this message ID exists in the messages table
      const msgMatch = await db.executeSafe({
        text: `SELECT id, direction, created_at, status FROM messages WHERE provider_message_id = $1`,
        values: [msgId]
      }) as any[];

      if (msgMatch.length === 0) {
        missingCount++;
        console.log(`\n❌ [DROPPED MESSAGE FOUND]`);
        console.log(`   Event ID: ${event.id}`);
        console.log(`   Event Created At: ${event.created_at}`);
        console.log(`   Message ID: ${msgId}`);
        console.log(`   From: ${from} | To: ${to}`);
        console.log(`   Content: ${body}`);

        // Check if there is a dead letter job for this message
        const dljMatch = await db.executeSafe({
          text: `SELECT id, status, error_message, created_at FROM dead_letter_jobs WHERE payload::text LIKE $1`,
          values: [`%${msgId}%`]
        }) as any[];

        if (dljMatch.length > 0) {
          console.log(`   ⚠️ Dead Letter Job found! Status: ${dljMatch[0].status}`);
          console.log(`   Error Message: ${dljMatch[0].error_message}`);
        } else {
          console.log(`   ⚠️ No Dead Letter Job found for this message!`);
          
          // Let's check webhook_events table
          const weMatch = await db.executeSafe({
            text: `SELECT id, processed_at, sender_id FROM webhook_events WHERE provider_message_id = $1`,
            values: [msgId]
          }) as any[];
          if (weMatch.length > 0) {
            console.log(`   ℹ️ Webhook Event exists in DB. ID: ${weMatch[0].id}, Processed At: ${weMatch[0].processed_at}`);
          } else {
            console.log(`   ℹ️ No Webhook Event found in DB either! (Blocked before dedupe?)`);
          }
        }
      }
    }
  }

  console.log("\n==================================================");
  console.log(`Analysis Complete.`);
  console.log(`Total webhook payloads with messages parsed: ${parsedCount}`);
  console.log(`Total missing/dropped messages: ${missingCount}`);
  console.log("==================================================");

  process.exit(0);
}

run().catch(console.error);
