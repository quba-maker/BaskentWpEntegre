require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function test() {
  const sql = neon(process.env.DATABASE_URL);
  
  try {
    const res = await sql.transaction([ 
      sql`SELECT 1`,
      "SELECT 2 as num"
    ]);
    console.log("Success:", res);
  } catch (e) {
    console.error("Error:", e.message);
  }
}

test();
