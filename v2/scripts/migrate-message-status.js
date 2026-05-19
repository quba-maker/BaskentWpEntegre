const { neon } = require("@neondatabase/serverless");
require("dotenv").config({path: ".env"});

const sql = neon(process.env.DATABASE_URL);

async function run() {
  try {
    console.log("Adding status & direction columns to messages...");
    await sql`
      ALTER TABLE messages 
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'in';
    `;
    console.log("Adding last_message_status & direction to conversations...");
    await sql`
      ALTER TABLE conversations 
      ADD COLUMN IF NOT EXISTS last_message_status TEXT DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS last_message_direction TEXT DEFAULT 'in';
    `;
    console.log("Migration completed successfully.");
  } catch(e) {
    console.error("Migration failed:", e);
  }
}
run();
