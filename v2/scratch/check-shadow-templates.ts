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
  const shadowId = '7ac1432a-a432-497a-8526-9394f51d0e2a';
  const templates = await sql`
    SELECT id, name, language, is_active, is_default, template_type
    FROM message_templates
    WHERE tenant_id = ${shadowId}::uuid
  `;
  console.log("Templates for baskent-shadow:", templates);
}

main().catch(console.error);
