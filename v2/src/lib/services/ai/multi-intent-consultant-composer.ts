/**
 * P0.16-K: MultiIntentConsultantComposer
 *
 * Handles messages that contain MULTIPLE questions in one message.
 * Ensures ALL questions are answered, not just the first detected intent.
 *
 * Example trigger:
 *   "hastaneniz nerede? fiyatlar nasıl? doktor isimleri verebilir misiniz? süreç nasıl işliyor?"
 *
 * DESIGN:
 * - Detects intent list from inbound text
 * - Composes numbered response blocks for each intent
 * - Uses ConsultantConversationStateResolver for participant context
 * - Returns null if NOT a multi-intent message (caller falls through to LLM)
 *
 * SAFETY:
 * - No outbound messages / no side effects
 * - No hardcoded names or fabricated content
 * - PII-safe telemetry only
 */

import type { TenantBrain } from '../../brain/tenant-brain';
import { ConsultantConversationStateResolver } from './consultant-conversation-state-resolver';
import { DoctorNamesPolicy } from './doctor-names-policy';
import { DoctorDirectoryResolver } from './doctor-directory-resolver';
import { TenantConfigResolver } from './tenant-config-resolver';

export interface MultiIntentComposerResult {
  text: string;
  intentList: string[];
  composed: true;
}

interface IntentCandidate {
  intent: string;
  detected: boolean;
}

