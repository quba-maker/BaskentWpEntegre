require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function test() {
  const sql = neon(process.env.DATABASE_URL);
  
  try {
    const q = sql.query('SELECT $1::int as num', [5]);
    console.log("q is:", typeof q, q);
    // Is it executable in transaction?
    const res = await sql.transaction([ sql`SELECT 1 as id`, q ]);
    console.log("Transaction res length:", res.length);
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
