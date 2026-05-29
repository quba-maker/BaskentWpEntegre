import dotenv from "dotenv";
dotenv.config({ path: "../.env.local" });
import { withTenantDB } from "../src/lib/core/tenant-db";

const TEST_TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function runAudit() {
  const db = withTenantDB(TEST_TENANT_ID, true);
  
  console.log("=== DB & SETUP CHECK ===");
  const tables = await db.executeSafe({ text: "SELECT table_name FROM information_schema.tables WHERE table_schema='public'" }) as any[];
  console.log("Tables exist:", tables.length > 10 ? "YES" : "NO");

  const templates = await db.executeSafe({ text: "SELECT template_type, count(*) as c FROM message_templates GROUP BY template_type" }) as any[];
  console.log("Templates:", templates);

  const rules = await db.executeSafe({ text: "SELECT count(*) as c FROM automation_rules" }) as any[];
  console.log("Automation rules count:", rules[0].c);

  console.log("\n=== ZERO OUTBOUND CHECK ===");
  const outbound = await db.executeSafe({ text: "SELECT count(*) as c FROM messages WHERE direction = 'out'" }) as any[];
  console.log("Outbound messages count:", outbound[0].c);
  
  const recentOutbound = await db.executeSafe({ text: "SELECT id, created_at, content FROM messages WHERE direction = 'out' ORDER BY created_at DESC LIMIT 3" }) as any[];
  console.log("Recent outbound:", recentOutbound);

  console.log("\n=== TELEGRAM CHECK ===");
  const tg = await db.executeSafe({ text: "SELECT count(*) as c FROM notification_channels WHERE channel_type = 'telegram'" }) as any[];
  console.log("Telegram channels:", tg[0].c);

  console.log("\n=== ENV CHECK ===");
  console.log("USE_V2_TASK_ENGINE:", process.env.USE_V2_TASK_ENGINE);
  console.log("ENABLE_V2_ORPHAN_TASK_GENERATION:", process.env.ENABLE_V2_ORPHAN_TASK_GENERATION);
  console.log("QSTASH_TOKEN present:", !!process.env.QSTASH_TOKEN);
  console.log("QSTASH_URL present:", !!process.env.QSTASH_URL);
  
  process.exit(0);
}

runAudit().catch(console.error);
