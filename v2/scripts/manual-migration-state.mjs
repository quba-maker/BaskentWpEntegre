import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

async function main() {
  try {
    console.log("Starting stateful architecture migration...");

    // 1. Alter conversations
    console.log("Altering conversations...");
    await sql`
      ALTER TABLE conversations 
      ADD COLUMN IF NOT EXISTS active_workflow_run_id UUID,
      ADD COLUMN IF NOT EXISTS workflow_lock_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS handed_off_by UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS handed_off_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS handoff_reason TEXT,
      ADD COLUMN IF NOT EXISTS ai_disabled_until TIMESTAMPTZ
    `;

    // 2. Alter messages
    console.log("Altering messages...");
    await sql`
      ALTER TABLE messages 
      ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
      ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(10, 6),
      ADD COLUMN IF NOT EXISTS temperature NUMERIC(3, 2),
      ADD COLUMN IF NOT EXISTS moderation_result TEXT,
      ADD COLUMN IF NOT EXISTS correlation_id TEXT
    `;

    // 3. Create conversation_snapshots
    console.log("Creating conversation_snapshots...");
    await sql`
      CREATE TABLE IF NOT EXISTS conversation_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        workflow_run_id UUID,
        snapshot_data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // 4. Alter workflow_runs
    console.log("Altering workflow_runs...");
    await sql`
      ALTER TABLE workflow_runs 
      ADD COLUMN IF NOT EXISTS prompt_binding_versions JSONB,
      ADD COLUMN IF NOT EXISTS error_details JSONB,
      ADD COLUMN IF NOT EXISTS correlation_id TEXT
    `;

    // 5. Alter workflow_steps
    console.log("Altering workflow_steps...");
    await sql`
      ALTER TABLE workflow_steps 
      ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS dependencies JSONB
    `;

    // 6. Alter channel_events
    console.log("Altering channel_events...");
    await sql`
      ALTER TABLE channel_events 
      ADD COLUMN IF NOT EXISTS correlation_id TEXT
    `;

    // 7. Alter webhook_events
    console.log("Altering webhook_events...");
    await sql`
      ALTER TABLE webhook_events 
      ADD COLUMN IF NOT EXISTS correlation_id TEXT
    `;

    // 8. Alter tenants
    console.log("Altering tenants...");
    await sql`
      ALTER TABLE tenants 
      ADD COLUMN IF NOT EXISTS token_budget INTEGER DEFAULT 1000000,
      ADD COLUMN IF NOT EXISTS tokens_used INTEGER DEFAULT 0
    `;

    console.log("Migration completed successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
  }
}

main();
