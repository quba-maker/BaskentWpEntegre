import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function cleanOldTables() {
  console.log("Dropping old tables to allow clean Drizzle setup...");
  
  await sql`DROP TABLE IF EXISTS pipeline_events CASCADE;`;
  await sql`DROP TABLE IF EXISTS tenant_semantic_rules CASCADE;`;
  await sql`DROP TABLE IF EXISTS ai_context_memory CASCADE;`;
  await sql`DROP TABLE IF EXISTS ai_audit_logs CASCADE;`;

  console.log("Dropped successfully.");
}

cleanOldTables().catch(console.error);
