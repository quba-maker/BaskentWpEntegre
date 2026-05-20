import { sql } from "./src/lib/db";
async function run() {
  const tid = '43c08749-ecc3-452f-a48d-60cd631986f8';
  const settings = await sql`SELECT * FROM settings WHERE tenant_id = ${tid}`;
  console.log("Settings:", settings);
}
run().catch(console.error).finally(() => process.exit(0));
