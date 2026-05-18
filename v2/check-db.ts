import { neon } from "@neondatabase/serverless";
require('dotenv').config({ path: '.env.local' });
async function main() {
  const sql = neon(process.env.DATABASE_URL || "");
  try {
    const res = await sql`SELECT count(*) FROM conversations`;
    console.log("Conversations:", res);
    const res2 = await sql`SELECT count(*) FROM messages`;
    console.log("Messages:", res2);
  } catch(e) {
    console.error("DB Error:", e);
  }
}
main();
