import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log('--- QUBA AI: ADMIN PASSWORD RESET ---');
  const email = process.argv[2] || 'admin@qubamedya.com';
  const newPassword = process.argv[3] || 'admin123';
  
  const users = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (users.length === 0) {
    console.error(`User ${email} not found! Run seed.mjs first.`);
    return;
  }
  
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(newPassword, salt);
  
  await sql`UPDATE users SET password_hash = ${hash} WHERE email = ${email}`;
  console.log(`✅ Success! Password for ${email} has been reset to: ${newPassword}`);
}
run();
