import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const tenantRes = await sql`SELECT id FROM tenants WHERE slug = 'baskent' LIMIT 1`;
  const tenantId = tenantRes[0].id;

  const rows = await sql`
    SELECT id, name, language, body, form_name, department, is_active, is_default, template_type 
    FROM message_templates
    WHERE tenant_id = ${tenantId}::uuid
  `;
  console.log("TEMPLATES:", rows);
}

main().catch(console.error);
