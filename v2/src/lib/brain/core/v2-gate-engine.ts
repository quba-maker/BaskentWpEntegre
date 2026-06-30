import type { TenantBrain } from '../tenant-brain';
import type { QubaBrainProfile } from './schema';
import { DoctorDirectoryResolver, type Doctor } from '../../services/ai/doctor-directory-resolver';
import type { BrainV2ShadowPlan } from '../../services/ai/brain-v2-shadow-planner';

export type QubaV2ContactMode =
  | 'form_lead'
  | 'direct_inbound'
  | 'continuing_conversation'
  | 'patient_inbound_after_form';

export type QubaV2GateIntent =
  | 'price_question'
  | 'doctor_names'
  | 'doctor_profile'
  | 'accommodation_question'
  | 'process_question'
  | 'appointment_or_call_request'
  | 'visit_intent'
  | 'address_question'
  | 'form_payload'
  | 'language_or_country_signal'
  | 'concern_objection'
  | 'trust_repair'
  | 'media_or_document';

export interface QubaV2GateSignal {
  intent: QubaV2GateIntent;
  confidence: 'low' | 'medium' | 'high';
  evidence: string[];
  mustAnswer: string;
}

export interface QubaV2ActionDryRun {
  action: 'schedule_callback' | 'create_appointment' | 'handoff_human' | 'collect_info' | 'answer_only';
  status: 'not_applicable' | 'blocked' | 'ready';
  requiredMissing: string[];
  safetyNotes: string[];
  humanFacingInstruction: string;
}

export interface QubaV2GateResult {
  version: 'quba_v2_gate_v1';
  engine: 'quba_v2_independent';
  mode: 'sandbox' | 'shadow' | 'live_dry_run';
  usedLegacyRuntimeGates: false;
  contactMode: QubaV2ContactMode;
  detectedIntents: QubaV2GateIntent[];
  signals: QubaV2GateSignal[];
  mustAnswer: string[];
  verifiedData: {
    dateContext: string;
    pricePolicy?: string;
    doctorDirectory?: Array<{ department: string; doctors: string[] }>;
    accommodationPolicy?: string;
    knownFacts?: string[];
  };
  missingInformation: string[];
  forbiddenClaims: string[];
  riskFlags: string[];
  dryRunActions: QubaV2ActionDryRun[];
  responseDirectives: string[];
  recommendedFollowUp?: string;
  summary: string;
}

interface BuildParams {
  inboundText: string;
  history?: { role: string; content: string }[];
  brain: TenantBrain;
  profile: QubaBrainProfile;
  now?: Date;
  latestForm?: any;
  conversation?: any;
  opportunity?: any;
}

const FALLBACK_PRICE_POLICY =
  'Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.';

const FALLBACK_ACCOMMODATION_POLICY =
  'Hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller konusunda ekip danışmanlık yapabilir; konaklama garantisi veya rezervasyon sözü verilmez.';

function normalizeText(text: string): string {
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

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function buildRecentUserWindow(inboundText: string, history: { role: string; content: string }[] = []): string {
  const burst: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role === 'assistant') break;
    if (msg?.role === 'user' && msg.content) burst.unshift(msg.content);
  }
  return unique([...burst, inboundText].map(item => String(item || '').trim()).filter(Boolean)).join('\n');
}

function hasStructuredFormPayload(text: string): boolean {
  return /(?:Full\s+name|Phone\s+number|WhatsApp\s+number|Şikayetiniz\s+Nedir|Sikayetiniz\s+Nedir|Hangi\s+[üu]lkede\s+ya[şs][ıi]yorsunuz|Date\s+of\s+birth|Türkiye'ye\s*\(Konya'ya\)\s+tedavi|Size\s+ne\s+zaman\s+randevu)/i.test(text || '');
}

function getDateContext(now: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);
}

