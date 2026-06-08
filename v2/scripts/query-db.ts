import * as fs from "fs";
import * as path from "path";
import { parse } from "dotenv";

const envLocalPath = path.join(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
  const envConfig = parse(fs.readFileSync(envLocalPath));
  for (const k in envConfig) {
    process.env[k] = envConfig[k];
  }
}

const TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";

async function main() {
  const { withTenantDB } = await import("../src/lib/core/tenant-db");
  const db = withTenantDB(TENANT_ID, true);

  console.log("Querying conversations count grouped by channel and autopilot_enabled...");
  try {
    const res = await db.executeSafe({
      text: `
        SELECT channel, autopilot_enabled, COUNT(*)::int as count 
        FROM conversations 
        WHERE tenant_id = $1 
        GROUP BY channel, autopilot_enabled
      `,
      values: [TENANT_ID]
    }) as any[];

    console.table(res);

    console.log("Checking if there are active pins/archives/favorites...");
    const counts = await db.executeSafe({
      text: `
        SELECT 
          (SELECT COUNT(*)::int FROM conversation_pins WHERE tenant_id = $1) as pins_count,
          (SELECT COUNT(*)::int FROM conversation_favorites WHERE tenant_id = $1) as favorites_count,
          (SELECT COUNT(*)::int FROM conversation_archives WHERE tenant_id = $1) as archives_count
      `,
      values: [TENANT_ID]
    }) as any[];
    console.table(counts);

  } catch (err) {
    console.error("Query failed:", err);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
