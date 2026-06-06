const { neon } = require("@neondatabase/serverless");
const dotenv = require("dotenv");

dotenv.config({ path: "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local" });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const sql = neon(appDatabaseUrl);
  
  const conversationId = 'e8925d2f-b5dc-40ff-8c6b-d68b21ceb9f7';
  
  const logs = await sql`
    SELECT id, action, channel, actor_id, metadata, created_at
    FROM outreach_logs
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at DESC;
  `;
  console.log("OUTREACH LOGS FOR CONVERSATION:", conversationId);
  console.log(logs);
}
main().catch(console.error);
