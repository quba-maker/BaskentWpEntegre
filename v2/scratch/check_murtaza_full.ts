import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../.env.local") });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  if (!appDatabaseUrl) {
    console.error("No database URL found in env.");
    process.exit(1);
  }
  const sql = neon(appDatabaseUrl);
  const targetPhone = "3306";

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

  console.log("\n=== FOLLOW UP TASKS ===");
  const tasks = await sql`
    SELECT id, opportunity_id, phone_number, task_type, title, status, due_at, created_at, metadata
    FROM follow_up_tasks
    WHERE phone_number LIKE ${'%' + targetPhone + '%'}
    ORDER BY created_at DESC
  `;
  tasks.forEach(t => {
    console.log(`\n- ID: ${t.id}\n  OppID: ${t.opportunity_id}\n  Type: ${t.task_type}\n  Title: ${t.title}\n  Status: ${t.status}\n  Due: ${t.due_at}\n  Metadata: ${JSON.stringify(t.metadata)}`);
  });
}

main().catch(console.error);
