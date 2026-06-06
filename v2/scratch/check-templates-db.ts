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
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  const templates = await sql`
    SELECT id, name, language, is_active, is_default, template_type
    FROM message_templates
    WHERE tenant_id = ${tenantId}::uuid
  `;
  console.log("Templates in DB:", templates);
}

main().catch(console.error);
