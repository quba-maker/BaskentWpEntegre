import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const adminSql = neon(process.env.DATABASE_URL);
  const q1 = await adminSql`SELECT count(*) FROM channels`;
  console.log("Owner Count (No RLS):", q1[0].count);

  const urlAuth = new URL(process.env.DATABASE_URL);
  // Change username and password in URL instead of options
  urlAuth.username = 'app_client';
  urlAuth.password = 'AppClientSuperSecurePassword123!@#_2026';
  // Also keep the option just in case
  urlAuth.searchParams.set('options', '-c role=app_client');
  
  const authSql = neon(urlAuth.toString());
  try {
    const qAuth = await authSql`SELECT count(*) FROM channels`;
    console.log("Auth Count (No Context):", qAuth[0].count);
  } catch (e) {
    console.log("Auth Count (No Context): ERROR OR ZERO", e.message);
  }

  const urlAuthTenant = new URL(urlAuth.toString());
  urlAuthTenant.searchParams.append('options', '-c app.current_tenant_id=7ac1432a-a432-497a-8526-9394f51d0e2a');
  const authTenantSql = neon(urlAuthTenant.toString());
  
  try {
    const qAuthTenant = await authTenantSql`SELECT count(*) FROM channels`;
    console.log("Auth Count (Tenant Context):", qAuthTenant[0].count);
  } catch (e) {
    console.error("Auth Count (Tenant Context) Error:", e.message);
  }
}

main().catch(console.error);

main().catch(console.error);
