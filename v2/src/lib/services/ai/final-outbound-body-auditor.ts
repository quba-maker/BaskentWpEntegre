/**
 * P0.16-N: FinalOutboundBodyAuditor
 *
 * Mandatory last-mile enforcement applied to the EXACT body sent to 360dialog
 * or any WhatsApp provider — right before sendWhatsAppMessage().
 *
 * Problem it solves:
 *   - Test bot returns orchestratorResult.text directly (already through FinalPipelineEnforcer).
 *   - Live worker post-processes with sanitizePatientFacingMessage() + formatForWhatsApp() AFTER
 *     FinalPipelineEnforcer, potentially undoing normalizer/formatter fixes.
 *   - This auditor runs at the very last step before the send call, guaranteeing parity.
 *
 * Chain:
 *   TurkishFinalQualityNormalizer → WhatsAppFormattingFinalizer → LegacyBlock Kill
 *   → FINAL_OUTBOUND_BODY_AUDIT telemetry
 *
 * Rules:
 *   - No outbound messages, no DB writes, no side effects.
 *   - PII-safe telemetry only.
 *   - Never throws; falls back to original text on any error.
 */

import { TurkishFinalQualityNormalizer } from './turkish-final-quality-normalizer';
import { WhatsAppFormattingFinalizer } from './whatsapp-formatting-finalizer';
import { FinalPipelineEnforcer } from './final-pipeline-enforcer';

export interface FinalOutboundAuditCtx {
  tenantId: string;
  conversationId?: string;
  workerPath?: string;
  responseSource?: string;
  channel?: string;
  replyLanguage?: string;
  inboundText?: string;
}

export interface FinalOutboundAuditResult {
  text: string;
  bodyLength: number;
  paragraphCount: number;
  hasNumberedBlocks: boolean;
  normalizerApplied: boolean;
  formatterApplied: boolean;
  containsLegacyClose: boolean;
  containsKnownBadMorphology: boolean;
  rewrote: boolean;
}

