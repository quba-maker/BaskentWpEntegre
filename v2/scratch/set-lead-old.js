const { neon } = require("@neondatabase/serverless");
const dotenv = require("dotenv");

dotenv.config({ path: "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local" });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const sql = neon(appDatabaseUrl);
  
  const conversationId = 'e8925d2f-b5dc-40ff-8c6b-d68b21ceb9f7';
  
  // Clear any existing outreach logs first so it checks eligibility cleanly
  await sql`
    DELETE FROM outreach_logs
    WHERE conversation_id = ${conversationId};
  `;
  
  // Update the lead's created_at to 5 days ago
  const updated = await sql`
    UPDATE leads
    SET created_at = NOW() - INTERVAL '5 day'
    WHERE phone_number = '+905555555599'
    RETURNING id, created_at;
  `;
  console.log("Updated leads:", updated);
}
main().catch(console.error);
