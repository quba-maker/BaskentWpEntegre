import { Pool } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const RLS_TABLES = [
  'conversations',
  'messages',
  'leads',
  'customer_profiles',
  'workflow_runs',
  'channel_groups',
  'ai_usage_ledger',
  'ai_audit_logs',
  'webhook_events'
];

const JOIN_RLS_TABLES = {
  'workflow_steps': `run_id IN (SELECT id FROM workflow_runs WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)`,
  'channels': `group_id IN (SELECT id FROM channel_groups WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)`,
  'channel_integrations': `channel_id IN (SELECT id FROM channels WHERE group_id IN (SELECT id FROM channel_groups WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid))`,
  'conversation_snapshots': `conversation_id IN (SELECT id FROM conversations WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)`,
  'channel_events': `channel_id IN (SELECT id FROM channels WHERE group_id IN (SELECT id FROM channel_groups WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid))`
};

async function checkPolicyExists(tableName, policyName) {
  const result = await pool.query(
    `SELECT policyname FROM pg_policies WHERE tablename = $1 AND policyname = $2`,
    [tableName, policyName]
  );
  return result.rows.length > 0;
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const isRollback = process.argv.includes("--rollback");
  
  console.log(`Starting RLS Migration...`);
  if (isDryRun) console.log(`[DRY RUN MODE] No changes will be executed.`);
  if (isRollback) console.log(`[ROLLBACK MODE] Disabling RLS and dropping policies.`);

  const report = [];

  try {
    const ALL_TABLES = [...RLS_TABLES, ...Object.keys(JOIN_RLS_TABLES)];
    
    for (const table of ALL_TABLES) {
      console.log(`Processing table: ${table}`);
      
      // Verify table exists first
      const tableExists = await pool.query(`SELECT to_regclass('${table}'::text) as exists`);
      if (!tableExists.rows[0].exists) {
        report.push(`⚠️ Skipped ${table} (Table does not exist)`);
        continue;
      }

      if (isRollback) {
        if (!isDryRun) {
          await pool.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
          await pool.query(`DROP POLICY IF EXISTS tenant_isolation_policy ON ${table}`);
          await pool.query(`DROP POLICY IF EXISTS bypass_rls_policy ON ${table}`);
        }
        report.push(`✅ Disabled RLS on ${table}`);
        continue;
      }

      // ENABLE MODE
      const hasTenantPolicy = await checkPolicyExists(table, 'tenant_isolation_policy');
      const hasBypassPolicy = await checkPolicyExists(table, 'bypass_rls_policy');

      if (!isDryRun) {
        await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        await pool.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      }

      if (!hasTenantPolicy) {
        const usingClause = JOIN_RLS_TABLES[table] || `tenant_id = current_setting('app.current_tenant_id', true)::uuid`;
        if (!isDryRun) {
          await pool.query(`
            CREATE POLICY tenant_isolation_policy ON ${table}
            FOR ALL
            USING (${usingClause})
          `);
        }
        report.push(`✅ Created tenant_isolation_policy on ${table}`);
      } else {
        report.push(`⚡ tenant_isolation_policy already exists on ${table}`);
      }

      if (!hasBypassPolicy) {
        if (!isDryRun) {
          await pool.query(`
            CREATE POLICY bypass_rls_policy ON ${table}
            FOR ALL
            USING (current_setting('app.bypass_rls', true) = 'true')
          `);
        }
        report.push(`✅ Created bypass_rls_policy on ${table}`);
      } else {
        report.push(`⚡ bypass_rls_policy already exists on ${table}`);
      }
    }

    console.log("\n=== RLS MIGRATION REPORT ===");
    report.forEach(r => console.log(r));
    console.log(`\nMigration completed successfully. ${isDryRun ? "(Nothing executed)" : ""}`);

  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}

main();
