import { neon } from '@neondatabase/serverless';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const password = "admin123";
  const hash = await bcrypt.hash(password, 10);
  
  const result = await sql`
    UPDATE users
    SET password_hash = ${hash}
    WHERE email = 'admin@baskent.com'
    RETURNING id, email, name, role
  `;
  
  console.log("Updated User:", result);
}

main().catch(console.error);
