require('dotenv').config({ path: '.env.local' });
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  const schema = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'messages';
  `);
  console.log("Messages Schema:");
  console.log(schema.rows);
  pool.end();
}
run();
