/**
 * P0.16-K: MultiIntentConsultantComposer
 *
 * Handles messages that contain MULTIPLE questions in one message.
 * Ensures ALL questions are answered, not just the first detected intent.
 *
 * Example trigger:
 *   "hastaneniz nerede? fiyatlar nasıl? süreç nasıl işliyor?"
 *
 * DESIGN:
 * - Detects intent list from inbound text
 * - Composes response blocks as clean paragraphs for each intent (no list numbers)
 * - Fully localized for TR, EN, DE, NL, and AR
 * - Uses ConsultantConversationStateResolver for participant context
 *
 * SAFETY:
 * - PII-safe telemetry only
 * - Optimized regex to prevent "gelmeden" (before coming) false positive
 */

import type { TenantBrain } from '../../brain/tenant-brain';
import { ConsultantConversationStateResolver } from './consultant-conversation-state-resolver';
import { DoctorNamesPolicy } from './doctor-names-policy';
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
    replyLanguage = 'tr',
    workerPath = 'unknown'
  ): MultiIntentComposerResult | null {
    const lower = inboundText.toLowerCase();
    const lang = (replyLanguage || 'tr').toLowerCase();

    // ── Detect intents ────────────────────────────────────────────────────────
    // Multilingual intent detection supporting TR, EN, DE, NL, and AR
    const candidates: IntentCandidate[] = [
      { intent: 'address_question',    detected: /nerede|adres|konum|konumu|where|location|wo\b|adresse|standort|waar|locatie|أين|عنوان|موقع|اين/.test(lower) },
      { intent: 'price_question',      detected: /fiyat|[üu]cret|tutar|[öo]deme|maliyet|ta\s*12|ta12|ne kadar|price|fee|cost|payment|billing|how much|preis|gebühr|kosten|zahlung|rechnung|wie viel|prijs|tarief|betaling|factuur|hoeveel|سعر|تكلفة|رسوم|دفع|كم/.test(lower) },
      { intent: 'doctor_names',        detected: /(?:doktor|hekim)(?:lar|ler)?\s+(?:isim|list|kim|hang)|(?:doktor|hekim)(?:lar|ler)?\s+kim(?:ler)?|kimler\s+var|hangi\s+(?:doktor|hekim)(?:lar|ler)?|(?:doctor|physician|specialist|surgeon)s?\s+(?:name|list|who|which)|who\s+(?:is|are)\s+the\s+(?:doctor|physician|specialist)|(?:arzt|ärzte|spezialist)en?\s+(?:name|liste|wer|welch)|wer\s+sind\s+die\s+(?:ärzte|spezialisten)|(?:arts|artsen|specialist)en?\s+(?:naam|lijst|wie|welk)|wie\s+zijn\s+de\s+(?:artsen|specialisten)|(أطباء|طبيب|أخصائي|دكتور)\s+(أسماء|قائمة|من|أي)|من\s+هم\s+(الأطباء|الأخصائيين)/.test(lower) },
      { intent: 'process_question',    detected: /s[üu]re[çc]|nas[ıi]l\s+i[şs]liyor|nas[ıi]l\s+[çc]al[ıi][şs][ıi]yor|a[şs]ama|ad[ıi]m|tedavi\s+s[üu]re|nas[ıi]l\s+olacak|gelme\s+nas[ıi]l|geli[şs]\s+s[üu]re|process|treatment|journey|step|stage|how\s+does\s+it\s+work|how\s+is\s+it\s+done|prozess|ablauf|behandlung|schritt|phase|wie\s+läuft|wie\s+funktioniert|proces|verloop|stappen|hoe\s+werkt|hoe\s+verloopt|خطوات|مراحل|علاج|كيف\s+يتم|كيف\s+تسير|طريقة/.test(lower) },
      { intent: 'logistics_question',  detected: /konaklama|ula[şs][ıi]m|otel|transfer|yol|\bgelme(?!den)[a-zçğışöü]*|accommodation|transport|hotel|stay|flight|travel|\bcoming\b|unterkunft|unterbringen|anreise|\bkommen\b|verblijf|reizen|\bkomen\b|إقامة|سكن|نقل|مواصلات|توصيل|قدوم/.test(lower) },
      { intent: 'next_step_request',   detected: /belirleyelim|ne\s+zaman|nas[ıi]l\s+olacak|ee\s+yani|ne\s+yapmam\s+gerekiyor|ilerleyelim|schedule|call\s+me|next\s+step|let's\s+proceed|what\s+should\s+i\s+do|planen|anrufen|nächster\s+schritt|wie\s+geht\s+es\s+weiter|plannen|bellen|volgende\s+stap|hoe\s+nu\s+verder|جدولة|اتصل\s+بي|الخطوة\s+التالية|كيف\s+نتابع/.test(lower) },
      { intent: 'concern_objection',   detected: /[şs][üu]phe|end[iı]şe|emin\s+de[ğg]il|karars[ıi]z|pahal[ıi]|uzak|kalacak|konaklama|nas[ıi]l\s+gelece[ğg]im|ta\s*12|ta12|[öo]deme|doubt|worry|not\s+sure|undecided|expensive|far|stay|payment|zweifel|sorge|nicht\s+sicher|teuer|weit|zahlung|twijfel|zorg|niet\s+zeker|duur|ver|betaling|شك|قلق|غير\s+متأكد|متردد|غالي|بعيد|دفع/.test(lower) },
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

    if (detected.find(d => d.intent === 'address_question')) {
      if (lang === 'ar') {
        const orgName = (brain.prompts.metadata as any)?.identity?.organizationName || (brain.context.config as any)?.identity?.organizationName || 'المشفى الخاص بنا';
        const addressHint = TenantConfigResolver.getAddress(brain);
        blocks.push(addressHint ? `موقعنا لـ ${orgName} هو في العنوان ${addressHint}.` : `يمكنني مشاركة تفاصيل عنوان ${orgName} معكم.`);
      } else if (lang === 'de') {
        const orgName = (brain.prompts.metadata as any)?.identity?.organizationName || (brain.context.config as any)?.identity?.organizationName || 'Unser Krankenhaus';
        const addressHint = TenantConfigResolver.getAddress(brain);
        blocks.push(addressHint ? `Unser Standort für ${orgName} befindet sich unter der Adresse ${addressHint}.` : `Ich kann Ihnen die Adressdaten von ${orgName} mitteilen.`);
      } else if (lang === 'nl') {
        const orgName = (brain.prompts.metadata as any)?.identity?.organizationName || (brain.context.config as any)?.identity?.organizationName || 'Ons ziekenhuis';
        const addressHint = TenantConfigResolver.getAddress(brain);
        blocks.push(addressHint ? `Onze locatie voor ${orgName} is gevestigd op het adres ${addressHint}.` : `Ik kan de adresgegevens van ${orgName} met u delen.`);
      } else if (lang === 'en') {
        const orgName = (brain.prompts.metadata as any)?.identity?.organizationName || (brain.context.config as any)?.identity?.organizationName || 'Our hospital';
        const addressHint = TenantConfigResolver.getAddress(brain);
        blocks.push(addressHint ? `Our location for ${orgName} is at ${addressHint}.` : `I can share the address details of ${orgName} with you.`);
      } else {
        const orgName = (brain.prompts.metadata as any)?.identity?.organizationName || (brain.context.config as any)?.identity?.organizationName || 'Hastanemiz';
        const addressHint = TenantConfigResolver.getAddress(brain);
        blocks.push(addressHint ? `${orgName} konumumuz ${addressHint} adresindedir.` : `${orgName} adres bilgisini sizinle paylaşabilirim.`);
      }
    }

    if (detected.find(d => d.intent === 'price_question')) {
      if (lang === 'ar') {
        blocks.push(`بما أن الأسعار يتم تحديدها بناءً على التقييم في المشفى والإجراء المخطط له، لا يمكنني مشاركة سعر صافٍ هنا. ومن المفهوم تماماً رغبتكم في توضيح تفاصيل الدفع أو الفواتير.`);
      } else if (lang === 'de') {
        blocks.push(`Da die Preise auf der Grundlage der Untersuchung im Krankenhaus und des geplanten Ablaufs festgelegt werden, kann ich hier keinen konkreten Preis nennen. Es ist absolut verständlich, dass Sie Zahlungs- oder Abrechnungsdetails klären möchten.`);
      } else if (lang === 'nl') {
        blocks.push(`Aangezien de prijzen worden bepaald op basis van de evaluatie in het ziekenhuis en de geplande procedure, kan ik hier geen netto prijs delen. Het is heel begrijpelijk dat u betalings- of factureringsgegevens wilt verduidelijken.`);
      } else if (lang === 'en') {
        blocks.push(`Since pricing is determined based on the hospital evaluation and the planned procedure, I cannot share a net price here. It is very understandable that you want to clarify payment or billing details.`);
      } else {
        const hasForeignContext = history.some(m => /almanya|yurt\s*dışı|yurtdisi|sigorta|sgk|ta\s*12|ta12|t12/i.test(m.content))
          || /almanya|yurt\s*dışı|yurtdisi|sigorta|sgk|ta\s*12|ta12|t12/i.test(inboundText)
          || brain.context.location?.toLowerCase().includes('almanya')
          || (brain.prompts.metadata as any)?.isForeigner;
        const extraInfo = hasForeignContext
          ? ' Ödeme veya TA12 gibi evrak konularını ayrıca netleştirmek istemeniz çok anlaşılır.'
          : ' Ödeme veya faturalandırma konularını netleştirmek istemeniz çok anlaşılır.';
        blocks.push(`Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.${extraInfo}`);
      }
    }

    if (detected.find(d => d.intent === 'doctor_names')) {
      const doctorPolicy = DoctorNamesPolicy.resolve(brain, departments, previousDoctorAsk, lang);
      blocks.push(doctorPolicy.text);
    }

    if (detected.find(d => d.intent === 'process_question')) {
      if (lang === 'ar') {
        blocks.push(`تبدأ العملية بتقييم الطبيب الأخصائي لدينا في المشفى. يتم تحديد خطة العلاج الشخصية بعد الفحص البدني والفحوصات اللازمة.`);
      } else if (lang === 'de') {
        blocks.push(`Der Ablauf beginnt mit der Untersuchung durch unseren Facharzt im Krankenhaus. Der individuelle Behandlungsplan wird nach der körperlichen Untersuchung und den erforderlichen Tests festgelegt.`);
      } else if (lang === 'nl') {
        blocks.push(`Het proces begint met de evaluatie door onze medisch specialist in het ziekenhuis. Het persoonlijke behandelplan wordt definitief vastgesteld na lichamelijk onderzoek en de nodige tests.`);
      } else if (lang === 'en') {
        blocks.push(`The process starts with the evaluation of our specialist physician at the hospital. The personalized treatment plan is finalized after physical examination and necessary tests.`);
      } else {
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
        blocks.push(processBlocks.join('\n'));
      }
    }

    if (detected.find(d => d.intent === 'concern_objection')) {
      if (lang === 'ar') {
        blocks.push(`من المفهوم تماماً رغبتكم في توضيح تفاصيل الدفع والنقل والإقامة قبل اتخاذ القرار. ما هو الموضوع الأكثر أهمية بالنسبة لكم في هذه المرحلة؟`);
      } else if (lang === 'de') {
        blocks.push(`Es ist absolut verständlich, dass Sie vor einer Entscheidung Zahlungs-, Transport- und Unterkunftsfragen klären möchten. Welches Thema beschäftigt Sie am meisten?`);
      } else if (lang === 'nl') {
        blocks.push(`Het is heel begrijpelijk dat u betalings-, transport- en accommodatiezaken wilt verduidelijken voordat u een beslissing neemt. Welk onderwerp houdt u het meeste bezig?`);
      } else if (lang === 'en') {
        blocks.push(`It is very understandable that you want to clarify the payment, transport, and accommodation aspects before making a decision. Which topic is on your mind the most?`);
      } else {
        blocks.push(`Karar vermeden önce ödeme, ulaşım ve konaklama tarafını netleştirmek istemeniz çok anlaşılır. En çok hangi başlık sizi düşündürüyor?`);
      }
    }

    if (detected.find(d => d.intent === 'logistics_question')) {
      if (lang === 'ar') {
        blocks.push(`بالنسبة للمرضى القادمين من خارج المدينة أو من خارج البلاد، يمكن تنظيم ترتيبات النقل والتنقلات والإقامة من قبل فريقنا. إذا كان لديكم أي قلق بشأن الإقامة أو مسار القدوم، يمكننا تسجيل ذلك والتخطيط له معاً.`);
      } else if (lang === 'de') {
        blocks.push(`Für Patienten, die von außerhalb oder aus dem Ausland anreisen, können Transport, Transfers und Unterkunftsplanung von unserem Team organisiert werden. Wenn Sie Bedenken bezüglich Unterkunft oder Anreiseroute haben, können wir dies notieren und gemeinsam planen.`);
      } else if (lang === 'nl') {
        blocks.push(`Voor patiënten die van buiten de stad of uit het buitenland komen, kunnen transport, transfers en accommodatieplanning door ons team worden georganiseerd. Als u zich zorgen maakt over accommodatie of reisroutes, kunnen we dit noteren en samen plannen.`);
      } else if (lang === 'en') {
        blocks.push(`For patients coming from out of town or abroad, transportation, transfers, and accommodation planning can be organized by our team. If you have any concerns about accommodation or travel routes, we can note this down and plan together.`);
      } else {
        blocks.push(`Şehir dışından veya yurt dışından gelen hastalar için ulaşım, transfer ve konaklama planlaması ayrıca değerlendirilebilir. Kalacak yer veya geliş güzergahı endişeniz varsa bunu da not alıp birlikte netleştirebiliriz.`);
      }
    }

    if (detected.find(d => d.intent === 'next_step_request')) {
      const location = selfParticipant?.location;
      if (lang === 'ar') {
        let callbackText = 'ما هو اليوم والوقت المناسبين للاتصال بكم هاتفياً؟';
        if (location) {
          callbackText += `\nلقد سجلت أنكم في ${location}؛ هل ترغبون في جدولة المكالمة حسب توقيتكم المحلي في ${location}؟`;
        }
        blocks.push(callbackText);
      } else if (lang === 'de') {
        let callbackText = 'An welchem Tag und in welchem Zeitfenster dürfen wir Sie anrufen?';
        if (location) {
          callbackText += `\nIch habe notiert, dass Sie in ${location} sind; möchten Sie, dass wir den Anruf nach Ihrer Ortszeit planen?`;
        }
        blocks.push(callbackText);
      } else if (lang === 'nl') {
        let callbackText = 'Op welke dag en welk tijdstip schikt het u dat wij u bellen?';
        if (location) {
          callbackText += `\nIk heb genoteerd dat u in ${location} bent; wilt u dat we het gesprek plannen volgens uw lokale tijd?`;
        }
        blocks.push(callbackText);
      } else if (lang === 'en') {
        let callbackText = 'Which day and time range would be suitable for us to call you?';
        if (location) {
          callbackText += `\nI noted that you are in ${location}; would you like us to schedule the call in ${location} local time?`;
        }
        blocks.push(callbackText);
      } else {
        let callbackText = 'Sizi hangi gün ve saat aralığında aramam uygun olur?';
        if (location) {
          callbackText += `\n${location}'da olduğunuzu not aldım; saati ${location} saati olarak mı iletmemi istersiniz?`;
        }
        blocks.push(callbackText);
      }
    }

    if (blocks.length === 0) return null;

    let intro = '';
    if (lang === 'ar') {
      intro = detected.length >= 3 ? 'بالتأكيد، سأجيب على أسئلتكم بالتفصيل.' : 'بالتأكيد، سأجيب على استفساراتكم.';
    } else if (lang === 'de') {
      intro = detected.length >= 3 ? 'Gerne beantworte ich Ihre Fragen im Detail.' : 'Gerne beantworte ich Ihre Fragen.';
    } else if (lang === 'nl') {
      intro = detected.length >= 3 ? 'Natuurlijk, ik zal uw vragen in detail beantwoorden.' : 'Natuurlijk, ik zal uw vragen beantwoorden.';
    } else if (lang === 'en') {
      intro = detected.length >= 3 ? 'Certainly, let me answer your questions in detail.' : 'Certainly, let me answer your questions.';
    } else {
      intro = detected.length >= 3 ? 'Tabii, tek tek yanıtlayayım.' : 'Elbette yanıtlayayım.';
    }

    // Connect responses as clean paragraphs without numbering lists
    const text = `${intro}\n\n${blocks.join('\n\n')}`;

    try {
      console.log(JSON.stringify({
        tag: 'MULTI_INTENT_CONSULTANT_COMPOSED',
        intentList,
        intentCount: intentList.length,
        blockCount: blocks.length,
        participantsCount: state.participants.length,
        departments,
        lang,
        workerPath,
      }));
    } catch { /* non-fatal */ }

    return { text, intentList, composed: true };
  }

  /**
   * Quick check: is this message a multi-intent query (≥ 2 distinct intents)?
   */
  public static isMultiIntent(inboundText: string): boolean {
    const lower = inboundText.toLowerCase();
    let count = 0;
    if (/nerede|adres|konum|konumu|where|location|wo\b|adresse|standort|waar|locatie|أين|عنوان|موقع|اين/.test(lower)) count++;
    if (/fiyat|[üu]cret|tutar|[öo]deme|maliyet|ta\s*12|ta12|ne kadar|price|fee|cost|payment|billing|how much|preis|gebühr|kosten|zahlung|rechnung|wie viel|prijs|tarief|betaling|factuur|hoeveel|سعر|تكلفة|رسوم|دفع|كم/.test(lower)) count++;
    if (/(?:doktor|hekim)(?:lar|ler)?\s+(?:isim|list|kim|hang)|(?:doktor|hekim)(?:lar|ler)?\s+kim(?:ler)?|kimler\s+var|hangi\s+(?:doktor|hekim)(?:lar|ler)?|(?:doctor|physician|specialist|surgeon)s?\s+(?:name|list|who|which)|who\s+(?:is|are)\s+the\s+(?:doctor|physician|specialist)|(?:arzt|ärzte|spezialist)en?\s+(?:name|liste|wer|welch)|wer\s+sind\s+die\s+(?:ärzte|spezialisten)|(?:arts|artsen|specialist)en?\s+(?:naam|lijst|wie|welk)|wie\s+zijn\s+de\s+(?:artsen|specialisten)|(أطباء|طبيب|أخصائي|دكتور)\s+(أسماء|قائمة|من|أي)|من\s+هم\s+(الأطباء|الأخصائيين)/.test(lower)) count++;
    if (/s[üu]re[çc]|nas[ıi]l\s+i[şs]liyor|nas[ıi]l\s+[çc]al[ıi][şs][ıi]yor|a[şs]ama|ad[ıi]m|tedavi\s+s[üu]re|nas[ıi]l\s+olacak|gelme\s+nas[ıi]l|geli[şs]\s+s[üu]re|process|treatment|journey|step|stage|how\s+does\s+it\s+work|how\s+is\s+it\s+done|prozess|ablauf|behandlung|schritt|phase|wie\s+läuft|wie\s+funktioniert|proces|verloop|stappen|hoe\s+werkt|hoe\s+verloopt|خطوات|مراحل|علاج|كيف\s+يتم|كيف\s+تسير|طريقة/.test(lower)) count++;
    if (/konaklama|ula[şs][ıi]m|otel|transfer|yol|\bgelme(?!den)[a-zçğışöü]*|accommodation|transport|hotel|stay|flight|travel|\bcoming\b|unterkunft|unterbringen|anreise|\bkommen\b|verblijf|reizen|\bkomen\b|إقامة|سكن|نقل|مواصلات|توصيل|قدوم/.test(lower)) count++;
    if (/[şs][üu]phe|end[iı]şe|emin\s+de[ğg]il|karars[ıi]z|pahal[ıi]|uzak|kalacak|konaklama|nas[ıi]l\s+gelece[ğg]im|ta\s*12|ta12|[öo]deme|doubt|worry|not\s+sure|undecided|expensive|far|stay|payment|zweifel|sorge|nicht\s+sicher|teuer|weit|zahlung|twijfel|zorg|niet\s+zeker|duur|ver|betaling|شك|قلق|غير\s+متأكد|متردد|غالي|بعيد|دفع/.test(lower)) count++;
    return count >= 2;
  }
}
