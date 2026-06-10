import * as dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

async function check() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const sql = neon(dbUrl);
  try {
    const cols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'leads';
    `;
    console.log(cols);
  } catch (err) {
    console.error(err);
  }
}
check();
