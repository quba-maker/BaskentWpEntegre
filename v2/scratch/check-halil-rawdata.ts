import * as path from 'path';
import * as fs from 'fs';
import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}

const dbUrl = process.env.DATABASE_URL;
const sql = neon(dbUrl!);

async function main() {
  const leadId = '0cd8a537-c9b9-4273-94dd-c78f220233ec';
  const leads = await sql`
    SELECT id, patient_name, phone_number, country, raw_data, created_at
    FROM leads
    WHERE id = ${leadId}::uuid
  `;
  console.log("Halil Hanay details:", JSON.stringify(leads[0], null, 2));
}

main().catch(console.error);
