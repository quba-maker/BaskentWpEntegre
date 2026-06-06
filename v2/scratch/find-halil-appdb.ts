import * as path from 'path';
import * as fs from 'fs';
import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

// Try multiple dotenv files
const paths = [
  path.join(__dirname, '../.env.production.local'),
  path.join(__dirname, '../.env.local'),
  path.join(__dirname, '../.env'),
  path.join(__dirname, '../../.env.local'),
];

for (const p of paths) {
  if (fs.existsSync(p)) {
    config({ path: p });
  }
}

const dbUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("No database URL found!");
  process.exit(1);
}

const sql = neon(dbUrl);

async function main() {
  const leads = await sql`
    SELECT id, patient_name, form_name, phone_number, created_at, linked_opportunity_id, tenant_id
    FROM leads 
    WHERE patient_name ILIKE '%Halil%' OR patient_name ILIKE '%Hanay%'
    ORDER BY created_at DESC
  `;
  console.log("Halil leads:", leads);
}

main().catch(console.error);
