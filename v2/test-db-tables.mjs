import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const sql = neon(process.env.DATABASE_URL);
async function run() {
  try {
    const res = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    console.log("Tables:");
    console.log(res.map(r => r.table_name).join(', '));
  } catch (e) {
    console.error(e);
  }
}
run();
