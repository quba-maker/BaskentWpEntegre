import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("=========================================");
  console.log("🔍 Explaining Exact Phone/Conv Queries");
  console.log("=========================================");

  // 1. Explain exact phone match
  console.log("\n--- EXPLAIN phone_number = $1 ---");
  try {
    const explain1 = await db.executeSafe({
      text: `
        EXPLAIN
        SELECT id FROM messages
        WHERE phone_number = $1 AND tenant_id = $2
        ORDER BY created_at DESC
        LIMIT 50
      `,
      values: ["77086223402", TENANT_ID]
    }) as any[];
    explain1.forEach(r => console.log(r["QUERY PLAN"]));
  } catch (err: any) {
    console.error("Failed:", err.message);
  }

  // 2. Explain exact conversation_id match (without index)
  console.log("\n--- EXPLAIN conversation_id = $1 (no index yet) ---");
  try {
    const explain2 = await db.executeSafe({
      text: `
        EXPLAIN
        SELECT id FROM messages
        WHERE conversation_id = $1 AND tenant_id = $2
        ORDER BY created_at DESC
        LIMIT 50
      `,
      values: ["fa1b149d-c99f-4e03-be95-139d2c878a13", TENANT_ID]
    }) as any[];
    explain2.forEach(r => console.log(r["QUERY PLAN"]));
  } catch (err: any) {
    console.error("Failed:", err.message);
  }

  process.exit(0);
}

run().catch(console.error);
