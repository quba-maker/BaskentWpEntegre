const dotenv = require("dotenv");
dotenv.config({ path: "./.env.local" });

// Helper to mask phone numbers (e.g. +90553***4260)
function maskPhone(phone) {
  if (!phone) return "N/A";
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length < 7) return "***";
  return `+${cleaned.substring(0, 2)}5***${cleaned.substring(cleaned.length - 4)}`;
}

// Helper to scrub secrets from text payload or URL
function scrubText(text) {
  if (!text) return "";
  // Scrub 360dialog API Keys, webhook secrets, Facebook lookaside URLs with signatures
  let scrubbed = text;
  
  // Scrub long hex/alphanumeric keys
  scrubbed = scrubbed.replace(/[a-zA-Z0-9_-]{30,}/g, "[SECRET_KEY_SCRUBBED]");
  
  // Mask lookaside signatures (hash and ext query params)
  scrubbed = scrubbed.replace(/hash=[a-zA-Z0-9%_-]+/g, "hash=[SIGNATURE_MASKED]");
  scrubbed = scrubbed.replace(/ext=[0-9]+/g, "ext=[EXPIRY_MASKED]");
  
  // Mask lookaside URLs
  scrubbed = scrubbed.replace(/https:\/\/lookaside\.fbsbx\.com\/[^\s"']+/g, "https://lookaside.fbsbx.com/attachments/...[LOOKASIDE_SCRUBBED]");
  
  return scrubbed;
}

async function main() {
  const { withTenantDB } = require("../src/lib/core/tenant-db");
  const tenantId = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
  const channelId = "2e7352c1-5db7-4414-baf7-de571a66bfa6";
  
  console.log("-----------------------------------------------------------------");
  console.log("🛡️  Başkent 360dialog Media Test Secure Monitoring System");
  console.log("-----------------------------------------------------------------");
  
  const adminDb = withTenantDB(tenantId, true);
  
  // Filter for last 30 minutes
  const timeLimit = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  
  console.log(`Filtering events and messages since: ${timeLimit} (Last 30 mins)`);

  // 1. Fetch recent webhook events
  console.log("\n📡 Webhook Ingestion Events (channel_events):");
  const events = await adminDb.executeSafe({
    text: `
      SELECT id, event_type, created_at, payload
      FROM channel_events
      WHERE channel_id = $1 
        AND created_at >= $2
        AND event_type = '360dialog_webhook_received'
      ORDER BY created_at DESC
      LIMIT 10
    `,
    values: [channelId, timeLimit]
  });

  if (events.length === 0) {
    console.log("   ❌ No 360dialog webhook events found in the last 30 minutes.");
  } else {
    for (const e of events) {
      const payloadStr = JSON.stringify(e.payload);
      const changes = e.payload?.entry?.[0]?.changes?.[0]?.value;
      const incomingMsg = changes?.messages?.[0];
      const statuses = changes?.statuses?.[0];

      if (incomingMsg) {
        console.log(`   - 📥 [INBOUND_${incomingMsg.type.toUpperCase()}] Event ID: ${e.id} | Time: ${e.created_at.toISOString()}`);
        console.log(`     From: ${maskPhone(incomingMsg.from)}`);
        console.log(`     Message ID: ${incomingMsg.id}`);
        if (incomingMsg.text) {
          console.log(`     Text Content: ${scrubText(incomingMsg.text.body)}`);
        }
        if (incomingMsg[incomingMsg.type]) {
          const mInfo = incomingMsg[incomingMsg.type];
          console.log(`     Media Details in Webhook: id=${mInfo.id}, mime_type=${mInfo.mime_type || "N/A"}, filename=${mInfo.filename || "N/A"}`);
        }
      } else if (statuses) {
        console.log(`   - ⚡ [STATUS_${statuses.status.toUpperCase()}] Event ID: ${e.id} | Time: ${e.created_at.toISOString()}`);
        console.log(`     Recipient: ${maskPhone(statuses.recipient_id)}`);
        console.log(`     Status Message ID: ${statuses.id}`);
      } else {
        console.log(`   - ⚙️ [OTHER_EVENT] Event ID: ${e.id} | Type: ${e.event_type}`);
      }
    }
  }

  // 2. Fetch recent database messages
  console.log("\n💬 Messages Table Logging & Sync Status:");
  const messages = await adminDb.executeSafe({
    text: `
      SELECT m.id, m.phone_number, m.direction, m.content, m.media_type, m.media_url, m.media_metadata, m.model_used, m.created_at
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.channel_id = $1 
        AND m.created_at >= $2
      ORDER BY m.created_at DESC
      LIMIT 15
    `,
    values: [channelId, timeLimit]
  });

  if (messages.length === 0) {
    console.log("   ❌ No messages found in database for this channel in the last 30 minutes.");
  } else {
    let outboundCount = 0;
    
    for (const m of messages) {
      const isOutbound = m.direction === 'out';
      if (isOutbound) outboundCount++;
      
      const dirSymbol = isOutbound ? "📤 OUT" : "📥 IN ";
      console.log(`   [${dirSymbol}] Message ID: ${m.id} | Time: ${m.created_at.toISOString()}`);
      console.log(`     Sender/Recipient: ${maskPhone(m.phone_number)}`);
      console.log(`     Model Used: ${m.model_used || "NULL (Human Action)"}`);
      console.log(`     Content: ${scrubText(m.content)}`);
      
      if (m.media_type) {
        console.log(`     👉 MEDIA DETECTED: [${m.media_type.toUpperCase()}]`);
        console.log(`        - media_url: ${m.media_url ? m.media_url : "❌ NULL (DOWNLOAD FAILED)"}`);
        console.log(`        - media_metadata: ${JSON.stringify(m.media_metadata)}`);
        
        // Tenant isolation validation
        if (m.media_url) {
          const isIsolated = m.media_url.includes(`/media/${tenantId}/`);
          console.log(`        - Blob Path Tenant-Isolated: ${isIsolated ? "✅ YES (Secure & Scoped)" : "❌ NO (Leaked path!)"}`);
        }
      }
      console.log("");
    }
    
    console.log(`   -----------------------------------------------------------------`);
    console.log(`   📊 Bot Outbound Activity Check:`);
    console.log(`     Total Outbound Messages in last 30 mins: ${outboundCount}`);
    
    const botOutbound = messages.filter(m => m.direction === 'out' && m.model_used !== null);
    console.log(`     AI Bot Outbound Count: ${botOutbound.length}`);
    if (botOutbound.length === 0) {
      console.log(`     ✅ ZERO-OUTBOUND PROTECTION ACTIVE: Bot outbound delta is 0.`);
    } else {
      console.log(`     ⚠️ WARNING: Bot outbound delta is ${botOutbound.length}!`);
    }
  }
  console.log("-----------------------------------------------------------------\n");
}

main().catch(console.error);
