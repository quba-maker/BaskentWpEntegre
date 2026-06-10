import * as dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

async function audit() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is missing in env");
    return;
  }

  const sql = neon(dbUrl);
  try {
    const rows = await sql`
      SELECT id, phone_number, form_name, created_at, raw_data 
      FROM leads 
      WHERE raw_data::text LIKE '%_webhook_errors%';
    `;
    console.log(`Found ${rows.length} leads from _webhook_errors:`, rows.map(r => ({
      id: r.id,
      maskedPhone: r.phone_number ? r.phone_number.substring(0, 5) + '***' : 'none',
      form_name: r.form_name,
      created_at: r.created_at
    })));
  } catch (err) {
    console.error(err);
  }
}
audit();