// Known bad morphology patterns that should NEVER appear in final outbound body
const KNOWN_BAD_MORPHOLOGY_PATTERNS: RegExp[] = [
  /m[üu]mk[üu]n[üu]z/i,         // mümkünüz
  /plan[ıi]z[ıi]\b/i,           // planızı
  /tahminiz\s+(?:maliyet|et)/i,  // tahminizi maliyet
  /Konya(?:'n[ıi]n[ıi]z|n[ıi]n[ıi]z)/i,  // Konya'nınız
  /s[üu]re[çc]ininiz/i,          // sürecininiz
  /olabilece[ğg]inizie?\s+anl/i, // olabileceğinizi anlıyorum (garbled)
  /m[üu]mk[üu]n\s+de[ğg]ildir\s+olmuyor/i,
  /boyunuz\s+f[ıi]t[ıi][ğg][ıi]/i,
  /şikayeti\s+oldu[ğg]unuzu/i,
  /hastan[ıi]n[ıi]z\s+hastanemizde/i,
  /form\s+başvurunuz\s+bize\s+ulaştı\.,/i,
];

const PROMPT_LEAK_PATTERNS: RegExp[] = [
  /\bHasta\s+[^.\n]{0,140}\s+sorarsa\b/i,
  /\bdo[ğg]rulanm[ıi][şs]\s+listedeki\b/i,
  /\b(?:sistem\s+prompt|system\s+prompt|prompt\s+challenge)\b/i,
  /\bIntent:\s*[a-z_]+\b/i,
  /\b(?:Kullan[ıi]m\s+kural[ıi]|YASAK|TAL[İI]MAT|D[İI]REKT[İI]F)\b/i,
  /^-{3,}\s*(?:SYSTEM|PROMPT|RULE|KURAL|B[İI]LG[İI]|VERIFIED)[^-\n]*-{3,}/im,
];

// Legacy close phrases that signal the conversation was terminated incorrectly
const LEGACY_CLOSE_PATTERNS: RegExp[] = [
  /rica\s+ederiz[,\s]+(?:iyi\s+g[üu]nler|g[üu]le\s+g[üu]le)/i,
  /iyi\s+g[üu]nler\s+dileriz\.\s*$/i,
  /ba[şs]ka\s+sorunuz\s+olursa\s+(?:bize|burada)/i,
];

function buildCallbackTimeConfirmation(inboundText?: string): string | null {
  if (!inboundText) return null;
  const lower = inboundText
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();

  const dayMatch = lower.match(/\b(pazartesi|sal[ıi]|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar)\b/i);
  const timeMatch = lower.match(/\b(?:saat\s*)?(\d{1,2})(?::|\.|\s)?(\d{2})?\b/);
  if (!dayMatch || !timeMatch) return null;

  const rawHour = Number(timeMatch[1]);
  if (!Number.isFinite(rawHour) || rawHour < 0 || rawHour > 23) return null;
  const rawMinute = timeMatch[2] ? Number(timeMatch[2]) : 0;
  if (!Number.isFinite(rawMinute) || rawMinute < 0 || rawMinute > 59) return null;

  const dayLabelMap: Record<string, string> = {
    pazartesi: 'Pazartesi',
    salı: 'Salı',
    sali: 'Salı',
    'çarşamba': 'Çarşamba',
    carsamba: 'Çarşamba',
    'perşembe': 'Perşembe',
    persembe: 'Perşembe',
    cuma: 'Cuma',
    cumartesi: 'Cumartesi',
    pazar: 'Pazar',
  };

  const dayKey = dayMatch[1].replace('ı', 'i');
  const dayLabel = dayLabelMap[dayMatch[1]] || dayLabelMap[dayKey] || dayMatch[1];
  const hh = String(rawHour).padStart(2, '0');
  const mm = String(rawMinute).padStart(2, '0');

  if (dayLabel === 'Pazar') {
    return `Pazar günü telefon görüşmesi planlanmıyor. Pazar hariç Türkiye saatiyle 09:00-21:00 arasında hangi gün ve saat sizin için uygun olur?`;
  }

  return `${dayLabel} günü Türkiye saatiyle ${hh}:${mm} için not alayım mı?`;
}

function buildArrivalDateConfirmation(inboundText?: string, replyLanguage = 'tr'): string | null {
  if (!inboundText) return null;
  const lower = inboundText.toLowerCase().trim();

  // Try to determine if this is a date reply (containing month names or numeric date patterns)
  const dateIndicators = [
    'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
    'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'januari', 'februari', 'maart', 'juni', 'juli', 'augustus', 'oktober', 'november', 'december',
    'januar', 'februar', 'märz', 'mai', 'juni', 'juli', 'oktober', 'dezember'
  ];
  const isNumericDate = /^\d{1,2}[./\s]\d{1,2}$/.test(lower) || /^\d{1,2}\s+(?:ağustos|agustos|temmuz|haziran|eylül|eylul|ekim|kasım|kasim|aralık|aralik|ocak|şubat|subat|mart|nisan|mayıs|mayis)/i.test(lower);
  const isDate = dateIndicators.some(kw => lower.includes(kw)) || isNumericDate;
  if (!isDate) return null;

  let dateStr = '';
  const cleanInbound = inboundText.trim().replace(/[?.!,;:]+$/, '');
  if (cleanInbound.split(/\s+/).length <= 5) {
    dateStr = cleanInbound;
  } else {
    const words = cleanInbound.split(/\s+/);
    const foundIdx = words.findIndex(w => dateIndicators.some(kw => w.toLowerCase().includes(kw)));
    if (foundIdx !== -1) {
      const start = Math.max(0, foundIdx - 1);
      const end = Math.min(words.length, foundIdx + 2);
      dateStr = words.slice(start, end).join(' ');
    } else {
      dateStr = cleanInbound;
    }
  }
  dateStr = dateStr.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const lang = (replyLanguage || 'tr').toLowerCase();
  if (lang === 'ar') {
    return `لقد سجلت تاريخ وصولك المخطط له في ${dateStr}. هل لديك أي أسئلة أخرى، أم ترغب في جدولة مكالمة هاتفية مع مستشار المرضى لدينا لتوضيح التفاصيل؟`;
  } else if (lang === 'de') {
    return `Ich habe Ihre geplante Ankunft am ${dateStr} notiert. Haben Sie weitere Fragen oder möchten Sie ein Telefonat mit unserem Patientenberater vereinbaren, um die Details zu besprechen?`;
  } else if (lang === 'nl') {
    return `Ik heb uw geplande aankomst op ${dateStr} genoteerd. Heeft u nog andere vragen, of wilt u een telefoongesprek plannen met onze patiëntenadviseur om de details te bespreken?`;
  } else if (lang === 'en') {
    return `I have noted your planned arrival date as ${dateStr}. Do you have any other questions, or would you like to schedule a phone call with our patient advisor to finalize the details?`;
  } else {
    return `Anladım, ${dateStr} gelme düşüncenizi not aldım. Başka bir sorunuz var mı, ya da detayları netleştirmek için hasta danışmanımızla bir telefon görüşmesi planlamak ister misiniz?`;
  }
}

function isStructuredFormPayload(text?: string): boolean {
  if (!text) return false;
  return /(?:Full\s+name|Phone\s+number|WhatsApp\s+number|Şikayetiniz\s+Nedir|Sikayetiniz\s+Nedir|Hangi\s+[üu]lkede\s+ya[şs][ıi]yorsunuz|Date\s+of\s+birth|Türkiye'ye\s*\(Konya'ya\)\s+tedavi)/i.test(text);
}

