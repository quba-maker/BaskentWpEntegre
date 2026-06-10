import * as dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

async function check() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  const sql = neon(dbUrl);
  try {
    const stages = await sql`
      SELECT stage, COUNT(*) as cnt 
      FROM leads 
      GROUP BY stage;
    `;
    console.log(stages);
  } catch (err) {
    console.error(err);
  }
}
check();
