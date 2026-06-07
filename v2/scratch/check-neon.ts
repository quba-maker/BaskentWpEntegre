import { Pool, neonConfig } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import ws from 'ws';
dotenv.config({ path: '.env.production.local' });
neonConfig.webSocketConstructor = ws;

async function checkDelivery() {
  const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) return console.log('No URL');
  const sql = new Pool({ connectionString: url });
  try {
    const resLogs = await sql.query(`SELECT lead_id, action, metadata, created_at FROM outreach_logs WHERE action = 'form_greeting_template_sent' ORDER BY created_at DESC LIMIT 5`);
    console.log('Recent template sent logs:');
    console.dir(resLogs.rows, { depth: null });
    
    const resErrors = await sql.query(`SELECT lead_id, action, metadata, created_at FROM outreach_logs WHERE action = 'send_greeting_error' ORDER BY created_at DESC LIMIT 5`);
    console.log('Recent error logs:');
    console.dir(resErrors.rows, { depth: null });

    const resMsgs = await sql.query(`SELECT id, direction, status, provider_message_id, created_at FROM messages WHERE provider_message_id IS NOT NULL ORDER BY created_at DESC LIMIT 5`);
    console.log('Recent messages with provider ID:');
    console.dir(resMsgs.rows, { depth: null });

  } catch (err) { console.error(err); } finally { await sql.end(); }
}
checkDelivery();