function extractPayloadField(text: string | undefined, labels: string[]): string | null {
  if (!text) return null;
  const escapedLabels = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:${escapedLabels})\\s*:\\s*([^\\n]+)`, 'i');
  const match = text.match(pattern);
  return match?.[1]?.trim() || null;
}

function hasFertilityComplaint(text: string | null): boolean {
  if (!text) return false;
  return /(?:tekrar\s+anne|anne\s+olmak|çocuk\s+sahibi|cocuk\s+sahibi|bebek\s+sahibi|gebelik|hamile|t[üu]p\s+bebek|ivf|infertilite|k[ıi]s[ıi]rl[ıi]k)/i.test(text);
}

function hasCannotTravelSignal(text?: string): boolean {
  if (!text) return false;
  return /(?:yurt\s*d[ıi][şs][ıi]na\s+[çc][ıi]kamam|konya'?ya\s+gelemem|t[üu]rkiye'?ye\s+gelemem|gelemem|[çc][ıi]kamam)/i.test(text);
}

function containsPromptLeak(text: string): boolean {
  return PROMPT_LEAK_PATTERNS.some(pattern => pattern.test(text));
}

function buildPromptLeakRecovery(ctx: FinalOutboundAuditCtx): string {
  const inbound = ctx.inboundText || '';
  const complaint = extractPayloadField(inbound, ['Şikayetiniz Nedir?', 'Sikayetiniz Nedir?', 'Complaint']);
  const structuredForm = isStructuredFormPayload(inbound);
  const cannotTravel = hasCannotTravelSignal(inbound);

  if (structuredForm && hasFertilityComplaint(complaint || inbound)) {
    const travelLine = cannotTravel
      ? 'Formunuzda şu an Konya’ya gelemeyeceğinizi belirtmişsiniz.'
      : 'Geliş planınız netleştiğinde süreci buna göre birlikte planlayabiliriz.';

    return [
      'Merhaba,',
      'Başkent Üniversitesi Konya Hastanesi’nden form başvurunuz bize ulaştı.',
      'Tekrar anne olmak istediğinizi belirtmişsiniz. Gebelik planlaması ve çocuk sahibi olma sürecinde yaş, gebelik geçmişi ve genel sağlık durumu birlikte değerlendirilir. Bu nedenle doğru yönlendirme için Kadın Hastalıkları ve Doğum / Tüp Bebek alanında değerlendirme gerekir.',
      `${travelLine} Önce buradan merak ettiğiniz konuyu yanıtlayabilirim; süreç, uygun bölüm veya görüşme planı hakkında hangi bilgiyi netleştirelim?`,
    ].join('\n\n');
  }

  if (structuredForm) {
    return [
      'Merhaba,',
      'Form başvurunuz bize ulaştı. Sağlık talebinizi doğru değerlendirebilmem için bu aşamada merak ettiğiniz ana konuyu buradan yazabilir misiniz?',
    ].join('\n\n');
  }

  return 'Mesajınızı aldım. Bu konuda doğru bilgiyle yardımcı olayım; hangi başlığı netleştirelim?';
}

function isShortGreetingInbound(inboundText?: string): boolean {
  const clean = (inboundText || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .trim();
  return clean.length <= 30 && /\b(merhaba|selam|iyi günler|iyi aksamlar|iyi akşamlar|günaydın|gunaydin)\b/i.test(clean);
}

function formatTurkishDateFromIso(dateIso?: string | null): string | null {
  if (!dateIso) return null;
  const match = String(dateIso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const dt = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00+03:00`);
  if (isNaN(dt.getTime())) return null;

  const parts = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  }).formatToParts(dt);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const weekday = get('weekday');
  return `${get('day')} ${get('month')} ${get('year')} ${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`.trim();
}

