require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function test() {
  const sql = neon(process.env.DATABASE_URL);
  
  try {
    const res = await sql.transaction(tx => {
      console.log("tx type:", typeof tx);
      console.log("tx keys:", Object.keys(tx));
      return [
        tx`SELECT 1 as num`,
        tx`SELECT 2 as num`
      ];
    });
    console.log("Success length:", res.length);
    console.log("res[0]:", res[0]);
    console.log("res[1]:", res[1]);
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
