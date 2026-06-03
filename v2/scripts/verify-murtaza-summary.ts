import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "../.env.local") });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  if (!appDatabaseUrl) {
    console.error("No database URL found in env.");
    process.exit(1);
  }
  const sql = neon(appDatabaseUrl);
  const targetPhone = "3306"; // Murtaza's phone suffix

  console.log("=== OPPORTUNITIES ===");
  const opportunities = await sql`
    SELECT id, conversation_id, patient_name, phone_number, stage, priority, intent_type, summary, ai_reason, created_at, metadata
    FROM opportunities
    WHERE phone_number LIKE ${'%' + targetPhone + '%'}
    ORDER BY created_at DESC
  `;
  opportunities.forEach(o => {
    console.log(`\n- ID: ${o.id}\n  Stage: ${o.stage}\n  Priority: ${o.priority}\n  Intent: ${o.intent_type}\n  Name: ${o.patient_name}\n  Summary: ${o.summary}\n  AiReason: ${o.ai_reason}\n  Metadata: ${JSON.stringify(o.metadata)}`);
  });

  console.log("\n=== CONVERSATIONS ===");
  const conversations = await sql`
    SELECT id, phone_number, patient_name, lead_stage, active_opportunity_id, notes
    FROM conversations
    WHERE phone_number LIKE ${'%' + targetPhone + '%'}
    ORDER BY created_at DESC
  `;
  conversations.forEach(c => {
    console.log(`\n- ID: ${c.id}\n  Phone: ${c.phone_number}\n  Name: ${c.patient_name}\n  Stage: ${c.lead_stage}\n  ActiveOppID: ${c.active_opportunity_id}\n  Notes: ${c.notes}`);
  });
}

main().catch(console.error);
