import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const tenantRes = await sql`SELECT id FROM tenants WHERE slug = 'baskent' LIMIT 1`;
  const tenantId = tenantRes[0].id;

  const leads = await sql`
    SELECT id, patient_name, form_name, phone_number, created_at 
    FROM leads 
    WHERE tenant_id = ${tenantId}::uuid
    ORDER BY created_at DESC LIMIT 5
  `;
  console.log("LEADS:", leads);
}

main().catch(console.error);