function applyStaleYearDateRewrite(text: string, ctx: FinalOutboundAuditCtx): { text: string; rewrote: boolean } {
  const inbound = ctx.inboundText || '';
  if (!/\b(yar[ıi]n|bug[üu]n|pazartesi|sal[ıi]|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar)\b/i.test(inbound)) {
    return { text, rewrote: false };
  }

  try {
    const { parseDeterministicSuggestion } = require('../../utils/date-parser');
    const parsed = parseDeterministicSuggestion(inbound, new Date(), null, null);
    const replacementLabel = formatTurkishDateFromIso(parsed?.suggested_date);
    if (!replacementLabel) return { text, rewrote: false };

    const currentYear = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
    }).format(new Date()));
    const months = 'Ocak|Şubat|Subat|Mart|Nisan|Mayıs|Mayis|Haziran|Temmuz|Ağustos|Agustos|Eylül|Eylul|Ekim|Kasım|Kasim|Aralık|Aralik';
    const weekdays = 'Pazartesi|Salı|Sali|Çarşamba|Carsamba|Perşembe|Persembe|Cuma|Cumartesi|Pazar';

    let result = text;
    let rewrote = false;
    const starred = new RegExp(`\\*\\d{1,2}\\s+(?:${months})\\s+(20\\d{2})\\*\\s+(?:${weekdays})`, 'gi');
    result = result.replace(starred, (match: string, year: string) => {
      if (Number(year) >= currentYear) return match;
      rewrote = true;
      return `*${replacementLabel}*`;
    });

    const plain = new RegExp(`\\b\\d{1,2}\\s+(?:${months})\\s+(20\\d{2})(?:\\s+(?:${weekdays}))?\\b`, 'gi');
    result = result.replace(plain, (match: string, year: string) => {
      if (Number(year) >= currentYear) return match;
      rewrote = true;
      return replacementLabel;
    });

    return { text: result, rewrote };
  } catch {
    return { text, rewrote: false };
  }
}

