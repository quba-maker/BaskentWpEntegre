import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

async function main() {
  try {
    console.log("Adding columns to messages table...");
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE SET NULL`;
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS group_id UUID`;
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS workflow_run_id UUID`;
    await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS prompt_binding_id UUID`;
    
    console.log("Creating webhook_events table...");
    await sql`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_message_id TEXT NOT NULL,
        sender_id TEXT,
        event_timestamp NUMERIC,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    console.log("Done.");
  } catch (err) {
    console.error(err);
  }
}
main();
