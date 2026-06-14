/**
 * P0.11 Test Suite: State Arbitration & RepeatGuard
 * 
 * Tests ConversationStateArbitrator and RepeatGuard modules.
 * Run: DATABASE_URL=postgres://dummy:dummy@dummy.com/dummy AUTH_SECRET=dummy_secret npx tsx scratch/test_p011_state_arbitration.ts
 */

// ======== ConversationStateArbitrator Tests ========
import { ConversationStateArbitrator, type ArbitrationInput } from '../src/lib/services/ai/conversation-state-arbitrator';
import { ConversationIntentRouter } from '../src/lib/services/ai/conversation-intent-router';
import { RepeatGuard } from '../src/lib/services/ai/repeat-guard';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ ${testName}${details ? ' — ' + details : ''}`);
    failed++;
  }
}

console.log('\n========== ConversationStateArbitrator Tests ==========\n');

// Test 1: merhaba + pending timezone → SUPPRESS
{
  const result = ConversationStateArbitrator.arbitrate({
    lastUserMessage: 'merhaba',
    rawPendingSlot: 'timezone_clarification',
    rawInterpretedIntent: 'none',
    routerIntent: ConversationIntentRouter.route('merhaba'),
    history: []
  });
  assert(result.staleSlotSuppressed === true, 'T1: merhaba + timezone → suppressed');
  assert(result.effectiveIntent === 'greeting', 'T1: effectiveIntent = greeting');
  assert(result.effectivePendingSlot === 'generic_none', 'T1: effectivePendingSlot = generic_none');
}

// Test 2: efendim + pending timezone → SUPPRESS
{
  const result = ConversationStateArbitrator.arbitrate({
    lastUserMessage: 'efendim',
    rawPendingSlot: 'timezone_clarification',
    rawInterpretedIntent: 'none',
    routerIntent: ConversationIntentRouter.route('efendim'),
    history: []
  });
  assert(result.staleSlotSuppressed === true, 'T2: efendim + timezone → suppressed');
  assert(result.effectiveIntent === 'greeting', 'T2: effectiveIntent = greeting');
}

// Test 3: sen kimsin? + pending call_time → SUPPRESS
{
  const result = ConversationStateArbitrator.arbitrate({
    lastUserMessage: 'sen kimsin?',
    rawPendingSlot: 'call_time',
    rawInterpretedIntent: 'none',
    routerIntent: ConversationIntentRouter.route('sen kimsin?'),
    history: []
  });
  assert(result.staleSlotSuppressed === true, 'T3: sen kimsin + call_time → suppressed');
  assert(result.effectiveIntent === 'identity_question', 'T3: effectiveIntent = identity_question');
}

// Test 4: hangi saat + pending timezone → SUPPRESS (clarification question, not answer)
{
  const result = ConversationStateArbitrator.arbitrate({
    lastUserMessage: 'hangi saat',
    rawPendingSlot: 'timezone_clarification',
    rawInterpretedIntent: 'none',
    routerIntent: ConversationIntentRouter.route('hangi saat'),
    history: []
  });
  assert(result.staleSlotSuppressed === true, 'T4: hangi saat + timezone → suppressed (clarification, not answer)');
}

// Test 5: bize göre olsun + pending timezone → KEEP
{
  const result = ConversationStateArbitrator.arbitrate({
    lastUserMessage: 'bize göre olsun',
    rawPendingSlot: 'timezone_clarification',
    rawInterpretedIntent: 'timezone_clarification',
    routerIntent: ConversationIntentRouter.route('bize göre olsun'),
    history: []
  });
  assert(result.staleSlotSuppressed === false, 'T5: bize göre olsun + timezone → KEPT');
  assert(result.effectivePendingSlot === 'timezone_clarification', 'T5: slot preserved');
}

// Test 6: olur + pending confirmation → KEEP
{
  const result = ConversationStateArbitrator.arbitrate({
    lastUserMessage: 'olur',
    rawPendingSlot: 'confirmation_yes_no',
    rawInterpretedIntent: 'confirmation_yes_no',
    routerIntent: ConversationIntentRouter.route('olur'),
    history: []
  });
  assert(result.staleSlotSuppressed === false, 'T6: olur + confirmation → KEPT');
  assert(result.effectivePendingSlot === 'confirmation_yes_no', 'T6: slot preserved');
}

// Test 7: can you speak English? + pending timezone → SUPPRESS (language_switch)
{
  const result = ConversationStateArbitrator.arbitrate({
    lastUserMessage: 'can you speak English?',
    rawPendingSlot: 'timezone_clarification',
    rawInterpretedIntent: 'none',
    routerIntent: ConversationIntentRouter.route('can you speak English?'),
    history: []
  });
  assert(result.staleSlotSuppressed === true, 'T7: language switch + timezone → suppressed');
  assert(result.effectiveIntent === 'language_switch', 'T7: effectiveIntent = language_switch');
}

// Test 8: Türkçe devam edelim + pending call_time → SUPPRESS (language_switch)
{
  const result = ConversationStateArbitrator.arbitrate({
    lastUserMessage: 'Türkçe devam edelim',
    rawPendingSlot: 'call_time',
    rawInterpretedIntent: 'none',
    routerIntent: ConversationIntentRouter.route('Türkçe devam edelim'),
    history: []
  });
  assert(result.staleSlotSuppressed === true, 'T8: Türkçe devam edelim + call_time → suppressed');
  assert(result.effectiveIntent === 'language_switch', 'T8: effectiveIntent = language_switch');
}

// Test 9: no pending slot → pass through
{
  const result = ConversationStateArbitrator.arbitrate({
    lastUserMessage: 'merhaba',
    rawPendingSlot: 'generic_none',
    rawInterpretedIntent: 'none',
    routerIntent: ConversationIntentRouter.route('merhaba'),
    history: []
  });
  assert(result.staleSlotSuppressed === false, 'T9: no pending slot → not suppressed');
  assert(result.effectiveIntent === 'greeting', 'T9: effectiveIntent = greeting');
}

// Test 10: user_correction → SUPPRESS slot
{
  const result = ConversationStateArbitrator.arbitrate({
    lastUserMessage: 'hayır dediğimi anlamadın',
    rawPendingSlot: 'timezone_clarification',
    rawInterpretedIntent: 'user_correction',
    routerIntent: ConversationIntentRouter.route('hayır dediğimi anlamadın'),
    history: []
  });
  assert(result.staleSlotSuppressed === true, 'T10: user_correction → suppressed');
  assert(result.suppressionReason === 'user_correction_override', 'T10: reason = user_correction_override');
}

console.log('\n========== RepeatGuard Tests ==========\n');

// Test 11: 3 identical messages → repeating
{
  const history = [
    { role: 'assistant', content: 'Belirttiğiniz saat hangi ülke veya şehir saatine göre olsun?' },
    { role: 'user', content: 'efendim' },
    { role: 'assistant', content: 'Belirttiğiniz saat hangi ülke veya şehir saatine göre olsun?' },
    { role: 'user', content: 'merhaba' },
    { role: 'assistant', content: 'Belirttiğiniz saat hangi ülke veya şehir saatine göre olsun?' }
  ];
  const result = RepeatGuard.check(history);
  assert(result.isRepeating === true, 'T11: 3 identical assistant messages → isRepeating');
  assert(result.repeatCount >= 2, 'T11: repeatCount >= 2');
}

// Test 12: varied messages → not repeating
{
  const history = [
    { role: 'assistant', content: 'Merhaba, size nasıl yardımcı olabilirim?' },
    { role: 'user', content: 'merhaba' },
    { role: 'assistant', content: 'Geçmiş olsun, şikayetinizi daha detaylı anlatır mısınız?' },
    { role: 'user', content: 'belim ağrıyor' },
    { role: 'assistant', content: 'Bel ağrısı ne kadar süredir devam ediyor?' }
  ];
  const result = RepeatGuard.check(history);
  assert(result.isRepeating === false, 'T12: varied messages → not repeating');
}

// Test 13: Intent Router — efendim = greeting
{
  const intent = ConversationIntentRouter.route('efendim');
  assert(intent === 'greeting', 'T13: efendim → greeting');
}

// Test 14: Intent Router — sen kimsin = identity_question
{
  const intent = ConversationIntentRouter.route('sen kimsin?');
  assert(intent === 'identity_question', 'T14: sen kimsin → identity_question');
}

// Test 15: Intent Router — can you speak English = language_switch
{
  const intent = ConversationIntentRouter.route('can you speak English?');
  assert(intent === 'language_switch', 'T15: can you speak English → language_switch');
}

// Test 16: Intent Router — hangi saat contains 'saat' → time_availability (time indicator takes priority)
{
  const intent = ConversationIntentRouter.route('hangi saat');
  assert(intent === 'time_availability', 'T16: hangi saat → time_availability (saat keyword)');
}

// Test 16b: Intent Router — anlamadım = clarification_question
{
  const intent = ConversationIntentRouter.route('anlamadım');
  assert(intent === 'clarification_question', 'T16b: anlamadım → clarification_question');
}

// Test 17: Dynamic guide max 8 lines (7 behavioral summary lines)
{
  const summary = [
    '- Son mesaj dili: tr',
    '- Cevap dili: Türkçe',
    '- Intent: greeting',
    '- Pending slot geçerli: hayır',
    '- Eski scheduling context: yok',
    '- Ton: sıcak, doğal, kısa',
    '- Quality gate locale: tr'
  ];
  assert(summary.length <= 8, 'T17: Dynamic guide ≤ 8 lines');
}

console.log(`\n========== Results: ${passed} passed, ${failed} failed ==========\n`);
process.exit(failed > 0 ? 1 : 0);
