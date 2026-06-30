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
  conversationContextText?: string;
  verifiedDoctorDirectory?: Array<{ department: string; doctors: string[] }>;
  patientKnownFacts?: string[];
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

function normalizeTurkishForAudit(text?: string): string {
  return String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0307/g, '')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function auditContextText(ctx: FinalOutboundAuditCtx): string {
  return [
    ctx.conversationContextText || '',
    ctx.inboundText || '',
    ...(ctx.patientKnownFacts || []),
  ].filter(Boolean).join('\n');
}

function extractTravelDateSummaryFromContext(rawContext: string): string | null {
  const text = String(rawContext || '');
  const monthNames = [
    'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
    'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim',
    'aralık', 'aralik',
  ];
  const normalizedMonth: Record<string, string> = {
    ocak: 'Ocak',
    'şubat': 'Şubat',
    subat: 'Şubat',
    mart: 'Mart',
    nisan: 'Nisan',
    'mayıs': 'Mayıs',
    mayis: 'Mayıs',
    haziran: 'Haziran',
    temmuz: 'Temmuz',
    'ağustos': 'Ağustos',
    agustos: 'Ağustos',
    'eylül': 'Eylül',
    eylul: 'Eylül',
    ekim: 'Ekim',
    'kasım': 'Kasım',
    kasim: 'Kasım',
    'aralık': 'Aralık',
    aralik: 'Aralık',
  };

  const dayMonthMatches = Array.from(text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames.join('|')})\\b`, 'gi')));
  const monthDayMatches = Array.from(text.matchAll(new RegExp(`\\b(${monthNames.join('|')})\\s+(\\d{1,2})\\b`, 'gi')));
  const candidates = [
    ...dayMonthMatches.map(match => ({ index: match.index || 0, day: match[1], month: match[2] })),
    ...monthDayMatches.map(match => ({ index: match.index || 0, day: match[2], month: match[1] })),
  ].sort((a, b) => b.index - a.index);

  for (const candidate of candidates) {
    const day = Number(candidate.day);
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    const monthKey = candidate.month.toLocaleLowerCase('tr-TR');
    const month = normalizedMonth[monthKey] || normalizedMonth[monthKey.replace(/ı/g, 'i')] || candidate.month;
    return `${day} ${month}`;
  }

  const ambiguousResolved = text.match(/\b(?:7\s+8|7[./]8)\b[\s\S]{0,80}\btemmuz\s+8\b/i);
  if (ambiguousResolved) return '8 Temmuz';
  return null;
}

function buildKnownContextRecovery(ctx: FinalOutboundAuditCtx, reason: 'trust' | 'generic' | 'prompt_leak' = 'generic'): string | null {
  const rawContext = auditContextText(ctx);
  const cleanContext = normalizeTurkishForAudit(rawContext);
  const cleanInbound = normalizeTurkishForAudit(ctx.inboundText);
  const directoryText = formatVerifiedDoctorDirectoryForRecovery(ctx.verifiedDoctorDirectory);
  const hasSpineComplaint = /\b(?:bel\s+fitigi|bel\s+fitigim|boyun\s+fitigi|fitik|fitig)\b/.test(cleanContext);
  const hasPriceContext = /\b(?:fiyat|ucret|tutar|odeme|ne\s+kadar|ta\s*12|ta12)\b/.test(cleanContext);
  const hasVisitContext = /\b(?:gelecem|gelecegim|gelebilirim|turkiye|konya|gelme\s+plani)\b/.test(cleanContext);
  const travelDate = extractTravelDateSummaryFromContext(rawContext);
  const hasTrustSignal = /\b(?:bot|bor\s+musun|yapay\s+zeka\w*|guven|inanmadim|anlamadin|anlamiyorsun|unut|soyledim|dedim\s+ya|cevap\s+vermedin|sorularima\s+cevap)\b/.test(cleanInbound);

  if (!hasSpineComplaint && !directoryText && !hasPriceContext && !travelDate && !hasVisitContext) {
    return null;
  }

  const intro = reason === 'trust' || hasTrustSignal
    ? 'Haklısınız, önceki cevabım yeterince net olmadı. Aynı yerden toparlayayım.'
    : 'Aynı yerden devam edelim.';
  const parts: string[] = [intro];

  if (hasSpineComplaint) {
    if (directoryText) {
      parts.push(`Bel fıtığı için konuşuyorduk. Hastanemizde bu konuda Beyin ve Sinir Cerrahisi bölümünden destek alabilirsiniz.\n\n${directoryText}`);
    } else {
      parts.push('Bel fıtığı için konuşuyorduk. Bu şikayette doğru değerlendirme için ilgili uzman hekim muayenesi ve gerekirse tetkiklerle değerlendirme gerekir.');
    }
  } else if (directoryText) {
    parts.push(directoryText);
  }

  if (travelDate) {
    parts.push(`${travelDate} geliş planınızı da dikkate alıyorum.`);
  }

  if (hasPriceContext) {
    parts.push('Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.');
  }

  const followUp = hasPriceContext
    ? 'Fiyat tarafını netleştirmek için telefon görüşmesi planlayabiliriz; gün ve saat olarak size ne uygun olur?'
    : 'Süreç, randevu veya telefon görüşmesi tarafında hangi adımı netleştirelim?';
  parts.push(followUp);

  return parts.join('\n\n');
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

  const contextRecovery = buildKnownContextRecovery(ctx, 'prompt_leak');
  if (contextRecovery) {
    return contextRecovery;
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

function isIdentityQuestionInbound(inboundText?: string): boolean {
  const clean = (inboundText || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .trim();
  return /\b(kimle\s+g[öo]r[üu][şs][üu]yorum|ad[ıi]n[ıi]z\s+ne|kimsiniz|sen\s+kimsin|r[üu]ya\s+m[ıi]s[ıi]n|bot\s+musun|yapay\s+zeka\s+m[ıi]s[ıi]n)\b/i.test(clean);
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

  const nameOnlyGreetingCleaned = result.replace(
    /\bMemnun\s+oldum\s+[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü'’-]{1,40}(?:\s+(?:Bey|Hanım|Hanim|Sayın|Sayin|Bay|Bayan))?[,.]?/g,
    'Memnun oldum.'
  );
  if (nameOnlyGreetingCleaned !== result) {
    result = nameOnlyGreetingCleaned;
    rewrote = true;
  }

  const honorificCleaned = result.replace(/\b([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü'’-]{1,40})\s+(?:Bey|Hanım|Hanim|Sayın|Sayin|Bay|Bayan)(?=\b|[.,!?;:])/g, '$1');
  if (honorificCleaned !== result) {
    result = honorificCleaned;
    rewrote = true;
  }

  if (!isShortGreetingInbound(ctx.inboundText) && !isIdentityQuestionInbound(ctx.inboundText)) {
    const identityPatterns = [
      /^\s*(?:Merhaba,\s*)?Başkent\s+Üniversitesi\s+Konya\s+Hastanesi['’`]nden\s+R[üu]ya\s+ben[.,]?\s*/i,
      /^\s*(?:Merhaba,\s*)?Başkent\s+Üniversitesi\s+Konya\s+Hastanesi['’`]nden\s+ben\s+R[üu]ya[.,]?\s*/i,
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
    [/\b([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:'d[ae]n|'da|'de)\s+yazd[ıi][ğg][ıi]n[ıi]z[ıi]?\s+anlad[ıi]m)\s+(?:Haman|Hemen)\b[.,]?/g, '$1.'],
    [/\b(?:Haman|Hemen),\s+/g, ''],
    [/boyunuz\s+f[ıi]t[ıi][ğg][ıi]/gi, 'boyun fıtığı'],
    [/baban[ıi]z[ıi]n\s+([^.\n,]+?)\s+şikayeti\s+oldu[ğg]unuzu/gi, 'babanızın $1 şikayeti olduğunu'],
    [/annenizin\s+([^.\n,]+?)\s+şikayeti\s+oldu[ğg]unuzu/gi, 'annenizin $1 şikayeti olduğunu'],
    [/ve\s+(\d+\s+y[ıi]ld[ıi]r)\s+y[üu]r[üu]yemedi[ğg]inizi/gi, 've babanızın $1 yürüyemediğini'],
    [/Kesin\s+de[ğg]erlendirme\s+i[çc]in\s+hastan[ıi]n[ıi]z\s+hastanemizde/gi, 'Kesin değerlendirme için hastanın hastanemizde'],
    [/Kesin\s+de[ğg]erlendirme\s+i[çc]in\s+hastan[ıi]n\s+hastanemizde\s+ilgili\s+uzman\s+hekim\s+taraf[ıi]ndan\s+muayene\s+edilmeniz/gi, 'Kesin değerlendirme için hastanemizde ilgili uzman hekim tarafından muayene edilmeniz'],
    [/Kesin\s+de[ğg]erlendirme\s+i[çc]in\s+hastan[ıi]n\s+hastanemizde\s+ilgili\s+\*?uzman\s+hekim\*?\s+taraf[ıi]ndan\s+muayene\s+edilmesi/gi, 'Kesin değerlendirme için hastanemizde ilgili uzman hekim tarafından muayene edilmeniz'],
    [/Ge[çc]mi[şs]\s+olsun\s+dileklerimi\s+iletmek\s+isterim\.?/gi, 'Öncelikle geçmiş olsun.'],
    [/([.!?])\s+size\s+en\s+uygun/gi, '$1 Size en uygun'],
    [/(^|\n)size\s+en\s+uygun/gi, '$1Size en uygun'],
    [/(^|\n)en\s+uygun/gi, '$1Size en uygun'],
    [/Bab[ıi]n[ıi]z/i, 'Babanız'],
    [/^form\s+başvurunuz/gi, 'Form başvurunuz'],
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
    let removedVisitQuestion = false;
    const ctaPatterns = [
      /\s*Sizi\s+hangi\s+g[üu]n\s+ve\s+saat\s+aral[ıi][ğg][ıi]nda\s+aramam\s+uygun\s+olur\??/gi,
      /\s*Hangi\s+g[üu]n\s+ve\s+saat\s+aral[ıi][ğg][ıi]\s+sizin\s+i[çc]in\s+uygun\s+olur\??/gi,
      /\s*Telefon\s+g[öo]r[üu][şs]mesi\s+i[çc]in\s+size\s+uygun\s+g[üu]n\s+ve\s+saat\s+aral[ıi][ğg][ıi]\s+nedir\??/gi,
      /\s*[İI]lerleyen\s+d[öo]nemde\s+(?:T[üu]rkiye['’`]ye\s*(?:\/|veya|ya\s+da)\s*Konya['’`]ya|T[üu]rkiye’ye\s*(?:\/|veya|ya\s+da)\s*Konya’ya|T[üu]rkiye['’`]ye|T[üu]rkiye’ye|Konya['’`]ya|Konya’ya)\s+gelme\s+ihtimaliniz\s+olur\s+mu\??/gi,
    ];
    for (const pattern of ctaPatterns) {
      const next = result.replace(pattern, '').trim();
      if (next !== result) {
        if (/gelme\s+ihtimaliniz\s+olur\s+mu/i.test(result)) removedVisitQuestion = true;
        result = next;
        rewrote = true;
      }
    }
    const sentenceCleaned = result
      .split(/(?<=[.!?])\s+/)
      .filter(sentence => {
        const clean = sentence.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
        const cleanLower = clean
          .replace(/İ/g, 'i')
          .replace(/I/g, 'ı')
          .toLocaleLowerCase('tr-TR');
        const shouldDrop = /ilerleyen\s+d[öo]nemde[\s\S]{0,160}(?:t[üu]rkiye|konya)[\s\S]{0,160}gelme\s+ihtimaliniz\s+olur\s+mu/.test(cleanLower);
        if (shouldDrop) removedVisitQuestion = true;
        return !shouldDrop;
      })
      .join(' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();
    if (sentenceCleaned && sentenceCleaned !== result) {
      result = sentenceCleaned;
      rewrote = true;
    }
    const asksQuestion = /\?\s*$/.test(result);
    const complaintLikeInbound = /(?:bel\s+f[ıi]t[ıi][ğg][ıi]|boyun\s+f[ıi]t[ıi][ğg][ıi]|a[ğg]r[ıi]|şikayet|sikayet|egzama|diz|kalp|psoria|artrit)/i.test(ctx.inboundText || '');
    if (removedVisitQuestion && complaintLikeInbound && !asksQuestion) {
      const followUp = /bel\s+f[ıi]t[ıi][ğg][ıi]|boyun\s+f[ıi]t[ıi][ğg][ıi]/i.test(ctx.inboundText || '')
        ? 'Şikayetiniz ne kadar süredir devam ediyor, bacaklara vuran ağrı veya uyuşma var mı?'
        : 'Şikayetiniz ne kadar süredir devam ediyor?';
      result = `${result}\n\n${followUp}`.trim();
      rewrote = true;
    }
  }

  const fertilityContext = [
    ctx.inboundText || '',
    ctx.conversationContextText || '',
    ...(ctx.patientKnownFacts || []),
    result || '',
  ].join('\n');
  const fertilityInbound = /tekrar\s+anne\s+olmak|çocu[ğg]um\s+var|cocugum\s+var|gebelik|t[üu]p\s+bebek/i.test(fertilityContext);
  if (fertilityInbound) {
    const fertilityRewrites: Array<[RegExp, string]> = [
      [/\*?39\s+ya[şs][ıi]nday[ıi]m,\s*iki\s+[çc]ocu[ğg]um\s+var,\s*tekrar\s+anne\s+olmak\s+istiyorum\*?\s+[şs]ikayetiniz\s+oldu[ğg]unu\s+belirtmi[şs]siniz\./gi, '39 yaşında olduğunuzu, iki çocuğunuz olduğunu ve tekrar anne olmak istediğinizi belirtmişsiniz.'],
      [/\*?Kad[ıi]n\s+Hastal[ıi]klar[ıi]\s+ve\s+Do[ğg]um\*?\s+alan[ıi]nda\s+tekrar\s+anne\s+olmak\s+istedi[ğg]inizi\s+belirtmi[şs]siniz\.\s*[ÖO]ncelikle\s+bu\s+iste[ğg]iniz\s+i[çc]in\s+size\s+yard[ıi]mc[ıi]\s+olmak\s+isteriz\./gi, 'Tekrar anne olmak istediğinizi belirtmişsiniz. Gebelik planlaması Kadın Hastalıkları ve Doğum alanında değerlendirilir.'],
      [/Tekrar\s+anne\s+olmak\s+istedi[ğg]inizi\s+belirtmi[şs]siniz\.\s*[ÖO]ncelikle\s+ge[çc]mi[şs]\s+olsun\./gi, 'Tekrar anne olmak istediğinizi belirtmişsiniz. İlginiz için teşekkür ederiz.'],
      [/Formunuzda\s+şu\s+anda\s+yurt\s+d[ıi][şs][ıi]na\s+[çc][ıi]kamayaca[ğg][ıi]n[ıi]z[ıi]\s+belirtmi[şs]siniz\./gi, 'Formunuzda şu anda yurt dışına çıkamayacağınızı ve Konya’ya gelemeyeceğinizi belirtmişsiniz.'],
      [/Bu\s+tarz\s+durumlarda,\s+uzaktan\s+ve\s+yaln[ıi]zca\s+mevcut\s+bilgilerle\s+net\s+bir\s+de[ğg]erlendirme\s+yapmak\s+m[üu]mk[üu]n\s+olmamakta(?:d[ıi]r)?\./gi, 'Gebelik planlamasında yaş, gebelik geçmişi ve genel sağlık durumu birlikte değerlendirilir; bu nedenle uzaktan net bir planlama yapmak doğru olmaz.'],
      [/Kesin\s+de[ğg]erlendirme\s+i[çc]in\s+hastan[ıi]n\s+hastanemizde\s+ilgili\s+\*?uzman\s+hekim\*?\s+taraf[ıi]ndan\s+muayene\s+edilmesi/gi, 'Kesin değerlendirme için hastanemizde ilgili uzman hekim tarafından muayene edilmeniz'],
    ];
    for (const [pattern, replacement] of fertilityRewrites) {
      const next = result.replace(pattern, replacement);
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

function formatVerifiedDoctorDirectoryForRecovery(directory?: Array<{ department: string; doctors: string[] }>): string | null {
  if (!directory || directory.length === 0) return null;
  const blocks = directory
    .filter(block => block?.department && Array.isArray(block.doctors) && block.doctors.length > 0)
    .slice(0, 3)
    .map(block => {
      const names = block.doctors.slice(0, 8).map(name => `• ${name}`).join('\n');
      return `${block.department} için doğrulanmış hekim bilgisi:\n${names}`;
    });
  return blocks.length > 0 ? blocks.join('\n\n') : null;
}

function turkishLocative(location: string): string {
  const clean = String(location || '').trim();
  if (!clean) return '';
  if (/(?:a|ı|o|u)$/i.test(clean)) return `${clean}’da`;
  if (/(?:e|i|ö|ü)$/i.test(clean)) return `${clean}’de`;
  return `${clean}’da`;
}

function relationGenitive(relationPossessive: string): string {
  const clean = relationPossessive.trim().toLocaleLowerCase('tr-TR');
  if (clean === 'babanız') return 'babanızın';
  if (clean === 'anneniz') return 'annenizin';
  if (clean === 'eşiniz') return 'eşinizin';
  if (clean === 'yakınınız') return 'yakınınızın';
  return `${relationPossessive}ın`;
}

function parseRelatedPersonFacts(facts?: string[]): {
  relationLabel: string;
  relationPossessive: string;
  topic: string;
  patientLocation?: string;
  requesterLocation?: string;
} | null {
  if (!Array.isArray(facts) || facts.length === 0) return null;
  const joined = facts.join('\n');
  const related = facts.find(f => /Yak[ıi]n[ıi]\s*\(([^)]+)\)\s+konusu:/i.test(f));
  if (!related) return null;
  const relMatch = related.match(/Yak[ıi]n[ıi]\s*\(([^)]+)\)\s+konusu:\s*([^.;\n]+)/i);
  if (!relMatch) return null;
  const rawLabel = relMatch[1].trim();
  const topic = relMatch[2].trim();
  const relationPossessive = /baba/i.test(rawLabel) ? 'babanız'
    : /anne/i.test(rawLabel) ? 'anneniz'
    : /eşi|esi/i.test(rawLabel) ? 'eşiniz'
    : 'yakınınız';
  const patientLocation = (joined.match(/Hastan[ıi]n bulundu[ğg]u yer:\s*([^.\n]+)/i)?.[1] || related.match(/bulundu[ğg]u yer:\s*([^.;\n]+)/i)?.[1])?.trim();
  const requesterLocation = joined.match(/Ba[şs]vuran ki[şs]inin bulundu[ğg]u yer:\s*([^.\n]+)/i)?.[1]?.trim();
  const rawLocationText = joined.toLocaleLowerCase('tr-TR');
  const inferredRequesterLocation = requesterLocation ||
    (/\bben\b[^.\n]{0,90}\balmanya\b|\balmanya\b[^.\n]{0,90}\bben\b/i.test(rawLocationText) ? 'Almanya' :
     /\bben\b[^.\n]{0,90}\bt[üu]rkiye\b|\bt[üu]rkiye\b[^.\n]{0,90}\bben\b/i.test(rawLocationText) ? 'Türkiye' :
     /\bben\b[^.\n]{0,90}\bkazakistan\b|\bkazakistan\b[^.\n]{0,90}\bben\b/i.test(rawLocationText) ? 'Kazakistan' :
     /\bben\b[^.\n]{0,90}\b[öo]zbekistan\b|\b[öo]zbekistan\b[^.\n]{0,90}\bben\b/i.test(rawLocationText) ? 'Özbekistan' : undefined);
  const inferredPatientLocation = patientLocation ||
    (/\b(?:babam|babası|baba|annem|annesi|anne|e[şs]im|e[şs]i)\b[^.\n]{0,90}\bt[üu]rkiye\b|\bt[üu]rkiye\b[^.\n]{0,90}\b(?:babam|babası|baba|annem|annesi|anne|e[şs]im|e[şs]i)\b/i.test(rawLocationText) ? 'Türkiye' :
     /\b(?:babam|babası|baba|annem|annesi|anne|e[şs]im|e[şs]i)\b[^.\n]{0,90}\balmanya\b|\balmanya\b[^.\n]{0,90}\b(?:babam|babası|baba|annem|annesi|anne|e[şs]im|e[şs]i)\b/i.test(rawLocationText) ? 'Almanya' : undefined);
  return {
    relationLabel: rawLabel,
    relationPossessive,
    topic,
    patientLocation: inferredPatientLocation,
    requesterLocation: inferredRequesterLocation,
  };
}

function applyKnownFactsRelationGuard(text: string, ctx: FinalOutboundAuditCtx): { text: string; rewrote: boolean } {
  const related = parseRelatedPersonFacts(ctx.patientKnownFacts);
  if (!related) return { text, rewrote: false };

  const hasRelationInText = new RegExp(related.relationPossessive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text);
  const selfMismatch = /\b(?:şikayetiniz|yaşadığınız\s+şikayet|muayene\s+edilmeniz|belirttiğiniz\s+şikayetiniz)\b/i.test(text) && !hasRelationInText;
  const asksForMoreComplaint = /şikayetinizi\s+biraz\s+daha\s+detayland[ıi]rabilir\s+misiniz/i.test(text) && !hasRelationInText;
  const isFirstFormWelcome = /form\s+başvurunuz\s+bize\s+ulaştı/i.test(text);
  const requesterLocationMissing = !!related.requesterLocation && !new RegExp(related.requesterLocation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text);
  const patientLocationMissing = !!related.patientLocation && !new RegExp(related.patientLocation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text);
  const relationSelfProcessMismatch = hasRelationInText && /\b(?:muayene\s+edilmeniz|size\s+en\s+uygun\s+takip|en\s+uygun\s+takip|tedavi\s+süreci\s+daha\s+sa[ğg]l[ıi]kl[ıi])\b/i.test(text);
  const malformedRelationText = /Bab[ıi]n[ıi]z/i.test(text);
  const relationContextMissing = isFirstFormWelcome && (requesterLocationMissing || patientLocationMissing);
  const inbound = [ctx.conversationContextText || '', ctx.inboundText || ''].join('\n');
  const asksAccommodation = /\b(?:konaklama|kalacak\s+yer\w*|otel|misafirhane|nerede\s+kal)\b/i.test(inbound);
  const asksDoctorMeeting = /\b(?:doktorla\s+g[öo]r[üu][şs]|hekimle\s+g[öo]r[üu][şs]|doktor\s+g[öo]r[üu][şs]mesi|ön\s+g[öo]r[üu][şs]me)\b/i.test(inbound);
  const relationSpecificFollowup = (asksAccommodation || asksDoctorMeeting) && (!hasRelationInText || requesterLocationMissing || patientLocationMissing);

  // V3: this guard is only a red-line fixer. It must not replace a good
  // model-written form reply just because a location/relation detail is absent.
  // Rewriting healthy Gemini replies here made live answers colder than the
  // local V3 prompt tests.
  const shouldRewrite =
    selfMismatch ||
    asksForMoreComplaint ||
    relationSelfProcessMismatch ||
    malformedRelationText ||
    relationSpecificFollowup ||
    // Keep the old first-form repair only for clearly broken legacy openings.
    (relationContextMissing && /form\s+başvurunuz\s+bize\s+ulaştı\.?,/i.test(text));

  if (!shouldRewrite) {
    return { text, rewrote: false };
  }

  const locationLine = related.requesterLocation && related.patientLocation
    ? `Sizin ${turkishLocative(related.requesterLocation)}, ${relationGenitive(related.relationPossessive)} ${turkishLocative(related.patientLocation)} olduğunu`
    : [
        related.requesterLocation ? `Sizin ${turkishLocative(related.requesterLocation)} olduğunuzu` : '',
        related.patientLocation ? `${relationGenitive(related.relationPossessive)} ${turkishLocative(related.patientLocation)} olduğunu` : '',
      ].filter(Boolean).join(', ');

  if (asksAccommodation || asksDoctorMeeting) {
    const parts = [
      `${related.relationPossessive[0].toUpperCase()}${related.relationPossessive.slice(1)} için ${related.topic} konusunu ayrı tutuyorum.${locationLine ? ` ${locationLine} da not ediyorum.` : ''}`,
    ];
    if (asksAccommodation) {
      parts.push('Konaklama tarafı için net söyleyeyim: hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller konusunda ekibimiz danışmanlık yapabilir; garanti veya rezervasyon sözü veremem.');
    }
    if (asksDoctorMeeting) {
      parts.push('Doktorla doğrudan ön görüşme sözü veremem; ancak bu talebi not edip randevu/koordinasyon sürecinde nasıl ilerlenebileceğini netleştirebiliriz.');
    }
    parts.push('Önce konaklama tarafını mı, doktor görüşmesi talebini mi netleştirelim?');
    return { text: parts.join('\n\n'), rewrote: true };
  }

  const subjectLine = `${related.relationPossessive[0].toUpperCase()}${related.relationPossessive.slice(1)} için ${related.topic} konusunda bilgi almak istediğinizi görüyorum. Geçmiş olsun.`;
  const contextLine = locationLine ? `${locationLine[0].toUpperCase()}${locationLine.slice(1)} ayrıca not ediyorum.` : '';
  return {
    text: [
      subjectLine,
      contextLine,
      `Bu tür durumlarda uzaktan kesin değerlendirme yapmak doğru olmaz; ${related.relationPossessive} için uzman hekim muayenesiyle süreç daha güvenli şekilde netleşir.`,
      'Önce bilgi almak istediğinizi not ediyorum. İsterseniz süreci kısaca anlatayım; doktor, konaklama veya arama planı tarafında merak ettiğiniz noktayı da buradan yanıtlayabilirim.',
    ].filter(Boolean).join('\n\n'),
    rewrote: true,
  };
}

function applyGenericEscapeRecovery(text: string, ctx: FinalOutboundAuditCtx): { text: string; rewrote: boolean } {
  const inbound = (ctx.inboundText || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
  const contextText = [ctx.conversationContextText || '', ctx.inboundText || '']
    .join('\n')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
  const cleanText = (text || '').trim();
  const isGenericEscape =
    /size\s+sa[ğg]l[ıi]k\s+talebinizle\s+ilgili\s+yard[ıi]mc[ıi]\s+olay[ıi]m\.\s*hangi\s+konuda\s+bilgi\s+almak\s+istiyorsunuz\??/i.test(cleanText) ||
    /devam\s+edelim;\s+son\s+mesaj[ıi]n[ıi]zdaki\s+talebi\s+tam\s+yakalayamad[ıi]m/i.test(cleanText) ||
    /hangi\s+konuda\s+bilgi\s+almak\s+istedi[ğg]inizi\s+iletebilirsiniz\??/i.test(cleanText) ||
    /^hangi\s+konuda\s+yard[ıi]mc[ıi]\s+olmam[ıi]\s+istersiniz\??$/i.test(cleanText) ||
    /^hangi\s+konuda\s+yard[ıi]mc[ıi]\s+olay[ıi]m\??$/i.test(cleanText);

  if (!isGenericEscape) {
    return { text, rewrote: false };
  }

  const asksPrice = /\b(?:fiyat|[üu]cret|tutar|[öo]deme|ne\s+kadar|ta\s*12|ta12)\b/i.test(inbound);
  const priceContext = /\b(?:fiyat|[üu]cret|tutar|[öo]deme|ne\s+kadar|ta\s*12|ta12)\b/i.test(contextText);
  const asksAccommodation = /\b(?:konaklama|kalacak\s+yer\w*|otel|misafirhane|nerede\s+kal|accommodation|stay|unterkunft)\b/i.test(inbound);
  const asksAddress = /\b(?:adres|konum|harita|nerede|neredesiniz|location|address)\b/i.test(inbound);
  const asksDoctorPattern = /\b(?:doktor|hekim|hoca|uzman|kadronuz|doktorunuzun|doktorunun|dermatoloji|kardiyoloji|kad[ıi]n\s+do[ğg]um)\b.*\b(?:isim|ismi|ismini|ad[ıi]|kim|kimler|liste|ara[şs]t[ıi]r)|\b(?:isim|ad[ıi])\s+s[öo]yle|\bara[şs]t[ıi]raca[ğg][ıi]m|\bara[şs]t[ıi]racam/i;
  const asksDoctor = asksDoctorPattern.test(inbound);
  const doctorContext = asksDoctor || asksDoctorPattern.test(contextText) || (ctx.verifiedDoctorDirectory || []).length > 0 && /\b(?:doktor|hekim|hoca|uzman|dermatoloji|kardiyoloji|kad[ıi]n\s+do[ğg]um|isim|ad[ıi]|g[üu]ven|bot)\b/i.test(contextText);

  if (asksAddress) {
    return {
      text: 'Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi adresimiz: Hocacihan Mahallesi, Saray Caddesi No:1, Selçuklu / Konya.',
      rewrote: true,
    };
  }

  if ([asksPrice, asksAccommodation, asksDoctor].filter(Boolean).length >= 2) {
    const parts: string[] = [];
    if (asksPrice) {
      parts.push('Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.');
    }
    if (asksDoctor) {
      parts.push('Doktor isimlerini öğrenmek istediğinizi görüyorum. Doğrulanmış hekim listesi varsa isimleri paylaşabilirim; hekimler hakkında kişisel başarı kıyaslaması yapamam.');
    }
    if (asksAccommodation) {
      parts.push('Konaklama tarafının sizin için önemli olduğunu görüyorum. Hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller konusunda ekibimiz danışmanlık yapabilir; garanti veya rezervasyon sözü veremem.');
    }
    parts.push('Bu başlıklardan hangisini önce netleştirelim?');
    return {
      text: parts.join('\n\n'),
      rewrote: true,
    };
  }

  if (asksDoctor) {
    const directoryText = formatVerifiedDoctorDirectoryForRecovery(ctx.verifiedDoctorDirectory);
    if (directoryText) {
      return {
        text: directoryText,
        rewrote: true,
      };
    }
    return {
      text: 'Doktor isimlerini öğrenmek istediğinizi görüyorum. Doğrulanmış hekim listesi varsa isimleri paylaşabilirim; hekimler hakkında kişisel başarı kıyaslaması yapamam.',
      rewrote: true,
    };
  }

  if (asksAccommodation) {
    return {
      text: 'Konaklama tarafının sizin için önemli olduğunu görüyorum. Hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller konusunda ekibimiz danışmanlık yapabilir; garanti veya rezervasyon sözü veremem.',
      rewrote: true,
    };
  }

  if (/\b(?:g[üu]ven|inanmad[ıi]m|bot|bor\s+musun|robot|yapay\s+zeka|anlam[ıi]yor|anlamad[ıi]n|unut|unuttun|unutuyorsun|s[öo]yledim|dedim\s+ya|emin\s+olam[ıi]yorum|yard[ıi]mc[ıi]\s+olamayacaks[ıi]n[ıi]z)\b/i.test(inbound)) {
    const contextRecovery = buildKnownContextRecovery(ctx, 'trust');
    if (contextRecovery) {
      return {
        text: contextRecovery,
        rewrote: true,
      };
    }

    const directoryText = doctorContext ? formatVerifiedDoctorDirectoryForRecovery(ctx.verifiedDoctorDirectory) : null;
    if (directoryText) {
      return {
        text: `Haklısınız, önceki cevabım yeterince net olmadı. Doktor isimlerini doğrudan paylaşayım.\n\n${directoryText}`,
        rewrote: true,
      };
    }
    if (priceContext) {
      return {
        text: 'Haklısınız, aynı fiyat cümlesini tekrarlamak yardımcı olmuyor. Buradan net fiyat paylaşamıyorum; isterseniz bu başlığı hasta danışmanıyla telefon görüşmesinde netleştirebiliriz. Size hangi gün ve saat aralığı uygun olur?',
        rewrote: true,
      };
    }
    return {
      text: 'Haklısınız, cevabım yeterince net olmadı. Sorunuzu tekrar başa almadan buradan toparlayayım; hangi bilgiyi netleştirmemi istersiniz?',
      rewrote: true,
    };
  }

  if (asksPrice) {
    return {
      text: 'Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.',
      rewrote: true,
    };
  }

  const contextRecovery = buildKnownContextRecovery(ctx, 'generic');
  if (contextRecovery) {
    return {
      text: contextRecovery,
      rewrote: true,
    };
  }

  return {
    text: 'Mesajınızı aldım. Aynı yerden devam edelim; hangi bilgiyi netleştireyim?',
    rewrote: true,
  };
}

function applyTrustRepairGuard(text: string, ctx: FinalOutboundAuditCtx): { text: string; rewrote: boolean } {
  const inbound = (ctx.inboundText || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
  const contextText = [ctx.conversationContextText || '', ctx.inboundText || '', text || '']
    .join('\n')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();

  const hasTrustSignal = /\b(?:g[üu]ven|inanmad[ıi]m|bot|bor\s+musun|robot|yapay\s+zeka|anlam[ıi]yor|anlamad[ıi]n|unut|unuttun|unutuyorsun|s[öo]yledim|dedim\s+ya|yard[ıi]mc[ıi]\s+olamayacaks[ıi]n[ıi]z|cevap\s+vermedin|cevaplamad[ıi]n|sorular[ıi]ma\s+cevap)\b/i.test(inbound);
  if (!hasTrustSignal) return { text, rewrote: false };

  const looksLikeWrongFallback =
    /gelme\s+d[üu][şs][üu]ncenizi\s+not\s+ald[ıi]m/i.test(text) ||
    /ayn[ıi]\s+yerden\s+devam\s+edelim/i.test(text) ||
    /hangi\s+(?:ad[ıi]m[ıi]|bilgiyi)\s+netle[şs]tirelim/i.test(text) ||
    /hangi\s+konuda\s+bilgi\s+almak\s+istiyorsunuz/i.test(text) ||
    /size\s+sa[ğg]l[ıi]k\s+talebinizle\s+ilgili\s+yard[ıi]mc[ıi]\s+olay[ıi]m/i.test(text) ||
    /ba[şs]ka\s+bir\s+sorunuz\s+var\s+m[ıi]/i.test(text);

  const ownsTrustMoment = /\b(?:hakl[ıi]s[ıi]n[ıi]z|kusura\s+bakmay[ıi]n|özür|g[üu]ven|daha\s+net|net\s+yard[ıi]mc[ıi]|anl[ıi]yorum)\b/i.test(text);
  const keepsConversationContext = /\b(?:bel\s+f[ıi]t[ıi][ğg][ıi]|boyun\s+f[ıi]t[ıi][ğg][ıi]|fiyat|[üu]cret|beyin\s+ve\s+sinir|kardiyoloji|dermatoloji|randevu|telefon|dan[ıi][şs]man|s[üu]re[çc]|muayene|konaklama|rinoplasti|burun|ameliyat)\b/i.test(text);
  if (ownsTrustMoment && keepsConversationContext && !looksLikeWrongFallback) {
    return { text, rewrote: false };
  }

  const contextRecovery = buildKnownContextRecovery(ctx, 'trust');
  if (contextRecovery && looksLikeWrongFallback) {
    return { text: contextRecovery, rewrote: true };
  }

  const asksDoctorPattern = /\b(?:doktor|hekim|hoca|uzman|dermatoloji|kardiyoloji|kad[ıi]n\s+do[ğg]um)\b.*\b(?:isim|ismi|ismini|ad[ıi]|kim|kimler|liste|ara[şs]t[ıi]r)|\b(?:isim|ad[ıi])\s+s[öo]yle|\bara[şs]t[ıi]raca[ğg][ıi]m|\bara[şs]t[ıi]racam/i;
  const directoryText = asksDoctorPattern.test(contextText)
    ? formatVerifiedDoctorDirectoryForRecovery(ctx.verifiedDoctorDirectory)
    : null;
  if (directoryText) {
    return {
      text: `Haklısınız, önceki cevabım yeterince net olmadı. Doktor isimlerini doğrudan paylaşayım.\n\n${directoryText}`,
      rewrote: true,
    };
  }

  const priceContext = /\b(?:fiyat|[üu]cret|tutar|[öo]deme|ne\s+kadar|ta\s*12|ta12)\b/i.test(contextText);
  const lacksTrustOwnership = !/\b(?:hakl[ıi]s[ıi]n[ıi]z|g[üu]ven|daha\s+net|somut)\b/i.test(text);
  const lacksSafePricePhrase = priceContext && !/buradan\s+net\s+fiyat\s+payla[şs]am[ıi]yorum/i.test(text);

  if (priceContext && (looksLikeWrongFallback || lacksTrustOwnership || lacksSafePricePhrase)) {
    return {
      text: 'Haklısınız, aynı fiyat cümlesini tekrar etmek size yardımcı olmuyor. Buradan net fiyat paylaşamıyorum; isterseniz bu başlığı hasta danışmanıyla telefon görüşmesinde netleştirebiliriz. Size hangi gün ve saat aralığı uygun olur?',
      rewrote: true,
    };
  }

  if (!looksLikeWrongFallback) return { text, rewrote: false };

  return {
    text: 'Haklısınız, önceki cevabım yeterince net olmadı. Sorunuzu tekrar başa almadan buradan toparlayayım; hangi bilgiyi netleştirelim?',
    rewrote: true,
  };
}

function applyMediaDocumentGuard(text: string, ctx: FinalOutboundAuditCtx): { text: string; rewrote: boolean } {
  const inbound = [ctx.conversationContextText || '', ctx.inboundText || '']
    .join('\n')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
  const hasMediaSignal = /\b(?:mr|mrg|emar|rapor|g[öo]rsel|film|r[öo]ntgen|tomografi|tetkik|sonu[çc]|belge|foto[ğg]raf|resim)\b/i.test(inbound);
  const asksComment = /\b(?:yorumlar\s+m[ıi]s[ıi]n[ıi]z|yorum\s+yapar|ne\s+d[üu][şs][üu]n|incele|bakabilir|de[ğg]erlendir)\b/i.test(inbound);
  if (!hasMediaSignal && !asksComment) return { text, rewrote: false };

  const saysSafeBoundary = /\b(?:t[ıi]bbi\s+yorum\s+yapamam|buradan\s+yorum\s+yapamam|net\s+de[ğg]erlendirme\s+yapamam)\b/i.test(text);
  const saysReceived = /\b(?:ula[şs]t[ıi]|geldi|ald[ıi]m|rapor|g[öo]rsel|belge|tetkik)\b/i.test(text);
  const createsWrongExpectation = /\b(?:buradan\s+iletebilirsiniz|g[öo]nderebilirsiniz|doktorumuz\s+inceleyecek|ekibimiz\s+de[ğg]erlendirecek|rapora\s+g[öo]re\s+te[şs]his)\b/i.test(text);
  if (saysSafeBoundary && saysReceived && !createsWrongExpectation) {
    return { text, rewrote: false };
  }

  return {
    text: [
      'Görseliniz veya raporunuz ulaştıysa buradan tıbbi yorum yapamam; kesin değerlendirme hastanede ilgili uzman hekim muayenesiyle yapılır.',
      'Bu görsel ya da raporla ilgili özellikle neyi sormak istiyorsunuz?',
    ].join('\n\n'),
    rewrote: true,
  };
}

function applyExplicitQuestionCoverageGuard(text: string, ctx: FinalOutboundAuditCtx): { text: string; rewrote: boolean } {
  const inbound = (ctx.inboundText || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
  let result = text;
  let rewrote = false;

  const asksAddress = /\b(?:adres|konum|harita|nerede|neredesiniz|location|address)\b/i.test(inbound);
  if (asksAddress) {
    if (!/\bHocacihan\b|\bSaray\s+Caddesi\b|\bSel[çc]uklu\b/i.test(result)) {
      return {
        text: 'Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi adresimiz: Hocacihan Mahallesi, Saray Caddesi No:1, Selçuklu / Konya.',
        rewrote: true,
      };
    }
    const next = result
      .replace(/\s*Size\s+daha\s+do[ğg]ru\s+yard[ıi]mc[ıi]\s+olabilmem\s+i[çc]in\s+ad[ıi]n[ıi]z[ıi]?\s+[öo][ğg]renebilir\s+miyim\??/gi, '')
      .replace(/\s*Ad[ıi]n[ıi]z[ıi]?\s+[öo][ğg]renebilir\s+miyim\??/gi, '')
      .trim();
    if (next !== result) {
      result = next;
      rewrote = true;
    }
  }

  const asksAccommodation = /\b(?:konaklama|kalacak\s+yer\w*|otel|misafirhane|nerede\s+kal|accommodation|stay|unterkunft)\b/i.test(inbound);
  const answeredAccommodation = /\b(?:konaklama|kalacak\s+yer|otel|anla[şs]mal[ıi]|hastaneye\s+yak[ıi]n|rezervasyon|garanti)\b/i.test(result);
  if (asksAccommodation && !answeredAccommodation) {
    result = [
      result.trim(),
      'Konaklama tarafı için de şunu net söyleyebilirim: Hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller konusunda ekibimiz danışmanlık yapabilir; garanti veya rezervasyon sözü veremem.'
    ].filter(Boolean).join('\n\n');
    rewrote = true;
  }

  const asksPrice = /\b(?:fiyat|[üu]cret|tutar|[öo]deme|ne\s+kadar|ta\s*12|ta12)\b/i.test(inbound);
  const answeredPrice = /Fiyat\s+bilgisi,\s+hastanedeki\s+de[ğg]erlendirme\s+ve\s+planlanacak\s+s[üu]rece\s+g[öo]re\s+de[ğg]i[şs]ti[ğg]i\s+i[çc]in\s+buradan\s+net\s+fiyat\s+payla[şs]am[ıi]yorum\./i.test(result);
  if (asksPrice && !answeredPrice) {
    result = [
      'Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.',
      result.trim()
    ].filter(Boolean).join('\n\n');
    rewrote = true;
  }

  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return { text: result, rewrote };
}

function extractCountryMention(text?: string): string | null {
  const clean = (text || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
  const countryPatterns: Array<[RegExp, string]> = [
    [/\bo['’`]?zbekiston\b|\b[öo]zbekistan\b|\bozbekiston\b/i, 'Özbekistan'],
    [/\bkazakistan\b/i, 'Kazakistan'],
    [/\balmanya\b|\bgermany\b|\bdeutschland\b/i, 'Almanya'],
    [/\bfransa\b|\bfrance\b/i, 'Fransa'],
    [/\bkanada\b|\bcanada\b/i, 'Kanada'],
    [/\bhollanda\b|\bnetherlands\b|\bnederland\b/i, 'Hollanda'],
    [/\bbel[çc]ika\b|\bbelgium\b/i, 'Belçika'],
    [/\birak\b|\biraq\b/i, 'Irak'],
    [/\b[üu]rd[üu]n\b|\bjordan\b/i, 'Ürdün'],
    [/\bt[üu]rkiye\b|\bturkey\b/i, 'Türkiye'],
    [/\bazerbaycan\b|\bazerbaijan\b/i, 'Azerbaycan'],
    [/\brusya\b|\brussia\b/i, 'Rusya'],
    [/\bingiltere\b|\bunited kingdom\b|\buk\b/i, 'İngiltere'],
  ];
  for (const [pattern, label] of countryPatterns) {
    if (pattern.test(clean)) return label;
  }
  return null;
}

function applyCountryAcknowledgementGuard(text: string, ctx: FinalOutboundAuditCtx): { text: string; rewrote: boolean } {
  const country = extractCountryMention(ctx.inboundText);
  if (!country) return { text, rewrote: false };

  const contextText = [ctx.conversationContextText || '', ctx.inboundText || '', text || '']
    .join('\n')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLocaleLowerCase('tr-TR');
  const medicalTerm = /psor(?:y|i)azi|psoriaz|psoryaz|psoriatik|psoriatic|artrit/.test(contextText);
  const replyKeepsMedicalTerm = /psor(?:y|i)azi|psoriaz|psoryaz|psoriatik|psoriatic|artrit/.test(
    (text || '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLocaleLowerCase('tr-TR')
  );
  if (medicalTerm && !replyKeepsMedicalTerm) {
    return {
      text: `${country}'da yaşadığınızı not aldım. Yazdığınız hastalık adını psoriatik artrit olarak mı anlamalıyım? Netleştirirseniz süreç ve ilgili bölüm konusunda daha doğru yönlendireyim.`,
      rewrote: true,
    };
  }
  const serviceMisread = /\bhamam\s+hizmet/i.test(contextText);
  if (serviceMisread) {
    return {
      text: medicalTerm
        ? `${country}'da yaşadığınızı not aldım. Yazdığınız hastalık adını psoriatik artrit olarak mı anlamalıyım? Netleştirirseniz süreç ve ilgili bölüm konusunda daha doğru yönlendireyim.`
        : `${country}'da yaşadığınızı not aldım. Aynı yerden devam edelim; sağlık talebinizle ilgili hangi bilgiyi netleştirelim?`,
      rewrote: true,
    };
  }

  const asksForNameOnly = /ad[ıi]n[ıi]z[ıi]?\s+(?:[öo][ğg]renebilir|payla[şs][ıi]r|yazar)|ad[ıi]n[ıi]z\s+nedir/i.test(text);
  const generic = /hangi\s+bilgiyi\s+netle[şs]tireyim|hangi\s+konuda\s+bilgi\s+almak/i.test(text);
  const languagePreferencePrompt = /istedi[ğg]iniz\s+dilde|hangi\s+dil\s+(?:sizin\s+i[çc]in\s+)?(?:daha\s+)?rahat|[öo]zbek[çc]e|rus[çc]a|ingilizce/i.test(text);
  const genericOrRestarting = generic || languagePreferencePrompt || /hangi\s+bilgiyi\s+netle[şs]tirelim|sa[ğg]l[ıi]k\s+talebiniz\s+nedir|hangi\s+b[öo]l[üu]m|hangi\s+[şs]ikayet/i.test(text);
  if (genericOrRestarting && medicalTerm) {
    return {
      text: `${country}'da yaşadığınızı not aldım. Yazdığınız hastalık adını psoriatik artrit olarak mı anlamalıyım? Netleştirirseniz süreç ve ilgili bölüm konusunda daha doğru yönlendireyim.`,
      rewrote: true,
    };
  }
  if (!asksForNameOnly && !generic && !languagePreferencePrompt && new RegExp(country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
    return { text, rewrote: false };
  }
  if (languagePreferencePrompt && !new RegExp(country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) {
    return {
      text: `${country}'da yaşadığınızı not aldım. İsterseniz Türkçe devam edebiliriz; Özbekçe, Rusça veya İngilizce sizin için daha rahatsa o dilde de yardımcı olayım. Hangi dil daha rahat olur?`,
      rewrote: true,
    };
  }
  if (!asksForNameOnly && !generic) return { text, rewrote: false };

  return {
    text: `${country}'da yaşadığınızı not aldım. Aynı yerden devam edelim; süreç, geliş planı veya randevu tarafında hangi bilgiyi netleştirelim?`,
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

      const relationGuard = applyKnownFactsRelationGuard(result, ctx);
      if (relationGuard.rewrote) {
        result = relationGuard.text;
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

      const coverageGuard = applyExplicitQuestionCoverageGuard(result, ctx);
      if (coverageGuard.rewrote) {
        result = coverageGuard.text;
        rewrote = true;
      }

      const mediaGuard = applyMediaDocumentGuard(result, ctx);
      if (mediaGuard.rewrote) {
        result = mediaGuard.text;
        rewrote = true;
      }

      const countryGuard = applyCountryAcknowledgementGuard(result, ctx);
      if (countryGuard.rewrote) {
        result = countryGuard.text;
        rewrote = true;
      }

      const genericEscape = applyGenericEscapeRecovery(result, ctx);
      if (genericEscape.rewrote) {
        result = genericEscape.text;
        rewrote = true;
      }

      const trustRepair = applyTrustRepairGuard(result, ctx);
      if (trustRepair.rewrote) {
        result = trustRepair.text;
        rewrote = true;
      }

      // Run relation guard once more at the end. Some coverage/trust recovery
      // rewrites intentionally rebuild the answer; they must not erase
      // applicant/patient separation from form context.
      const finalRelationGuard = applyKnownFactsRelationGuard(result, ctx);
      if (finalRelationGuard.rewrote) {
        result = finalRelationGuard.text;
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
