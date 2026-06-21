import './preload';

const testScenarios = [
  { id: 1, name: "Greeting Only (Merhabalar)", messages: [{ role: "user", content: "Merhabalar" }] },
  { id: 2, name: "Status inquiry (Nasılsınız)", messages: [{ role: "user", content: "Nasılsınız" }] },
  { id: 3, name: "Identity inquiry (Ben kimle görüşüyorum?)", messages: [{ role: "user", content: "Ben kimle görüşüyorum?" }] },
  { id: 4, name: "Doctor name request (Doktor ismi verebilir misiniz?)", messages: [{ role: "user", content: "Doktor ismi verebilir misiniz?" }] },
  { id: 5, name: "Clinic routing inquiry (Mide yanması için hangi bölüme gitmeliyim?)", messages: [{ role: "user", content: "Mide yanması için hangi bölüme gitmeliyim?" }] },
  { id: 6, name: "Topic shift (Dahiliye mide yanması var)", messages: [{ role: "user", content: "Dahiliye mide yanması var" }] },
  { id: 7, name: "Pricing request (Fiyat ne kadar?)", messages: [{ role: "user", content: "Fiyat ne kadar?" }] },
  { id: 8, name: "Location check (İstanbul’da hastaneniz var mı?)", messages: [{ role: "user", content: "İstanbul’da hastaneniz var mı?" }] },
  { id: 9, name: "Complex case check (Akromegali ameliyatı yapıyor musunuz?)", messages: [{ role: "user", content: "Akromegali ameliyatı yapıyor musunuz?" }] },
  { id: 10, name: "Organ transplant check (Organ nakli yapıyor musunuz?)", messages: [{ role: "user", content: "Organ nakli yapıyor musunuz?" }] },
  { id: 11, name: "Topic shift / Cancellation (Plan iptal gelmeyeceğim, başka bir hastalık hakkında bilgi almak istiyorum)", messages: [{ role: "user", content: "Plan iptal gelmeyeceğim, başka bir hastalık hakkında bilgi almak istiyorum" }] },
  { id: 12, name: "Cancellation request (Randevumu iptal etmek istiyorum)", messages: [{ role: "user", content: "Randevumu iptal etmek istiyorum" }] },
  { id: 13, name: "Opt-out request (Beni aramayın)", messages: [{ role: "user", content: "Beni aramayın" }] }
];

async function main() {
  const tenantId = 'caab9ea1-9591-45e4-bbc5-9c9b498982c8';
  console.log("=== STARTING BOT QUALITY GOLDEN SET TESTS ===");
  console.log(`Tenant ID: ${tenantId}`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY is not defined in .env.local!");
    return;
  }

  // Dynamic imports to prevent hoisting issues
  const { withTenantDB } = await import('../src/lib/core/tenant-db');
  const { BrainResolver } = await import('../src/lib/brain/brain-resolver');
  const { PromptBuilder } = await import('../src/lib/services/ai/prompt-builder');
  const { AIOrchestrator } = await import('../src/lib/services/ai/orchestrator');

  const db = withTenantDB(tenantId, true);

  // Fetch active channel
  const channels = await db.executeSafe({
    text: "SELECT id FROM channels WHERE group_id IN (SELECT id FROM channel_groups WHERE tenant_id = $1) AND provider = '360dialog' LIMIT 1",
    values: [tenantId]
  }) as any[];

  if (channels.length === 0) {
    console.error("No active WhatsApp channel found!");
    return;
  }
  const channelId = channels[0].id;

  // Resolve V2 brain
  const mockPayload = {
    contacts: [{ profile: { name: 'Murtaza Test' } }],
    messages: [{ from: '905546833306', text: { body: 'Merhabalar' }, type: 'text', id: 'mock-msg-id-123' }]
  };
  const brain = await BrainResolver.resolveTenantBrain(mockPayload, 'whatsapp', 'mock-webhook-id', channelId);

  // Fetch backup prompt (v25 / 24731 chars)
  const backupRows = await db.executeSafe({
    text: "SELECT system_prompt FROM brain_versions WHERE tenant_id = $1 AND version_number = 25",
    values: [tenantId]
  }) as any[];
  const backupPromptText = backupRows[0]?.system_prompt || '';

  if (!brain.prompts.systemPrompt || !backupPromptText) {
    console.error("Failed to load active or backup system prompts!");
    return;
  }

  const orchestrator = new AIOrchestrator();
  const config = {
    provider: 'gemini' as const,
    modelId: 'gemini-2.5-flash',
    apiKey,
    temperature: 0.1,
    maxTokens: 1000
  };

  // Run all scenarios
  for (const scenario of testScenarios) {
    console.log(`\n=============================================================`);
    console.log(`SCENARIO ${scenario.id}: ${scenario.name}`);
    console.log(`User Input: "${scenario.messages[0].content}"`);
    console.log(`-------------------------------------------------------------`);

    // Mock unifiedContext representing WhatsApp channel conversation
    const mockUnifiedContext = {
      currentMessageText: scenario.messages[0].content,
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
        summary: 'Mide yanması şikayeti var.',
        ai_reason: 'Randevu bekleniyor',
        country: 'Türkiye'
      },
      history: [
        { role: 'user', content: scenario.messages[0].content }
      ],
      isGreetingOnly: scenario.id === 1 || scenario.id === 2
    };

    // 1. Run with Active Prompt (4.2k base + policies + overlays)
    try {
      const activePromptBuilt = PromptBuilder.buildSystemPrompt(brain, 'lead', false, mockUnifiedContext);
      const activeMessages: any[] = [
        { role: 'system', content: activePromptBuilt },
        ...scenario.messages.map(m => ({ role: m.role as any, content: m.content }))
      ];
      const activeRes = await orchestrator.generateResponse(activeMessages, config, tenantId);
      console.log(`[ACTIVE PROMPT WITH POLICIES RESPONSE]:\n${activeRes.text?.trim()}`);
    } catch (err: any) {
      console.error(`[ACTIVE PROMPT ERROR]: ${err.message}`);
    }

    console.log(`- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -`);

    // 2. Run with Backup Prompt (24.7k base + policies + overlays)
    try {
      // Temporarily mock the brain systemPrompt to use the backup prompt
      const backupBrain = {
        ...brain,
        prompts: {
          ...brain.prompts,
          systemPrompt: backupPromptText,
          promptHash: null // bypass hash check or re-hash
        }
      };
      
      const backupPromptBuilt = PromptBuilder.buildSystemPrompt(backupBrain, 'lead', false, mockUnifiedContext);
      const backupMessages: any[] = [
        { role: 'system', content: backupPromptBuilt },
        ...scenario.messages.map(m => ({ role: m.role as any, content: m.content }))
      ];
      const backupRes = await orchestrator.generateResponse(backupMessages, config, tenantId);
      console.log(`[BACKUP PROMPT RESPONSE]:\n${backupRes.text?.trim()}`);
    } catch (err: any) {
      console.error(`[BACKUP PROMPT ERROR]: ${err.message}`);
    }
  }

  console.log(`\n=============================================================`);
  console.log("=== GOLDEN SET TESTS COMPLETED ===");
}

main().catch(err => {
  console.error("Error during golden set tests:", err);
});
