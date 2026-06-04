import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const tenants = await sql`
    SELECT id, slug, name FROM tenants WHERE id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'
  `;
  console.log("Tenant info:");
  console.log(tenants);
}

main().catch(console.error);
