/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { QualityGateRecoveryHelper, normalizeQualityGateReason } from '../src/lib/services/ai/quality-gate-recovery';
import { AIOrchestrator, ChatMessage } from '../src/lib/services/ai/orchestrator';

// Setup mock database
const queryHistory: { text: string; values?: any[] }[] = [];

const mockDb: any = {
  tenantId: 'mock-tenant-id-456',
  executeSafe: async (query: any) => {
    if (typeof query === 'string') {
      queryHistory.push({ text: query, values: [] });
    } else {
      queryHistory.push({ text: query.text, values: query.values });
    }
    return [];
  }
};

// Inject mockDb globally so withTenantDB resolves to it
(global as any).mockDb = mockDb;

const mockBrain = {
  context: {
    tenantId: 'mock-tenant-id-456',
    channel: 'whatsapp',
    config: {
      industry: 'healthcare',
      timezone: 'Europe/Istanbul'
    },
    settings: {
      aiModel: 'gemini-2.5-flash',
      maxResponseTokens: 1000
    }
  },
  prompts: {
    systemPrompt: 'Sen Başkent asistanısın.',
    metadata: {
      industry: 'healthcare'
    }
  }
};

const identityConfig = {
  personaName: 'Rüya',
  organizationShortName: 'Başkent'
};

