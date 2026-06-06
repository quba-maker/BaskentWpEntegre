import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const sql = neon(databaseUrl);

async function run() {
  const tenants = await sql`SELECT id FROM tenants WHERE slug = 'baskent' LIMIT 1`;
  if (tenants.length === 0) {
    console.error('Tenant not found');
    process.exit(1);
  }
  const tenantId = tenants[0].id;
  
  const name = 'tr_karsilama';
  const language = 'tr';
  const type = 'greeting';
  const body = 'Merhaba, Başkent Üniversitesi Konya Hastanesi’nden, doldurduğunuz form doğrultusunda sizinle iletişime geçiyoruz.';

  const exists = await sql`
    SELECT * FROM message_templates
    WHERE tenant_id = ${tenantId} AND name = ${name} AND language = ${language}
  `;

  if (exists.length > 0) {
    console.log('Template exists. Updating...');
    await sql`
      UPDATE message_templates
      SET body = ${body}, is_active = true, template_type = ${type}
      WHERE id = ${exists[0].id}
    `;
  } else {
    console.log('Template does not exist. Inserting...');
    await sql`
      INSERT INTO message_templates (tenant_id, name, language, body, template_type, is_active, is_default)
      VALUES (${tenantId}, ${name}, ${language}, ${body}, ${type}, true, false)
    `;
  }

  const final = await sql`SELECT id, name, language, body, is_active, template_type FROM message_templates WHERE tenant_id = ${tenantId} AND name = ${name}`;
  console.log('Final DB State:', final);
}

run().catch(console.error);
