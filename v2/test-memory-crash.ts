import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });
import { sql } from "./src/lib/db";
import { MemoryEngine } from "./src/lib/services/ai/engines/memory";

async function run() {
  const tenantId = 'quba-maker/BaskentWpEntegre';
  const phone = '905546833306';
  
  const conv = await sql`SELECT id FROM conversations WHERE phone_number = ${phone} AND tenant_id = ${tenantId} LIMIT 1`;
  if (conv.length === 0) {
    console.log("No conv");
    process.exit(0);
  }
  
  console.log("Summarizing conversation:", conv[0].id);
  
  try {
    await MemoryEngine.summarizeConversation(tenantId, conv[0].id);
    console.log("SUCCESS");
  } catch (err) {
    console.error("CRASH:", err);
  }
  
  process.exit(0);
}

run();
