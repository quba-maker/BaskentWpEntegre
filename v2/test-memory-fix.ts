import 'dotenv/config';
import { sql } from "./src/lib/db";
import { MemoryEngine } from "./src/lib/services/ai/engines/memory";

async function run() {
  const phone = '905546833306';
  const tenantId = 'quba-maker'; // Assuming tenantId is quba-maker
  
  console.log("Fetching latest messages from DB...");
  const msgs = await sql`SELECT * FROM (
          SELECT content, direction, created_at
          FROM messages
          WHERE tenant_id = ${tenantId} 
            AND phone_number = ${phone}
          ORDER BY created_at DESC
          LIMIT 10
        ) sub
        ORDER BY created_at ASC;`;
  console.log(msgs.map(m => `[${m.direction}] ${m.content}`).join("\n"));
  
  console.log("\nRunning summarization...");
  await MemoryEngine.summarizeConversation(tenantId, phone);
  
  console.log("\nChecking DB for new summary...");
  const mem = await sql`SELECT * FROM conversation_memory WHERE conversation_id = (SELECT id FROM conversations WHERE phone_number = ${phone} AND tenant_id = ${tenantId} LIMIT 1)`;
  console.log("Memory in DB:", mem[0]?.ai_summary);
  
  process.exit(0);
}
run();
