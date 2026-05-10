import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.DATABASE_URL);

async function checkStatus() {
  console.log("=== LATEST MESSAGES ===");
  const messages = await sql`SELECT phone_number, direction, content, created_at FROM messages ORDER BY created_at DESC LIMIT 5`;
  console.log(messages);

  console.log("\n=== LATEST CONVERSATIONS ===");
  const convs = await sql`SELECT phone_number, status, phase, lead_stage, temperature FROM conversations ORDER BY updated_at DESC LIMIT 2`;
  console.log(convs);

  console.log("\n=== LATEST LEADS ===");
  const leads = await sql`SELECT phone_number, stage, score FROM leads ORDER BY updated_at DESC LIMIT 2`;
  console.log(leads);
}

checkStatus().catch(console.error);
