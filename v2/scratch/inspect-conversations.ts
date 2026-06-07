import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  const phoneNumbers = ["491749749926", "31634003536", "22792184752", "998959838180", "77086223402"];

  for (const phone of phoneNumbers) {
    console.log(`\n=========================================`);
    console.log(`Checking conversation for phone: ${phone}`);
    console.log(`=========================================`);

    const convs = await db.executeSafe({
      text: `SELECT id, patient_name, phone_number, last_message_at, last_message_direction, last_message_content, message_count FROM conversations WHERE phone_number = $1 AND tenant_id = $2`,
      values: [phone, TENANT_ID]
    }) as any[];

    if (convs.length === 0) {
      console.log("No conversation found in DB.");
      continue;
    }

    const c = convs[0];
    console.log(`Conversation ID: ${c.id}`);
    console.log(`Patient Name: ${c.patient_name}`);
    console.log(`Message Count: ${c.message_count}`);
    console.log(`Current Last Message At: ${c.last_message_at}`);
    console.log(`Current Last Message Dir: ${c.last_message_direction}`);
    console.log(`Current Last Message Content: "${c.last_message_content}"`);

    const msgs = await db.executeSafe({
      text: `SELECT id, direction, content, created_at, provider_timestamp, provider_message_id FROM messages WHERE conversation_id = $1 AND tenant_id = $2 ORDER BY COALESCE(provider_timestamp, created_at) ASC`,
      values: [c.id, TENANT_ID]
    }) as any[];

    console.log(`Existing Messages count: ${msgs.length}`);
    msgs.forEach((m, i) => {
      console.log(`  [${i + 1}] Dir: ${m.direction} | At: ${m.provider_timestamp || m.created_at} | Content: "${m.content.substring(0, 60)}" | MsgId: ${m.provider_message_id}`);
    });
  }

  process.exit(0);
}

run().catch(console.error);
