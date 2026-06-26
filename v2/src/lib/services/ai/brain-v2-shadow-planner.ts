import type { TenantBrain } from '../../brain/tenant-brain';
import { ConversationIntentRouter } from './conversation-intent-router';
import { ConversationKnownFactsResolver } from './conversation-known-facts-resolver';
import { DoctorDirectoryResolver, type Doctor } from './doctor-directory-resolver';
import { isDoctorNameRequestText, isDoctorProfileQuestionText } from './doctor-names-policy';
import { MultiIntentConsultantComposer } from './multi-intent-consultant-composer';

export type BrainV2ContactMode =
  | 'form_lead'
  | 'direct_inbound'
  | 'continuing_conversation'
  | 'patient_inbound_after_form';

export interface BrainV2ShadowPlan {
  version: 'brain_v2_shadow_v1';
  mode: 'shadow';
  contactMode: BrainV2ContactMode;
  detectedIntents: string[];
  mustAnswer: string[];
  verifiedFacts: {
    dateContext: string;
    pricePolicy?: string;
    doctorDirectory?: Array<{ department: string; doctors: string[] }>;
    accommodationPolicy?: string;
    knownFacts?: string[];
  };
  missingInformation: string[];
  forbiddenClaims: string[];
  riskFlags: string[];
  recommendedFollowUp?: string;
  summary: string;
}

interface BuildParams {
  inboundText: string;
  history?: { role: string; content: string }[];
  brain: TenantBrain;
  channel?: string;
  now?: Date;
  conversation?: any;
  opportunity?: any;
  profile?: any;
  latestForm?: any;
}

type IntentFlag =
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

const PRICE_POLICY =
  'Fiyat bilgisi, hastanedeki değerlendirme ve planlanacak sürece göre değiştiği için buradan net fiyat paylaşamıyorum.';

function normalizeText(text: string): string {
  return (text || '')
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

function buildRecentUserWindow(inboundText: string, history: { role: string; content: string }[] = []): string {
  const tail: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg?.role === 'assistant') break;
    if (msg?.role === 'user' && msg.content) {
      tail.unshift(msg.content);
    }
  }
  const parts = [...tail, inboundText].map(t => String(t || '').trim()).filter(Boolean);
  return Array.from(new Set(parts)).join('\n');
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function hasStructuredFormPayload(text: string): boolean {
  return /(?:Full\s+name|Phone\s+number|WhatsApp\s+number|Şikayetiniz\s+Nedir|Sikayetiniz\s+Nedir|Hangi\s+[üu]lkede\s+ya[şs][ıi]yorsunuz|Date\s+of\s+birth|Türkiye'ye\s*\(Konya'ya\)\s+tedavi|Size\s+ne\s+zaman\s+randevu)/i.test(text || '');
}

function hasPriceQuestion(clean: string): boolean {
  return /\b(fiyat|ucret|ücret|tutar|odeme|ödeme|maliyet|paket fiyati|paket fiyatı|ne kadar|ta\s*12|ta12|price|cost|fee|payment)\b/.test(clean);
}

function hasAccommodationQuestion(clean: string): boolean {
  return /\b(konaklama|kalacak|otel|transfer|ulasim|ulaşim|ulaşım|nerede kal|accommodation|hotel|stay|transport)\b/.test(clean);
}

function hasProcessQuestion(clean: string): boolean {
  return /\b(surec|süreç|nasil olacak|nasıl olacak|nasil isliyor|nasıl işliyor|asama|aşama|sonraki adim|sonraki adım|process|next step)\b/.test(clean);
}

function hasAppointmentOrCall(clean: string): boolean {
  return /\b(randevu|aram[aă]|arayin|arayın|telefon|gorusme|görüşme|call|appointment|schedule)\b/.test(clean);
}

