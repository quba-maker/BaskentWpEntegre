import { parseTurkeyLocalToUtc, adjustToOperatingHours } from '../src/lib/utils/timezone';

function runTests() {
  console.log('=== STARTING OPERATIONS & TIMEZONE FIX VERIFICATION ===\n');

  // Test 1: parseTurkeyLocalToUtc
  console.log('Testing parseTurkeyLocalToUtc...');
  const parsed1 = parseTurkeyLocalToUtc('2026-06-03', '10:00');
  console.log(`Input: '2026-06-03' 10:00 TRT -> Output: ${parsed1}`);
  if (parsed1 !== '2026-06-03T07:00:00.000Z') {
    throw new Error('Test 1 failed: Expected 2026-06-03T07:00:00.000Z');
  }
  console.log('✅ parseTurkeyLocalToUtc passed.\n');

  // Test 2: adjustToOperatingHours - before operating hours (08:00 TRT)
  console.log('Testing adjustToOperatingHours (Before hours)...');
  const resBefore = adjustToOperatingHours('2026-06-03T05:00:00Z'); // 08:00 TRT
  console.log(`Input: 2026-06-03T05:00:00Z (08:00 TRT)`);
  console.log(`Output: ${JSON.stringify(resBefore, null, 2)}`);
  if (!resBefore.adjusted || resBefore.adjustedUtc !== '2026-06-03T06:00:00.000Z') {
    throw new Error('Before hours test failed: Expected adjustment to 09:00 TRT (06:00 UTC)');
  }
  console.log('✅ Before hours shift passed.\n');

  // Test 3: adjustToOperatingHours - inside operating hours (18:00 TRT)
  console.log('Testing adjustToOperatingHours (Inside hours)...');
  const resInside = adjustToOperatingHours('2026-06-03T15:00:00Z'); // 18:00 TRT
  console.log(`Input: 2026-06-03T15:00:00Z (18:00 TRT)`);
  console.log(`Output: ${JSON.stringify(resInside, null, 2)}`);
  if (resInside.adjusted) {
    throw new Error('Inside hours test failed: Should not adjust valid operational times');
  }
  console.log('✅ Inside hours validation passed.\n');

  // Test 4: adjustToOperatingHours - after operating hours (23:00 TRT)
  console.log('Testing adjustToOperatingHours (After hours)...');
  const resAfter = adjustToOperatingHours('2026-06-03T20:00:00Z'); // 23:00 TRT
  console.log(`Input: 2026-06-03T20:00:00Z (23:00 TRT)`);
  console.log(`Output: ${JSON.stringify(resAfter, null, 2)}`);
  if (!resAfter.adjusted || resAfter.adjustedUtc !== '2026-06-04T06:00:00.000Z') {
    throw new Error('After hours test failed: Expected adjustment to next day 09:00 TRT (06:00 UTC)');
  }
  console.log('✅ After hours shift passed.\n');

  console.log('🎉 ALL TIMEZONE AND OPERATING HOUR VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉');
}

try {
  runTests();
} catch (e: any) {
  console.error('❌ Verification failed:', e.message);
  process.exit(1);
}
