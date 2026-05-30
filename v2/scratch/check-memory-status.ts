import { Pool } from '@neondatabase/serverless';

async function main() {
  const pool = new Pool({
    connectionString: "postgresql://neondb_owner:npg_x1cmTpdio5qa@ep-orange-hill-alm34j6t-pooler.c-3.eu-central-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require"
  });

  console.log("\n=== FEATURE FLAGS ===");
  const flags = await pool.query(`
    SELECT tenant_id, flag_key, is_enabled
    FROM feature_flags;
  `);
  console.table(flags.rows);

  await pool.end();
}

main().catch(console.error);
