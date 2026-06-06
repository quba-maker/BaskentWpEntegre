import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const sql = neon(databaseUrl);

async function run() {
  const query = `
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name IN (
      'outreach_logs',
      'leads',
      'opportunities',
      'conversations',
      'messages',
      'message_templates'
    )
    AND column_name IN (
      'id',
      'tenant_id',
      'lead_id',
      'opportunity_id',
      'conversation_id',
      'template_id',
      'phone_number',
      'form_name',
      'action',
      'channel',
      'name',
      'language',
      'direction'
    )
    ORDER BY table_name, column_name;
  `;

  const rows = await sql.query(query);
  console.log('SCHEMA_ROWS:', JSON.stringify(rows, null, 2));
}

run().catch(console.error);
