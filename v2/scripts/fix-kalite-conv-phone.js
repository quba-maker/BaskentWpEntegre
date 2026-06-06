require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function run() {
  console.log("--- Fixing E2E Kalite Test Fırsatı Conversation Phone & Opportunity ---");
  const sql = neon(process.env.DATABASE_URL);

  const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
  const phone = "+905555555599";

  // Find opportunity ID
  const opps = await sql`SELECT id FROM opportunities WHERE tenant_id = ${TENANT_ID} AND phone_number = ${phone} LIMIT 1`;
  if (opps.length === 0) {
    console.error("Opportunity not found!");
    return;
  }
  const oppId = opps[0].id;

  // Update conversation
  await sql`
    UPDATE conversations 
    SET phone_number = ${phone},
        real_phone = ${phone},
        active_opportunity_id = ${oppId},
        last_message_content = 'Facebook Formu dolduruldu.',
        last_message_direction = 'in',
        last_message_at = NOW()
    WHERE tenant_id = ${TENANT_ID} AND patient_name = 'E2E Kalite Test Fırsatı'
  `;
  console.log("✅ Conversation successfully updated with phone and active opportunity!");
}
run();
