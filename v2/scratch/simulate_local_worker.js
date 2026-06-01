const { QueueWorkerEngine } = require("../src/lib/queue/worker.ts");
const { neon } = require("@neondatabase/serverless");
const dotenv = require("dotenv");

dotenv.config({ path: "/Users/mustafa/Desktop/baskent-wp-entegre/v2/.env.local" });
const appDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
  const sql = neon(appDatabaseUrl);
  
  // Find İsa's conversation to get tenant_id and customer_id
  const conversations = await sql`
    SELECT tenant_id, id FROM conversations WHERE phone_number = '905546833306' LIMIT 1
  `;
  
  if (conversations.length === 0) {
    console.error("Conversation for İsa not found.");
    return;
  }
  
  const { tenant_id: tenantId, id: conversationId } = conversations[0];
  console.log(`Using tenantId: ${tenantId}, conversationId: ${conversationId}`);
  
  // Construct the exact Meta Webhook Payload for "evet onaylıyorum"
  const payload = {
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

  const metadata = {
    messageId: "simulated-" + crypto.randomUUID(),
    publishedAt: new Date().toISOString()
  };

  // Temporarily set the tenant_id env variable for guard assertion bypass
  process.env.TEST_TENANT_ID = tenantId;

  // Initialize the worker engine
  const engine = new QueueWorkerEngine();
  
  console.log("Starting QueueWorkerEngine.processEvent locally...");
  await engine.processEvent("whatsapp.message.received", tenantId, payload, metadata);
  console.log("Local processEvent completed successfully!");
}

main().catch(console.error);