export class MultiIntentConsultantComposer {
  /**
   * Tries to compose a multi-intent response.
   * Returns null if the message is NOT multi-intent (< 2 distinct intents).
   */
  public static compose(
    inboundText: string,
    brain: TenantBrain,
    history: { role: string; content: string }[],
    resolvedDepartment: string | null,
    workerPath = 'unknown'
  ): MultiIntentComposerResult | null {
    const lower = inboundText.toLowerCase();

    // ── Detect intents ────────────────────────────────────────────────────────
    // P0.16-M: Expanded candidates — must match isMultiIntent() below exactly
    const candidates: IntentCandidate[] = [
      { intent: 'address_question',    detected: /nerede|adres|konum|konumu/.test(lower) },
      { intent: 'price_question',      detected: /fiyat|[üu]cret|tutar|[öo]deme|maliyet|ta\s*12|ta12|ne kadar/.test(lower) },
      // P0.16-M: "doktor kim" / "doktorlar kim" / "hekimler kim" / "hangi doktorlar" etc.
      { intent: 'doctor_names',        detected: /(?:doktor|hekim)(?:lar|ler)?\s+(?:isim|list|kim|hang)|(?:doktor|hekim)(?:lar|ler)?\s+kim(?:ler)?|kimler\s+var|hangi\s+(?:doktor|hekim)(?:lar|ler)?/.test(lower) },
      // P0.16-M: "süreç" / "nasıl işliyor" / "süreç nasıl" etc.
      { intent: 'process_question',    detected: /s[üu]re[çc]|nas[ıi]l\s+i[şs]liyor|nas[ıi]l\s+[çc]al[ıi][şs][ıi]yor|a[şs]ama|ad[ıi]m|tedavi\s+s[üu]re|nas[ıi]l\s+olacak|gelme\s+nas[ıi]l|geli[şs]\s+s[üu]re|tedavi\s+s[üu]re/.test(lower) },
      { intent: 'logistics_question',  detected: /konaklama|ula[şs][ıi]m|otel|transfer|yol|gelme/.test(lower) },
      { intent: 'next_step_request',   detected: /belirleyelim|ne\s+zaman|nas[ıi]l\s+olacak|ee\s+yani|ne\s+yapmam\s+gerekiyor|ilerleyelim/.test(lower) },
      { intent: 'concern_objection',   detected: /[şs][üu]phe|end[iı]şe|emin\s+de[ğg]il|karars[ıi]z|pahal[ıi]|uzak|kalacak|konaklama|nas[ıi]l\s+gelece[ğg]im|ta\s*12|ta12|[öo]deme/.test(lower) },
    ];

    const detected = candidates.filter(c => c.detected);

    // Not multi-intent if fewer than 2 distinct intents
    if (detected.length < 2) return null;

    const intentList = detected.map(c => c.intent);

    // ── Get consultant state ──────────────────────────────────────────────────
    const state = ConsultantConversationStateResolver.resolve(history);
    const selfParticipant = state.participants.find(p => p.relation === 'self');
    const departments: string[] = [];
    for (const p of state.participants) {
      if (p.department && !departments.includes(p.department)) {
        departments.push(p.department);
      }
    }
    // Fallback: use resolvedDepartment from orchestrator chain
    if (departments.length === 0 && resolvedDepartment) {
      departments.push(resolvedDepartment);
    }

    // ── Check if doctor was already asked (for policy tier) ──────────────────
    const previousDoctorAsk = history.some(m =>
      m.role === 'user' &&
      /doktor\s+isim|hekim\s+isim|hangi\s+doktor/.test(m.content.toLowerCase())
    );

    // ── Build response blocks ─────────────────────────────────────────────────
    const blocks: string[] = [];
    let blockIndex = 1;

    if (detected.find(d => d.intent === 'address_question')) {
      const orgName = (brain.prompts.metadata as any)?.identity?.organizationName
        || (brain.context.config as any)?.identity?.organizationName
        || 'Hastanemiz';
      const addressHint = TenantConfigResolver.getAddress(brain);

      if (addressHint) {
        blocks.push(`${blockIndex}. Hastane konumu\n${addressHint}`);
      } else {
        blocks.push(`${blockIndex}. Hastane konumu\n${orgName} adres bilgisini sizinle paylaşabilirim.`);
      }
      blockIndex++;
    }

    if (detected.find(d => d.intent === 'price_question')) {
      const hasForeignContext = history.some(m => /almanya|yurt\s*dışı|yurtdisi|sigorta|sgk|ta\s*12|ta12|t12/i.test(m.content))
        || /almanya|yurt\s*dışı|yurtdisi|sigorta|sgk|ta\s*12|ta12|t12/i.test(inboundText)
        || brain.context.location?.toLowerCase().includes('almanya')
        || (brain.prompts.metadata as any)?.isForeigner;

      const extraInfo = hasForeignContext
        ? ' Ödeme veya TA12 gibi evrak konularını ayrıca netleştirmek istemeniz çok anlaşılır.'
        : ' Ödeme veya faturalandırma konularını netleştirmek istemeniz çok anlaşılır.';

      blocks.push(`${blockIndex}. Fiyat bilgisi\nFiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.${extraInfo}`);
      blockIndex++;
    }

    if (detected.find(d => d.intent === 'doctor_names')) {
      const doctorPolicy = DoctorNamesPolicy.resolve(brain, departments, previousDoctorAsk);
      blocks.push(`${blockIndex}. Doktor bilgisi\n${doctorPolicy.text}`);
      blockIndex++;
    }

    if (detected.find(d => d.intent === 'process_question')) {
      // Use department-aware process block
      const hasNeurosurgery = departments.some(d => d.toLowerCase().includes('beyin') || d.toLowerCase().includes('sinir') || d.toLowerCase().includes('fizik'));
      const hasCardiology   = departments.some(d => d.toLowerCase().includes('kardiy'));

      const processBlocks: string[] = [];
      if (hasNeurosurgery && selfParticipant?.complaint) {
        processBlocks.push(`${selfParticipant.complaint} için süreç hastanede ilgili uzman hekim değerlendirmesiyle başlar. Muayene ve gerekirse tetkikler sonrası tedavi planı netleşir.`);
      }
      if (hasCardiology) {
        const secondaryLabel = state.participants.find(p => p.department?.toLowerCase().includes('kardiy') && p.relation !== 'self');
        const label = secondaryLabel ? `${secondaryLabel.relation === 'mother' ? 'Anneniz' : secondaryLabel.relation === 'father' ? 'Babanız' : 'Yakınınız'} için Kardiyoloji` : 'Kardiyoloji';
        processBlocks.push(`${label}: muayene ve gerekli görülürse tetkikler planlanır; net değerlendirme hastanede yapılır.`);
      }
      if (processBlocks.length === 0) {
        processBlocks.push('Süreç hastanede ilgili uzman hekim değerlendirmesiyle başlar. Muayene ve gerekli tetkikler sonrası kişiye özel plan netleşir.');
      }

      blocks.push(`${blockIndex}. Süreç\n${processBlocks.join('\n')}`);
      blockIndex++;
    }

    if (detected.find(d => d.intent === 'concern_objection')) {
      blocks.push(`${blockIndex}. Aklınızdaki soru işaretleri\nKarar vermeden önce ödeme, ulaşım ve konaklama tarafını netleştirmek istemeniz çok anlaşılır. En çok hangi başlık sizi düşündürüyor?`);
      blockIndex++;
    }

    if (detected.find(d => d.intent === 'logistics_question')) {
      blocks.push(`${blockIndex}. Konaklama / Ulaşım\nŞehir dışından veya yurt dışından gelen hastalar için ulaşım, transfer ve konaklama planlaması ayrıca değerlendirilebilir. Kalacak yer veya geliş güzergahı endişeniz varsa bunu da not alıp birlikte netleştirebiliriz.`);
      blockIndex++;
    }

    if (detected.find(d => d.intent === 'next_step_request')) {
      // Build callback request
      const location = selfParticipant?.location;
      let callbackText = 'Sizi hangi gün ve saat aralığında aramam uygun olur?';
      if (location) {
        callbackText += `\n${location}'da olduğunuzu not aldım; saati ${location} saati olarak mı iletmemi istersiniz?`;
      }
      blocks.push(`${blockIndex}. Sonraki adım\n${callbackText}`);
      blockIndex++;
    }

    if (blocks.length === 0) return null;

    const intro = detected.length >= 3
      ? 'Tabii, tek tek yanıtlayayım.'
      : 'Elbette yanıtlayayım.';

    const text = `${intro}\n\n${blocks.join('\n\n')}`;

    try {
      console.log(JSON.stringify({
        tag: 'MULTI_INTENT_CONSULTANT_COMPOSED',
        intentList,
        intentCount: intentList.length,
        blockCount: blocks.length,
        participantsCount: state.participants.length,
        departments,
        workerPath,
      }));
    } catch { /* non-fatal */ }

    return { text, intentList, composed: true };
  }

