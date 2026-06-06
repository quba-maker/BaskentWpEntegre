require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  try {
    const rows = await sql`
      SELECT id, tenant_id, name, variables, body
      FROM message_templates
      WHERE tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
    `;
    console.log("Başkent Templates variables:");
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
