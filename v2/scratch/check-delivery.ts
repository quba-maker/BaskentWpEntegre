import { Pool } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

async function checkDelivery() {
  const sql = new Pool({ connectionString: process.env.APP_DATABASE_URL });
  try {
    const resLeads = await sql.query(`SELECT id, patient_name, stage, created_at FROM leads WHERE patient_name ILIKE '%Halil Hanay%' ORDER BY created_at DESC`);
    console.log('Leads:');
    console.dir(resLeads.rows, { depth: null });
  } catch (err) { console.error(err); } finally { await sql.end(); }
}
checkDelivery();
