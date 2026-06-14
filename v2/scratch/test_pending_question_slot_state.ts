import { PendingQuestionResolver } from '../src/lib/services/ai/pending-question-resolver';
import { ShortAnswerInterpreter } from '../src/lib/services/ai/short-answer-interpreter';
import { ContextAwareSafeFallbackResolver } from '../src/lib/services/ai/context-aware-safe-fallback';
import { PromptBuilder } from '../src/lib/services/ai/prompt-builder';
import { TenantBrain } from '../src/lib/brain/tenant-brain';

// Mock helper to construct TenantBrain
function createMockBrain(industry: string): TenantBrain {
  return {
    context: {
      tenantId: 'mock-tenant-id-123',
      channel: 'whatsapp',
      config: {
        industry,
        timezone: 'Europe/Istanbul',
        identity: {
          personaName: 'Rüya',
          organizationShortName: 'Başkent'
        }
      }
    },
    prompts: {
      systemPrompt: 'Sen Başkent asistanısın.',
      metadata: {
        industry
      }
    }
  } as any;
}

function runTests() {
  console.log('=== P0.9 PENDING QUESTION / SLOT STATE / SCHEDULING FLOW STABILIZATION TESTS ===\n');
  let passedCount = 0;
  let totalCount = 0;

  const assert = (name: string, condition: boolean, message?: string) => {
    totalCount++;
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${name}`);
      if (message) console.error(`   Reason: ${message}`);
    }
  };

  // 1. Pending slot detection: complaint_duration
  const history1 = [
    { role: 'user', content: 'merhaba' },
    { role: 'assistant', content: 'Mide yanması şikayetinizle ilgili bilgi almak istediğinizi belirtmiştiniz. Bu durum ne zamandır devam ediyor?' }
  ] as any[];
  assert(
    '1. PendingSlot: complaint_duration',
    PendingQuestionResolver.resolve(history1) === 'complaint_duration',
    `Expected complaint_duration, got ${PendingQuestionResolver.resolve(history1)}`
  );

  // 2. Short answer interpreter: "2 ay" -> duration_answer
  assert(
    '2. ShortAnswer: "2 ay" -> duration_answer',
    ShortAnswerInterpreter.interpret('2 ay', 'complaint_duration') === 'duration_answer'
  );

  // 3. Short answer interpreter: "olur" -> affirmative_answer
  assert(
    '3. ShortAnswer: "olur" -> affirmative_answer',
    ShortAnswerInterpreter.interpret('olur', 'confirmation_yes_no') === 'affirmative_answer'
  );

  // 4. Short answer interpreter: "bize göre olsun" -> timezone_answer
  assert(
    '4. ShortAnswer: "bize göre olsun" -> timezone_answer',
    ShortAnswerInterpreter.interpret('bize göre olsun', 'timezone_clarification') === 'timezone_answer'
  );

  // 5. Short answer interpreter: "17 olur" -> time_answer
  assert(
    '5. ShortAnswer: "17 olur" -> time_answer',
    ShortAnswerInterpreter.interpret('17 olur', 'call_time') === 'time_answer'
  );

  // 6. User frustration/correction mapping
  assert(
    '6. Frustration: "soru sordun cevap verdim" -> user_correction',
    ShortAnswerInterpreter.interpret('soru sordun cevap verdim', 'generic_none') === 'user_correction'
  );

  // 7. ContextAwareSafeFallbackResolver: user_correction response with complaint
  const brain = createMockBrain('healthcare');
  const fallbackResCorrection = ContextAwareSafeFallbackResolver.resolve({
    inboundText: 'soru sordun cevap verdim',
    brain,
    identityConfig: { personaName: 'Rüya' },
    unifiedContext: {
      patient_known_facts: ['Şikayeti: mide yanması'],
      history: [
        { role: 'user', content: '2 ay' },
        { role: 'assistant', content: 'Saat 00:00 çalışma saatleri dışındadır...' }
      ]
    }
  });
  assert(
    '7. Fallback path correction matches user_correction_fallback',
    fallbackResCorrection.finalPath === 'user_correction_fallback',
    `Expected user_correction_fallback, got ${fallbackResCorrection.finalPath}`
  );
  assert(
    '7. Fallback text correction contains previous answer and complaint',
    fallbackResCorrection.text.includes('2 ay') && fallbackResCorrection.text.includes('mide yanması'),
    `Text: "${fallbackResCorrection.text}"`
  );

  // 8. ContextAwareSafeFallbackResolver: pendingSlot = complaint_duration fallback
  const fallbackResDuration = ContextAwareSafeFallbackResolver.resolve({
    inboundText: 'bilmiyorum',
    brain,
    identityConfig: { personaName: 'Rüya' },
    unifiedContext: {
      history: [
        { role: 'user', content: 'merhaba' },
        { role: 'assistant', content: 'Bu durum ne zamandır devam ediyor?' }
      ]
    }
  });
  assert(
    '8. Slot-aware fallback: complaint_duration',
    fallbackResDuration.finalPath === 'pending_slot_complaint_duration_fallback' &&
    fallbackResDuration.text.includes('Şikayetinizin ne kadardır devam ettiğini'),
    `Path: ${fallbackResDuration.finalPath}, Text: ${fallbackResDuration.text}`
  );

  // 9. PromptBuilder memory suppression
  const mockContextWithPending = {
    currentMessageText: '2 ay',
    patient_known_facts: ['Şikayeti: mide yanması'],
    opportunity: {
      id: 'opp-1',
      summary: 'Hasta daha önce Kardiyoloji bölümüyle ilgilendi.',
      ai_reason: 'Kardiyoloji kontrol'
    },
    history: [
      { role: 'user', content: 'merhaba' },
      { role: 'assistant', content: 'Bu durum ne zamandır devam ediyor?' }
    ]
  };
  const systemPrompt = PromptBuilder.buildSystemPrompt(brain, 'lead', false, mockContextWithPending);
  assert(
    '9. Memory suppression: opp summary is suppressed when pending slot is active',
    systemPrompt.includes('geçmiş bağlam bu turda baskılanmıştır') &&
    !systemPrompt.includes('Kardiyoloji bölümüyle ilgilendi'),
    `Prompt: ${systemPrompt}`
  );

  // 10. Scheduling: Date-only 17 June must clear midnight local/UTC
  const mockContextDateOnly = {
    active_task: {
      task_type: 'callback_scheduled',
      metadata: {
        scheduled_for_utc: '2026-06-17T00:00:00Z', // UTC midnight
        callback_time_tr: '00:00'
      }
    }
  };
  const promptDateOnly = PromptBuilder.buildSystemPrompt(brain, 'lead', false, mockContextDateOnly);
  assert(
    '10. Date-only scheduled callback clears midnight 00:00',
    promptDateOnly.includes('callback_time_tr: Bilinmiyor'),
    `Prompt: ${promptDateOnly}`
  );

  // 11. Date-only suggestions vs explicit midnight suggestions
  const { parseDeterministicSuggestion } = require('../src/lib/utils/date-parser');
  
  // Case A: 17 haziran arayın (date-only)
  const suggDateOnly = parseDeterministicSuggestion("17 haziran arayın", new Date(), null, null);
  assert(
    '11. A: "17 haziran arayın" -> suggested_time is null',
    suggDateOnly.suggested_time === null,
    `Expected suggested_time null, got ${suggDateOnly.suggested_time}`
  );
  assert(
    '11. B: "17 haziran arayın" -> suggested_date is resolved',
    suggDateOnly.suggested_date !== null && suggDateOnly.suggested_date.includes('-06-17'),
    `Expected suggested_date to include -06-17, got ${suggDateOnly.suggested_date}`
  );

  // Case B: 17 haziran gece 12'de arayın (explicit midnight)
  const suggExplicitMidnight = parseDeterministicSuggestion("17 haziran gece 12'de arayın", new Date(), null, null);
  assert(
    '11. C: "17 haziran gece 12\'de arayın" -> suggested_time is 00:00',
    suggExplicitMidnight.suggested_time === '00:00',
    `Expected suggested_time 00:00, got ${suggExplicitMidnight.suggested_time}`
  );

  console.log(`\nTotal: ${totalCount}, Passed: ${passedCount}`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runTests();
