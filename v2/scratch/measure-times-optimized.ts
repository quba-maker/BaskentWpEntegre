import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const CONV_ID = "fa1b149d-c99f-4e03-be95-139d2c878a13";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("=========================================");
  console.log("⏱️ Measuring Optimized Query Speed (Loop)");
  console.log("=========================================");

  for (let i = 1; i <= 5; i++) {
    const start = Date.now();
    
    await db.executeSafe({
      text: `
        SELECT id, content as text, direction, status, model_used,
               media_type, media_url, media_metadata, provider_message_id,
               EXTRACT(EPOCH FROM created_at) * 1000 as created_at_ms
        FROM messages
        WHERE conversation_id = $1::uuid 
          AND (tenant_id = $2)
        ORDER BY created_at DESC
        LIMIT 50
      `,
      values: [CONV_ID, TENANT_ID]
    });

    const duration = Date.now() - start;
    console.log(`Run [${i}] duration: ${duration} ms`);
  }

  process.exit(0);
}

run().catch(console.error);
