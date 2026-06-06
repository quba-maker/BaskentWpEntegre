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
  const tenants = await sql`SELECT id, name, slug FROM tenants`;
  console.log("Tenants:", tenants);
}

main().catch(console.error);
