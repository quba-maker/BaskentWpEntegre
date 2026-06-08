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

process.env.TEST_TENANT_ID = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
process.env.TEST_USER_ID = "23429a66-d897-4504-a7fb-c5ff898f9163";

async function main() {
  const { getConversations } = await import("../src/app/actions/inbox");

  const runTest = async (primary: string, channel: string, stage: string) => {
    console.log(`\n--- Test Case: primary=${primary}, channel=${channel}, stage=${stage} ---`);
    try {
      const result = await getConversations(
        1,       // page
        "",      // search
        stage,   // stage
        primary, // primaryFilter
        "all_reply", // replyFilter
        channel  // channelFilter
      );
      console.log("Returned rows count:", Array.isArray(result) ? result.length : "Not an array");
      if (Array.isArray(result) && result.length > 0) {
        console.log(`First 3 items:`);
        result.slice(0, 3).forEach((item: any, idx: number) => {
          console.log(`  ${idx + 1}. ID: ${item.id}, Name: ${item.name}, Channel: ${item.channel}, Stage: ${item.stage}, isBotActive: ${item.isBotActive}`);
        });
      }
    } catch (err) {
      console.error("Error running test:", err);
    }
  };

  // Test Case 1: Tümü + Botta
  await runTest("bot_active", "all", "all");

  // Test Case 2: Tümü + WhatsApp
  await runTest("all", "whatsapp", "all");

  // Test Case 3: Botta + WhatsApp
  await runTest("bot_active", "whatsapp", "all");

  // Test Case 4: Botta + Stage (new)
  await runTest("bot_active", "all", "new");
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});