  /**
   * Quick check: is this message a multi-intent query (≥ 2 distinct intents)?
   * Used by orchestrator to decide whether to call compose().
   */
  public static isMultiIntent(inboundText: string): boolean {
    const lower = inboundText.toLowerCase();
    let count = 0;
    if (/nerede|adres|konum|konumu/.test(lower)) count++;
    if (/fiyat|[üu]cret|tutar|[öo]deme|maliyet|ta\s*12|ta12|ne kadar/.test(lower)) count++;
    // P0.16-M: expanded — "doktorlar kim", "hekimler kim" etc.
    if (/(?:doktor|hekim)(?:lar|ler)?\s+(?:isim|list|kim|hang)|(?:doktor|hekim)(?:lar|ler)?\s+kim(?:ler)?|kimler\s+var|hangi\s+(?:doktor|hekim)(?:lar|ler)?/.test(lower)) count++;
    // P0.16-M: expanded — "süreç" alone, "nasıl olacak", "gelme nasıl" etc.
    if (/s[üu]re[çc]|nas[ıi]l\s+i[şs]liyor|nas[ıi]l\s+[çc]al[ıi][şs][ıi]yor|a[şs]ama|ad[ıi]m|tedavi\s+s[üu]re|nas[ıi]l\s+olacak|gelme\s+nas[ıi]l|geli[şs]\s+s[üu]re|tedavi\s+s[üu]re/.test(lower)) count++;
    if (/konaklama|ula[şs][ıi]m|otel|transfer|yol|gelme/.test(lower)) count++;
    if (/[şs][üu]phe|end[iı]şe|emin\s+de[ğg]il|karars[ıi]z|pahal[ıi]|uzak|kalacak|nas[ıi]l\s+gelece[ğg]im|ta\s*12|ta12|[öo]deme/.test(lower)) count++;
    return count >= 2;
  }
}
