import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL || process.env.APP_DATABASE_URL);

async function main() {
  try {
    console.log("Starting favorites & archives migration...");

    console.log("Creating conversation_favorites table...");
    await sql`
      CREATE TABLE IF NOT EXISTS conversation_favorites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, user_id, conversation_id)
      )
    `;
    console.log("Creating idx_conversation_favorites_user index...");
    await sql`CREATE INDEX IF NOT EXISTS idx_conversation_favorites_user ON conversation_favorites(tenant_id, user_id, created_at DESC)`;

    console.log("Creating conversation_archives table...");
    await sql`
      CREATE TABLE IF NOT EXISTS conversation_archives (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, user_id, conversation_id)
      )
    `;
    console.log("Creating idx_conversation_archives_user index...");
    await sql`CREATE INDEX IF NOT EXISTS idx_conversation_archives_user ON conversation_archives(tenant_id, user_id, created_at DESC)`;

    console.log("Enabling ROW LEVEL SECURITY...");
    await sql`ALTER TABLE conversation_favorites ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE conversation_archives ENABLE ROW LEVEL SECURITY`;

    console.log("Dropping existing policies if any...");
    await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON conversation_favorites`;
    await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON conversation_archives`;

    console.log("Creating strict tenant isolation policies...");
    await sql`
      CREATE POLICY tenant_isolation_policy ON conversation_favorites
      FOR ALL
      USING (
        (current_setting('app.bypass_rls', true) = 'true')
        OR (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      )
    `;
    await sql`
      CREATE POLICY tenant_isolation_policy ON conversation_archives
      FOR ALL
      USING (
        (current_setting('app.bypass_rls', true) = 'true')
        OR (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      )
    `;

    console.log("Verification checks:");
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('conversation_favorites', 'conversation_archives')
    `;
    console.log("Found tables:", tables);

    const rls = await sql`
      SELECT tablename, rowsecurity FROM pg_tables
      WHERE schemaname = 'public' AND tablename IN ('conversation_favorites', 'conversation_archives')
    `;
    console.log("RLS Status:", rls);

    console.log("Migration completed successfully! 🎉");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

main();