function hasVisitIntent(clean: string): boolean {
  return /\b(gelecegim|gelecem|gelebilirim|gelmeyi|gelme plani|gelme planı|konya'ya|konyaya|turkiye'ye|türkiye'ye|kazakistan'dan|almanya'dan|ozbekistan'dan|özbekistan'dan)\b/.test(clean);
}

function hasAddressQuestion(clean: string): boolean {
  return /\b(adres|konum|harita|neredesiniz|nerede|location|address)\b/.test(clean);
}

function hasConcern(clean: string): boolean {
  return /\b(suphe|şüphe|guven|güven|inanmadim|inanmadım|emin degil|emin değil|kararsiz|kararsız|pahali|pahalı|uzak|endise|endişe)\b/.test(clean);
}

function hasTrustRepairSignal(clean: string): boolean {
  return /\b(bot musun|botsun|yapay zeka|guvenemedim|güvenemedim|inanmadim|inanmadım|yardimci olamayacaksiniz|yardımcı olamayacaksınız|beni anlamiyorsun|beni anlamıyorsun|sorularima cevap vermedin|sorularıma cevap vermedin)\b/.test(clean);
}

function hasMediaOrDocumentSignal(clean: string): boolean {
  return /\b(gorsel|görsel|fotograf|fotoğraf|resim|rapor|belge|dosya|mr|mrg|em[ae]r|radyoloji|tetkik|sonuc|sonuç|image|photo|document|report)\b/.test(clean);
}

function hasCountryOrLanguageSignal(clean: string): boolean {
  return /\b(almanya|kazakistan|ozbekistan|özbekistan|o'zbekiston|fransa|kanada|hollanda|rusca|rusça|ozbekce|özbekçe|ingilizce|turkce|türkçe)\b/.test(clean);
}

function detectDepartments(text: string, history: { role: string; content: string }[] = [], conversation?: any): string[] {
  const combined = [text, ...history.slice(-8).map(m => m.content || ''), conversation?.department || ''].join('\n');
  const clean = normalizeText(combined);
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

  const found: string[] = [];
  for (const dept of departments) {
    if (dept.patterns.some(pattern => pattern.test(clean))) found.push(dept.label);
  }
  return unique(found);
}

function formatDoctorDirectory(doctors: Doctor[], departments: string[]): Array<{ department: string; doctors: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const doctor of doctors) {
    const dept = doctor.department || departments[0] || 'Genel';
    if (!grouped.has(dept)) grouped.set(dept, []);
    grouped.get(dept)!.push(doctor.name);
  }
  return Array.from(grouped.entries()).map(([department, names]) => ({
    department,
    doctors: unique(names).slice(0, 8)
  }));
}

function getDateContext(now: Date): string {
  const formatter = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  return formatter.format(now);
}

function buildSummary(contactMode: BrainV2ContactMode, flags: string[], mustAnswer: string[]): string {
  const scope = contactMode === 'form_lead'
    ? 'form başvurusu'
    : contactMode === 'patient_inbound_after_form'
      ? 'form sonrası hasta mesajı'
      : contactMode === 'continuing_conversation'
        ? 'devam eden konuşma'
        : 'doğrudan gelen mesaj';
  const intentText = flags.length > 0 ? flags.join(', ') : 'tekil/genel mesaj';
  const answerText = mustAnswer.length > 0 ? mustAnswer.join(', ') : 'tek doğal takip sorusu';
  return `${scope}; algılanan başlıklar: ${intentText}; cevabın kaçırmaması gerekenler: ${answerText}.`;
}

export class BrainV2ShadowPlanner {
  public static buildSandboxPromptDirective(plan: BrainV2ShadowPlan): string {
    const lines: string[] = [
      '',
      '[BRAIN V2 TEST REHBERI - SADECE SANDBOX]',
      'Bu blok canlı hastalara gönderilmez; test alanında cevabı daha doğru üretmek için kullanılır.',
      `Konuşma modu: ${plan.contactMode}.`,
    ];

    if (plan.detectedIntents.length > 0) {
      lines.push(`Algılanan başlıklar: ${plan.detectedIntents.slice(0, 8).join(', ')}.`);
    }
    if (plan.mustAnswer.length > 0) {
      lines.push(`Cevapta mutlaka ele al: ${plan.mustAnswer.join(' | ')}.`);
    }
    if (plan.missingInformation.length > 0) {
      lines.push(`Eksikse tek kısa soruyla netleştir: ${plan.missingInformation.join(', ')}.`);
    }
    if (plan.verifiedFacts.pricePolicy) {
      lines.push(`Fiyat politikası: ${plan.verifiedFacts.pricePolicy}`);
    }
    if (plan.verifiedFacts.accommodationPolicy) {
      lines.push(`Konaklama politikası: ${plan.verifiedFacts.accommodationPolicy}`);
    }
    if (plan.verifiedFacts.doctorDirectory && plan.verifiedFacts.doctorDirectory.length > 0) {
      const doctorLines = plan.verifiedFacts.doctorDirectory
        .slice(0, 3)
        .map(block => `${block.department}: ${block.doctors.slice(0, 6).join(', ')}`);
      lines.push(`Doğrulanmış doktor bilgisi: ${doctorLines.join(' | ')}`);
    }
    if (plan.verifiedFacts.knownFacts && plan.verifiedFacts.knownFacts.length > 0) {
      lines.push(`Bilinen konuşma gerçekleri: ${plan.verifiedFacts.knownFacts.slice(0, 5).join(' | ')}`);
    }
    if (plan.recommendedFollowUp) {
      lines.push(`Önerilen yön: ${plan.recommendedFollowUp}`);
    }
    if (plan.forbiddenClaims.length > 0) {
      lines.push(`Kesin yasaklar: ${plan.forbiddenClaims.join(' | ')}.`);
    }
    if (plan.riskFlags.length > 0) {
      lines.push(`Risk işaretleri: ${plan.riskFlags.join(', ')}.`);
    }

    lines.push(
      'Cevabı hazır kalıp gibi değil, doğal hasta danışmanı diliyle yaz.',
      'Kullanıcı birden fazla soru sorduysa hiçbirini atlama.',
      'Hastaya ismiyle hitap etme; Bey, Hanım, Sayın, Bay, Bayan kullanma.',
      'Devam eden konuşmada kendini veya kurumu tekrar tanıtma; doğrudan son soruya cevap ver.',
      'Kullanıcı sadece adını yazdıysa kısa kabul et ve akışın eksik bilgisini tek doğal soruyla sor.',
      'Kullanıcı "olur", "evet", "gelebilirim" gibi olumlu yanıt verdiyse konuşmayı kapatma; eksikse ülke veya yaklaşık geliş dönemini netleştir.',
      'Eski/generic kaçış cümlelerine dönme: "Hangi konuda bilgi almak istiyorsunuz?" gibi cevap verme.',
      '[/BRAIN V2 TEST REHBERI]'
    );

    return lines.join('\n');
  }

  public static build(params: BuildParams): BrainV2ShadowPlan {
    const inboundText = params.inboundText || '';
    const history = params.history || [];
    const analysisText = buildRecentUserWindow(inboundText, history);
    const clean = normalizeText(analysisText);
    const recentUserContextText = [
      ...history
        .slice(-10)
        .filter(m => m.role === 'user')
        .map(m => m.content || ''),
      inboundText
    ].join('\n');
    const recentUserContextClean = normalizeText(recentUserContextText);
    const hasCurrentFormPayload = hasStructuredFormPayload(inboundText);
    const hasAnyFormPayload = hasCurrentFormPayload || history.some(m => hasStructuredFormPayload(m.content || '')) || !!params.latestForm;

    const contactMode: BrainV2ContactMode = hasCurrentFormPayload
      ? 'form_lead'
      : hasAnyFormPayload
        ? 'patient_inbound_after_form'
        : history.length > 0
          ? 'continuing_conversation'
          : 'direct_inbound';

    const routerIntents = ConversationIntentRouter.routeAll(analysisText);
    const multiIntents = MultiIntentConsultantComposer.detectIntentList(analysisText);
    const flags: IntentFlag[] = [];
    const pushFlag = (flag: IntentFlag, condition: boolean) => {
      if (condition && !flags.includes(flag)) flags.push(flag);
    };

    const allDoctors = DoctorDirectoryResolver.getDoctors(params.brain);
    const doctorNameAsk = isDoctorNameRequestText(analysisText, history.some(m => m.role === 'user' && isDoctorNameRequestText(m.content || '', false)));
    const trustRepairSignal = hasTrustRepairSignal(clean);
    const recentDoctorNameAsk = isDoctorNameRequestText(recentUserContextText, true);
    const recentPriceQuestion = hasPriceQuestion(recentUserContextClean);
    const doctorProfileAsk = !hasCurrentFormPayload && isDoctorProfileQuestionText(analysisText, allDoctors);
    const explicitAccommodationQuestion = hasAccommodationQuestion(clean);

    pushFlag('price_question', hasPriceQuestion(clean) || (trustRepairSignal && recentPriceQuestion) || multiIntents.includes('price_question') || routerIntents.includes('price_question'));
    pushFlag('doctor_names', doctorNameAsk || (trustRepairSignal && recentDoctorNameAsk) || multiIntents.includes('doctor_names') || routerIntents.includes('doctor_lookup'));
    pushFlag('doctor_profile', doctorProfileAsk);
    pushFlag('accommodation_question', explicitAccommodationQuestion || (!hasCurrentFormPayload && multiIntents.includes('logistics_question')));
    pushFlag('process_question', hasProcessQuestion(clean) || multiIntents.includes('process_question') || routerIntents.includes('process_question'));
    pushFlag('appointment_or_call_request', hasAppointmentOrCall(clean) || routerIntents.includes('call_scheduling_request'));
    pushFlag('visit_intent', hasVisitIntent(clean) || routerIntents.includes('arrival_date_answer'));
    pushFlag('address_question', hasAddressQuestion(clean) || multiIntents.includes('address_question') || routerIntents.includes('address_full_request') || routerIntents.includes('location_direction'));
    pushFlag('form_payload', hasCurrentFormPayload);
    pushFlag('language_or_country_signal', hasCountryOrLanguageSignal(clean));
    pushFlag('concern_objection', hasConcern(clean) || multiIntents.includes('concern_objection') || routerIntents.includes('distance_objection'));
    pushFlag('trust_repair', trustRepairSignal);
    pushFlag('media_or_document', hasMediaOrDocumentSignal(clean));

    const previousAssistantText = history
      .filter(m => m.role === 'assistant')
      .slice(-4)
      .map(m => m.content || '')
      .join('\n');
    const priceAlreadyAnswered = /buradan\s+net\s+fiyat\s+payla[şs]am[ıi]yorum|fiyat\s+bilgisi,\s*hastanedeki\s+de[ğg]erlendirme/i.test(previousAssistantText);

    const detectedIntents = unique([...routerIntents.filter(i => i !== 'generic_other'), ...multiIntents, ...flags]);
    const departments = detectDepartments(`${analysisText}\n${trustRepairSignal ? recentUserContextText : ''}`, history, params.conversation);
    const scopedDoctors = departments.length > 0
      ? departments.flatMap(dept => DoctorDirectoryResolver.getDoctors(params.brain, dept))
      : allDoctors;
    const doctorDirectory = formatDoctorDirectory(scopedDoctors.length > 0 ? scopedDoctors : allDoctors, departments);

    let knownFacts: string[] = [];
    try {
      const facts = ConversationKnownFactsResolver.resolve({
        history,
        opportunity: params.opportunity,
        profile: params.profile,
        latestForm: params.latestForm,
        conversation: params.conversation
      });
      knownFacts = ConversationKnownFactsResolver.formatFacts(facts).slice(0, 8);
    } catch {
      knownFacts = [];
    }

    const mustAnswer: string[] = [];
    if (flags.includes('price_question')) mustAnswer.push('fiyat politikasını güvenli cümleyle yanıtla');
    if (flags.includes('doctor_names')) mustAnswer.push('doktor adı sorusunu doğrulanmış listeyle yanıtla');
    if (flags.includes('doctor_profile')) mustAnswer.push('hekim hakkında kişisel yorum yapmadan görev bilgisini ver');
    if (flags.includes('accommodation_question')) mustAnswer.push('konaklama desteğini garanti vermeden açıkla');
    if (flags.includes('process_question')) mustAnswer.push('süreci kısa ve doğal anlat');
    if (flags.includes('appointment_or_call_request')) mustAnswer.push('randevu/arama isteğini gün-saat-saat dilimi netliğiyle ele al');
    if (flags.includes('visit_intent')) mustAnswer.push('geliş bilgisini tekrar sormadan mevcut planı kullan');
    if (flags.includes('address_question')) mustAnswer.push('adres/konum talebini teşekkür kapanışı yapmadan yanıtla');
    if (flags.includes('language_or_country_signal')) mustAnswer.push('ülke/dil bilgisini kabul et; aynı bilgiyi tekrar sorma');
    if (flags.includes('trust_repair')) mustAnswer.push('güven kırılmasını kalıp cevapla değil, kısa sahiplenme ve somut yardım seçeneğiyle toparla');
    if (flags.includes('media_or_document')) mustAnswer.push('görsel/rapor/belge ulaştıysa tıbbi yorum vaadi vermeden ne sorduğunu netleştir');
    if (flags.includes('price_question') && priceAlreadyAnswered) mustAnswer.push('fiyat sorusu tekrarlandıysa aynı kalıbı tekrarlama; danışmanla telefon görüşmesini seçenek olarak sun');

    const missingInformation: string[] = [];
    if (flags.includes('doctor_names') && departments.length === 0) missingInformation.push('doktor adı için bölüm');
    if (flags.includes('doctor_names') && doctorDirectory.length === 0) missingInformation.push('doğrulanmış doktor listesi');
    if (flags.includes('appointment_or_call_request') && !/\b(?:bugun|bugün|yarin|yarın|pazartesi|sali|salı|carsamba|çarşamba|persembe|perşembe|cuma|cumartesi|pazar|\d{1,2}[:.]\d{2})\b/.test(clean)) {
      missingInformation.push('randevu/arama için net gün ve saat');
    }

    const forbiddenClaims = [
      'kesin tanı veya tedavi sözü verme',
      'doktor adı uydurma',
      'yaklaşık/net/indirimli fiyat verme',
      'konaklama garantisi veya rezervasyon sözü verme',
      'doktorla doğrudan WhatsApp/telefon görüşmesi sözü verme',
      'form yoksa form varmış gibi konuşma'
    ];

    const riskFlags: string[] = [];
    if (flags.length >= 2) riskFlags.push('multi_intent_must_answer_all');
    if (flags.includes('price_question')) riskFlags.push('price_amount_forbidden');
    if (flags.includes('doctor_names') && doctorDirectory.length === 0) riskFlags.push('doctor_directory_missing_or_unscoped');
    if (flags.includes('accommodation_question')) riskFlags.push('accommodation_no_guarantee');
    if (flags.includes('trust_repair')) riskFlags.push('trust_repair_needed');
    if (flags.includes('media_or_document')) riskFlags.push('media_no_diagnosis_or_review_promise');
    if (flags.includes('price_question') && priceAlreadyAnswered) riskFlags.push('repeated_price_needs_handoff_option');
    if (/form doldur/i.test(analysisText) && !hasAnyFormPayload) riskFlags.push('user_claims_form_without_verified_form');
    if (/\b(7\s*14|7[./]14)\b/.test(clean)) riskFlags.push('ambiguous_date_needs_clarification');
    if (/\b(hangi konuda bilgi almak istiyorsunuz|size saglik talebinizle ilgili yardimci olayim)\b/.test(clean)) riskFlags.push('generic_escape_phrase_seen');

    let recommendedFollowUp: string | undefined;
    if (/\b(7\s*14|7[./]14)\b/.test(clean)) {
      recommendedFollowUp = '7 14 derken, 14 Temmuz mu yoksa 7-14 Temmuz arası mı?';
    } else if (flags.includes('doctor_names') && doctorDirectory.length > 0) {
      recommendedFollowUp = 'Doktor isimlerini paylaş; hekim hakkında kişisel yorum istenirse yorum/başarı kıyaslaması yapma.';
    } else if (flags.includes('accommodation_question')) {
      recommendedFollowUp = 'Konaklama sorusunu doğrudan yanıtla; tekrar "hangi başlık" diye sorma.';
    } else if (flags.includes('price_question') && priceAlreadyAnswered) {
      recommendedFollowUp = 'Fiyat kalıbını tekrar etmek yerine, bu detayları hasta danışmanıyla telefon görüşmesinde netleştirebileceğini söyle ve uygunsa gün/saat sor.';
    } else if (flags.includes('trust_repair')) {
      recommendedFollowUp = 'Önce güven kırılmasını sahiplen; sonra sorulan somut başlığı yanıtla veya danışman görüşmesini seçenek olarak sun.';
    } else if (flags.includes('media_or_document')) {
      recommendedFollowUp = 'Belgenin/görselin ulaştığını söyle; tıbbi yorum yapmadan kullanıcının ne öğrenmek istediğini sor.';
    } else if (flags.includes('appointment_or_call_request') && missingInformation.length > 0) {
      recommendedFollowUp = 'Randevu/arama için eksik olan gün, saat veya saat dilimini tek kısa soruyla netleştir.';
    } else if (flags.includes('price_question')) {
      recommendedFollowUp = 'Fiyatı güvenli cümleyle yanıtla; hasta başka başlık da sorduysa onları aynı cevapta kaçırma.';
    } else if (flags.includes('language_or_country_signal')) {
      recommendedFollowUp = 'Ülke veya tercih edilen dil bilgisini kabul et; konuşmayı önceki sağlık talebi üzerinden sürdür.';
    }

    return {
      version: 'brain_v2_shadow_v1',
      mode: 'shadow',
      contactMode,
      detectedIntents,
      mustAnswer: unique(mustAnswer),
      verifiedFacts: {
        dateContext: getDateContext(params.now || new Date()),
        pricePolicy: flags.includes('price_question') ? PRICE_POLICY : undefined,
        doctorDirectory: flags.includes('doctor_names') || flags.includes('doctor_profile') ? doctorDirectory : undefined,
        accommodationPolicy: flags.includes('accommodation_question')
          ? 'Hastaneye yakın konaklama seçenekleri ve anlaşmalı oteller için ekip danışmanlık yapabilir; garanti veya rezervasyon sözü verilmez.'
          : undefined,
        knownFacts: knownFacts.length > 0 ? knownFacts : undefined
      },
      missingInformation: unique(missingInformation),
      forbiddenClaims,
      riskFlags: unique(riskFlags),
      recommendedFollowUp,
      summary: buildSummary(contactMode, flags, unique(mustAnswer))
    };
  }
}
