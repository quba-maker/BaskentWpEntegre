import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("=========================================");
  console.log("🔍 Querying Recent dead_letter_jobs");
  console.log("=========================================");

  const dlq = await db.executeSafe({
    text: `
      SELECT 
        id, 
        topic, 
        error_message, 
        created_at,
        payload::text as raw_payload
      FROM dead_letter_jobs 
      WHERE created_at > '2026-06-06T00:00:00Z'
      ORDER BY created_at DESC
    `,
    values: []
  }) as any[];

  console.log(`Found ${dlq.length} dead lettered jobs since June 6:`);
  dlq.forEach((job, idx) => {
    console.log(`\n--- Job [${idx + 1}] ---`);
    console.log(`ID: ${job.id}`);
    console.log(`Topic: ${job.topic}`);
    console.log(`Created At: ${job.created_at}`);
    console.log(`Error: ${job.error_message}`);
    
    // Extract recipient/sender information and message text if possible
    try {
      const parsed = JSON.parse(job.raw_payload);
      const entry = parsed.payload?.entry?.[0] || parsed.entry?.[0];
      const change = entry?.changes?.[0];
      const val = change?.value;
      const msg = val?.messages?.[0] || val?.message_echoes?.[0];
      
      console.log(`Sender: ${val?.contacts?.[0]?.wa_id || msg?.from}`);
      console.log(`Message ID: ${msg?.id}`);
      console.log(`Content Preview: ${msg?.text?.body || msg?.content || msg?.type || "No text"}`);
    } catch (err: any) {
      console.log("Could not parse payload:", err.message);
    }
  });

  process.exit(0);
}

run().catch(console.error);
