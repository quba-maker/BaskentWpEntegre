import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

async function clear() {
  const sql = neon(process.env.DATABASE_URL);
  await sql`DELETE FROM settings WHERE key IN ('system_prompt_whatsapp', 'system_prompt_foreign', 'system_prompt_tr')`;
  console.log("Deleted old cached prompts from settings.");
}
clear();
