import { ContextAwareSafeFallbackResolver } from '../src/lib/services/ai/context-aware-safe-fallback';
import { TenantBrain } from '../src/lib/brain/tenant-brain';

// Mock utility to create a minimal TenantBrain
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
      metadata: {
        industry
      }
    }
  } as any;
}

interface TestPattern {
  name: string;
  inboundText: string;
  industry: string;
  identityConfig: any;
  unifiedContext: any;
  expectedContent: string;
  expectedFinalPath: string;
}

const testPatterns: TestPattern[] = [
  // 1. Healthcare + form + greeting
  {
    name: 'Healthcare + form + greeting',
    inboundText: 'merhaba',
    industry: 'healthcare',
    identityConfig: { personaName: 'Rüya' },
    unifiedContext: {
      latestForm: { name: 'test_form', data: {} }
    },
    expectedContent: 'Merhaba, Rüya ben. Formunuzla ilgili yardımcı olayım; hangi konuda bilgi almak istiyorsunuz?',
    expectedFinalPath: 'greeting_form_fallback'
  },
  // 2. Healthcare + complaint
  {
    name: 'Healthcare + complaint',
    inboundText: 'merhaba',
    industry: 'healthcare',
    identityConfig: { personaName: 'Rüya' },
    unifiedContext: {
      patient_known_facts: ['Şikayeti: Mide ağrısı']
    },
    expectedContent: 'Merhaba, Rüya ben. Mide ağrısı konusuyla ilgili yardımcı olayım. Bu durum ne zamandır devam ediyor?',
    expectedFinalPath: 'greeting_healthcare_complaint_fallback'
  },
  // 3. Healthcare + time intent
  {
    name: 'Healthcare + time intent',
    inboundText: 'perşembe günü saat 17:00',
    industry: 'healthcare',
    identityConfig: { personaName: 'Rüya' },
    unifiedContext: {},
    expectedContent: 'Paylaştığınız zaman bilgisini not aldım. Temsilci arkadaşımız saat planlamasını teyit etmek üzere sizinle iletişime geçecektir.',
    expectedFinalPath: 'intent_time_availability_fallback'
  },
  // 4. Name intent without gender guessing
  {
    name: 'Name intent without gender guessing',
    inboundText: 'ismim mehmet',
    industry: 'healthcare',
    identityConfig: { personaName: 'Rüya' },
    unifiedContext: {},
    expectedContent: 'Teşekkür ederim Mehmet. Bilgilerinizi not aldım.',
    expectedFinalPath: 'name_generic_fallback'
  },
  // 5. Unknown sector greeting
  {
    name: 'Unknown sector greeting',
    inboundText: 'selam',
    industry: '',
    identityConfig: { personaName: 'Rüya' },
    unifiedContext: {},
    expectedContent: 'Merhaba, Rüya ben. Hangi konuda bilgi almak istediğinizi yazabilirsiniz.',
    expectedFinalPath: 'greeting_neutral_fallback'
  },
  // 6. E-commerce/order context greeting
  {
    name: 'E-commerce greeting',
    inboundText: 'merhaba',
    industry: 'e-commerce',
    identityConfig: { personaName: 'Buse', organizationShortName: 'Moda A.Ş.' },
    unifiedContext: {},
    expectedContent: 'Merhaba, Buse ben. Hangi konuda bilgi almak istediğinizi yazabilirsiniz.',
    expectedFinalPath: 'greeting_neutral_fallback'
  },
  // 7. Education/course context greeting
  {
    name: 'Education greeting',
    inboundText: 'iyi günler',
    industry: 'education',
    identityConfig: { personaName: 'Hakan' },
    unifiedContext: {},
    expectedContent: 'Merhaba, Hakan ben. Hangi konuda bilgi almak istediğinizi yazabilirsiniz.',
    expectedFinalPath: 'greeting_neutral_fallback'
  },
  // 8. Name + Healthcare + Complaint Present
  {
    name: 'Name + Healthcare + Complaint Present',
    inboundText: 'adım mehmet',
    industry: 'healthcare',
    identityConfig: { personaName: 'Rüya' },
    unifiedContext: {
      patient_known_facts: ['Şikayeti: Mide yanması']
    },
    expectedContent: 'Teşekkür ederim Mehmet. Mide yanması konusuyla ilgili uygun zamanı netleştirebiliriz.',
    expectedFinalPath: 'name_healthcare_complaint_fallback'
  }
];

function runTests() {
  console.log('=== P0.7 DETERMINISTIC SAFE FALLBACK TESTS ===\n');
  let passedCount = 0;

  for (const t of testPatterns) {
    const brain = createMockBrain(t.industry);
    const result = ContextAwareSafeFallbackResolver.resolve({
      inboundText: t.inboundText,
      brain,
      identityConfig: t.identityConfig,
      unifiedContext: t.unifiedContext
    });

    const passedText = result.text === t.expectedContent;
    const passedPath = result.finalPath === t.expectedFinalPath;

    if (passedText && passedPath) {
      console.log(`✅ [PASS] ${t.name}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${t.name}`);
      if (!passedText) {
        console.error(`   Expected text: "${t.expectedContent}"`);
        console.error(`   Actual text:   "${result.text}"`);
      }
      if (!passedPath) {
        console.error(`   Expected path: "${t.expectedFinalPath}"`);
        console.error(`   Actual path:   "${result.finalPath}"`);
      }
    }
  }

  console.log(`\nTotal: ${testPatterns.length}, Passed: ${passedCount}`);
  if (passedCount !== testPatterns.length) {
    process.exit(1);
  }
}

runTests();
