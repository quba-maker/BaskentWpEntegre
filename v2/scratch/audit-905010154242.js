const { BrainResolver } = require('../src/lib/brain/brain-resolver');
require('dotenv').config({ path: '.env.local' });

async function main() {
  const payload = {
    entry: [{
      id: "193513653852062",
      changes: [{
        field: "messages",
        value: {
          contacts: [{ wa_id: "905010154242" }],
          messages: [{ from: "905010154242", text: { body: "test" } }]
        }
      }]
    }]
  };

  console.log('=== RESOLVING TENANT BRAIN FOR BASKENT ===');
  const brain = await BrainResolver.resolveTenantBrain(
    payload,
    'whatsapp',
    'test-uuid-123',
    '2e7352c1-5db7-4414-baf7-de571a66bfa6'
  );

  console.log('Brain Resolved Successfully:');
  console.log('ID:', brain.id);
  console.log('Tenant ID:', brain.context.tenantId);
  console.log('Channel:', brain.context.channel);
  console.log('Brain Source:', brain.context.brainSource);
  console.log('System Prompt Length:', brain.prompts.systemPrompt?.length || 0);
  console.log('Prompt Hash:', brain.prompts.promptHash);
}

main().catch(console.error);
