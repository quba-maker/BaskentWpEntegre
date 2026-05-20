import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

const sql = neon(process.env.DATABASE_URL);
async function run() {
  const users = await sql`SELECT id, email, is_active, tenant_id FROM users`;
  console.log('USERS:', users);
  
  const tenants = await sql`SELECT id, slug, status FROM tenants`;
  console.log('TENANTS:', tenants);
}
run();
