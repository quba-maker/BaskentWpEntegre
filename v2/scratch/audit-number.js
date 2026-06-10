require('dotenv').config({ path: '.env.local' });
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const phone = '905010154242';
  const likePhone = `%${phone}%`;

  console.log(`=== AUDITING PHONE NUMBER: ${phone} ===\n`);

  // 1. Check conversation details by ID
  const convDetails = await pool.query(
    `SELECT * FROM conversations WHERE id = '5ab1e196-47cb-4a6e-bf01-78f81f8e4ef9'`
  );
  console.log("--- Conversation Details ---");
  console.log(JSON.stringify(convDetails.rows, null, 2));
  console.log();

  pool.end();
}

run().catch(err => {
  console.error(err);
  pool.end();
});
