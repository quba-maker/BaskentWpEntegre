const { neon } = require("@neondatabase/serverless");
const dotenv = require("dotenv");

dotenv.config({ path: "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local" });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const sql = neon(appDatabaseUrl);
  
  const conversationId = 'e8925d2f-b5dc-40ff-8c6b-d68b21ceb9f7';
  
  const deletedLogs = await sql`
    DELETE FROM outreach_logs
    WHERE conversation_id = ${conversationId}
    RETURNING id, action;
  `;
  console.log("Deleted outreach logs:", deletedLogs);
}
main().catch(console.error);
