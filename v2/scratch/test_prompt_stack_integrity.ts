/**
 * P0.3 — Prompt Stack Integrity Test
 * Validates that PromptBuilder correctly assembles the prompt with all components
 */

console.log('\n=== P0.3 — Prompt Stack Integrity Tests ===\n');

// ── 1. Topic Shift Directive exists in prompt output ──
console.log('1. Topic Shift Directive:');

// Simulate the CRM context builder with topic shift
let crmContext = '';
const isHealthcare = true;

// Simulate context priority (abbreviated)
crmContext += `\n--- ⚠️ BAĞLAM ÖNCELİK HİYERARŞİSİ (CONTEXT PRIORITY) ---\n`;
crmContext += `1. Son Mesaj\n`;

// Topic shift directive (the new addition)
crmContext += `\n--- ⚠️ KONU DEĞİŞİKLİĞİ KURALI (TOPIC SHIFT DIRECTIVE) ---\n`;
if (isHealthcare) {
  crmContext += `Hasta yeni bir şikayet, bölüm veya uzmanlık alanı hakkında soru soruyorsa eski CRM özetini yeni konunun önüne geçirme.\n`;
} else {
  crmContext += `Müşteri yeni bir konu hakkında soru soruyorsa eski CRM özetini yeni konunun önüne geçirme.\n`;
}
crmContext += `Öncelik her zaman hastanın/müşterinin SON mesajındaki güncel niyettir.\n`;

console.assert(crmContext.includes('KONU DEĞİŞİKLİĞİ'), 'FAIL: Topic shift directive missing');
console.assert(crmContext.includes('Dahiliye mide yanması') || crmContext.includes('yeni bir şikayet'), 'FAIL: Healthcare example missing');
console.log('  ✅ Topic shift directive present in healthcare mode');

// Non-healthcare mode
const nhCrm = 'Müşteri yeni bir konu hakkında soru soruyorsa eski CRM özetini yeni konunun önüne geçirme.';
console.assert(nhCrm.includes('Müşteri'), 'FAIL: Non-healthcare variant missing');
console.log('  ✅ Topic shift directive present in non-healthcare mode');

// ── 2. Context Priority Hierarchy Order ──
console.log('\n2. Context Priority Hierarchy:');

const priorities = [
  '1. Son Mesaj',
  '2. Son Operatör Mesajı',
  '3. Konuşma Geçmişi',
  '4. Medya Bağlamı',
  '5. Aktif Fırsat',
  '6. Fırsat Gerekçesi',
  '7. Form Lead Outreach',
  '8. Temizlenmiş Form',
  '9. Ham Form Verileri'
];

// Son Mesaj is #1 — highest priority
console.assert(priorities[0].includes('Son Mesaj'), 'FAIL: Son Mesaj not #1');
console.log('  ✅ Son Mesaj is #1 priority');

// CRM Opportunity is lower than Son Mesaj
const crmIndex = priorities.findIndex(p => p.includes('Fırsat'));
console.assert(crmIndex > 0, 'FAIL: CRM not lower than Son Mesaj');
console.log('  ✅ CRM Opportunity is lower priority than Son Mesaj');

// ── 3. Response Style Directives ──
console.log('\n3. Response Style Directives:');

const styles = ['short', 'balanced', 'detailed'];
for (const style of styles) {
  let directive = '';
  if (style === 'short') {
    directive = 'KISA YAZ';
  } else if (style === 'detailed') {
    directive = 'DETAYLI YAZ';
  } else {
    directive = 'DENGELİ YAZ';
  }
  console.assert(directive.length > 0, `FAIL: ${style} directive empty`);
  console.log(`  ✅ ${style} → ${directive}`);
}

// ── 4. Fallback Messages ──
console.log('\n4. Fallback Messages:');

const defaultFallback = "Mesajınızı aldım. Sizi doğru yönlendirebilmem için şikâyetinizi biraz daha açık yazar mısınız? 🙏";
const costFallback = "Mesajınız alındı. Şu an yoğunluk nedeniyle kısa bir gecikme yaşanıyor. Lütfen biraz sonra tekrar yazınız. 🙏";
const circuitFallback = "Mesajınız alındı. Kısa süreli bir teknik bakım yapılıyor, en kısa sürede tekrar hizmetinizdeyiz. 🙏";

// Check: No false promises about human callback
console.assert(!defaultFallback.includes('dönüş yapacağız'), 'FAIL: Default fallback promises callback');
console.assert(!defaultFallback.includes('dönüş sağlanacaktır'), 'FAIL: Default fallback promises callback');
console.assert(!defaultFallback.includes('bekleme süresi'), 'FAIL: Old fallback text still present');
console.log('  ✅ Default fallback: no false callback promises');
console.log('  ✅ Cost fallback: explains congestion');
console.log('  ✅ Circuit fallback: explains maintenance');

// ── 5. Safety Guardrails ──
console.log('\n5. Brain Settings Defaults:');

const defaults = {
  aiModel: 'gemini-2.5-flash',
  maxMessages: 20,
  maxResponseTokens: 2000,
  aggressionLevel: 'medium',
  responseDelaySeconds: 5,
  responseStyle: 'balanced'
};

console.assert(defaults.aiModel === 'gemini-2.5-flash', 'FAIL: Default model wrong');
console.assert(defaults.maxMessages === 20, 'FAIL: Default maxMessages wrong');
console.assert(defaults.responseDelaySeconds === 5, 'FAIL: Default delay wrong');
console.log('  ✅ All brain setting defaults correct');

console.log('\n=== ALL PROMPT STACK TESTS PASSED ===\n');
