import dotenv from "dotenv";
import path from "path";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function run() {
  const sql = neon(process.env.DATABASE_URL!);
  
  const integrations = await sql`
    SELECT id, tenant_id, credentials, health_status, last_sync_at, cron_last_run_at, webhook_last_received_at 
    FROM tenant_integrations WHERE provider = 'google_sheets' AND tenant_id = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8'
  `;
  console.log("tenant_integrations count:", integrations.length);
  for (const integration of integrations) {
    console.log("Integration ID:", integration.id);
    console.log("Tenant ID:", integration.tenant_id);
    console.log("Health:", integration.health_status);
    console.log("Last Sync At:", integration.last_sync_at);
    console.log("Cron Last Run At:", integration.cron_last_run_at);
    console.log("Webhook Last Received At:", integration.webhook_last_received_at);
  }

  const pipelines = await sql`
    SELECT id, tenant_id, provider, config, greeting_group_id, outbound_channel_id FROM ingestion_pipelines WHERE provider = 'google_sheets'
  `;
  console.log("\ningestion_pipelines count:", pipelines.length);
  for (const pipeline of pipelines) {
    console.log("Pipeline ID:", pipeline.id);
    console.log("Tenant ID:", pipeline.tenant_id);
    console.log("Provider:", pipeline.provider);
    console.log("Config:", JSON.stringify(pipeline.config, null, 2));
    console.log("Greeting Group ID:", pipeline.greeting_group_id);
    console.log("Outbound Channel ID:", pipeline.outbound_channel_id);
  }
}

run();
