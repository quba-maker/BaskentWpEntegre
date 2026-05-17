import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  const sql = neon(process.env.DATABASE_URL);
  const res = await sql`SELECT slug, id FROM tenants WHERE slug = 'baskent'`;
  console.log(res);
}
run().catch(console.error);
