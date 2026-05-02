import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
const sql = neon(process.env.DATABASE_URL);
async function run() {
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS department VARCHAR(100)`;
  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS patient_type VARCHAR(50)`;
  console.log('Columns added!');
}
run();
