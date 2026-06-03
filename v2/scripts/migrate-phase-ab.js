require('dotenv').config({ path: '.env.local' });
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  try {
    await pool.query(`
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_timestamp timestamp with time zone;
    `);
    console.log("Added provider_timestamp to messages.");

    await pool.query(`
      ALTER TABLE conversations ADD COLUMN IF NOT EXISTS history_imported_at timestamp with time zone;
    `);
    console.log("Added history_imported_at to conversations.");

  } catch (e) {
    console.error("Migration error:", e);
  } finally {
    pool.end();
  }
}
run();
