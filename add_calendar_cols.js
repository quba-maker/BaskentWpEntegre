import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const sql = neon(process.env.DATABASE_URL);
async function run() {
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS scheduled_date TIMESTAMP`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS assigned_doctor VARCHAR(100)`;
  console.log('Calendar columns added!');
}
run().catch(console.error);
