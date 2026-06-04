import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const conversations = await sql`
    SELECT id, tenant_id, phone_number, patient_name, notes, created_at
    FROM conversations
    ORDER BY created_at DESC
    LIMIT 10
  `;
  console.log("Recent Conversations:");
  console.log(JSON.stringify(conversations, null, 2));
}

main().catch(console.error);