function detectDepartments(text: string, conversation?: any): string[] {
  const clean = normalizeText(`${text}\n${conversation?.department || ''}`);
  const departments: Array<{ label: string; patterns: RegExp[] }> = [
    { label: 'Dermatoloji', patterns: [/\bdermatoloji\b/, /\bcildiye\b/, /\begzama\b/, /\bsac\b/, /\bsaç\b/] },
    { label: 'Kadın Hastalıkları ve Doğum', patterns: [/\bkadin dogum\b/, /\bkadın doğum\b/, /\bjinekoloji\b/, /\bgebelik\b/, /\banne olmak\b/] },
    { label: 'Kardiyoloji', patterns: [/\bkardiyoloji\b/, /\bkalp\b/, /\bnefes darligi\b/, /\bnefes darlığı\b/] },
    { label: 'Ortopedi', patterns: [/\bortopedi\b/, /\bdiz\b/, /\bprotez\b/, /\bkirik\b/, /\bkırık\b/] },
    { label: 'Beyin ve Sinir Cerrahisi', patterns: [/\bbeyin\b/, /\bsinir cerrahisi\b/, /\bbel fitigi\b/, /\bbel fıtığı\b/, /\bboyun fitigi\b/, /\bboyun fıtığı\b/] },
    { label: 'Fizik Tedavi ve Rehabilitasyon', patterns: [/\bfizik tedavi\b/, /\bftr\b/, /\brehabilitasyon\b/] },
    { label: 'Tüp Bebek', patterns: [/\btup bebek\b/, /\btüp bebek\b/, /\bivf\b/, /\btekrar anne\b/] },
    { label: 'Check-up', patterns: [/\bcheck ?up\b/, /\bcheck-up\b/, /\bgenel muayene\b/] },
  ];

  return unique(departments.filter(dept => dept.patterns.some(pattern => pattern.test(clean))).map(dept => dept.label));
}

function formatDoctorDirectory(doctors: Doctor[], departments: string[]): Array<{ department: string; doctors: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const doctor of doctors) {
    const department = doctor.department || departments[0] || 'Genel';
    if (!grouped.has(department)) grouped.set(department, []);
    grouped.get(department)!.push(doctor.name);
  }
  return Array.from(grouped.entries()).map(([department, doctors]) => ({
    department,
    doctors: unique(doctors).slice(0, 8),
  }));
}

function evidenceFor(clean: string, patterns: RegExp[]): string[] {
  return patterns
    .filter(pattern => pattern.test(clean))
    .map(pattern => pattern.source)
    .slice(0, 3);
}

