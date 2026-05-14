require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function test() {
  const sql = neon(process.env.DATABASE_URL);
  
  // Tagged template
  const q1 = sql`SELECT 1 as num`;
  
  // Tuple
  const q2 = ['SELECT $1::int as num', [2]];
  
  try {
    const res = await sql.transaction([ q1, q2 ]);
    console.log("Txn result length:", res.length);
    console.log("Result 0 (tagged template):", JSON.stringify(res[0]));
    console.log("Result 1 (tuple):", JSON.stringify(res[1]));
  } catch (e) {
    console.error(e);
  }
}

test();
