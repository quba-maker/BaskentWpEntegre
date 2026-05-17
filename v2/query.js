const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '../.env.local' });
const sql = neon(process.env.DATABASE_URL);
async function run() {
  const tenants = await sql`SELECT id, slug FROM tenants`;
  console.log("Tenants:", tenants);
  const prompts = await sql`SELECT * FROM bot_prompts`;
  console.log("Prompts:", prompts);
  const settings = await sql`SELECT * FROM settings`;
  console.log("Settings:", settings);
}
run().catch(console.error);
