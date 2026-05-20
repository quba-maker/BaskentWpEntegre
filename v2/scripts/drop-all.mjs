import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
  console.error("❌ CRITICAL: Destructive migrations (DROP CASCADE) are permanently blocked in production environments.");
  console.error("Execution aborted to protect live tenant data.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function wipeDatabase() {
  console.log("Wiping all old tables for the new Sprint 4.0 UUID schema...");
  
  try { await sql`DROP TABLE IF EXISTS leads CASCADE;`; console.log('Dropped leads'); } catch (e) { console.error(e.message); }
  try { await sql`DROP TABLE IF EXISTS users CASCADE;`; console.log('Dropped users'); } catch (e) { console.error(e.message); }
  try { await sql`DROP TABLE IF EXISTS tenants CASCADE;`; console.log('Dropped tenants'); } catch (e) { console.error(e.message); }
  try { await sql`DROP TABLE IF EXISTS pipeline_events CASCADE;`; console.log('Dropped pipeline_events'); } catch (e) { console.error(e.message); }
  try { await sql`DROP TABLE IF EXISTS tenant_semantic_rules CASCADE;`; console.log('Dropped tenant_semantic_rules'); } catch (e) { console.error(e.message); }
  try { await sql`DROP TABLE IF EXISTS ai_context_memory CASCADE;`; console.log('Dropped ai_context_memory'); } catch (e) { console.error(e.message); }
  try { await sql`DROP TABLE IF EXISTS ai_audit_logs CASCADE;`; console.log('Dropped ai_audit_logs'); } catch (e) { console.error(e.message); }
  try { await sql`DROP TABLE IF EXISTS ingestion_pipelines CASCADE;`; console.log('Dropped ingestion_pipelines'); } catch (e) { console.error(e.message); }
  try { await sql`DROP TABLE IF EXISTS rollback_snapshots CASCADE;`; console.log('Dropped rollback_snapshots'); } catch (e) { console.error(e.message); }
  try { await sql`DROP TABLE IF EXISTS customer_profiles CASCADE;`; console.log('Dropped customer_profiles'); } catch (e) { console.error(e.message); }

  console.log("Wipe complete. Database is fresh.");
}

wipeDatabase().catch(console.error);
