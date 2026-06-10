import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { TurkishReplyQualityGate } from '../src/lib/services/ai/turkish-quality-gate';
import { PromptBuilder } from '../src/lib/services/ai/prompt-builder';
import { TenantBrain } from '../src/lib/brain/tenant-brain';
import { TenantLearningCaptureService } from '../src/lib/services/ai/tenant-learning-capture.service';

async function testAvailabilityDetection() {
  console.log("=== TESTING PATIENT AVAILABILITY DETECTION ===");

  const availabilityMessages = [
    "perşembe saat 20 olabilir",
    "perşembe günü saat 20 de arayabilirsiniz",
    "yarın 14:00 uygun",
    "bugün akşam arayabilirsiniz",
    "telefon görüşmesi için uygunum",
    "beni şu saatte arayın",
    "hafta içi öğleden sonra ulaşırsanız seviniriz",
    "cuma günü 15.30 gibi görüşebiliriz",
    "yarin oglen arayabilirsiniz"
  ];

  const nonAvailabilityMessages = [
    "merhaba nasılsınız?",
    "fiyat nedir acaba?",
    "hangi doktorlar var?",
    "teşekkür ederim iyi günler",
    "tamam anlaştık",
    "sadece epikriz göndermek istiyorum"
  ];

  let failed = 0;

  for (const msg of availabilityMessages) {
    const isAvail = TurkishReplyQualityGate.detectPatientProvidedAvailability(msg);
    if (!isAvail) {
      console.error(`- [FAIL] Expected availability detected for: "${msg}"`);
      failed++;
    } else {
      console.log(`- [PASS] Availability detected: "${msg}"`);
    }
  }

  for (const msg of nonAvailabilityMessages) {
    const isAvail = TurkishReplyQualityGate.detectPatientProvidedAvailability(msg);
    if (isAvail) {
      console.error(`- [FAIL] Unexpected availability detected for: "${msg}"`);
      failed++;
    } else {
      console.log(`- [PASS] No availability detected: "${msg}"`);
    }
  }

  if (failed > 0) {
    throw new Error(`Availability detection tests failed: ${failed} failures`);
  }
}

async function testQualityGateRelaxation() {
  console.log("\n=== TESTING INTENT-AWARE QUALITY GATE RELAXATION ===");

  // Under ctaOfferedRecently = true, but patientProvidedAvailability = true
  const qgOptionsRelaxed = {
    ctaOfferedRecently: true,
    patientProvidedAvailability: true
  };

  const allowedConfirmations = [
    "Uygun zamanınızı not aldım, ilgili birime iletiyorum.",
    "Belirttiğiniz saat planlama için kontrol edilecek.",
    "Notumu aldım, hasta danışmanlarımız kontrol edecek.",
    "Telefon görüşmesi için talebinizi iletiyorum.",
    "Telefon görüşmesi için notunuz iletildi, ekibimiz kontrol edecek."
  ];

  const blockedExpressions = [
    "Uygun zaman paylaşır mısınız?",
    "Yarın için randevu planlayalım.",
    "Arama planlayalım mı?",
    "Sizi arayalım mı?",
    "Görüşme ayarlayalım mı?",
    "Planlama için Türkiye saatiyle görüşebiliriz." // Türkiye saatiyle must remain strictly blocked
  ];

  let failed = 0;

  // Verify allowed confirmations are NOT blocked
  for (const text of allowedConfirmations) {
    const res = TurkishReplyQualityGate.validate(text, qgOptionsRelaxed);
    if (!res.valid) {
      console.error(`- [FAIL] Allowed confirmation was blocked: "${text}". Reason: ${res.reason}`);
      failed++;
    } else {
      console.log(`- [PASS] Allowed confirmation passed QG: "${text}"`);
    }
  }

  // Verify blocked expressions ARE blocked
  for (const text of blockedExpressions) {
    const res = TurkishReplyQualityGate.validate(text, qgOptionsRelaxed);
    if (res.valid) {
      console.error(`- [FAIL] Prohibited expression was allowed: "${text}"`);
      failed++;
    } else {
      console.log(`- [PASS] Prohibited expression correctly blocked: "${text}". Reason: ${res.reason}`);
    }
  }

  // Verify that without patientProvidedAvailability, confirmation phrases containing blocked words are still strictly blocked
  const qgOptionsStrict = {
    ctaOfferedRecently: true,
    patientProvidedAvailability: false
  };

  const ctaPhrases = [
    "Telefon görüşmesi için talebinizi iletiyorum.", // Contains "telefon gorusmesi"
    "Türkiye saatiyle görüşelim." // Contains "turkiye saatiyle"
  ];

  for (const text of ctaPhrases) {
    const res = TurkishReplyQualityGate.validate(text, qgOptionsStrict);
    if (res.valid) {
      console.error(`- [FAIL] Normal CTA phrase was allowed without patient availability: "${text}"`);
      failed++;
    } else {
      console.log(`- [PASS] Normal CTA phrase blocked correctly without patient availability: "${text}"`);
    }
  }

  if (failed > 0) {
    throw new Error(`Quality Gate relaxation tests failed: ${failed} failures`);
  }
}

