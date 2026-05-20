import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log('1. Checking DB for admin@qubamedya.com');
  const users = await sql`SELECT id, email, password_hash, is_active FROM users WHERE email = 'admin@qubamedya.com'`;
  if (users.length === 0) {
    console.log('User not found!');
    return;
  }
  const user = users[0];
  console.log('User found:', user.email, 'Active:', user.is_active);
  
  // Update password to 'admin123' so we can test predictably
  console.log('2. Resetting password to "admin123"');
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash('admin123', salt);
  await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`;
  console.log('Password reset successfully.');
  
  console.log('3. Verifying password hash directly...');
  const isValid = await bcrypt.compare('admin123', hash);
  console.log('Bcrypt compare result:', isValid);
}
run();
