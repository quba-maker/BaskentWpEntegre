const { neon } = require("@neondatabase/serverless");
const dotenv = require("dotenv");

dotenv.config({ path: "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local" });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const sql = neon(appDatabaseUrl);
  
  const taskId = "a9142e2c-5b9c-4a9c-80bb-e33d06a2e9f5";
  const tasks = await sql`
    SELECT id, opportunity_id, phone_number, task_type, title, status, due_at, metadata, updated_at
    FROM follow_up_tasks
    WHERE id = ${taskId}
  `;
  console.log("TASK DETAILS:");
  console.log(tasks);
  
  console.log("\nLATEST MESSAGES FOR THIS CONVERSATION:");
  const messages = await sql`
    SELECT id, direction, content, created_at
    FROM messages
    WHERE conversation_id = '8f738423-6213-44e6-8ac0-3a10bc7835bb'
    ORDER BY created_at DESC
    LIMIT 5
  `;
  console.log(messages);
}
main().catch(console.error);
