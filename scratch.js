import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS country VARCHAR(100)`;
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS real_phone VARCHAR(20)`;
  console.log("DB Updated");
}
run();
