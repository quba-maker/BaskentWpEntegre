import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const tenantRes = await sql`SELECT id FROM tenants WHERE slug = 'baskent' LIMIT 1`;
  const tenantId = tenantRes[0].id;

  const logs = await sql`
    SELECT id, action, created_at 
    FROM outreach_logs 
    WHERE tenant_id = ${tenantId} AND action = 'form_greeting_template_sent' 
    ORDER BY created_at DESC LIMIT 5
  `;
  console.log("Recent form_greeting_template_sent:", logs);

  const msgs = await sql`
    SELECT id, direction, channel, status, created_at 
    FROM messages 
    WHERE tenant_id = ${tenantId}::uuid AND direction = 'out' 
    ORDER BY created_at DESC LIMIT 5
  `;
  console.log("Recent outbound messages:", msgs);
}

main().catch(console.error);
