import dotenv from "dotenv";
import path from "path";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function run() {
  const sql = neon(process.env.DATABASE_URL!);
  
  console.log("=== LATEST PIPELINE EVENTS ===");
  const events = await sql`
    SELECT id, tenant_id, event_type, payload, created_at
    FROM pipeline_events 
    WHERE tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'
    ORDER BY created_at DESC LIMIT 20
  `;
  console.log(JSON.stringify(events, null, 2));
}

run();
