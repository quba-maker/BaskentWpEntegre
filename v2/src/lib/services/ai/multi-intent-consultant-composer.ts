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

export interface MultiIntentComposerResult {
  text: string;
  intentList: string[];
  composed: true;
  guidanceOnly?: boolean;
}

interface IntentCandidate {
  intent: string;
  detected: boolean;
}

export class MultiIntentConsultantComposer {
  private static detectIntents(inboundText: string): IntentCandidate[] {
    const lower = inboundText.toLowerCase();

    return [
      { intent: 'address_question',    detected: /nerede|adres|konum|konumu|where|location|wo\b|adresse|standort|waar|locatie|أين|عنوان|موقع|اين/.test(lower) },
      { intent: 'price_question',      detected: /fiyat|[üu]cret|tutar|[öo]deme|maliyet|ta\s*12|ta12|ne kadar|price|fee|cost|payment|billing|how much|preis|gebühr|kosten|zahlung|rechnung|wie viel|prijs|tarief|betaling|factuur|hoeveel|سعر|تكلفة|رسوم|دفع|كم/.test(lower) },
      { intent: 'doctor_names',        detected: /(?:doktor|doktorunuz|doktorunun|hekim|hoca)(?:lar|ler)?\s+(?:isim|ad[ıi]|ad[ıi]n[eıi]?|list|kim|hang)|(?:doktor|doktorunuz|doktorunun|hekim|hoca)(?:lar|ler)?\s+kim(?:ler)?|kimler\s+var|hangi\s+(?:doktor|hekim|hoca)(?:lar|ler)?|(?:doctor|physician|specialist|surgeon)s?\s+(?:name|list|who|which)|who\s+(?:is|are)\s+the\s+(?:doctor|physician|specialist)|(?:arzt|ärzte|spezialist)en?\s+(?:name|liste|wer|welch)|wer\s+sind\s+die\s+(?:ärzte|spezialisten)|(?:arts|artsen|specialist)en?\s+(?:naam|lijst|wie|welk)|wie\s+zijn\s+de\s+(?:artsen|specialisten)|(أطباء|طبيب|أخصائي|دكتور)\s+(أسماء|قائمة|من|أي)|من\s+هم\s+(الأطباء|الأخصائيين)/.test(lower) },
      { intent: 'process_question',    detected: /s[üu]re[çc]|nas[ıi]l\s+i[şs]liyor|nas[ıi]l\s+[çc]al[ıi][şs][ıi]yor|a[şs]ama|ad[ıi]m|tedavi\s+s[üu]re|nas[ıi]l\s+olacak|gelme\s+nas[ıi]l|geli[şs]\s+s[üu]re|process|treatment|journey|step|stage|how\s+does\s+it\s+work|how\s+is\s+it\s+done|prozess|ablauf|behandlung|schritt|phase|wie\s+läuft|wie\s+funktioniert|proces|verloop|stappen|hoe\s+werkt|hoe\s+verloopt|خطوات|مراحل|علاج|كيف\s+يتم|كيف\s+تسير|طريقة/.test(lower) },
      { intent: 'logistics_question',  detected: /konaklama|ula[şs][ıi]m|otel|transfer|yol|\bgelme(?!den)[a-zçğışöü]*|accommodation|transport|hotel|stay|flight|travel|\bcoming\b|unterkunft|unterbringen|anreise|\bkommen\b|verblijf|reizen|\bkomen\b|إقامة|سكن|نقل|مواصلات|توصيل|قدوم/.test(lower) },
      { intent: 'next_step_request',   detected: /belirleyelim|ne\s+zaman|nas[ıi]l\s+olacak|ee\s+yani|ne\s+yapmam\s+gerekiyor|ilerleyelim|schedule|call\s+me|next\s+step|let's\s+proceed|what\s+should\s+i\s+do|planen|anrufen|nächster\s+schritt|wie\s+geht\s+es\s+weiter|plannen|bellen|volgende\s+stap|hoe\s+nu\s+verder|جدولة|اتصل\s+بي|الخطوة\s+التالية|كيف\s+نتابع/.test(lower) },
      { intent: 'concern_objection',   detected: /[şs][üu]phe|end[iı]şe|emin\s+de[ğg]il|karars[ıi]z|pahal[ıi]|uzak|kalacak|konaklama|nas[ıi]l\s+gelece[ğg]im|ta\s*12|ta12|[öo]deme|doubt|worry|not\s+sure|undecided|expensive|far|stay|payment|zweifel|sorge|nicht\s+sicher|teuer|weit|zahlung|twijfel|zorg|niet\s+zeker|duur|ver|betaling|شك|قلق|غير\s+متأكد|متردد|غالي|بعيد|دفع/.test(lower) },
    ];
  }

  public static detectIntentList(inboundText: string): string[] {
    return this.detectIntents(inboundText).filter(c => c.detected).map(c => c.intent);
  }

  public static buildPromptGuidance(inboundText: string, intentList = this.detectIntentList(inboundText)): string {
    if (intentList.length < 2) return '';

    const topicLabels: Record<string, string> = {
      address_question: 'adres/konum',
      price_question: 'fiyat/ödeme',
      doctor_names: 'doktor/hekim isimleri',
      process_question: 'süreç',
      logistics_question: 'ulaşım/konaklama',
      next_step_request: 'sonraki adım',
      concern_objection: 'güven/endişe/itiraz',
    };

    const topics = intentList.map(i => topicLabels[i] || i).join(', ');
    const hasAccommodation = intentList.includes('logistics_question') || /konaklama|kalacak|otel|accommodation|stay|unterkunft/i.test(inboundText);
    const hasDoctor = intentList.includes('doctor_names');
    const hasPrice = intentList.includes('price_question');
    const hasNextStep = intentList.includes('next_step_request');

    const lines = [
      `Çoklu niyet algılandı: ${topics}.`,
      `Hasta cevabını hazır bloklarla değil, doğal ve tek akış halinde yaz. Aynı soruyu tekrar sorma; hasta bir başlığı özellikle belirttiyse doğrudan o başlığı yanıtla.`,
      `Liste/numara kullanma; kısa paragraflarla ilerle. Hasta zaten başlığı belirtmişse genel "hangi başlık" geri sorularına dönme; doğrudan o konuya cevap ver.`,
    ];

    if (hasPrice) {
      lines.push(`Fiyat için sadece şu güvenli cümleyi kullan: "Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum." Yaklaşık fiyat, aralık fiyat, indirim veya paket fiyatı verme.`);
    }
    if (hasAccommodation) {
      lines.push(`Konaklama için sınır: Hastaneye yakın birçok konaklama seçeneği ve anlaşmalı oteller bulunduğunu, ekibin bu konuda danışmanlık yapabileceğini söyleyebilirsin. Misafirhane, garanti, rezervasyon yaptırma veya konaklamayı ayarlama sözü verme.`);
    }
    if (hasDoctor) {
      lines.push(`Doktor/hekim isimleri doğrulanmış dizinde varsa paylaş. Doktorla doğrudan WhatsApp/telefon ön görüşmesi sözü verme; yalnızca talebi not edip randevu/koordinasyon sürecini netleştir.`);
    }
    if (hasNextStep) {
      lines.push(`Telefon/randevu CTA'sını otomatik dayatma. Hasta önce bilgi istiyorsa önce bilgiyi ver; yalnızca hasta açıkça arama/randevu isterse tek doğal netleştirme sorusu sor.`);
    }

    return lines.join('\n');
  }

  /**
   * Tries to compose a multi-intent response.
   * Returns null if the message is NOT multi-intent (< 2 distinct intents).
   *
   * v80: This is no longer a patient-facing composer. It returns guidance text
   * for the LLM so the model can answer naturally without hardcoded blocks.
   */
  public static compose(
    inboundText: string,
    brain: TenantBrain,
    history: { role: string; content: string }[],
    resolvedDepartment: string | null,
    replyLanguage = 'tr',
    workerPath = 'unknown'
  ): MultiIntentComposerResult | null {
    const candidates = this.detectIntents(inboundText);
    const detected = candidates.filter(c => c.detected);

    // Not multi-intent if fewer than 2 distinct intents
    if (detected.length < 2) return null;

    const intentList = detected.map(c => c.intent);
    const text = this.buildPromptGuidance(inboundText, intentList);

    try {
      console.log(JSON.stringify({
        tag: 'MULTI_INTENT_CONSULTANT_GUIDANCE_BUILT',
        intentList,
        intentCount: intentList.length,
        guidanceOnly: true,
        resolvedDepartment: resolvedDepartment || null,
        replyLanguage,
        workerPath,
      }));
    } catch { /* non-fatal */ }

    return { text, intentList, composed: true, guidanceOnly: true };
  }

  /**
   * Quick check: is this message a multi-intent query (≥ 2 distinct intents)?
   */
  public static isMultiIntent(inboundText: string): boolean {
    return this.detectIntentList(inboundText).length >= 2;
  }
}
