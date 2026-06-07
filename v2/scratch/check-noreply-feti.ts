import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const LEAD_ID = "86a7216e-8c17-409f-ad21-409b930b0603";

async function run() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("=========================================");
  console.log("🔍 Checking No-Reply Eligibility for Feti Ereci");
  console.log("=========================================");

  const { resolveFirstContactCore } = await import("../src/lib/utils/first-contact-status-resolver");
  const res = await resolveFirstContactCore(db, TENANT_ID, LEAD_ID);
  
  console.log("\nResolver output:");
  console.dir(res, { depth: null });

  process.exit(0);
}

run().catch(console.error);