function applyNaturalToneRewrites(text: string, ctx: FinalOutboundAuditCtx): { text: string; rewrote: boolean } {
  let result = text;
  let rewrote = false;

  const honorificCleaned = result.replace(/\b([A-ZÇĞİÖŞÜ][a-zçğıöşü]+)\s+(?:Bey|Hanım|Hanim|Sayın|Sayin|Bay|Bayan)\b/g, '$1');
  if (honorificCleaned !== result) {
    result = honorificCleaned;
    rewrote = true;
  }

  if (!isShortGreetingInbound(ctx.inboundText)) {
    const identityPatterns = [
      /^\s*Başkent\s+Üniversitesi\s+Konya\s+Hastanesi['’`]nden\s+R[üu]ya\s+ben[.,]?\s*/i,
      /^\s*Başkent\s+Üniversitesi\s+Konya\s+Hastanesi['’`]nden\s+ben\s+R[üu]ya[.,]?\s*/i,
      /^\s*(?:Merhaba,\s*)?R[üu]ya\s+ben[.,]?\s*(?:Başkent\s+Üniversitesi\s+Konya\s+(?:Hastanesi|Uygulama\s+ve\s+Araştırma\s+Merkezi)['’`]nden\s+(?:yazıyorum|sizinle\s+ilgileniyorum)[.,]?)?\s*/i,
      /^\s*(?:Merhaba,\s*)?Ben\s+R[üu]ya[.,]?\s*(?:Başkent\s+Üniversitesi\s+Konya\s+(?:Hastanesi|Uygulama\s+ve\s+Araştırma\s+Merkezi)['’`]nden\s+(?:yazıyorum|sizinle\s+ilgileniyorum)[.,]?)?\s*/i,
    ];
    for (const pattern of identityPatterns) {
      const next = result.replace(pattern, '').trimStart();
      if (next !== result && next.length >= 20) {
        result = next;
        rewrote = true;
        break;
      }
    }
  }

  const robotPhraseRewrites: Array<[RegExp, string]> = [
    [/Bug[üu]n\s+([^.\n]+?)\s+oldu[ğg]una\s+g[öo]re\s+/gi, ''],
    [/Konuşma geçmişimizdeki bilgileri dikkatle takip ediyorum\.?/gi, ''],
    [/sizin için uygun görünüyor/gi, 'uygun mu'],
    [/Bu doğrultuda\s+/gi, ''],
  ];
  for (const [pattern, replacement] of robotPhraseRewrites) {
    const next = result.replace(pattern, replacement);
    if (next !== result) {
      result = next;
      rewrote = true;
    }
  }

  const morphologyRewrites: Array<[RegExp, string]> = [
    [/form\s+başvurunuz\s+bize\s+ulaştı\.,/gi, 'form başvurunuz bize ulaştı.'],
    [/boyunuz\s+f[ıi]t[ıi][ğg][ıi]/gi, 'boyun fıtığı'],
    [/baban[ıi]z[ıi]n\s+([^.\n,]+?)\s+şikayeti\s+oldu[ğg]unuzu/gi, 'babanızın $1 şikayeti olduğunu'],
    [/annenizin\s+([^.\n,]+?)\s+şikayeti\s+oldu[ğg]unuzu/gi, 'annenizin $1 şikayeti olduğunu'],
    [/ve\s+(\d+\s+y[ıi]ld[ıi]r)\s+y[üu]r[üu]yemedi[ğg]inizi/gi, 've babanızın $1 yürüyemediğini'],
    [/Kesin\s+de[ğg]erlendirme\s+i[çc]in\s+hastan[ıi]n[ıi]z\s+hastanemizde/gi, 'Kesin değerlendirme için hastanın hastanemizde'],
    [/Ge[çc]mi[şs]\s+olsun\s+dileklerimi\s+iletmek\s+isterim\.?/gi, 'Öncelikle geçmiş olsun.'],
    [/(^|\n)size\s+en\s+uygun/gi, '$1Size en uygun'],
  ];
  for (const [pattern, replacement] of morphologyRewrites) {
    const next = result.replace(pattern, replacement);
    if (next !== result) {
      result = next;
      rewrote = true;
    }
  }

  const accommodationInbound = /konaklama|kalacak\s+yer|otel|misafirhane|accommodation|stay|unterkunft/i.test(ctx.inboundText || '');
  if (accommodationInbound) {
    const accommodationRewrites: Array<[RegExp, string]> = [
      [/Karar\s+vermeden\s+[öo]nce\s+[öo]deme,\s+ula[şs][ıi]m\s+ve\s+konaklama\s+taraf[ıi]n[ıi]\s+netle[şs]tirmek\s+istemeniz\s+[çc]ok\s+anla[şs][ıi]l[ıi]r\.\s*En\s+[çc]ok\s+hangi\s+ba[şs]l[ıi]k\s+sizi\s+d[üu][şs][üu]nd[üu]r[üu]yor\?/gi, 'Konaklama tarafını netleştirmek istemeniz çok anlaşılır.'],
      [/En\s+[çc]ok\s+hangi\s+ba[şs]l[ıi]k\s+sizi\s+d[üu][şs][üu]nd[üu]r[üu]yor\?/gi, 'Konaklama konusunda özellikle neyi netleştirmek istersiniz?'],
      [/havaliman[ıi]\s+transferi,\s+konaklama\s+ve\s+s[üu]re[çc]\s+planlama\s+koordinasyonu\s+ekibimiz\s+taraf[ıi]ndan\s+organize\s+edilmektedir/gi, 'hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller konusunda ekibimiz danışmanlık yapabilir'],
      [/konaklama\s+(?:ayarlan[ıi]r|ayarlar[ıi]z|organize\s+edilir|organize\s+ederiz|rezervasyon\s+yapar[ıi]z)/gi, 'konaklama seçenekleri konusunda danışmanlık yapılabilir'],
      [/misafirhanemiz\s+(?:var|bulunuyor)/gi, 'hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller bulunuyor'],
    ];
    for (const [pattern, replacement] of accommodationRewrites) {
      const next = result.replace(pattern, replacement);
      if (next !== result) {
        result = next;
        rewrote = true;
      }
    }
  }

  const infoFirstInbound = /(?:[öo]nce\s+bilgi|bilgi\s+almak|fiyat|[üu]cret|[öo]deme|konaklama|kalacak\s+yer|doktorla\s+g[öo]r[üu][şs]mek)/i.test(ctx.inboundText || '');
  const explicitSchedulingInbound = /(?:arama|aranmak|telefon|randevu\s+(?:almak|olu[şs]turmak|planlamak)|saat\s+\d{1,2})/i.test(ctx.inboundText || '');
  if (infoFirstInbound && !explicitSchedulingInbound) {
    const ctaPatterns = [
      /\s*Sizi\s+hangi\s+g[üu]n\s+ve\s+saat\s+aral[ıi][ğg][ıi]nda\s+aramam\s+uygun\s+olur\??/gi,
      /\s*Hangi\s+g[üu]n\s+ve\s+saat\s+aral[ıi][ğg][ıi]\s+sizin\s+i[çc]in\s+uygun\s+olur\??/gi,
      /\s*Telefon\s+g[öo]r[üu][şs]mesi\s+i[çc]in\s+size\s+uygun\s+g[üu]n\s+ve\s+saat\s+aral[ıi][ğg][ıi]\s+nedir\??/gi,
    ];
    for (const pattern of ctaPatterns) {
      const next = result.replace(pattern, '').trim();
      if (next !== result) {
        result = next;
        rewrote = true;
      }
    }
  }

  // Rewrite outbound-specific form initiation phrases to inbound-friendly form acknowledgement phrases
  const formPhraseRewrites: Array<[RegExp, string]> = [
    [/(?:doldurduğunuz\s+form\s+doğrultusunda|form\s+doğrultusunda)\s+(?:sizinle\s+)?(?:iletişime\s+geçi(?:yoruz|mekteyiz)|irtibata\s+geçi(?:yoruz|mekteyiz))/gi, 'form başvurunuz bize ulaştı'],
  ];
  for (const [pattern, replacement] of formPhraseRewrites) {
    const next = result.replace(pattern, replacement);
    if (next !== result) {
      result = next;
      rewrote = true;
    }
  }

  // Rewrite/strip unnecessary apologies if the user admitted to making a mistake (e.g. "yanlış doldurmuşum")
  const userAdmittedMistake = ctx.inboundText && /yanl[ıi][şs]\s+(?:doldur|se[çc]|yaz)|gelemem/i.test(ctx.inboundText);
  if (userAdmittedMistake) {
    const apologyPatterns = [
      /^\s*(?:Kusura\s+bakmayınız[.,]?\s*|Kusura\s+bakmayın[.,]?\s*|Özür\s+dilerim[.,]?\s*)(?:formunuzdaki\s+geli[şs]im\s+bilgisiyle\s+ilgili\s+bir\s+karışıklık\s+olmuş[.,]?\s*|formunuzdaki\s+geli[şs]im\s+bilgisiyle\s+ilgili\s+bir\s+karisiklik\s+olmus[.,]?\s*)?(?:d[üu]zeltti[ğg]iniz\s+i[çc]in\s+te[şs]ekk[üu]r\s+eder(?:im|iz)[.,]?\s*)?/i,
      /^\s*(?:Kusura\s+bakmayınız|Kusura\s+bakmayın|Özür\s+dilerim)[.,]?\s*(?:bir\s+karışıklık\s+olmuş|bir\s+karisiklik\s+olmus)?[.,]?\s*/i,
    ];
    for (const pattern of apologyPatterns) {
      const next = result.replace(pattern, '').trimStart();
      if (next !== result) {
        result = "Anladım, kaydınızı güncelledim. " + next.charAt(0).toUpperCase() + next.slice(1);
        rewrote = true;
        break;
      }
    }
  }

  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return { text: result, rewrote };
}

function isPriceQuestionInbound(inboundText?: string): boolean {
  const clean = (inboundText || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
  return /\b(fiyat|ücret|ucret|tutar|ne kadar|kaç para|kac para|ödeme|odeme)\b/i.test(clean);
}

function applyPriceQuestionGuard(text: string, ctx: FinalOutboundAuditCtx): { text: string; rewrote: boolean } {
  if (!isPriceQuestionInbound(ctx.inboundText)) {
    return { text, rewrote: false };
  }

  let result = text;
  let rewrote = false;
  const exactPriceSentence = 'Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.';

  const priceSentencePattern = /Fiyat\s+bilgisi,[\s\S]{0,220}?buradan\s+net\s+(?:bir\s+)?(?:fiyat\s+)?paylaşamıyorum\./i;
  if (priceSentencePattern.test(result)) {
    result = result.replace(priceSentencePattern, exactPriceSentence);
    rewrote = true;
  }

  const phoneCtaPatterns: RegExp[] = [
    /\s*(?:İsterseniz|Dilerseniz)?[^.\n!?]*(?:telefon\s+görüşmesi|arama)[^.\n!?]*(?:planlayabiliriz|ayarlayabiliriz|yapabiliriz|oluşturabiliriz)[^.\n!?]*[.!?]?/gi,
    /\s*(?:Bu\s+görüşmede|Görüşmede)[^.\n!?]*(?:daha\s+net|detaylı)[^.\n!?]*(?:bilgi|konuşabiliriz)[^.\n!?]*[.!?]?/gi,
    /\s*(?:Öncelikle,?\s*)?(?:telefon\s+görüşmesi|arama)\s+için\s+size\s+uygun\s+gün\s+ve\s+saat\s+aralığı\s+nedir\??/gi,
    /\s*Size\s+uygun\s+gün\s+ve\s+saat\s+aralığı\s+nedir\??/gi,
    /\s*Hangi\s+gün\s+ve\s+saat\s+aralığı\s+sizin\s+için\s+uygun\s+olur\??/gi,
    /\s*Hangi\s+hizmet\s+veya\s+b[öo]l[üu]m\s+i[çc]in\s+fiyat\s+bilgisi\s+almak\s+istiyorsunuz\??/gi,
    /\s*Hangi\s+hizmet\s+veya\s+b[öo]l[üu]m\s+i[çc]in\s+sordu[ğg]unuzu\s+yazarsan[ıi]z[^.\n!?]*[.!?]?/gi,
  ];

  for (const pattern of phoneCtaPatterns) {
    const next = result.replace(pattern, '');
    if (next !== result) {
      result = next;
      rewrote = true;
    }
  }

  const onlyPrice = result.trim() === exactPriceSentence;
  if (onlyPrice) {
    result = `${exactPriceSentence}\n\nSüreçle ilgili merak ettiğiniz başlığı yazarsanız buradan yardımcı olayım.`;
    rewrote = true;
  }

  result = result.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { text: result, rewrote };
}

function applyGenericEscapeRecovery(text: string, ctx: FinalOutboundAuditCtx): { text: string; rewrote: boolean } {
  const inbound = (ctx.inboundText || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
  const cleanText = (text || '').trim();
  const isGenericEscape =
    /size\s+sa[ğg]l[ıi]k\s+talebinizle\s+ilgili\s+yard[ıi]mc[ıi]\s+olay[ıi]m\.\s*hangi\s+konuda\s+bilgi\s+almak\s+istiyorsunuz\??/i.test(cleanText) ||
    /hangi\s+konuda\s+bilgi\s+almak\s+istedi[ğg]inizi\s+iletebilirsiniz\??/i.test(cleanText) ||
    /^hangi\s+konuda\s+yard[ıi]mc[ıi]\s+olay[ıi]m\??$/i.test(cleanText);

  if (!isGenericEscape) {
    return { text, rewrote: false };
  }

  if (/\b(?:doktor|hekim|hoca|uzman|kadronuz|doktorunuzun|doktorunun)\b.*\b(?:isim|ismi|ismini|ad[ıi]|kim|kimler|liste|ara[şs]t[ıi]r)|\b(?:isim|ad[ıi])\s+s[öo]yle|\bara[şs]t[ıi]raca[ğg][ıi]m|\bara[şs]t[ıi]racam/i.test(inbound)) {
    return {
      text: 'Doktor isimlerini öğrenmek istediğinizi görüyorum. Doğrulanmış hekim listesi varsa isimleri paylaşabilirim; hekimler hakkında kişisel başarı kıyaslaması yapamam.',
      rewrote: true,
    };
  }

  if (/\b(?:konaklama|kalacak\s+yer|otel|misafirhane|nerede\s+kal|accommodation|stay|unterkunft)\b/i.test(inbound)) {
    return {
      text: 'Konaklama tarafının sizin için önemli olduğunu görüyorum. Hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller konusunda ekibimiz danışmanlık yapabilir; garanti veya rezervasyon sözü veremem.',
      rewrote: true,
    };
  }

  if (/\b(?:g[üu]ven|inanmad[ıi]m|bot|robot|anlam[ıi]yor|anlamad[ıi]n|emin\s+olam[ıi]yorum)\b/i.test(inbound)) {
    return {
      text: 'Haklısınız, cevabım yeterince net olmadı. Sorunuzu tekrar başa almadan buradan toparlayayım; hangi bilgiyi netleştirmemi istersiniz?',
      rewrote: true,
    };
  }

  if (/\b(?:fiyat|[üu]cret|tutar|[öo]deme|ne\s+kadar|ta\s*12|ta12)\b/i.test(inbound)) {
    return {
      text: 'Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.',
      rewrote: true,
    };
  }

  return {
    text: 'Mesajınızı aldım. Aynı yerden devam edelim; hangi bilgiyi netleştireyim?',
    rewrote: true,
  };
}

export class FinalOutboundBodyAuditor {
  /**
   * Apply mandatory last-mile chain to the final body before 360dialog send.
   * Returns the (potentially rewritten) body and audit metadata.
   */
  public static audit(
    text: string,
    ctx: FinalOutboundAuditCtx
  ): FinalOutboundAuditResult {
    if (!text) {
      return {
        text: '',
        bodyLength: 0,
        paragraphCount: 0,
        hasNumberedBlocks: false,
        normalizerApplied: false,
        formatterApplied: false,
        containsLegacyClose: false,
        containsKnownBadMorphology: false,
        rewrote: false,
      };
    }

    let cleanedText = text.trim();
    const leadingPunctRegex = /^[\s,;.:!\-—–]+/;
    let rewrote = false;
    if (leadingPunctRegex.test(cleanedText)) {
      cleanedText = cleanedText.replace(leadingPunctRegex, '').trim();
      rewrote = true;
    }

    let result = cleanedText;
    let normalizerApplied = false;
    let formatterApplied = false;

    try {
      // Step 1: Turkish Final Quality Normalizer
      const looksTurkish = /[ışğçöüİŞĞÇÖÜ]|\b(?:merhaba|geçmiş\s+olsun|hastanemizde|türkiye|şikayet|randevu|görüşme)\b/i.test(result);
      if (ctx.replyLanguage === 'tr' || (!ctx.replyLanguage && looksTurkish)) {
        const normResult = TurkishFinalQualityNormalizer.normalize(result);
        if (normResult.wasModified) {
          result = normResult.text;
          normalizerApplied = true;
          rewrote = true;
        }
      }

      // Step 2: WhatsApp Formatting Finalizer (paragraph/numbered block)
      // Only apply if channel is whatsapp or unspecified (default is whatsapp for this system)
      const isWhatsApp = !ctx.channel || ctx.channel === 'whatsapp';
      if (isWhatsApp) {
        const fmtResult = WhatsAppFormattingFinalizer.format(result);
        if (fmtResult.wasModified) {
          result = fmtResult.text;
          formatterApplied = true;
          rewrote = true;
        }
      }

      // Step 3: Legacy block kill (catch any "bu ekrandan" that survived)
      const legacyReplacement = FinalPipelineEnforcer.checkLegacyBlock(result);
      if (legacyReplacement !== null) {
        result = legacyReplacement;
        rewrote = true;
      }

      // Step 4: If a continuing callback-time answer somehow becomes a repeated
      // self-introduction, recover it to the slot confirmation the user expects.
      if (/^\s*(?:ben\s+)?r[üu]ya\b|ba[şs]kent\s+[üu]niversitesi/i.test(result)) {
        const arrivalRecovery = buildArrivalDateConfirmation(ctx.inboundText, ctx.replyLanguage);
        if (arrivalRecovery) {
          result = arrivalRecovery;
          rewrote = true;
        } else {
          const callbackRecovery = buildCallbackTimeConfirmation(ctx.inboundText);
          if (callbackRecovery) {
            result = callbackRecovery;
            rewrote = true;
          }
        }
      }

      const naturalTone = applyNaturalToneRewrites(result, ctx);
      if (naturalTone.rewrote) {
        result = naturalTone.text;
        rewrote = true;
      }

      const priceGuard = applyPriceQuestionGuard(result, ctx);
      if (priceGuard.rewrote) {
        result = priceGuard.text;
        rewrote = true;
      }

      const genericEscape = applyGenericEscapeRecovery(result, ctx);
      if (genericEscape.rewrote) {
        result = genericEscape.text;
        rewrote = true;
      }

      const staleYear = applyStaleYearDateRewrite(result, ctx);
      if (staleYear.rewrote) {
        result = staleYear.text;
        rewrote = true;
      }

      if (containsPromptLeak(result)) {
        result = buildPromptLeakRecovery(ctx);
        rewrote = true;
        if (!formatterApplied && (!ctx.channel || ctx.channel === 'whatsapp')) {
          const fmtResult = WhatsAppFormattingFinalizer.format(result);
          result = fmtResult.text;
          formatterApplied = formatterApplied || fmtResult.wasModified;
        }
      }
    } catch (err) {
      // Non-fatal — use original text
      console.error('[FinalOutboundBodyAuditor] Error in chain, using original text:', err);
      result = text;
    }

    // Metrics
    const paragraphs = result.split(/\n\n+/).filter(p => p.trim().length > 0);
    const hasNumberedBlocks = /^\d+\.\s/m.test(result);
    const containsLegacyClose = LEGACY_CLOSE_PATTERNS.some(p => p.test(result));
    const containsKnownBadMorphology = KNOWN_BAD_MORPHOLOGY_PATTERNS.some(p => p.test(result));

    // Telemetry — FINAL_OUTBOUND_BODY_AUDIT (PII-safe)
    try {
      console.log(JSON.stringify({
        tag: 'FINAL_OUTBOUND_BODY_AUDIT',
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId || 'unknown',
        workerPath: ctx.workerPath || 'unknown',
        responseSource: ctx.responseSource || 'unknown',
        bodyLength: result.length,
        paragraphCount: paragraphs.length,
        hasNumberedBlocks,
        normalizerApplied,
        formatterApplied,
        containsLegacyClose,
        containsKnownBadMorphology,
        rewrote,
      }));
    } catch { /* non-fatal */ }

    // Safety: if known bad morphology still present after normalizer, log as warning
    if (containsKnownBadMorphology) {
      try {
        console.warn(JSON.stringify({
          tag: 'FINAL_OUTBOUND_BAD_MORPHOLOGY_DETECTED',
          tenantId: ctx.tenantId,
          conversationId: ctx.conversationId || 'unknown',
          workerPath: ctx.workerPath || 'unknown',
          // No body content — PII-safe
        }));
      } catch { /* non-fatal */ }
    }

    return {
      text: result,
      bodyLength: result.length,
      paragraphCount: paragraphs.length,
      hasNumberedBlocks,
      normalizerApplied,
      formatterApplied,
      containsLegacyClose,
      containsKnownBadMorphology,
      rewrote,
    };
  }
}
