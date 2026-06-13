import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function main() {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  console.log("=== STARTING PROMPT CONTENT AUDIT ===");
  console.log(`Tenant ID: ${tenantId}`);
  console.log(`USE_V2_BRAIN_RESOLUTION: ${process.env.USE_V2_BRAIN_RESOLUTION || 'not set (uses default)'}`);
  console.log(`USE_V1_FALLBACK: ${process.env.USE_V1_FALLBACK || 'not set (uses default)'}`);

  // Dynamic imports to ensure dotenv.config() has loaded process.env before files execute
  const { withTenantDB } = await import('../src/lib/core/tenant-db');
  const { BrainResolver } = await import('../src/lib/brain/brain-resolver');
  const { PromptBuilder } = await import('../src/lib/services/ai/prompt-builder');

  // Fetch active channel
  const db = withTenantDB(tenantId, true);
  const channels = await db.executeSafe({
    text: "SELECT id, provider, identifier FROM channels WHERE group_id IN (SELECT id FROM channel_groups WHERE tenant_id = $1) AND provider = '360dialog' LIMIT 1",
    values: [tenantId]
  }) as any[];

  if (channels.length === 0) {
    console.error("No active WhatsApp (360dialog) channel found for tenant!");
    return;
  }
  const channel = channels[0];
  console.log(`Resolved active WhatsApp channel: ${channel.id} (Identifier: ${channel.identifier})`);

  // Mock webhook payload and context
  const mockPayload = {
    contacts: [{ profile: { name: 'Murtaza Test' } }],
    messages: [{ from: '905546833306', text: { body: 'Merhabalar' }, type: 'text', id: 'mock-msg-id-123' }]
  };

  console.log("\nResolving TenantBrain...");
  const brain = await BrainResolver.resolveTenantBrain(mockPayload, 'whatsapp', 'mock-webhook-id', channel.id);
  console.log(`Brain source resolved: ${brain.source}`);
  console.log(`Base prompt length from DB: ${brain.prompts.systemPrompt?.length || 0} characters`);
  console.log(`AI Model resolved: ${brain.context.settings?.aiModel}`);
  console.log(`Max Messages: ${brain.context.settings?.maxMessages}`);
  console.log(`Response Style: ${brain.context.settings?.responseStyle}`);

  // Mock unifiedContext for PromptBuilder
  const mockUnifiedContext = {
    currentMessageText: 'Merhabalar',
    currentMessageMediaType: 'text',
    languageContext: {
      reply_language: 'Turkish',
      detected_patient_language: 'Turkish'
    },
    profile: {
      first_name: 'Mustafa',
      last_name: 'Yılmaz',
      country: 'Türkiye'
    },
    opportunity: {
      summary: 'Kardiyoloji kontrolü bekliyor, fiyat bilgisi sordu.',
      ai_reason: 'Fiyat itirazı var',
      country: 'Türkiye'
    },
    history: [
      { role: 'user', content: 'Merhabalar' },
      { role: 'assistant', content: 'Merhaba, Başkent Üniversitesi Konya Hastanesinden Rüya ben. Nasıl yardımcı olabilirim?' }
    ]
  };

  console.log("\nBuilding system prompt...");
  const finalPrompt = PromptBuilder.buildSystemPrompt(brain, 'lead', false, mockUnifiedContext);
  console.log(`Final LLM system prompt length: ${finalPrompt.length} characters`);
  console.log(`PromptBuilder added characters: ${finalPrompt.length - (brain.prompts.systemPrompt?.length || 0)} characters`);

  console.log("\n=== FIRST 500 CHARACTERS OF FINAL PROMPT ===");
  console.log(finalPrompt.substring(0, 500) + "...\n");

  console.log("=== LAST 500 CHARACTERS OF FINAL PROMPT ===");
  console.log("..." + finalPrompt.substring(finalPrompt.length - 500));
  console.log("\n=== AUDIT FINISHED SUCCESSFULLY ===");
}

main().catch(err => {
  console.error("Error during prompt audit:", err);
});
