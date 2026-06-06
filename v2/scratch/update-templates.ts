import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  const tenantRes = await sql`SELECT id FROM tenants WHERE slug = 'baskent' LIMIT 1`;
  const tenantId = tenantRes[0].id;

  // Print existing before change
  const before = await sql`
    SELECT id, name, is_active, is_default 
    FROM message_templates 
    WHERE tenant_id = ${tenantId}::uuid AND template_type = 'greeting'
  `;
  console.log("BEFORE:", before);

  // Update Varsayılan Türkçe Karşılama
  await sql`
    UPDATE message_templates
    SET is_default = false, is_active = false
    WHERE tenant_id = ${tenantId}::uuid AND name = 'Varsayılan Türkçe Karşılama'
  `;

  // Update tr_karsilama
  await sql`
    UPDATE message_templates
    SET is_default = true, is_active = true, language = 'tr', template_type = 'greeting'
    WHERE tenant_id = ${tenantId}::uuid AND name = 'tr_karsilama'
  `;

  const after = await sql`
    SELECT id, name, is_active, is_default 
    FROM message_templates 
    WHERE tenant_id = ${tenantId}::uuid AND template_type = 'greeting'
  `;
  console.log("AFTER:", after);
}
run().catch(console.error);
