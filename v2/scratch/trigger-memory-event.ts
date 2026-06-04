import { RealtimePublisher } from '../src/lib/realtime/publisher';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const tenantId = "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
  const conversationId = "74c9ef00-c0c4-4504-81fa-fbc8d5aacc71"; // Anees Ali

  console.log(`Triggering realtime memory update for conversation ${conversationId}...`);
  await RealtimePublisher.publishMemoryUpdated(tenantId, conversationId, {
    aiSummary: "MOCK AI SUMMARY UPDATE AT " + new Date().toISOString() + " - Note: This summary should NOT overwrite the manual notes.",
    aiBuyingIntent: "HOT",
    aiSentiment: "POSITIVE",
    objections: ["None"]
  });
  console.log("Memory update event published successfully!");
}

main().catch(console.error);
