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
      { intent: 'price_question',      detected: /fiyat|[üu]cret|ne kadar/.test(lower) },
      // P0.16-M: "doktor kim" / "doktor kimler" / "hangi doktor" all count as doctor intent
      { intent: 'doctor_names',        detected: /doktor\s+isim|hekim\s+isim|doktor\s+isimleri|kimler\s+var|hangi\s+doktorlar|doktor\s+list|doktor\s+kim|kim\s+doktor|hangi\s+doktor|doktor\s+kimler/.test(lower) },
      // P0.16-M: "süreç" alone, "nasıl olacak", "gelme nasıl" all count as process intent
      { intent: 'process_question',    detected: /s[üu]re[çc]|nas[ıi]l\s+i[şs]liyor|nas[ıi]l\s+[çc]al[ıi][şs][ıi]yor|a[şs]ama|ad[ıi]m|tedavi\s+s[üu]re|nas[ıi]l\s+olacak|gelme\s+nas[ıi]l|geli[şs]\s+s[üu]re|tedavi\s+s[üu]re/.test(lower) },
      { intent: 'logistics_question',  detected: /konaklama|ula[şs][ıi]m|otel|transfer|yol|gelme/.test(lower) },
      { intent: 'next_step_request',   detected: /belirleyelim|ne\s+zaman|nas[ıi]l\s+olacak|ee\s+yani|ne\s+yapmam\s+gerekiyor|ilerleyelim/.test(lower) },
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
      const addressHint = (brain.context.config as any)?.address
        || (brain.prompts.metadata as any)?.address
        || null;

      if (addressHint) {
        blocks.push(`${blockIndex}. Hastane konumu\n${addressHint}`);
      } else {
        blocks.push(`${blockIndex}. Hastane konumu\n${orgName} adres bilgisini danışman ekibimiz sizinle paylaşabilir.`);
      }
      blockIndex++;
    }

    if (detected.find(d => d.intent === 'price_question')) {
      blocks.push(`${blockIndex}. Fiyat bilgisi\nNet fiyat; muayene, tetkik ve kişiye özel tedavi planı sonrasında netleştiği için buradan kesin rakam vermem doğru olmaz. Danışman ekibimiz tahmini maliyet hakkında bilgi verebilir.`);
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
        processBlocks.push(`${selfParticipant.complaint} için önce kısa bir telefon görüşmesiyle bilgi alınır, ardından uygun tarih planlanır. Hastaneye geldiğinizde uzman hekim muayenesi ve gerekirse tetkikler sonrası tedavi planı netleşir.`);
      }
      if (hasCardiology) {
        const secondaryLabel = state.participants.find(p => p.department?.toLowerCase().includes('kardiy') && p.relation !== 'self');
        const label = secondaryLabel ? `${secondaryLabel.relation === 'mother' ? 'Anneniz' : secondaryLabel.relation === 'father' ? 'Babanız' : 'Yakınınız'} için Kardiyoloji` : 'Kardiyoloji';
        processBlocks.push(`${label}: ön görüşme ile başlanır, ardından muayene ve tetkikler planlanır.`);
      }
      if (processBlocks.length === 0) {
        processBlocks.push('Önce kısa bir telefon görüşmesiyle bilgi alınır, ardından uygun tarih ve hekim planlanır. Muayene ve gerekli tetkikler sonrası tedavi planı netleşir.');
      }

      blocks.push(`${blockIndex}. Süreç\n${processBlocks.join('\n')}`);
      blockIndex++;
    }

    if (detected.find(d => d.intent === 'logistics_question')) {
      blocks.push(`${blockIndex}. Konaklama / Ulaşım\nKonaklama ve transfer konusunda danışman ekibimiz yönlendirme yapabilir.`);
      blockIndex++;
    }

    if (detected.find(d => d.intent === 'next_step_request')) {
      // Build callback request
      const location = selfParticipant?.location;
      let callbackText = 'Sizi hangi gün ve saat aralığında aramamız uygun olur?';
      if (location) {
        callbackText += `\n${location}'da olduğunuzu not aldım; saati ${location} saati olarak mı iletmemizi istersiniz?`;
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
    if (/nerede|adres|konum/.test(lower)) count++;
    if (/fiyat|[üu]cret|ne kadar/.test(lower)) count++;
    // P0.16-M: expanded — "doktor kim", "hangi doktor" etc.
    if (/doktor\s+isim|hekim\s+isim|hangi\s+doktorlar|doktor\s+kim|kim\s+doktor|hangi\s+doktor|doktor\s+kimler/.test(lower)) count++;
    // P0.16-M: expanded — "süreç" alone, "nasıl olacak", "gelme nasıl"
    if (/s[üu]re[çc]|nas[ıi]l\s+i[şs]liyor|a[şs]ama|ad[ıi]m|nas[ıi]l\s+olacak|gelme\s+nas[ıi]l/.test(lower)) count++;
    if (/konaklama|ula[şs][ıi]m|otel|gelme/.test(lower)) count++;
    return count >= 2;
  }
}
