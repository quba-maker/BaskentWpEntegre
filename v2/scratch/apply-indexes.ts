import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;

async function run() {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(DATABASE_URL!);

  console.log("=========================================");
  console.log("🚀 Applying messages Table Database Index");
  console.log("=========================================");

  try {
    console.log("Applying index: idx_messages_tenant_conversation_created...");
    await sql`
      CREATE INDEX IF NOT EXISTS idx_messages_tenant_conversation_created 
      ON messages(tenant_id, conversation_id, created_at DESC);
    `;
    console.log("✅ Index created successfully!");
  } catch (err: any) {
    console.error("❌ Failed to create index:", err.message);
  }

  process.exit(0);
}

run().catch(console.error);
