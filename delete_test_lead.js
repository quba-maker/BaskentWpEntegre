import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config();

const sql = neon(process.env.DATABASE_URL);

async function run() {
  const phone = '%5546833306%';
  console.log('Deleting test lead...');
  await sql`DELETE FROM messages WHERE phone_number LIKE ${phone}`;
  await sql`DELETE FROM conversation_states WHERE phone_number LIKE ${phone}`;
  await sql`DELETE FROM events WHERE phone_number LIKE ${phone}`;
  await sql`DELETE FROM leads WHERE phone_number LIKE ${phone}`;
  await sql`DELETE FROM conversations WHERE phone_number LIKE ${phone}`;
  console.log('Done!');
  process.exit(0);
}

run();
