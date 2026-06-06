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
    console.log("Loading env from:", p);
    config({ path: p });
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not found in loaded envs!");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

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
