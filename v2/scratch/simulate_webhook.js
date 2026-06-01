const dotenv = require("dotenv");
const { neon } = require("@neondatabase/serverless");

dotenv.config({ path: "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local" });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const sql = neon(appDatabaseUrl);
  
  // 1. Get İsa's conversation details (tenant_id)
  const conversations = await sql`
    SELECT tenant_id, id FROM conversations WHERE phone_number = '905546833306' LIMIT 1
  `;
  
  if (conversations.length === 0) {
    console.error("Conversation for İsa not found.");
    return;
  }
  
  const { tenant_id: tenantId, id: conversationId } = conversations[0];
  console.log(`Found İsa conversation. tenantId: ${tenantId}, conversationId: ${conversationId}`);
  
  // 2. Prepare mock Meta Webhook Payload for "evet onaylıyorum"
  const webhookPayload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "2733513257027362",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550293290",
                phone_number_id: "1072536945944841"
              },
              contacts: [
                {
                  profile: {
                    name: "İsa"
                  },
                  wa_id: "905546833306"
                }
              ],
              messages: [
                {
                  from: "905546833306",
                  id: "wamid.HBgLOTA1NTQ2ODMzMzA2FQIAERgSRTk0OTM5QTRGNDEzNDMzMTUzAA==" + Math.random().toString(36).substring(7),
                  timestamp: Math.round(Date.now() / 1000).toString(),
                  text: {
                    body: "evet onaylıyorum"
                  },
                  type: "text"
                }
              ]
            },
            field: "messages"
          }
        ]
      }
    ]
  };

  // 3. Construct QueueMessage format expected by /api/queue-worker
  const queueMessage = {
    id: "simulated-" + crypto.randomUUID(),
    traceId: "simulated-trace-" + crypto.randomUUID(),
    tenantId: tenantId,
    topic: "whatsapp.message.received",
    payload: webhookPayload,
    timestamp: Date.now()
  };

  console.log("Sending POST to http://localhost:3000/api/queue-worker...");
  
  const response = await fetch("http://localhost:3000/api/queue-worker", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": tenantId,
      "x-topic": "whatsapp.message.received"
    },
    body: JSON.stringify(queueMessage)
  });

  const responseText = await response.text();
  console.log(`Response Status: ${response.status}`);
  console.log(`Response Body: ${responseText}`);
}

main().catch(console.error);
