require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function run() {
  console.log("--- Injecting Lead for E2E Kalite Test Fırsatı ---");
  const sql = neon(process.env.DATABASE_URL);

  const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
  const phone = "+905555555599";

  // Delete any existing leads for this phone
  await sql`DELETE FROM leads WHERE tenant_id = ${TENANT_ID} AND phone_number = ${phone}`;
  // Delete any messages for this conversation to prevent hard blocking
  // Find conversation ID first
  const convs = await sql`SELECT id FROM conversations WHERE tenant_id = ${TENANT_ID} AND patient_name = 'E2E Kalite Test Fırsatı'`;
  if (convs.length > 0) {
    const convId = convs[0].id;
    await sql`DELETE FROM messages WHERE tenant_id = ${TENANT_ID} AND conversation_id = ${convId}`;
    console.log("Deleted messages for conversation:", convId);
  }

  // Insert lead
  const res = await sql`
    INSERT INTO leads (
      tenant_id, phone_number, patient_name, form_name, country, raw_data, created_at
    ) VALUES (
      ${TENANT_ID}, ${phone}, 'E2E Kalite Test Fırsatı', 'Contact Form', 'TR', '{"language": "tr", "department": "Obezite"}', NOW() - INTERVAL '10 hours'
    ) RETURNING id
  `;
  console.log("✅ Injected lead successfully, ID:", res[0].id);
}
run();
