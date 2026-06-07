import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  const convs = await db.executeSafe({
    text: `
      SELECT id, phone_number, patient_name, status, channel_id, customer_id, tags
      FROM conversations
      WHERE tenant_id = $1
        AND phone_number = '77086223402'
    `,
    values: [TENANT_ID]
  }) as any[];

  console.log("Conversations found for Feti:");
  console.dir(convs, { depth: null });

  process.exit(0);
}

run().catch(console.error);