async function testSafeFallback() {
  console.log("\n=== TESTING SAFE CONFIRMATION FALLBACK VALIDATION ===");

  const safeFallback = "Uygun olduğunuz zamanı not aldım, hasta danışmanlarımız planlamayı kontrol edecek.";
  const qgOptions = {
    ctaOfferedRecently: true,
    patientProvidedAvailability: true
  };

  const res = TurkishReplyQualityGate.validate(safeFallback, qgOptions);
  if (!res.valid) {
    throw new Error(`Safe fallback failed Quality Gate validation: ${res.reason}`);
  }
  console.log(`- [PASS] Safe fallback successfully passed Quality Gate validation: "${safeFallback}"`);
}

async function testTenantBoundQueries() {
  console.log("\n=== SIMULATING TENANT BOUND DB QUERIES ===");

  // Mock DB executor that analyzes the SQL string and checks for RLS requirements
  const mockDb = {
    executeSafe: async (query: { text: string; values: any[] }) => {
      const textNormalized = query.text.toLowerCase().replace(/\s+/g, ' ');
      console.log(`SQL Executed: "${query.text.trim().replace(/\s+/g, ' ')}"`);
      console.log(`Values:`, query.values);

      if (textNormalized.includes('update tenant_learning_events')) {
        // Assert WHERE clause contains tenant_id bound
        const hasTenantBound = textNormalized.includes('tenant_id =') || textNormalized.includes('tenant_id=');
        if (!hasTenantBound) {
          throw new Error("SECURITY_QUERY_REJECTED: Raw query lacks tenant_id bound!");
        }
        console.log("-> [OK] Update query contains tenant_id bound.");
      }
      return [{ id: 'mock-id' }];
    }
  };

  // 1. Simulate logOperatorSend update path
  console.log("\n[Simulating logOperatorSend UPDATE path]");
  await TenantLearningCaptureService.logOperatorSend(mockDb, {
    tenantId: 'caab9ea1-9591-45e4-bbc5-9c9b498982c8',
    channelId: 'channel-123',
    conversationId: 'conversation-456',
    messageId: 'message-789',
    humanFinalText: 'Not aldım, iletiyorum.'
  });

  // 2. Simulate logPatientReaction retrospective update path
  console.log("\n[Simulating logPatientReaction retrospective UPDATE path]");
  await TenantLearningCaptureService.logPatientReaction(mockDb, {
    tenantId: 'caab9ea1-9591-45e4-bbc5-9c9b498982c8',
    channelId: 'channel-123',
    conversationId: 'conversation-456',
    messageId: 'message-789',
    patientMessageText: 'perşembe saat 20:00 de arayın'
  });

  console.log("- [PASS] Simulated database queries successfully validated for tenant bounds!");
}

async function run() {
  try {
    await testAvailabilityDetection();
    await testQualityGateRelaxation();
    await testSafeFallback();
    await testTenantBoundQueries();
    console.log("\n=== ALL CTA AVAILABILITY HOTFIX TESTS PASSED SUCCESSFULLY! ===");
  } catch (e: any) {
    console.error("\n❌ CTA AVAILABILITY HOTFIX TEST FAILED:");
    console.error(e.message);
    process.exit(1);
  }
}

run();
