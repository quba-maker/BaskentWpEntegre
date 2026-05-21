require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  try {
    const leadsCols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'leads'
    `;
    console.log("Leads columns:", JSON.stringify(leadsCols, null, 2));

    const cpCols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'customer_profiles'
    `;
    console.log("Customer profiles columns:", JSON.stringify(cpCols, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
