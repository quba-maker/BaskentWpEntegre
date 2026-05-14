require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function test() {
  const sql = neon(process.env.DATABASE_URL);
  try {
    const q = sql`SELECT 5 as num`;
    const res = await sql.transaction([
      sql`SET LOCAL quba.is_admin = 'true'`,
      q
    ]);
    console.log("Transaction result:", JSON.stringify(res, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
