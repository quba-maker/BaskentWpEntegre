const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  try {
    const convCols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'conversations';
    `;
    console.log("Conversations columns:", convCols);

    const readStateCols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'conversation_read_states';
    `;
    console.log("conversation_read_states columns:", readStateCols);
  } catch (err) {
    console.error(err);
  }
}
run();
