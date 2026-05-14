require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function test() {
  const sql = neon(process.env.DATABASE_URL);
  
  try {
    const res = await sql.transaction([ 
      sql`SELECT 1 as num`,
      sql`SELECT 2 as num`
    ]);
    console.log("Success length:", res.length);
    console.log("res[0]:", Array.isArray(res[0]) ? 'Array' : typeof res[0], JSON.stringify(res[0]));
    console.log("res[1]:", Array.isArray(res[1]) ? 'Array' : typeof res[1], JSON.stringify(res[1]));
  } catch (e) {
    console.error("Error:", e.message);
  }
}

test();
