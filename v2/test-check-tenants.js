require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  try {
    const tenants = await sql`SELECT id, slug, name, status FROM tenants`;
    console.log("Tenants:", JSON.stringify(tenants, null, 2));
    
    const users = await sql`SELECT id, email, role, tenant_id, is_active FROM users`;
    console.log("Users:", JSON.stringify(users, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
