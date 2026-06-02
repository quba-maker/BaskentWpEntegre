const dotenv = require("dotenv");
dotenv.config({ path: "./.env.local" });

const { withTenantDB } = require("../src/lib/core/tenant-db");

async function main() {
  const tenantId = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
  
  const adminDb = withTenantDB(tenantId, true);
  
  console.log("Fetching latest 5 channel_events with channel_id...");
  const events = await adminDb.executeSafe({
    text: `
      SELECT id, channel_id, event_type, created_at, correlation_id, 
             (payload->'entry'->0->'changes'->0->'value'->'messages'->0->>'id') as provider_msg_id,
             payload
      FROM channel_events
      WHERE event_type = '360dialog_webhook_received'
      ORDER BY created_at DESC
      LIMIT 5
    `
  });
  
  for (const event of events) {
    console.log(`Event ID: ${event.id}`);
    console.log(`  Channel ID in DB: ${event.channel_id}`);
    console.log(`  Provider Msg ID: ${event.provider_msg_id}`);
    console.log(`  Trace ID: ${event.correlation_id}`);
    console.log(`  Created At: ${event.created_at}`);
    
    // Check if media exists in webhook payload
    const changes = event.payload?.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    if (msg) {
      console.log(`  Msg Type: ${msg.type}`);
      if (msg[msg.type]) {
        console.log(`  Media Object: ${JSON.stringify(msg[msg.type])}`);
      }
    }
    console.log("-----------------------------------------");
  }
}

main().catch(console.error);