function detectSignals(clean: string, analysisText: string, history: { role: string; content: string }[]): QubaV2GateSignal[] {
  const previousUserText = history.filter(m => m.role === 'user').slice(-8).map(m => m.content || '').join('\n');
  const previousClean = normalizeText(previousUserText);
  const combinedClean = normalizeText(`${previousUserText}\n${analysisText}`);
  const signals: QubaV2GateSignal[] = [];
  const push = (intent: QubaV2GateIntent, condition: boolean, mustAnswer: string, confidence: QubaV2GateSignal['confidence'] = 'high', evidence: string[] = []) => {
    if (!condition || signals.some(signal => signal.intent === intent)) return;
    signals.push({ intent, confidence, evidence, mustAnswer });
  };

  const pricePatterns = [/\b(fiyat|ucret|ücret|tutar|odeme|ödeme|maliyet|paket fiyati|paket fiyatı|ne kadar|ta\s*12|ta12|price|cost|fee|payment)\b/];
  const doctorPatterns = [/\b(doktor|hekim|hoca|hocanin|hocanın|kim var|isim|adi ne|adı ne|kadronuz|araştıracağım|arastiracagim)\b/];
  const accommodationPatterns = [/\b(konaklama|kalacak|otel|transfer|ulasim|ulaşim|ulaşım|nerede kal|accommodation|hotel|stay|transport)\b/];
  const processPatterns = [/\b(surec|süreç|nasil olacak|nasıl olacak|nasil isliyor|nasıl işliyor|asama|aşama|sonraki adim|sonraki adım|process|next step)\b/];
  const appointmentPatterns = [/\b(randevu|aram[aă]|arayin|arayın|telefon|gorusme|görüşme|call|appointment|schedule)\b/];
  const visitPatterns = [/\b(gelecegim|gelecem|gelebilirim|gelmeyi|gelme plani|gelme planı|konya'ya|konyaya|turkiye'ye|türkiye'ye|kazakistan'dan|almanya'dan|ozbekistan'dan|özbekistan'dan)\b/];
  const addressPatterns = [/\b(adres|konum|harita|neredesiniz|nerede|location|address)\b/];
  const countryPatterns = [/\b(almanya|kazakistan|ozbekistan|özbekistan|o'zbekiston|fransa|kanada|hollanda|ukrayna|rusca|rusça|ozbekce|özbekçe|ingilizce|turkce|türkçe)\b/];
  const concernPatterns = [/\b(suphe|şüphe|guven|güven|inanmadim|inanmadım|emin degil|emin değil|kararsiz|kararsız|pahali|pahalı|uzak|endise|endişe)\b/];
  const trustPatterns = [/\b(bot musun|bor musun|botsun|yapay zeka|guvenemedim|güvenemedim|inanmadim|inanmadım|yardimci olamayacaksiniz|yardımcı olamayacaksınız|beni anlamiyorsun|beni anlamıyorsun|unuttun|unutuyorsun|soyledim ya|söyledim ya|dedim ya|sorularima cevap vermedin|sorularıma cevap vermedin)\b/];
  const mediaPatterns = [/\b(gorsel|görsel|fotograf|fotoğraf|resim|rapor|belge|dosya|mr|mrg|em[ae]r|radyoloji|tetkik|sonuc|sonuç|image|photo|document|report)\b/];

  push('price_question', pricePatterns.some(p => p.test(clean)), 'fiyat politikasını güvenli cümleyle yanıtla', 'high', evidenceFor(clean, pricePatterns));
  push('doctor_names', doctorPatterns.some(p => p.test(clean)) && /\b(doktor|hekim|hoca|isim|adi ne|adı ne|kadronuz|araştır|arastir)\b/.test(clean), 'doktor adı sorusunu doğrulanmış listeyle yanıtla', 'high', evidenceFor(clean, doctorPatterns));
  push('doctor_profile', /\b(nasil|nasıl|iyi mi|yorum|basarili|başarılı)\b/.test(clean) && /\b(hoca|doktor|hekim)\b/.test(clean), 'hekim hakkında kişisel yorum yapmadan görev bilgisini ver', 'medium');
  push('accommodation_question', accommodationPatterns.some(p => p.test(clean)), 'konaklama desteğini garanti vermeden açıkla', 'high', evidenceFor(clean, accommodationPatterns));
  push('process_question', processPatterns.some(p => p.test(clean)), 'süreci kısa ve doğal anlat', 'high', evidenceFor(clean, processPatterns));
  push('appointment_or_call_request', appointmentPatterns.some(p => p.test(clean)), 'randevu/arama isteğini gün-saat-saat dilimi netliğiyle ele al', 'high', evidenceFor(clean, appointmentPatterns));
  push('visit_intent', visitPatterns.some(p => p.test(combinedClean)), 'geliş bilgisini tekrar sormadan mevcut planı kullan', 'medium', evidenceFor(combinedClean, visitPatterns));
  push('address_question', addressPatterns.some(p => p.test(clean)), 'adres/konum talebini teşekkür kapanışı yapmadan yanıtla', 'high', evidenceFor(clean, addressPatterns));
  push('language_or_country_signal', countryPatterns.some(p => p.test(clean)), 'ülke/dil bilgisini kabul et; aynı bilgiyi tekrar sorma', 'medium', evidenceFor(clean, countryPatterns));
  push('concern_objection', concernPatterns.some(p => p.test(clean)), 'itirazı veya endişeyi sahiplen; tek doğal devam sorusu sor', 'high', evidenceFor(clean, concernPatterns));
  push('trust_repair', trustPatterns.some(p => p.test(clean)), 'güven kırılmasını kalıp cevapla değil, kısa sahiplenme ve somut yardım seçeneğiyle toparla', 'high', evidenceFor(clean, trustPatterns));
  push('media_or_document', mediaPatterns.some(p => p.test(clean)), 'görsel/rapor/belge ulaştıysa tıbbi yorum vaadi vermeden ne sorduğunu netleştir', 'high', evidenceFor(clean, mediaPatterns));
  push('form_payload', hasStructuredFormPayload(analysisText), 'form başvurusunu gerçek form bağlamıyla karşıla; devam konuşmasında ilk karşılama şablonuna dönme', 'high');

  if (!signals.some(signal => signal.intent === 'doctor_names') && doctorPatterns.some(p => p.test(previousClean)) && trustPatterns.some(p => p.test(clean))) {
    push('doctor_names', true, 'önceki doktor adı talebini kaçırma; doğrulanmış liste varsa paylaş', 'medium');
  }

  return signals;
}

function getPolicySafeResponse(profile: QubaBrainProfile, policyId: string, fallback: string): string {
  const response = profile.policies.find(policy => policy.id === policyId)?.safeResponse;
  return response || fallback;
}

function buildActionDryRuns(signals: QubaV2GateSignal[], clean: string, profile: QubaBrainProfile): QubaV2ActionDryRun[] {
  const hasAppointment = signals.some(signal => signal.intent === 'appointment_or_call_request');
  const hasDoctorAsk = signals.some(signal => signal.intent === 'doctor_names' || signal.intent === 'doctor_profile');
  const hasAnyQuestion = signals.length > 0;
  const dryRuns: QubaV2ActionDryRun[] = [];

  if (hasAppointment) {
    const hasDay = /\b(bugun|bugün|yarin|yarın|pazartesi|sali|salı|carsamba|çarşamba|persembe|perşembe|cuma|cumartesi|pazar|\d{1,2}[./]\d{1,2})\b/.test(clean);
    const hasTime = /\b\d{1,2}[:.]\d{2}\b|\b(sabah|ogle|öğle|aksam|akşam|gece)\b/.test(clean);
    const hasTimezone = /\b(turkiye saati|türkiye saati|yerel saat|almanya saati|kazakistan saati|ozbekistan saati|özbekistan saati)\b/.test(clean);
    const hasConfirmation = /\b(evet|olur|uygun|tamam|onayliyorum|onaylıyorum)\b/.test(clean);
    const requiredMissing = [
      !hasDay ? 'net gün' : '',
      !hasTime ? 'net saat veya saat aralığı' : '',
      !hasTimezone && profile.industry === 'healthcare' ? 'saat dilimi' : '',
      !hasConfirmation ? 'hasta teyidi' : '',
    ].filter(Boolean);

    dryRuns.push({
      action: 'schedule_callback',
      status: requiredMissing.length === 0 ? 'ready' : 'blocked',
      requiredMissing,
      safetyNotes: ['V2 testte gerçek task açılmaz.', 'Pazar ve çalışma saati kontrolü canlı işlem katmanında ayrıca doğrulanır.'],
      humanFacingInstruction: requiredMissing.length > 0
        ? `Sadece eksik parçayı sor: ${requiredMissing.join(', ')}.`
        : 'Slotu doğal dille özetle ve teyit tamamlandıysa arama talebinin iletileceğini söyle.',
    });
  }

  if (hasDoctorAsk) {
    dryRuns.push({
      action: 'collect_info',
      status: 'ready',
      requiredMissing: [],
      safetyNotes: ['Doktorla doğrudan WhatsApp/telefon görüşmesi sözü verilmez.', 'Kişisel yorum veya başarı kıyaslaması yapılmaz.'],
      humanFacingInstruction: 'Doğrulanmış doktor bilgisi varsa paylaş; hekim yorumu istenirse kişisel yorum yapmadan bölüm/görev bilgisinde kal.',
    });
  }

  if (hasAnyQuestion && dryRuns.length === 0) {
    dryRuns.push({
      action: 'answer_only',
      status: 'ready',
      requiredMissing: [],
      safetyNotes: ['Hasta cevabını LLM yazar; kapı sadece sinyal üretir.'],
      humanFacingInstruction: 'Soruyu doğrudan cevapla, gerekirse tek doğal takip sorusu sor.',
    });
  }

  return dryRuns;
}

function buildSummary(contactMode: QubaV2ContactMode, signals: QubaV2GateSignal[], actions: QubaV2ActionDryRun[]): string {
  const modeLabel = contactMode === 'form_lead'
    ? 'formlu ilk temas'
    : contactMode === 'patient_inbound_after_form'
      ? 'form sonrası devam'
      : contactMode === 'continuing_conversation'
        ? 'devam eden konuşma'
        : 'formsuz direkt mesaj';
  const intents = signals.length > 0 ? signals.map(signal => signal.intent).join(', ') : 'genel mesaj';
  const actionText = actions.length > 0 ? actions.map(action => `${action.action}:${action.status}`).join(', ') : 'aksiyon yok';
  return `${modeLabel}; V2 bağımsız kapı sinyalleri: ${intents}; dry-run aksiyon: ${actionText}.`;
}

function toLegacyShadowPlan(result: QubaV2GateResult): BrainV2ShadowPlan {
  return {
    version: 'brain_v2_shadow_v1',
    mode: 'shadow',
    contactMode: result.contactMode,
    detectedIntents: result.detectedIntents,
    mustAnswer: result.mustAnswer,
    verifiedFacts: {
      dateContext: result.verifiedData.dateContext,
      pricePolicy: result.verifiedData.pricePolicy,
      doctorDirectory: result.verifiedData.doctorDirectory,
      accommodationPolicy: result.verifiedData.accommodationPolicy,
      knownFacts: result.verifiedData.knownFacts,
    },
    missingInformation: result.missingInformation,
    forbiddenClaims: result.forbiddenClaims,
    riskFlags: result.riskFlags,
    recommendedFollowUp: result.recommendedFollowUp,
    summary: result.summary,
  };
}

export class QubaV2GateEngine {
  public static build(params: BuildParams): QubaV2GateResult {
    const inboundText = params.inboundText || '';
    const history = params.history || [];
    const analysisText = buildRecentUserWindow(inboundText, history);
    const clean = normalizeText(analysisText);
    const currentClean = normalizeText(inboundText);
    const hasCurrentFormPayload = hasStructuredFormPayload(inboundText);
    const hasAnyFormPayload = hasCurrentFormPayload || history.some(m => hasStructuredFormPayload(m.content || '')) || !!params.latestForm;
    const contactMode: QubaV2ContactMode = hasCurrentFormPayload
      ? 'form_lead'
      : hasAnyFormPayload
        ? 'patient_inbound_after_form'
        : history.length > 0
          ? 'continuing_conversation'
          : 'direct_inbound';

    const signals = detectSignals(currentClean, analysisText, history);
    const departments = detectDepartments(analysisText, params.conversation);
    const allDoctors = DoctorDirectoryResolver.getDoctors(params.brain);
    const scopedDoctors = departments.length > 0
      ? departments.flatMap(department => DoctorDirectoryResolver.getDoctors(params.brain, department))
      : allDoctors;
    const doctorDirectory = formatDoctorDirectory(scopedDoctors.length > 0 ? scopedDoctors : allDoctors, departments);
    const detectedIntents = unique(signals.map(signal => signal.intent));
    const hasIntent = (intent: QubaV2GateIntent) => detectedIntents.includes(intent);

    const mustAnswer = unique(signals.map(signal => signal.mustAnswer));
    if (hasIntent('price_question') && /\b(fiyat|ucret|ücret|ne kadar|maliyet)\b/.test(clean)) {
      const previousAssistantText = history.filter(m => m.role === 'assistant').slice(-4).map(m => m.content || '').join('\n');
      if (/net\s+fiyat\s+payla[şs]am[ıi]yorum|fiyat\s+bilgisi,\s*hastanedeki\s+de[ğg]erlendirme/i.test(previousAssistantText)) {
        mustAnswer.push('fiyat sorusu tekrarlandıysa aynı kalıbı tekrarlama; danışman görüşmesini seçenek olarak sun');
      }
    }

    const missingInformation: string[] = [];
    if (hasIntent('doctor_names') && departments.length === 0) missingInformation.push('doktor adı için bölüm');
    if (hasIntent('doctor_names') && doctorDirectory.length === 0) missingInformation.push('doğrulanmış doktor listesi');

    const dryRunActions = buildActionDryRuns(signals, clean, params.profile);
    for (const action of dryRunActions) {
      missingInformation.push(...action.requiredMissing);
    }

    const forbiddenClaims = unique([
      ...params.profile.policies.flatMap(policy => policy.forbiddenClaims || []),
      'kesin tanı veya tedavi sözü verme',
      'doktor adı uydurma',
      'yaklaşık/net/indirimli fiyat verme',
      'konaklama garantisi veya rezervasyon sözü verme',
      'doktorla doğrudan WhatsApp/telefon görüşmesi sözü verme',
      'form yoksa form varmış gibi konuşma',
    ]);

    const riskFlags: string[] = [];
    if (signals.length >= 2) riskFlags.push('multi_intent_must_answer_all');
    if (hasIntent('price_question')) riskFlags.push('price_amount_forbidden');
    if (hasIntent('doctor_names') && doctorDirectory.length === 0) riskFlags.push('doctor_directory_missing_or_unscoped');
    if (hasIntent('accommodation_question')) riskFlags.push('accommodation_no_guarantee');
    if (hasIntent('trust_repair')) riskFlags.push('trust_repair_needed');
    if (hasIntent('media_or_document')) riskFlags.push('media_no_diagnosis_or_review_promise');
    if (/form doldur/i.test(analysisText) && !hasAnyFormPayload) riskFlags.push('user_claims_form_without_verified_form');
    const ambiguousVisitDate = /\b(7\s*14|7[./]14|7\s*8|7[./]8)\b/.test(clean) &&
      /\b(turkiye|türkiye|konya|gelecem|gelecegim|gelicem|gelmeyi|gelme|geleceğim)\b/.test(clean);
    if (ambiguousVisitDate) riskFlags.push('ambiguous_date_needs_clarification');

    let recommendedFollowUp: string | undefined;
    if (ambiguousVisitDate) {
      recommendedFollowUp = /\b(7\s*8|7[./]8)\b/.test(clean)
        ? '7 8 derken, 8 Temmuz mu yoksa 7-8 Temmuz arası mı?'
        : '7 14 derken, 14 Temmuz mu yoksa 7-14 Temmuz arası mı?';
    } else if (hasIntent('doctor_names') && doctorDirectory.length > 0) {
      recommendedFollowUp = 'Doktor isimlerini paylaş; kişisel yorum istenirse yorum/başarı kıyaslaması yapma.';
    } else if (hasIntent('accommodation_question')) {
      recommendedFollowUp = 'Konaklama sorusunu doğrudan yanıtla; tekrar “hangi başlık” diye sorma.';
    } else if (hasIntent('trust_repair')) {
      recommendedFollowUp = 'Önce güven kırılmasını sahiplen; ardından sorulan somut başlığı cevapla.';
    }

    const responseDirectives = [
      'Hasta-facing cevap yazma yetkisi LLM + V2 Brain’dedir; kapı sadece sinyal üretir.',
      'Sorulan somut başlığı atlama.',
      'Tek cevapta en fazla bir doğal takip sorusu sor.',
      'Devam eden konuşmada kurum/asistan tanıtımını tekrar etme.',
      'Bey, Hanım, Sayın, Bayan kullanma.',
      '“Hangi konuda bilgi almak istiyorsunuz?” kaçışını kullanma.',
    ];

    const result: QubaV2GateResult = {
      version: 'quba_v2_gate_v1',
      engine: 'quba_v2_independent',
      mode: 'sandbox',
      usedLegacyRuntimeGates: false,
      contactMode,
      detectedIntents,
      signals,
      mustAnswer: unique(mustAnswer),
      verifiedData: {
        dateContext: getDateContext(params.now || new Date()),
        pricePolicy: hasIntent('price_question') ? getPolicySafeResponse(params.profile, 'healthcare_price_policy', FALLBACK_PRICE_POLICY) : undefined,
        doctorDirectory: hasIntent('doctor_names') || hasIntent('doctor_profile') ? doctorDirectory : undefined,
        accommodationPolicy: hasIntent('accommodation_question') ? getPolicySafeResponse(params.profile, 'healthcare_accommodation_policy', FALLBACK_ACCOMMODATION_POLICY) : undefined,
      },
      missingInformation: unique(missingInformation),
      forbiddenClaims,
      riskFlags: unique(riskFlags),
      dryRunActions,
      responseDirectives,
      recommendedFollowUp,
      summary: buildSummary(contactMode, signals, dryRunActions),
    };

    return result;
  }

  public static buildSandboxPromptDirective(result: QubaV2GateResult): string {
    const lines: string[] = [
      '',
      '[QUBA V2 GATE ENGINE - BAĞIMSIZ SANDBOX]',
      'Bu blok eski canlı kapıların hasta-facing cevaplarını kullanmaz; sadece V2 test cevabını yönlendiren sinyaldir.',
      `Motor: ${result.engine}; eski kapı kullanımı: ${result.usedLegacyRuntimeGates ? 'var' : 'yok'}.`,
      `Konuşma modu: ${result.contactMode}.`,
      `Özet: ${result.summary}`,
    ];

    if (result.detectedIntents.length > 0) lines.push(`Algılanan başlıklar: ${result.detectedIntents.join(', ')}.`);
    if (result.mustAnswer.length > 0) lines.push(`Cevapta mutlaka ele al: ${result.mustAnswer.join(' | ')}.`);
    if (result.missingInformation.length > 0) lines.push(`Eksikse tek kısa soruyla netleştir: ${result.missingInformation.join(', ')}.`);
    if (result.verifiedData.pricePolicy) lines.push(`Fiyat politikası: ${result.verifiedData.pricePolicy}`);
    if (result.verifiedData.accommodationPolicy) lines.push(`Konaklama politikası: ${result.verifiedData.accommodationPolicy}`);
    if (result.verifiedData.doctorDirectory && result.verifiedData.doctorDirectory.length > 0) {
      lines.push(`Doğrulanmış doktor bilgisi: ${result.verifiedData.doctorDirectory.slice(0, 4).map(block => `${block.department}: ${block.doctors.join(', ')}`).join(' | ')}`);
    }
    if (result.dryRunActions.length > 0) {
      lines.push(`Dry-run aksiyon: ${result.dryRunActions.map(action => `${action.action}/${action.status}${action.requiredMissing.length > 0 ? ` eksik: ${action.requiredMissing.join(', ')}` : ''}`).join(' | ')}`);
    }
    if (result.recommendedFollowUp) lines.push(`Önerilen yön: ${result.recommendedFollowUp}`);
    if (result.forbiddenClaims.length > 0) lines.push(`Kesin yasaklar: ${result.forbiddenClaims.slice(0, 10).join(' | ')}`);
    lines.push(...result.responseDirectives);
    lines.push('[/QUBA V2 GATE ENGINE]');
    return lines.join('\n');
  }

  public static toLegacyShadowPlan(result: QubaV2GateResult): BrainV2ShadowPlan {
    return toLegacyShadowPlan(result);
  }
}
