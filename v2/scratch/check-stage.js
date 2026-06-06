const { neon } = require("@neondatabase/serverless");
const dotenv = require("dotenv");

dotenv.config({ path: "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local" });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const sql = neon(appDatabaseUrl);
  
  const conversationId = 'e8925d2f-b5dc-40ff-8c6b-d68b21ceb9f7';
  
  const conv = await sql`
    SELECT id, lead_stage, active_opportunity_id
    FROM conversations
    WHERE id = ${conversationId};
  `;
  console.log("CONVERSATION STAGE:");
  console.log(conv);
  
  if (conv[0] && conv[0].active_opportunity_id) {
    const opp = await sql`
      SELECT id, stage
      FROM opportunities
      WHERE id = ${conv[0].active_opportunity_id};
    `;
    console.log("OPPORTUNITY STAGE:");
    console.log(opp);
  }
}
main().catch(console.error);
