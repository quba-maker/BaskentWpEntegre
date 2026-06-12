import { withTenantDB } from "../src/lib/core/tenant-db";
import { resolveTenantDisplayName, resolveIsHealthcare } from "../src/lib/services/meta/tenant-display-name-resolver";

async function runTest() {
  console.log("=== STARTING SECURITY RESOLVER TEST ===");

  // Initialize admin db to find a real active tenant
  const adminDb = withTenantDB("admin-system", true);
  const tenants = await adminDb.executeSafe({
    text: "SELECT id, slug FROM tenants WHERE status = 'active' LIMIT 2"
  }) as any[];

  if (tenants.length === 0) {
    console.error("❌ No active tenants found in the database. Test cannot proceed.");
    process.exit(1);
  }

  const tenantA = tenants[0];
  const tenantB = tenants[1]; // might be undefined if only 1 tenant exists

  console.log(`Found Tenant A: id=${tenantA.id}, slug=${tenantA.slug}`);
  if (tenantB) {
    console.log(`Found Tenant B: id=${tenantB.id}, slug=${tenantB.slug}`);
  }

  const dbA = withTenantDB(tenantA.id);

  // 1. Valid Lookup (Same Tenant)
  console.log("\nTesting: 1. Valid Lookup (Same Tenant)");
  try {
    const name = await resolveTenantDisplayName(dbA, tenantA.id);
    console.log(`   Result: Display Name resolved to: "${name}"`);
    if (name === null) {
      console.error("❌ Failed: Display name resolved to null for valid tenant");
      process.exit(1);
    }
    console.log("   ✅ Valid lookup passed without SECURITY_QUERY_REJECTED!");
  } catch (err: any) {
    console.error(`❌ Failed: Valid lookup threw an error: ${err.message}`);
    process.exit(1);
  }

  // 2. Cross-Tenant Lookup Blocked
  if (tenantB) {
    console.log("\nTesting: 2. Cross-Tenant Lookup (Tenant A attempting to resolve Tenant B)");
    try {
      const name = await resolveTenantDisplayName(dbA, tenantB.id);
      console.log(`   Result: ${name}`);
      if (name !== null) {
        console.error("❌ Failed: Tenant A resolved Tenant B's name! Cross-tenant leak detected!");
        process.exit(1);
      }
      console.log("   ✅ Cross-tenant lookup successfully blocked!");
    } catch (err: any) {
      console.error(`❌ Failed: Threw error instead of returning null: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log("\nSkipping: 2. Cross-Tenant Lookup (only one tenant exists)");
  }

  // 3. Invalid UUID Lookup handled gracefully
  console.log("\nTesting: 3. Invalid UUID Lookup (malformed string)");
  try {
    const name = await resolveTenantDisplayName(dbA, "invalid-uuid-string");
    console.log(`   Result: ${name}`);
    if (name !== null) {
      console.error("❌ Failed: Invalid UUID resolved to a value!");
      process.exit(1);
    }
    console.log("   ✅ Invalid UUID handled gracefully (returned null)!");
  } catch (err: any) {
    console.error(`❌ Failed: Threw error for invalid UUID: ${err.message}`);
    process.exit(1);
  }

  // 4. resolveIsHealthcare Validation
  console.log("\nTesting: 4. resolveIsHealthcare Validation");
  try {
    const isHealthcare = await resolveIsHealthcare(dbA, tenantA.id);
    console.log(`   Result: ${isHealthcare}`);
    console.log("   ✅ resolveIsHealthcare executed successfully!");
  } catch (err: any) {
    console.error(`❌ Failed: resolveIsHealthcare threw an error: ${err.message}`);
    process.exit(1);
  }

  console.log("\n=== ALL SECURITY RESOLVER TESTS PASSED SUCCESSFULLY! ===");
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
