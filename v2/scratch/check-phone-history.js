require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  const searchNums = ['905010154242', '5010154242', '+905010154242', '905010154242@c.us'];
  
  try {
    console.log("=== SEARCHING CONVERSATIONS ===");
    const convs = await sql`
      SELECT id, tenant_id, channel_id, phone_number, status, created_at, updated_at
      FROM conversations
      WHERE phone_number = ANY(${searchNums})
    `;
    console.log("Conversations found:", JSON.stringify(convs, null, 2));

    if (convs.length > 0) {
      const convIds = convs.map(c => c.id);
      console.log("\n=== SEARCHING MESSAGES ===");
      const msgs = await sql`
        SELECT id, conversation_id, phone_number, direction, content, status, created_at
        FROM messages
        WHERE conversation_id = ANY(${convIds}) OR phone_number = ANY(${searchNums})
        ORDER BY created_at DESC LIMIT 10
      `;
      console.log("Messages found:", JSON.stringify(msgs, null, 2));
    }

    console.log("\n=== SEARCHING WEBHOOK EVENTS ===");
    const webhookEvents = await sql`
      SELECT id, provider_message_id, sender_id, event_timestamp, processed_at
      FROM webhook_events
      WHERE sender_id = ANY(${searchNums}) OR sender_id LIKE '%5010154242%'
      ORDER BY processed_at DESC LIMIT 10
    `;
    console.log("Webhook events found:", JSON.stringify(webhookEvents, null, 2));

    console.log("\n=== SEARCHING LEADS ===");
    const leads = await sql`
      SELECT id, tenant_id, phone_number, stage, created_at
      FROM leads
      WHERE phone_number = ANY(${searchNums})
    `;
    console.log("Leads found:", JSON.stringify(leads, null, 2));

    console.log("\n=== BLOCKED OR INACTIVE CHANNELS/TENANTS? ===");
    // Let's list active channels and check their identifiers
    const channels = await sql`
      SELECT c.id, c.identifier, c.status, t.slug as tenant_slug, t.status as tenant_status
      FROM channels c
      JOIN channel_groups cg ON c.group_id = cg.id
      JOIN tenants t ON cg.tenant_id = t.id
      WHERE t.id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'
    `;
    console.log("Channels for Başkent:", JSON.stringify(channels, null, 2));

  } catch (e) {
    console.error("Error:", e);
  }
}
run();
