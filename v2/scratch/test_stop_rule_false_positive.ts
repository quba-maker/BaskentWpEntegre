/**
 * Stop Rule Intent Classifier — Unit Tests
 * 
 * Tests that communication opt-out vs cancellation intent are correctly classified.
 * No DB or network calls needed.
 */

import { classifyStopRuleIntent, StopRuleIntentResult } from '../src/lib/services/stop-rule-intent';

let passed = 0;
let failed = 0;

function assert(testName: string, result: StopRuleIntentResult, expected: { optOut: boolean; cancel: boolean; reason: string }) {
  const ok = result.isCommunicationOptOut === expected.optOut 
          && result.isCancellationIntent === expected.cancel
          && result.reason === expected.reason;
  if (ok) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.log(`  ❌ ${testName}`);
    console.log(`     Expected: optOut=${expected.optOut}, cancel=${expected.cancel}, reason=${expected.reason}`);
    console.log(`     Got:      optOut=${result.isCommunicationOptOut}, cancel=${result.isCancellationIntent}, reason=${result.reason}, match=${result.matchedPattern}`);
  }
}

console.log('=== HARD STOP (Communication Opt-Out) — Should trigger disableAutopilot ===\n');

const hardStopMessages = [
  'beni aramayın',
  'Beni bir daha aramayın!',
  'mesaj atmayın',
  'Bana mesaj atmayın lütfen',
  'rahatsız etmeyin',
  'Rahatsız Etmeyin!!!',
  'iletişim istemiyorum',
  'numaramı silin',
  'Listeden çıkarın',
  'stop',
  'Stop.',
  'STOP',
  'opt-out',
  'bana yazmayın',
  'bir daha yazmayın',
  'artık aramayın',
  'mesaj istemiyorum',
  'aranmak istemiyorum',
  'üye olmak istemiyorum',
];

for (const msg of hardStopMessages) {
  const result = classifyStopRuleIntent(msg);
  assert(msg, result, { optOut: true, cancel: false, reason: 'communication_opt_out' });
}

console.log('\n=== SOFT / CANCELLATION — Should NOT trigger disableAutopilot ===\n');

const cancelMessages = [
  'randevumu iptal etmek istiyorum',
  'planım iptal oldu',
  'plan iptal gelmeyeceğim',
  'plan iptal gelmeyeceğim. başka bir hastalık hakkında bilgi almak istiyorum',

  'cuma görüşmesini iptal edelim',
  'ameliyatı iptal edelim',
  'şimdilik vazgeçtim ama bilgi almak istiyorum',
  'randevumu iptal etmek istiyorum ama başka konu hakkında bilgi almak istiyorum',
  'iptal oldu ama bilgi almak istiyorum',
  'tedavimi iptal ettirmek istiyorum',
  'kontrolü iptal edebilir miyiz',

  'şimdilik vazgeçtim',
];

for (const msg of cancelMessages) {
  const result = classifyStopRuleIntent(msg);
  assert(msg, result, { optOut: false, cancel: true, reason: 'appointment_cancel_intent' });
}

console.log('\n=== NONE — No stop intent detected ===\n');

const noneMessages = [
  'Merhaba, bilgi almak istiyorum',
  'Merhabalar',
  'İyi günler, randevu almak istiyorum',
  'Doktor Mehmet Bey ile görüşmek istiyorum',
  'Tedavi seçeneklerini öğrenmek istiyorum',
  'Fiyat bilgisi alabilir miyim?',
  'Merhaba, ne zaman gelebilirim?',
  '',
  '  ',
];

for (const msg of noneMessages) {
  const result = classifyStopRuleIntent(msg);
  assert(msg || '(empty)', result, { optOut: false, cancel: false, reason: 'none' });
}

console.log('\n=== EDGE CASES ===\n');

// "istemiyorum" alone — ambiguous, should NOT be hard stop without communication context
const r1 = classifyStopRuleIntent('istemiyorum');
assert('"istemiyorum" alone → cancel intent (ambiguous, safe default)', r1, { optOut: false, cancel: true, reason: 'appointment_cancel_intent' });

// "mesaj istemiyorum" — explicit communication refusal
const r2 = classifyStopRuleIntent('mesaj istemiyorum');
assert('"mesaj istemiyorum" → hard stop', r2, { optOut: true, cancel: false, reason: 'communication_opt_out' });

// "iptal" alone — ambiguous, should NOT be hard stop
const r3 = classifyStopRuleIntent('iptal');
assert('"iptal" alone → cancel intent (NOT hard stop)', r3, { optOut: false, cancel: true, reason: 'appointment_cancel_intent' });

// "stop lütfen beni arayın" — has "stop" but in context
const r4 = classifyStopRuleIntent('stop');
assert('"stop" alone → hard stop', r4, { optOut: true, cancel: false, reason: 'communication_opt_out' });

// "gelemeyeceğim" alone — no stop keyword, just a statement. Bot handles normally.
const r5 = classifyStopRuleIntent('gelemeyeceğim');
assert('"gelemeyeceğim" alone → none (no stop keyword)', r5, { optOut: false, cancel: false, reason: 'none' });

// "randevu tarihimi değiştirmek istiyorum" — no stop keyword, just modification request
const r6 = classifyStopRuleIntent('randevu tarihimi değiştirmek istiyorum');
assert('"randevu tarihimi değiştirmek istiyorum" → none (no stop keyword)', r6, { optOut: false, cancel: false, reason: 'none' });

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}
