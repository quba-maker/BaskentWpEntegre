require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  try {
    const cols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'tenants'
    `;
    console.log("Tenants columns:", JSON.stringify(cols, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
