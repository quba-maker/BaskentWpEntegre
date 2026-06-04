import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const users = await sql`
    SELECT id, email, name, role
    FROM users
    LIMIT 10
  `;
  console.log("Users in DB:");
  console.log(users);
}

main().catch(console.error);
