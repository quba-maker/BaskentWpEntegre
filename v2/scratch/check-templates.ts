import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
async function check() {
  const sql = neon(process.env.DATABASE_URL!);
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const res = await sql`SELECT name, body FROM message_templates WHERE tenant_id = ${tenantId}::uuid AND name = 'tr_karsilama'`;
  console.log("Body:", res[0].body);
}
check();
