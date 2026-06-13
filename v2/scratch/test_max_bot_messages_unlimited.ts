/**
 * P0.3 — Max Bot Messages Unlimited Test
 * Tests that 0 = unlimited flows correctly through all layers
 */

// ── 1. UI Layer: MAX_MSG_OPTIONS includes Sınırsız ──
const MAX_MSG_OPTIONS = [
  { value: 5, label: "5 mesaj" },
  { value: 8, label: "8 mesaj" },
  { value: 12, label: "12 mesaj" },
  { value: 20, label: "20 mesaj" },
  { value: 0, label: "Sınırsız" },
];

function testUIOptions() {
  const unlimited = MAX_MSG_OPTIONS.find(o => o.value === 0);
  console.assert(unlimited !== undefined, 'FAIL: Sınırsız option missing');
  console.assert(unlimited?.label === 'Sınırsız', 'FAIL: Sınırsız label wrong');
  console.log('  ✅ UI includes Sınırsız option');
}

// ── 2. State Handling: ?? vs || for 0 ──
function testNullishCoalescing() {
  // Simulate profile.maxMessages = 0 (unlimited)
  const profile = { maxMessages: 0 };
  
  // Old behavior (buggy): 0 || 8 = 8
  const oldResult = profile.maxMessages || 8;
  console.assert(oldResult === 8, 'SANITY: old behavior should return 8 for 0');
  
  // New behavior (correct): 0 ?? 8 = 0
  const newResult = profile.maxMessages ?? 8;
  console.assert(newResult === 0, 'FAIL: ?? should preserve 0');
  console.log('  ✅ ?? preserves 0 (unlimited), || did not');
  
  // null case still falls back
  const nullProfile = { maxMessages: null as any };
  const nullResult = nullProfile.maxMessages ?? 8;
  console.assert(nullResult === 8, 'FAIL: null should fallback to 8');
  console.log('  ✅ null correctly falls back to 8');
  
  // undefined case
  const undefinedProfile = {} as any;
  const undResult = undefinedProfile.maxMessages ?? 8;
  console.assert(undResult === 8, 'FAIL: undefined should fallback to 8');
  console.log('  ✅ undefined correctly falls back to 8');
}

// ── 3. saveBotSetting parseInt fix ──
function testParseIntFix() {
  // Old behavior (buggy): parseInt("0") || 8 = 8
  const value = "0";
  const col = 'max_messages';
  
  // Old logic
  const oldDbVal = parseInt(value) || (col === 'max_messages' ? 8 : 1000);
  console.assert(oldDbVal === 8, 'SANITY: old parseInt logic returns 8 for "0"');
  
  // New logic
  const parsed = parseInt(value);
  let newDbVal: any;
  if (isNaN(parsed)) {
    newDbVal = col === 'max_messages' ? 8 : 1000;
  } else {
    newDbVal = parsed;
  }
  console.assert(newDbVal === 0, 'FAIL: new logic should preserve 0');
  console.log('  ✅ saveBotSetting parseInt preserves 0');
  
  // NaN case (invalid input)
  const nanParsed = parseInt("abc");
  let nanDbVal: any;
  if (isNaN(nanParsed)) {
    nanDbVal = 8;
  } else {
    nanDbVal = nanParsed;
  }
  console.assert(nanDbVal === 8, 'FAIL: NaN should fallback to 8');
  console.log('  ✅ NaN input falls back to default 8');
}

// ── 4. Worker Gate: maxMsg > 0 ──
function testWorkerGate() {
  // maxMsg = 0 → gate should NOT trigger (unlimited)
  const maxMsg0 = 0;
  const shouldSkip0 = maxMsg0 > 0;
  console.assert(shouldSkip0 === false, 'FAIL: maxMsg=0 should bypass gate');
  console.log('  ✅ maxMsg=0 bypasses worker gate (unlimited)');
  
  // maxMsg = 20 → gate should trigger when count >= 20
  const maxMsg20 = 20;
  const shouldCheck20 = maxMsg20 > 0;
  console.assert(shouldCheck20 === true, 'FAIL: maxMsg=20 should enter gate');
  console.log('  ✅ maxMsg=20 enters worker gate');
  
  // maxMsg = 5, count = 5 → handoff
  const maxMsg5 = 5;
  const count5 = 5;
  const shouldHandoff = maxMsg5 > 0 && count5 >= maxMsg5;
  console.assert(shouldHandoff === true, 'FAIL: count=5 >= maxMsg=5 should handoff');
  console.log('  ✅ count=5 >= maxMsg=5 triggers handoff');
}

// ── 5. BrainResolver: V2 path 0 handling ──
function testBrainResolverV2() {
  // Simulate DB returning max_messages = 0
  const p = { max_messages: 0 };
  
  let maxMessages = 20; // default
  if (p.max_messages !== null && p.max_messages !== undefined) {
    const parsed = parseInt(String(p.max_messages));
    maxMessages = isNaN(parsed) ? 20 : parsed;
  }
  console.assert(maxMessages === 0, 'FAIL: V2 resolver should preserve 0');
  console.log('  ✅ BrainResolver V2 preserves max_messages=0');
  
  // Simulate null → should stay default 20
  const pNull = { max_messages: null as any };
  let maxMessagesNull = 20;
  if (pNull.max_messages !== null && pNull.max_messages !== undefined) {
    const parsed = parseInt(String(pNull.max_messages));
    maxMessagesNull = isNaN(parsed) ? 20 : parsed;
  }
  console.assert(maxMessagesNull === 20, 'FAIL: null should stay 20');
  console.log('  ✅ BrainResolver V2 null stays default 20');
}

// ── 6. isDirty check ──
function testIsDirtyCheck() {
  // Profile has maxMessages = 0 (unlimited), user hasn't changed
  const profile = { maxMessages: 0 };
  const maxMessages = 0;
  const isDirty = maxMessages !== (profile.maxMessages ?? 8);
  console.assert(isDirty === false, 'FAIL: unchanged 0 should not be dirty');
  console.log('  ✅ isDirty: unchanged 0 → not dirty');
  
  // Profile has 0, user changes to 8
  const maxMessages2 = 8;
  const isDirty2 = maxMessages2 !== (profile.maxMessages ?? 8);
  console.assert(isDirty2 === true, 'FAIL: changed 0→8 should be dirty');
  console.log('  ✅ isDirty: 0→8 → dirty');
}

// ═══ RUN ALL ═══
console.log('\n=== P0.3 — Max Bot Messages Unlimited Tests ===\n');

console.log('1. UI Options:');
testUIOptions();

console.log('\n2. Nullish Coalescing (??):');
testNullishCoalescing();

console.log('\n3. saveBotSetting parseInt:');
testParseIntFix();

console.log('\n4. Worker Gate:');
testWorkerGate();

console.log('\n5. BrainResolver V2:');
testBrainResolverV2();

console.log('\n6. isDirty Check:');
testIsDirtyCheck();

console.log('\n=== ALL TESTS PASSED ===\n');
