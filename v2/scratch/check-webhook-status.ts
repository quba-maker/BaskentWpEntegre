import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("=========================================");
  console.log("🔍 Checking webhook_events for Feti Ereci");
  console.log("=========================================");

  const messageIds = [
    "wamid.HBgLNzcwODYyMjM0MDIVAgASGCBBQzc0QzA5MUEwQTM1NzVGMjAyNzg3Q0VDOTA1RTc0NQA=", // Event 31 (Inbound text 1)
    "wamid.HBgLNzcwODYyMjM0MDIVAgASGCBBQzgwQ0UyOUY0NzFEMjEyNkM1Q0Y0RjNDRDgyNUIwOAA=", // Event 36 (Inbound text 2)
    "wamid.HBgLNzcwODYyMjM0MDIVAgARGBQyQTEzNTZEMjRCN0Q4NDQxOEYxMgA=", // Event 33 (Echo 1)
    "wamid.HBgLNzcwODYyMjM0MDIVAgARGBQyQTdBMkE0QjFGRUQzNTVDRjgwNwA="  // Event 37 (Reaction/Echo)
  ];

  for (const mid of messageIds) {
    const res = await db.executeSafe({
      text: `SELECT * FROM webhook_events WHERE provider_message_id = $1 AND tenant_id = $2`,
      values: [mid, TENANT_ID]
    }) as any[];
    console.log(`\nID: ${mid}`);
    if (res.length > 0) {
      console.dir(res[0]);
    } else {
      console.log("❌ Not found in webhook_events");
    }
  }

  // Also query webhook_events by sender_id to see all events for this sender
  console.log("\n--- All events for sender 77086223402 ---");
  const allForSender = await db.executeSafe({
    text: `SELECT * FROM webhook_events WHERE sender_id = '77086223402' AND tenant_id = $1 ORDER BY event_timestamp ASC`,
    values: [TENANT_ID]
  }) as any[];
  console.dir(allForSender);

  process.exit(0);
}

run().catch(console.error);
