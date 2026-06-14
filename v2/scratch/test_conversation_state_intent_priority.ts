import { ConversationIntentRouter } from '../src/lib/services/ai/conversation-intent-router';
import { PromptBuilder } from '../src/lib/services/ai/prompt-builder';
import { ContextAwareSafeFallbackResolver } from '../src/lib/services/ai/context-aware-safe-fallback';
import { TenantBrain } from '../src/lib/brain/tenant-brain';

// Mock minimal TenantBrain
function createMockBrain(industry: string): TenantBrain {
  return {
    context: {
      tenantId: 'mock-tenant',
      channel: 'whatsapp',
      config: {
        industry
      }
    },
    prompts: {
      systemPrompt: 'Sen Başkent Üniversitesi Konya Hastanesi danışmanısın.',
      metadata: {
        industry
      }
    }
  } as any;
}

const mockIdentityConfig = {
  personaName: 'Rüya',
  organizationName: 'Başkent Üniversitesi Konya Hastanesi',
  organizationShortName: 'Başkent'
};

const intentTestCases = [
  { text: 'merhaba', expectedIntent: 'greeting' },
  { text: 'aktar', expectedIntent: 'transfer_request' },
  { text: 'haziran 17 de telefon görüşmesi istiyorum', expectedIntent: 'call_scheduling_request' },
  { text: '17 haziran arayın', expectedIntent: 'call_scheduling_request' },
  { text: 'saat 17 olur', expectedIntent: 'time_availability' },
  { text: 'saat 5 gibi', expectedIntent: 'time_availability' },
  { text: 'yarın öğleden sonra', expectedIntent: 'time_availability' },
  { text: 'bize göre olsun', expectedIntent: 'time_availability' },
  { text: 'Türkiye saatine göre olsun', expectedIntent: 'time_availability' },
  { text: 'Amerika saatine göre olsun', expectedIntent: 'time_availability' },
  { text: 'fiyatlar nasıl', expectedIntent: 'price_question' },
  { text: 'Konya uzak', expectedIntent: 'distance_objection' },
  { text: 'mide yanması var', expectedIntent: 'complaint_detail' },
  { text: 'dahiliye mide yanması', expectedIntent: 'topic_switch' }
];

function runTests() {
  console.log('=== P0.8 CONVERSATION STATE / INTENT PRIORITY TESTS ===\n');
  let passedCount = 0;

  // 1. Test Router Intent Classification
  console.log('--- 1. Router Intent Classification ---');
  for (const tc of intentTestCases) {
    const routed = ConversationIntentRouter.route(tc.text);
    if (routed === tc.expectedIntent) {
      console.log(`✅ [PASS] "${tc.text}" -> ${routed}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] "${tc.text}" -> Expected: ${tc.expectedIntent}, Got: ${routed}`);
    }
  }

  // 2. Test PromptBuilder Dynamic Intent Injection
  console.log('\n--- 2. PromptBuilder Dynamic Intent Injection ---');
  const brain = createMockBrain('healthcare');
  for (const tc of intentTestCases) {
    const unifiedContext = {
      currentMessageText: tc.text,
      patient_known_facts: ['Şikayeti: Baş ağrısı']
    };
    const sysPrompt = PromptBuilder.buildSystemPrompt(brain, 'lead', false, unifiedContext);
    const hasIntentGuide = sysPrompt.includes('=== 🎯 SON MESAJ INTENT KILAVUZU ===');
    const matchesIntentName = sysPrompt.includes(`Intent: ${tc.expectedIntent}`);

    if (hasIntentGuide && matchesIntentName) {
      console.log(`✅ [PASS] Inject guide for intent: ${tc.expectedIntent}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] Inject guide for intent: ${tc.expectedIntent}`);
      console.error(`   Has guide header: ${hasIntentGuide}`);
      console.error(`   Contains intent label: ${matchesIntentName}`);
    }
  }

  // 3. Test ContextAwareSafeFallbackResolver (Anti-leak & Deterministic Intent-aware Fallbacks)
  console.log('\n--- 3. Fallback Resolver & Anti-Leak ---');
  
  // Test case for transfer_request fallback
  const transferFallback = ContextAwareSafeFallbackResolver.resolve({
    inboundText: 'aktar',
    brain,
    identityConfig: mockIdentityConfig,
    unifiedContext: {
      opportunity: { summary: 'Mehmet (Türkiye), başlangıçta Kardiyoloji...' },
      patient_known_facts: ['Şikayeti: Kardiyoloji şikayeti']
    }
  });
  
  const transferPass = transferFallback.text.includes('aktarıyorum') && !transferFallback.text.includes('Mehmet (Türkiye)');
  if (transferPass) {
    console.log('✅ [PASS] Transfer intent-aware fallback (no opportunity.summary leakage)');
    passedCount++;
  } else {
    console.error('❌ [FAIL] Transfer intent-aware fallback');
    console.error(`   Text: "${transferFallback.text}"`);
  }

  // Test case for call_scheduling_request fallback
  const schedulingFallback = ContextAwareSafeFallbackResolver.resolve({
    inboundText: '17 haziran arayın',
    brain,
    identityConfig: mockIdentityConfig,
    unifiedContext: {
      opportunity: { summary: 'Murtaza/Amerika...' }
    }
  });

  const schedulingPass = schedulingFallback.text.includes('Telefon görüşmesi talebinizi') && !schedulingFallback.text.includes('Murtaza/Amerika');
  if (schedulingPass) {
    console.log('✅ [PASS] Call scheduling intent-aware fallback (no opportunity.summary leakage)');
    passedCount++;
  } else {
    console.error('❌ [FAIL] Call scheduling intent-aware fallback');
    console.error(`   Text: "${schedulingFallback.text}"`);
  }

  // Test case for general fallback (Must NOT leak opportunity.summary)
  const defaultFallback = ContextAwareSafeFallbackResolver.resolve({
    inboundText: 'hastaneye nasıl gidebilirim',
    brain,
    identityConfig: mockIdentityConfig,
    unifiedContext: {
      opportunity: { summary: 'Murtaza/Amerika...' },
      patient_known_facts: []
    }
  });

  const leakPass = !defaultFallback.text.includes('Murtaza/Amerika');
  if (leakPass) {
    console.log('✅ [PASS] Default fallback does NOT leak opportunity.summary');
    passedCount++;
  } else {
    console.error('❌ [FAIL] Default fallback leaked opportunity.summary!');
    console.error(`   Text: "${defaultFallback.text}"`);
  }

  const expectedTotalPass = intentTestCases.length * 2 + 3;
  console.log(`\nTotal tests run: ${expectedTotalPass}, Passed: ${passedCount}`);
  if (passedCount !== expectedTotalPass) {
    process.exit(1);
  }
}

runTests();
