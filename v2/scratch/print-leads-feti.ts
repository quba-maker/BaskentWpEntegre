import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  const leads = await db.executeSafe({
    text: `
      SELECT id, patient_name, phone_number, stage, customer_id, created_at
      FROM leads
      WHERE tenant_id = $1
        AND (
          phone_number LIKE '%77086223402%'
          OR phone_number LIKE '%7086223402%'
          OR patient_name ILIKE '%Feti%'
        )
    `,
    values: [TENANT_ID]
  }) as any[];

  console.log("Leads found for Feti:");
  console.dir(leads, { depth: null });

  process.exit(0);
}

run().catch(console.error);
