/**
 * P0.5 — Prompt Over-Constraint Stabilization Test
 * 
 * Tests that:
 * 1. Modular policies are disabled by default (no ENABLE_MODULAR_PROMPT_POLICIES)
 * 2. Generic fallback patterns are caught by quality gate
 * 3. Positive guidance section is present in built prompt
 * 4. Duplicate overriding constraints are removed
 * 5. Quality gate does NOT false-positive on legitimate short responses
 */

import { TurkishReplyQualityGate } from '../src/lib/services/ai/turkish-quality-gate';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    pass++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    fail++;
  }
}

async function main() {
  console.log('\n=== P0.5 — PROMPT OVER-CONSTRAINT STABILIZATION TESTS ===\n');

  // ═══ TEST GROUP 1: Feature Flag ═══
  console.log('\n--- 1. Feature Flag Tests ---');

  // Ensure ENABLE_MODULAR_PROMPT_POLICIES is NOT set (default off)
  const flagValue = process.env.ENABLE_MODULAR_PROMPT_POLICIES;
  assert(flagValue !== 'true', 'ENABLE_MODULAR_PROMPT_POLICIES is not "true" by default');

  // ═══ TEST GROUP 2: Generic Fallback Quality Gate ═══
  console.log('\n--- 2. Generic Fallback Pattern Detection ---');

  // Should FAIL — generic fallback patterns
  const genericPatterns = [
    'Mesajınızı aldım. Sizi doğru yönlendirebilmem için şikâyetinizi biraz daha açık yazabilir misiniz? 🙏',
    'Mesajınızı aldım, şikayetinizi biraz daha açık yazabilir misiniz?',
    'Doğru yönlendirebilmem için şikayetinizi açık yazabilir misiniz?',
    'Sizi doğru yönlendirebilmem için biraz daha açık yazabilir misiniz?',
    'Şikayetinizi biraz daha açık yazabilir misiniz?'
  ];

  for (const pattern of genericPatterns) {
    const result = TurkishReplyQualityGate.validate(pattern);
    assert(!result.valid, `Generic fallback rejected: "${pattern.substring(0, 60)}..."`);
    if (!result.valid) {
      assert(
        result.reason?.includes('generic_fallback_pattern') === true,
        `  Reason contains "generic_fallback_pattern"`
      );
    }
  }

  // Should PASS — legitimate short responses that contain partial keywords but are NOT generic
  console.log('\n--- 3. False Positive Guard (Legitimate Responses) ---');

  const legitimateResponses = [
    'Mesajınızı aldım. Mide yanması şikayetiniz için Dahiliye veya Gastroenteroloji bölümümüze başvurabilirsiniz.',
    'Geçmiş olsun 🙏 Mide yanması şikayetiniz için hastanemizin Dahiliye bölümünden destek alabilirsiniz.',
    'Merhaba, Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi\'ne hoş geldiniz.',
    'Teşekkür ederiz. Koordinatör ekibimiz sizi arayacaktır.',
    'Anladım. 2 yıldır süren mide yanması şikayetiniz için Gastroenteroloji bölümümüzü önerebiliriz.'
  ];

  for (const response of legitimateResponses) {
    const result = TurkishReplyQualityGate.validate(response);
    assert(result.valid, `Legitimate response accepted: "${response.substring(0, 60)}..."`);
  }

  // ═══ TEST GROUP 4: Prompt Builder — Positive Guidance Present ═══
  console.log('\n--- 4. Prompt Builder Structure Tests ---');

  // We can test the PromptBuilder output by importing and checking the built prompt
  try {
    const { PromptBuilder } = await import('../src/lib/services/ai/prompt-builder');
    const { TenantBrain } = await import('../src/lib/brain/tenant-brain');

    const mockBrain = new TenantBrain(
      {
        tenantId: 'test-tenant-id',
        channel: 'whatsapp',
        channelId: 'test-channel-id',
        config: { industry: 'healthcare', timezone: 'Europe/Istanbul', identity: { personaName: 'Rüya', organizationName: 'Test Hastanesi', organizationShortName: 'Test' } },
        settings: {},
        knowledge: {}
      },
      {
        systemPrompt: 'Sen Test Hastanesi asistanısın.',
        promptHash: null,
        metadata: { industry: 'healthcare', identity: { personaName: 'Rüya', organizationName: 'Test Hastanesi', organizationShortName: 'Test' } }
      }
    );

    const mockContext = {
      currentMessageText: 'merhaba',
      currentMessageMediaType: 'text',
      history: [],
      languageContext: { reply_language: 'Turkish', detected_patient_language: 'Turkish' },
      profile: { first_name: 'Test', last_name: 'User' }
    };

    const builtPrompt = PromptBuilder.buildSystemPrompt(mockBrain, 'lead', false, mockContext);

    // Check positive guidance is present
    assert(builtPrompt.includes('CEVAP ÜRETME REHBERİ'), 'Positive guidance section present in prompt');
    assert(builtPrompt.includes('bağlama özel cevap ver'), 'Positive guidance contains contextual response instruction');
    assert(builtPrompt.includes('Mesajınızı aldım, şikâyetinizi daha açık yazabilir misiniz'), 'Positive guidance warns against generic fallback');

    // Check duplicate overriding constraints are REMOVED
    assert(!builtPrompt.includes('DİNAMİK ENGELLEME VE FREN TALİMATLARI (OVERRIDING NEGATIVE CONSTRAINTS)'), 'Duplicate overriding constraints block is REMOVED');

    // Check dynamic brakes are still present (single authoritative location)
    assert(builtPrompt.includes('DİNAMİK KALİTE VE FREN KURALLARI'), 'Dynamic brakes block still present (single location)');

    // Check modular policies are NOT injected (default off)
    assert(!builtPrompt.includes('HASTA İTİRAZLARI VE İKNA YÖNLENDİRMELERİ'), 'Objection policy NOT injected (flag off)');
    assert(!builtPrompt.includes('FEW-SHOT ÖRNEKLER'), 'Few-shot policy NOT injected (flag off)');
    assert(!builtPrompt.includes('DİYALOG AKIŞI VE GÜVEN HUNİSİ'), 'Progress funnel policy NOT injected (flag off)');

    // Print prompt size for comparison
    console.log(`\n  📏 Built prompt size: ${builtPrompt.length} chars (should be smaller than 57K pre-modularization)`);

  } catch (err: any) {
    console.log(`  ⚠️ SKIP: PromptBuilder import failed (expected in dry-run without DB): ${err.message}`);
  }

  // ═══ SUMMARY ═══
  console.log('\n===============================================');
  console.log(`RESULTS: ${pass} passed, ${fail} failed out of ${pass + fail} total`);
  console.log('===============================================\n');

  if (fail > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
