import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const CUST_ID = "b4544238-407e-495f-82ea-bd70f27209c6";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  const profile = await db.executeSafe({
    text: `
      SELECT *
      FROM customer_profiles
      WHERE tenant_id = $1
        AND id = $2
    `,
    values: [TENANT_ID, CUST_ID]
  }) as any[];

  console.log("Customer Profile found for Feti:");
  console.dir(profile, { depth: null });

  process.exit(0);
}

run().catch(console.error);
