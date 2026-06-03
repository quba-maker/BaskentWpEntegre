import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
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
    SELECT id, conversation_id, patient_name, phone_number, stage, priority, intent_type, created_at, metadata
    FROM opportunities
    WHERE phone_number LIKE ${'%' + targetPhone + '%'}
    ORDER BY created_at DESC
  `;
  console.log(JSON.stringify(opportunities, null, 2));

  console.log("\n=== CONVERSATIONS ===");
  const conversations = await sql`
    SELECT id, phone_number, status, autopilot_enabled, lead_stage, active_opportunity_id, created_at
    FROM conversations
    WHERE phone_number LIKE ${'%' + targetPhone + '%'}
    ORDER BY created_at DESC
  `;
  console.log(JSON.stringify(conversations, null, 2));

  console.log("\n=== LEADS ===");
  const leads = await sql`
    SELECT *
    FROM leads
    WHERE phone_number LIKE ${'%' + targetPhone + '%'}
    ORDER BY created_at DESC
  `;
  console.log(JSON.stringify(leads, null, 2));

  console.log("\n=== FOLLOW UP TASKS ===");
  const tasks = await sql`
    SELECT id, opportunity_id, phone_number, task_type, title, status, due_at, created_at, metadata
    FROM follow_up_tasks
    WHERE phone_number LIKE ${'%' + targetPhone + '%'}
    ORDER BY created_at DESC
  `;
  console.log(JSON.stringify(tasks, null, 2));

  console.log("\n=== NOTIFICATIONS ===");
  const notifications = await sql`
    SELECT *
    FROM notifications
    WHERE task_id IN (
      SELECT id FROM follow_up_tasks WHERE phone_number LIKE ${'%' + targetPhone + '%'}
    )
    ORDER BY created_at DESC
  `;
  console.log(JSON.stringify(notifications, null, 2));

  console.log("\n=== MESSAGES ===");
  const messages = await sql`
    SELECT *
    FROM messages
    WHERE conversation_id IN (
      SELECT id FROM conversations WHERE phone_number LIKE ${'%' + targetPhone + '%'}
    )
    ORDER BY created_at DESC
    LIMIT 20
  `;
  console.log(JSON.stringify(messages, null, 2));
}

main().catch(console.error);
