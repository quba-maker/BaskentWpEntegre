import { sql } from "@/lib/db";
async function run() {
  const res = await sql`SELECT id, tenant_id, phone_number, direction, content FROM messages ORDER BY created_at DESC LIMIT 5`;
  console.log(res);
}
run().catch(console.error).finally(() => process.exit(0));
