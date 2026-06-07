import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("=========================================");
  console.log("🧪 Running Backfill Dry-Run");
  console.log("=========================================");

  const dlq = await db.executeSafe({
    text: `
      SELECT 
        id, 
        topic, 
        payload::text as raw_payload,
        created_at
      FROM dead_letter_jobs 
      WHERE created_at > '2026-06-06T00:00:00Z'
      ORDER BY created_at ASC
    `,
    values: []
  }) as any[];

  console.log(`Analyzing ${dlq.length} unresolved dead letter jobs...`);
  
  let fetiCount = 0;
  let otherCount = 0;
  const plan: any[] = [];

  for (const job of dlq) {
    try {
      const parsed = JSON.parse(job.raw_payload);
      const entry = parsed.payload?.entry?.[0] || parsed.entry?.[0];
      const val = entry?.changes?.[0]?.value;
      const msg = val?.messages?.[0] || val?.message_echoes?.[0];
      
      const phone = val?.contacts?.[0]?.wa_id || msg?.from;
      const isFeti = phone === '77086223402';
      
      if (isFeti) fetiCount++;
      else otherCount++;

      // Find if conversation exists
      const conv = await db.executeSafe({
        text: `SELECT id, phone_number, patient_name, status, lead_stage FROM conversations WHERE phone_number = $1 AND tenant_id = $2`,
        values: [phone, TENANT_ID]
      }) as any[];

      plan.push({
        jobId: job.id,
        phone,
        isFeti,
        messageId: msg?.id,
        content: msg?.text?.body || msg?.content || `[${msg?.type || "unknown"}]`,
        created_at: job.created_at,
        conversationExists: conv.length > 0,
        conversationId: conv[0]?.id || "needs_creation",
        patientName: conv[0]?.patient_name || val?.contacts?.[0]?.profile?.name || "Unknown",
        direction: 'in'
      });
    } catch (err: any) {
      console.log(`Failed to parse job ${job.id}:`, err.message);
    }
  }

  console.log("\n--- DRY RUN REPORT ---");
  console.log(`Total messages to backfill: ${plan.length}`);
  console.log(`  - Feti Ereci messages: ${fetiCount}`);
  console.log(`  - Other patients messages: ${otherCount}`);
  
  console.log("\nDetails of planned inserts:");
  plan.forEach((p, idx) => {
    console.log(`\n[${idx + 1}] Patient: "${p.patientName}" (${p.phone})`);
    console.log(`    Message ID: ${p.messageId}`);
    console.log(`    Content: "${p.content}"`);
    console.log(`    Conversation ID: ${p.conversationId} (Exists: ${p.conversationExists})`);
    console.log(`    Will trigger AI: no`);
    console.log(`    Will trigger notification: no`);
    console.log(`    Will trigger task: no`);
  });

  process.exit(0);
}

run().catch(console.error);
