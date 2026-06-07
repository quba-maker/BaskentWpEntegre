require('dotenv').config({ path: '.env.production.local' });
const { Client } = require('pg');
async function run() {
  const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.log('No URL found!'); return; }
  const client = new Client({ connectionString: url });
  await client.connect();
  const res = await client.query(`SELECT lead_id, action, metadata, created_at FROM outreach_logs WHERE action = 'form_greeting_template_sent' ORDER BY created_at DESC LIMIT 5`);
  console.log('Logs:', res.rows);
  const msgs = await client.query(`SELECT id, direction, status, provider_message_id, created_at FROM messages WHERE provider_message_id IS NOT NULL ORDER BY created_at DESC LIMIT 5`);
  console.log('Messages:', msgs.rows);
  await client.end();
}
run().catch(console.error);
