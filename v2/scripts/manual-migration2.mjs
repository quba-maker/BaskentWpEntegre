import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

async function main() {
  try {
    console.log("Creating dead_letter_jobs table...");
    await sql`
      CREATE TABLE IF NOT EXISTS dead_letter_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        payload JSONB,
        error_message TEXT,
        error_stack TEXT,
        status TEXT DEFAULT 'unresolved',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("Done.");
  } catch (err) {
    console.error(err);
  }
}
main();
