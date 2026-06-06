const { neon } = require("@neondatabase/serverless");
const dotenv = require("dotenv");

dotenv.config({ path: "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local" });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const sql = neon(appDatabaseUrl);
  
  const conversationId = 'e8925d2f-b5dc-40ff-8c6b-d68b21ceb9f7';
  
  // Set lead created_at back to 13 hours ago
  const updated = await sql`
    UPDATE leads
    SET created_at = NOW() - INTERVAL '13 hour'
    WHERE phone_number = '+905555555599'
    RETURNING id, created_at;
  `;
  console.log("Restored leads:", updated);
}
main().catch(console.error);
