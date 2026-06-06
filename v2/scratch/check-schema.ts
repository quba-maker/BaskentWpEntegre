import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  const tables = ['outreach_logs', 'leads', 'opportunities', 'conversations', 'messages', 'message_templates'];

  const results = await sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_name = ANY(${tables})
      AND column_name IN ('id', 'tenant_id', 'lead_id', 'opportunity_id', 'conversation_id', 'action', 'channel', 'phone_number', 'form_name')
  `;

  // Format nicely
  const formatted: any = {};
  for (const row of results) {
    if (!formatted[row.table_name]) formatted[row.table_name] = {};
    formatted[row.table_name][row.column_name] = row.data_type;
  }
  
  console.log("SCHEMA:", JSON.stringify(formatted, null, 2));
}

run().catch(console.error);
