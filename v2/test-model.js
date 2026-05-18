require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');

async function test() {
  if (!process.env.DATABASE_URL) {
    console.log("No DATABASE_URL found");
    return;
  }
  const sql = neon(process.env.DATABASE_URL);
  try {
    const res = await sql`SELECT model_used FROM messages LIMIT 1`;
    console.log("Success! model_used exists.");
  } catch (e) {
    console.log("Error:", e.message);
  }
}
test();
