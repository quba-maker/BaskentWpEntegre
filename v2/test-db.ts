import { sql } from "./src/lib/db";

async function main() {
  try {
    const leads = await sql`SELECT id, tenant_id, phone_number, customer_id, form_name FROM leads ORDER BY created_at DESC LIMIT 5`;
    console.log("Leads:");
    console.log(leads);
    
    const profiles = await sql`SELECT id, tenant_id, primary_phone FROM customer_profiles ORDER BY created_at DESC LIMIT 5`;
    console.log("\nProfiles:");
    console.log(profiles);
    
  } catch (err) {
    console.error(err);
  }
}
main();