async function runTests() {
  console.log('=== P0.10 QUALITY GATE RECOVERY & PARITY PATH TEST SUITE ===\n');
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

  // Clear query history helper
  const clearHistory = () => {
    queryHistory.length = 0;
  };

  try {
    // ----------------------------------------------------
    // Scenario 1: generic_fallback_pattern (Low-Risk) -> Recovery Applied
    // ----------------------------------------------------
    clearHistory();
    const res1 = await QualityGateRecoveryHelper.handleFailure({
      tenantId: 'mock-tenant-id-456',
      conversationId: 'conv-123',
      phoneNumber: '905001234567',
      inboundText: 'merhaba',
      brain: mockBrain,
      identityConfig,
      unifiedContext: { history: [] },
      reason: 'generic_fallback_pattern: Bağlamsız genel yanıt kalıbı',
      channel: 'whatsapp',
      path: 'queue_immediate'
    });

    assert('1. generic_fallback_pattern recovery applied', res1.recovered === true);
    assert('1. generic_fallback_pattern is not high risk', res1.isHighRisk === false);
    assert('1. generic_fallback_pattern normalized correctly', res1.reasonNormalized === 'generic_fallback_pattern');
    assert('1. generic_fallback_pattern logs applied action to audit logs', 
      queryHistory.some(q => q.values && q.values.includes('QUALITY_GATE_RECOVERY_APPLIED'))
    );
    assert('1. generic_fallback_pattern does NOT update conversation status to human', 
      !queryHistory.some(q => q.text.toLowerCase().includes('update conversations') && q.text.toLowerCase().includes('status = \'human\''))
    );

    // ----------------------------------------------------
    // Scenario 2: cta_frequency_brake (Low-Risk) -> Recovery Applied
    // ----------------------------------------------------
    clearHistory();
    const res2 = await QualityGateRecoveryHelper.handleFailure({
      tenantId: 'mock-tenant-id-456',
      conversationId: 'conv-123',
      phoneNumber: '905001234567',
      inboundText: '17:00 uygun',
      brain: mockBrain,
      identityConfig,
      unifiedContext: { history: [] },
      reason: 'Kritik Fren Engeli: CTA Frekans Freni aktifken CTA ifadesi kullanılamaz',
      channel: 'whatsapp',
      path: 'queue_delayed'
    });

    assert('2. cta_frequency_brake recovery applied', res2.recovered === true);
    assert('2. cta_frequency_brake normalized correctly', res2.reasonNormalized === 'cta_frequency_brake');
    assert('2. cta_frequency_brake logs to audit logs', 
      queryHistory.some(q => q.values && q.values.includes('QUALITY_GATE_RECOVERY_APPLIED'))
    );

    // ----------------------------------------------------
    // Scenario 3: unknown_quality_reason -> Recovery NOT Applied (treated as high-risk)
    // ----------------------------------------------------
    clearHistory();
    const res3 = await QualityGateRecoveryHelper.handleFailure({
      tenantId: 'mock-tenant-id-456',
      conversationId: 'conv-123',
      phoneNumber: '905001234567',
      inboundText: 'selam',
      brain: mockBrain,
      identityConfig,
      unifiedContext: { history: [] },
      reason: 'unexpected_unsupported_grammar_rule_triggered',
      channel: 'whatsapp',
      path: 'queue_immediate'
    });

    assert('3. unknown_quality_reason recovery is NOT applied', res3.recovered === false);
    assert('3. unknown_quality_reason is treated as high risk', res3.isHighRisk === true);
    assert('3. unknown_quality_reason normalized to unknown', res3.reasonNormalized === 'unknown');
    assert('3. unknown_quality_reason triggers human takeover', 
      queryHistory.some(q => q.text.toLowerCase().includes('update conversations') && q.text.toLowerCase().includes('status = \'human\''))
    );
    assert('3. unknown_quality_reason inserts system alert message', 
      queryHistory.some(q => q.text.toLowerCase().includes('insert into messages') && q.text.toLowerCase().includes("'system'"))
    );

    // ----------------------------------------------------
    // Scenario 4: medical_unsafe (High-Risk) -> Human Takeover & System Alert
    // ----------------------------------------------------
    clearHistory();
    const res4 = await QualityGateRecoveryHelper.handleFailure({
      tenantId: 'mock-tenant-id-456',
      conversationId: 'conv-123',
      phoneNumber: '905001234567',
      inboundText: 'mide ilacı önerir misin',
      brain: mockBrain,
      identityConfig,
      unifiedContext: { history: [] },
      reason: 'medical_unsafe: Tıbbi teşhis/öneri içeriyor',
      channel: 'whatsapp',
      path: 'queue_immediate'
    });

    assert('4. medical_unsafe recovery NOT applied', res4.recovered === false);
    assert('4. medical_unsafe is high risk', res4.isHighRisk === true);
    assert('4. medical_unsafe triggers human takeover update', 
      queryHistory.some(q => q.text.toLowerCase().includes('update conversations') && q.text.toLowerCase().includes('status = \'human\''))
    );
    assert('4. medical_unsafe inserts system alert', 
      queryHistory.some(q => q.text.toLowerCase().includes('insert into messages') && q.text.toLowerCase().includes("'system'"))
    );

    // ----------------------------------------------------
    // Scenario 5: identity_leak (High-Risk) -> Human Takeover & System Alert
    // ----------------------------------------------------
    clearHistory();
    const res5 = await QualityGateRecoveryHelper.handleFailure({
      tenantId: 'mock-tenant-id-456',
      conversationId: 'conv-123',
      phoneNumber: '905001234567',
      inboundText: 'nereden yazıyorsun',
      brain: mockBrain,
      identityConfig,
      unifiedContext: { history: [] },
      reason: 'identity_leak: bot kimliği ifşa edildi',
      channel: 'whatsapp',
      path: 'queue_immediate'
    });

    assert('5. identity_leak recovery NOT applied', res5.recovered === false);
    assert('5. identity_leak is high risk', res5.isHighRisk === true);
    assert('5. identity_leak triggers human takeover', 
      queryHistory.some(q => q.text.toLowerCase().includes('update conversations') && q.text.toLowerCase().includes('status = \'human\''))
    );

    // ----------------------------------------------------
    // Scenario 6: panel/manual draft low-risk fail -> Return safe draft text
    // ----------------------------------------------------
    clearHistory();
    const res6 = await QualityGateRecoveryHelper.handleFailure({
      tenantId: 'mock-tenant-id-456',
      conversationId: 'conv-123',
      phoneNumber: '905001234567',
      inboundText: 'fiyat nedir',
      brain: mockBrain,
      identityConfig,
      unifiedContext: { history: [] },
      reason: 'style_quality: hatalı türkçe ek kullanımı',
      channel: 'whatsapp',
      path: 'panel_draft'
    });

    assert('6. panel_draft recovery applied', res6.recovered === true);
    assert('6. panel_draft returns safe fallback text', typeof res6.text === 'string' && res6.text.length > 0);
    assert('6. panel_draft does NOT perform auto outbound send', 
      !queryHistory.some(q => q.text.includes('INSERT INTO messages') && q.values?.includes('out'))
    );

    // ----------------------------------------------------
    // Scenario 7: queue worker low-risk fail -> Return safe response text and keep autopilot/bot
    // ----------------------------------------------------
    clearHistory();
    const res7 = await QualityGateRecoveryHelper.handleFailure({
      tenantId: 'mock-tenant-id-456',
      conversationId: 'conv-123',
      phoneNumber: '905001234567',
      inboundText: 'merhaba',
      brain: mockBrain,
      identityConfig,
      unifiedContext: { history: [] },
      reason: 'generic_fallback_pattern: fallback',
      channel: 'whatsapp',
      path: 'queue_immediate'
    });

    assert('7. queue_immediate low-risk recovery applied', res7.recovered === true);
    assert('7. queue_immediate returns safe text', typeof res7.text === 'string' && res7.text.length > 0);
    assert('7. queue_immediate does NOT set status to human in DB', 
      !queryHistory.some(q => q.text.toLowerCase().includes('update conversations') && q.text.toLowerCase().includes('status = \'human\''))
    );

    // ----------------------------------------------------
    // Scenario 8: direction='system' isolation test
    // ----------------------------------------------------
    const orchestrator = new AIOrchestrator();
    
    const messagesWithSystemNote: ChatMessage[] = [
      { role: 'system', content: 'Sen Başkent asistanısın.' },
      { role: 'user', content: 'Merhaba' },
      { role: 'assistant', content: 'Merhaba, Rüya ben.' },
      { role: 'assistant', content: 'AI yanıtı kalite kontrolünden geçemedi.', direction: 'system' }, // system note
      { role: 'user', content: 'Fiyat almak istiyorum.' }
    ];

    const dummyConfig = {
      provider: 'gemini' as const,
      modelId: 'gemini-2.5-flash',
      apiKey: 'dummy-api-key',
      temperature: 0.7,
      maxTokens: 1000
    };

    let receivedMessages: ChatMessage[] = [];
    (orchestrator as any).callGemini = async (msgs: ChatMessage[], config: any) => {
      receivedMessages = msgs;
      return { text: 'Mocked response', finishReason: 'STOP' };
    };

    await orchestrator.generateResponse(messagesWithSystemNote, dummyConfig, 'mock-tenant-id-456', 'conv-123', { sandbox: true });

    assert('8. direction=\'system\' isolation: system note filtered from messages', 
      !receivedMessages.some(m => m.direction === 'system' || m.content?.includes('kalite kontrolünden geçemedi'))
    );

    // ----------------------------------------------------
    // Scenario 9: MAX_TOKENS finishReason log check
    // ----------------------------------------------------
    (orchestrator as any).callGemini = async (msgs: ChatMessage[], config: any) => {
      return { text: 'Incomplete response text...', finishReason: 'MAX_TOKENS' };
    };

    const result = await orchestrator.generateResponse(messagesWithSystemNote, dummyConfig, 'mock-tenant-id-456', 'conv-123', { sandbox: false });

    assert('9. orchestrator returns fallback result on MAX_TOKENS', typeof result.text === 'string' && result.text.length > 0);
    assert('9. finishReason in orchestrator result is MAX_TOKENS', result.finishReason === 'MAX_TOKENS');

    // ----------------------------------------------------
    // Scenario 10: prompt/context compaction logic check
    // ----------------------------------------------------
    const hugeSystemPrompt = `
Sen Başkent asistanısın.
--- AKTİF FIRSAT BİLGİLERİ (CRM OPPORTUNITY) ---
Fırsat Detayları:
- Bölüm: Kardiyoloji
- Fiyat: 5000 TL
- İlgilenilen Hekim: Prof. Dr. Mehmet
- Uzun açıklamalar burada yer alır ve promptu şişirir...
--- ÖNCEKİ GÖRÜŞME ÖZETİ ---
Önceki Görüşme Notları:
- Hasta mide yanması şikayetiyle başvurdu.
- Randevu saati 17:00 olarak planlandı.
Ham Form Verileri:
- phone: 905000000000
- name: Ahmet
- department: Kardiyoloji
- notes: Bel ağrısı var.
    `;

    const messagesWithCompaction: ChatMessage[] = [
      { role: 'system', content: hugeSystemPrompt },
      { role: 'user', content: 'haziran 17 de telefon görüşmesi istiyorum' }
    ];

    let compactedSystemPromptText = '';
    (orchestrator as any).callGemini = async (msgs: ChatMessage[], config: any) => {
      compactedSystemPromptText = msgs.find(m => m.role === 'system')?.content || '';
      return { text: 'Mocked response', finishReason: 'STOP' };
    };

    await orchestrator.generateResponse(messagesWithCompaction, dummyConfig, 'mock-tenant-id-456', 'conv-123', { sandbox: true });

    assert('10. CRM Opportunity compacted when active flow is active', 
      compactedSystemPromptText.includes('aktif akış/bütçe koruması nedeniyle kısaltılmıştır')
    );
    assert('10. Previous memory summary compacted when active flow is active', 
      compactedSystemPromptText.includes('Geçmiş konuşma özeti') && compactedSystemPromptText.includes('aktif akış/bütçe koruması nedeniyle kısaltılmıştır')
    );
    assert('10. Raw form data compacted when active flow is active', 
      compactedSystemPromptText.includes('Ham Form Verileri: Form verisi mevcut.')
    );

  } catch (e: any) {
    console.error('Unhandled error during test run:', e);
    process.exit(1);
  }

  console.log(`\nP0.10 Test Suite completed. Total: ${totalCount}, Passed: ${passedCount}`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runTests();
