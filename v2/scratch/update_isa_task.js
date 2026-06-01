const { neon } = require("@neondatabase/serverless");
const dotenv = require("dotenv");

dotenv.config({ path: "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local" });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const sql = neon(appDatabaseUrl);
  
  const taskId = "a9142e2c-5b9c-4a9c-80bb-e33d06a2e9f5";
  const tasks = await sql`
    SELECT id, metadata, phone_number, tenant_id FROM follow_up_tasks WHERE id = ${taskId}
  `;
  
  if (tasks.length === 0) {
    console.log("Task not found.");
    return;
  }
  
  const task = tasks[0];
  const metadata = typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {});
  
  metadata.confirmation_status = 'confirmed';
  
  await sql`
    UPDATE follow_up_tasks 
    SET metadata = ${JSON.stringify(metadata)}, updated_at = NOW() 
    WHERE id = ${taskId}
  `;
  
  console.log(`Successfully updated task ${taskId} metadata to confirmation_status = 'confirmed'!`);
}
main().catch(console.error);
