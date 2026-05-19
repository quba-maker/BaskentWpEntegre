import { config } from 'dotenv';
config({ path: '.env' });
config({ path: '.env.local' }); // Overrides with .env.local if present

import { sql } from '../src/lib/db';

async function run() {
  try {
    console.log("Adding columns prompt_tokens and completion_tokens to messages...");
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER DEFAULT 0;`;
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS completion_tokens INTEGER DEFAULT 0;`;
    
    console.log("Creating composite indexes for tenant_id and created_at...");
    await sql`CREATE INDEX IF NOT EXISTS idx_messages_tenant_created ON messages (tenant_id, created_at DESC);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_conversations_tenant_created ON conversations (tenant_id, created_at DESC);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_conversations_tenant_last_msg ON conversations (tenant_id, last_message_at DESC);`;
    
    console.log("Migration completed successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

run();
