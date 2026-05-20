import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);
try {
  const users = await sql`SELECT id, email, role, is_active FROM users;`;
  console.log("USERS:", users);
  
  const tenants = await sql`SELECT id, slug, status FROM tenants;`;
  console.log("TENANTS:", tenants);
} catch (e) {
  console.error("DB Error:", e);
}
