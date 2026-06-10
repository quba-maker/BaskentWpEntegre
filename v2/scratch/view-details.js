const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const res = await pool.query(
    `SELECT * FROM conversations WHERE id = '5ab1e196-47cb-4a6e-bf01-78f81f8e4ef9'`
  );
  console.log(JSON.stringify(res.rows[0], null, 2));
  await pool.end();
}

main().catch(console.error);
