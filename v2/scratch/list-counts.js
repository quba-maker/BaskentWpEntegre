const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  try {
    const tenants = await sql`SELECT id, name, slug FROM tenants`;
    console.log("Tenants:", tenants);

    for (const t of tenants) {
      const usersCount = await sql`SELECT COUNT(*) FROM users WHERE tenant_id = ${t.id}`;
      const convsCount = await sql`SELECT COUNT(*) FROM conversations WHERE tenant_id = ${t.id}`;
      const msgCount = await sql`SELECT COUNT(*) FROM messages WHERE tenant_id = ${t.id}`;
      console.log(`Tenant ${t.slug} (${t.name}): users=${usersCount[0].count}, conversations=${convsCount[0].count}, messages=${msgCount[0].count}`);
    }

    // Let's print some conversations if any exist
    const allConvsCount = await sql`SELECT COUNT(*) FROM conversations`;
    console.log("Total conversations overall:", allConvsCount[0].count);
    if (allConvsCount[0].count > 0) {
      const sample = await sql`SELECT id, tenant_id, phone_number FROM conversations LIMIT 5`;
      console.log("Sample conversations:", sample);
    }
  } catch (err) {
    console.error(err);
  }
}
run();
