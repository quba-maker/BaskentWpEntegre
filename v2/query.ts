import { sql } from "./src/lib/db";
import { MemoryEngine } from "./src/lib/services/ai/engines/memory";

async function run() {
  const phone = '905546833306';
  
  // Find conversation
  const conversations = await sql`
    SELECT id, tenant_id, phone_number, name 
    FROM conversations 
    WHERE phone_number LIKE ${'%' + phone.substring(phone.length - 10)}
    LIMIT 5;
  `;
  
  console.log("Found conversations:", conversations);
  
  if (conversations.length === 0) {
    console.error("No conversation found for phone:", phone);
    return;
  }
  
  const targetConv = conversations[0];
  console.log(`Running summarizeConversation for ${targetConv.name} (Tenant: ${targetConv.tenant_id}, ConvID: ${targetConv.id})...`);
  
  await MemoryEngine.summarizeConversation(targetConv.tenant_id, targetConv.id);
  
  // Fetch result to verify
  const memory = await sql`
    SELECT * FROM conversation_memory 
    WHERE conversation_id = ${targetConv.id}
    LIMIT 1;
  `;
  console.log("Resulting Conversation Memory:", memory);
}

run().catch(console.error).finally(() => process.exit(0));
