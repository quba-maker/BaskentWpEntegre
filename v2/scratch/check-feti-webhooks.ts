import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("=========================================");
  console.log("🔍 Checking channel_events for Feti Ereci");
  console.log("=========================================");

  const events = await db.executeSafe({
    text: `
      SELECT id, channel_id, event_type, created_at, correlation_id,
             payload::text as payload_str
      FROM channel_events
      WHERE payload::text LIKE '%77086223402%'
         OR payload::text LIKE '%7086223402%'
         OR payload::text ILIKE '%Hayırlı akşamlar%'
         OR payload::text ILIKE '%Turkiyeye ne zaman%'
         OR payload::text ILIKE '%Teşekkür ederim%'
      ORDER BY created_at ASC
    `,
    values: []
  }) as any[];

  console.log(`Found ${events.length} events matching search criteria:`);
  events.forEach((ev, idx) => {
    console.log(`\n--- Event [${idx + 1}] ---`);
    console.log(`ID: ${ev.id}`);
    console.log(`Channel ID: ${ev.channel_id}`);
    console.log(`Event Type: ${ev.event_type}`);
    console.log(`Created At: ${ev.created_at}`);
    console.log(`Correlation ID: ${ev.correlation_id}`);
    
    // Parse and pretty print the payload
    try {
      const parsed = JSON.parse(ev.payload_str);
      console.dir(parsed, { depth: null });
    } catch {
      console.log(`Payload (raw): ${ev.payload_str}`);
    }
  });

  process.exit(0);
}

run().catch(console.error);
