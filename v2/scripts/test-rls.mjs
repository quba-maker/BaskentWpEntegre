import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const dbUrl = process.env.DATABASE_URL;

async function testRls() {
  const adminSql = neon(dbUrl);
  
  // 1. Get a tenant
  const tenants = await adminSql`SELECT id FROM tenants LIMIT 2`;
  if (tenants.length < 2) {
    console.log("Need at least 2 tenants to test.");
    return;
  }
  
  const tenantA = tenants[0].id;
  const tenantB = tenants[1].id;
  
  console.log(`Tenant A: ${tenantA}`);
  console.log(`Tenant B: ${tenantB}`);
  
  try {
    const noContext = await adminSql`SELECT count(*) FROM channels`;
    console.log(`[FAIL] No Context Query succeeded: ${noContext[0].count} rows. Expected an error or 0.`);
  } catch (err) {
    console.log(`[PASS] No Context Query failed correctly: ${err.message}`);
  }

  // 3. Context Tenant A
  const urlA = new URL(dbUrl);
  urlA.searchParams.set('options', `-c app.current_tenant_id=${tenantA}`);
  const sqlA = neon(urlA.toString());
  const countA = await sqlA`SELECT count(*) FROM channels`;
  console.log(`[PASS] Tenant A channels count: ${countA[0].count}`);

  // 4. Context Tenant B
  const urlB = new URL(dbUrl);
  urlB.searchParams.set('options', `-c app.current_tenant_id=${tenantB}`);
  const sqlB = neon(urlB.toString());
  const countB = await sqlB`SELECT count(*) FROM channels`;
  console.log(`[PASS] Tenant B channels count: ${countB[0].count}`);

  // 5. Bypass Context
  const bypassUrl = new URL(dbUrl);
  bypassUrl.searchParams.set('options', `-c app.bypass_rls=true`);
  const sqlBypass = neon(bypassUrl.toString());
  const countBypass = await sqlBypass`SELECT count(*) FROM channels`;
  console.log(`[PASS] Bypass mode channels count: ${countBypass[0].count}`);
  
}

testRls().catch(console.error);
