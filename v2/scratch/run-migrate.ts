require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  console.log("--- RUNNING MIGRATION DIRECT SQL ---");
  
  await sql`
    CREATE TABLE IF NOT EXISTS conversation_pins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(tenant_id, user_id, conversation_id)
    )
  `;
  console.log("✅ conversation_pins table created.");

  await sql`CREATE INDEX IF NOT EXISTS idx_conversation_pins_user ON conversation_pins(tenant_id, user_id, created_at DESC)`;
  console.log("✅ idx_conversation_pins_user index created.");

  await sql`
    CREATE TABLE IF NOT EXISTS conversation_read_states (
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      last_read_at TIMESTAMPTZ,
      last_read_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (tenant_id, user_id, conversation_id)
    )
  `;
  console.log("✅ conversation_read_states table created.");

  await sql`CREATE INDEX IF NOT EXISTS idx_conv_read_states_user ON conversation_read_states(tenant_id, user_id, conversation_id)`;
  console.log("✅ idx_conv_read_states_user index created.");

  await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_model TEXT`;
  console.log("✅ last_message_model column added to conversations.");

  // Apply shadow policies just in case
  try {
    await sql`ALTER TABLE conversation_pins ENABLE ROW LEVEL SECURITY`;
    await sql`DROP POLICY IF EXISTS pins_app_access ON conversation_pins`;
    await sql`CREATE POLICY pins_app_access ON conversation_pins FOR ALL USING (true) WITH CHECK (true)`;

    await sql`ALTER TABLE conversation_read_states ENABLE ROW LEVEL SECURITY`;
    await sql`DROP POLICY IF EXISTS read_states_app_access ON conversation_read_states`;
    await sql`CREATE POLICY read_states_app_access ON conversation_read_states FOR ALL USING (true) WITH CHECK (true)`;
    console.log("✅ RLS policies verified.");
  } catch (e) {
    console.warn("⚠️ RLS Policies warning:", e);
  }

  console.log("--- MIGRATION COMPLETED ---");
}

run().catch(console.error);
