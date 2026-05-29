import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { withTenantDB } from "../src/lib/core/tenant-db";
import { getFocusQueueItems } from "../src/app/actions/focus-queue";

const TEST_TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const TEST_OPPORTUNITY_ID = "0a05b03a-d526-4c88-8806-1230faaac3ea"; // Merve
process.env.TEST_TENANT_ID = TEST_TENANT_ID;
process.env.TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

async function runSmoke() {
  const db = withTenantDB(TEST_TENANT_ID, true);
  
  // 1. Merve in queue?
  const res = await getFocusQueueItems(TEST_TENANT_ID);
  const items = res.data || [];
  const merve = items.find((i: any) => i.opportunityId === TEST_OPPORTUNITY_ID);
  console.log("3. Merve in queue:", !!merve);
  if (merve) {
    console.log("4. Merve status/priority:", merve.stage, merve.priority, merve.nextBestAction);
  }

  // 11. Production messages out check
  const msgs = await db.executeSafe({
    text: `SELECT COUNT(*) as c FROM messages WHERE direction = 'out' AND created_at > NOW() - INTERVAL '1 hour'`
  }) as any[];
  // If there are legit outbound msgs, it's fine, but our test shouldn't have caused unexpected ones.
  console.log("11. Outbound messages in last 1 hour:", msgs[0].c);

  // Check stage wasn't altered by validate script
  const opp = await db.executeSafe({
    text: `SELECT stage FROM opportunities WHERE id = $1`,
    values: [TEST_OPPORTUNITY_ID]
  }) as any[];
  console.log("Stage unchanged check:", opp[0]?.stage);
}

runSmoke().catch(console.error);
