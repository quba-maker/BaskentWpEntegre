import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

async function checkColumnExists(tableName, columnName) {
  const result = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = ${tableName} AND column_name = ${columnName}
  `;
  return result.length > 0;
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  console.log(`Starting Stateful Architecture Migration V2... ${isDryRun ? "[DRY RUN]" : ""}`);

  const report = [];

  try {
    // 1. ai_usage_ledger
    console.log("Checking ai_usage_ledger...");
    if (!isDryRun) {
      await sql`
        CREATE TABLE IF NOT EXISTS ai_usage_ledger (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
          workflow_run_id UUID,
          message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
          model TEXT,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          total_tokens INTEGER,
          estimated_cost NUMERIC(10, 6),
          latency_ms INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;
    }
    report.push("Created table: ai_usage_ledger");

    // 2. messages table additions
    console.log("Checking messages...");
    const hasRetryAttempt = await checkColumnExists("messages", "retry_attempt");
    if (!hasRetryAttempt) {
      if (!isDryRun) await sql`ALTER TABLE messages ADD COLUMN retry_attempt INTEGER DEFAULT 0`;
      report.push("Added column: messages.retry_attempt");
    }

    const hasDeliveryStatus = await checkColumnExists("messages", "delivery_status");
    if (!hasDeliveryStatus) {
      if (!isDryRun) await sql`ALTER TABLE messages ADD COLUMN delivery_status TEXT`;
      report.push("Added column: messages.delivery_status");
    }

    const hasDeliveryError = await checkColumnExists("messages", "delivery_error");
    if (!hasDeliveryError) {
      if (!isDryRun) await sql`ALTER TABLE messages ADD COLUMN delivery_error TEXT`;
      report.push("Added column: messages.delivery_error");
    }

    // 3. workflow_runs table additions
    console.log("Checking workflow_runs...");
    const hasAgentType = await checkColumnExists("workflow_runs", "agent_type");
    if (!hasAgentType) {
      if (!isDryRun) await sql`ALTER TABLE workflow_runs ADD COLUMN agent_type TEXT`;
      report.push("Added column: workflow_runs.agent_type");
    }

    const hasOrchVersion = await checkColumnExists("workflow_runs", "orchestrator_version");
    if (!hasOrchVersion) {
      if (!isDryRun) await sql`ALTER TABLE workflow_runs ADD COLUMN orchestrator_version TEXT`;
      report.push("Added column: workflow_runs.orchestrator_version");
    }

    const hasExecStrategy = await checkColumnExists("workflow_runs", "execution_strategy");
    if (!hasExecStrategy) {
      if (!isDryRun) await sql`ALTER TABLE workflow_runs ADD COLUMN execution_strategy TEXT`;
      report.push("Added column: workflow_runs.execution_strategy");
    }

    console.log("\n=== MIGRATION REPORT ===");
    report.forEach(r => console.log(`- ${r}`));
    console.log(`\nMigration completed successfully. ${isDryRun ? "No changes were made." : ""}`);

  } catch (err) {
    console.error("Migration failed:", err);
  }
}

main();
