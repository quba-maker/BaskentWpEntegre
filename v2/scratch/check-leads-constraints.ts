import * as dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

async function check() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const sql = neon(dbUrl);
  try {
    const constraints = await sql`
      SELECT 
        conname, 
        pg_get_constraintdef(c.oid) as def
      FROM pg_constraint c 
      JOIN pg_namespace n ON n.oid = c.connamespace 
      WHERE conrelid = 'leads'::regclass;
    `;
    console.log(constraints);
  } catch (err) {
    console.error(err);
  }
}
check();
