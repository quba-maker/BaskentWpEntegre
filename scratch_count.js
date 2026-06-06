const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ path: ".env.local" });

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  
  // 1. direction='out' message count
  const outMessages = await sql`
    SELECT COUNT(*) as count FROM messages WHERE direction = 'out'
  `;
  console.log("OUT_MESSAGES_COUNT:", outMessages[0].count);

  // 2. direction='in' message count
  const inMessages = await sql`
    SELECT COUNT(*) as count FROM messages WHERE direction = 'in'
  `;
  console.log("IN_MESSAGES_COUNT:", inMessages[0].count);

  // 3. outreach_logs count for check
  const outreachLogs = await sql`
    SELECT COUNT(*) as count FROM outreach_logs
  `;
  console.log("OUTREACH_LOGS_COUNT:", outreachLogs[0].count);
}

run().catch(console.error);
