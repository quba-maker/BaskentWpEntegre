import { normalizeFormValue } from './normalize-form-value';

export interface FormSlots {
  complaintText: string;
  durationText: string;
  bodyPart: string;
  conditionTerms: string[];
  departmentHint: string;
  livingCity: string;
  requestedAppointmentText: string;
  age: string;
  formName: string;
  campaignName: string;
}

export type DraftPurpose = 'first_contact_intent_check' | 'detailed_medical_inquiry';

// Helper to normalize Turkish typos
export function normalizeTurkishTypos(text: string): string {
  if (!text) return "";
  let res = text.toLowerCase().trim();
  
  // Custom normalization for silent/stent typos
  if (res.includes("silent takili") || res.includes("silent takılı") || res.includes("sitent") || res.includes("stend")) {
    res = res.replace(/silent takili|silent takılı|sitent takili|stend takili/g, "stent takılı");
  }

  const replacements: [RegExp, string][] = [
    [/agrisi/g, "ağrısı"],
    [/agri/g, "ağrı"],
    [/kikirdak/g, "kıkırdak"],
    [/kirecleme/g, "kireçlenme"],
    [/sislik/g, "şişlik"],
    [/takili/g, "takılı"],
    [/dorgu/g, "doğru"]
  ];
  for (const [rx, rep] of replacements) {
    res = res.replace(rx, rep);
  }
  return res;
}

// Helper to clean and normalize complaint texts (remove greetings/typos)
export function cleanComplaintGreeting(text: string): string {
  if (!text) return "";
  let clean = text.trim();
  
  // Remove greetings and personal pronouns at start
  const greetingPattern = /^(merhaba|selam|selamlar|iyi günler|iyi gunler|iyi akşamlar|iyi aksamlar|mrb|slm|benim|ben|adım|ismim|adım soyadım|ad soyad|şikayetim|sikayetim|rahatsızlığım|rahatsizligim|şikayetimiz|sikayetimiz)\s+/i;
  let prev = "";
  while (clean !== prev) {
    prev = clean;
    clean = clean.replace(greetingPattern, "").trim();
  }

  // Remove leading punctuation if any (like commas, dashes, colons)
  clean = clean.replace(/^[\s.,:;\-—–]+/, '').trim();
  
  // Normalize typical patient grammar typos
  clean = clean
    .replace(/\bayagime\b/gi, "ayağıma")
    .replace(/\bayagıma\b/gi, "ayağıma")
    .replace(/\bbacagime\b/gi, "bacağıma")
    .replace(/\bbacagıma\b/gi, "bacağıma")
    .replace(/\bagriyor\b/gi, "ağrıyor")
    .replace(/\bcok\b/gi, "çok");

  return clean;
}

// Clean internal technical patterns
export function sanitizeCampaignString(text: string): string {
  if (!text) return "";
  let clean = text;
  const regexes = [
    /\d{4,}_/g, // e.g. 2026_
    /_FUNNEL/gi,
    /TR_/gi,
    /AVRUPA/gi,
    /ORTA_ASYA/gi,
    /campaign/gi,
    /adset/gi,
    /leadgen/gi,
    /form_id/gi,
    /funnel/gi
  ];
  for (const rx of regexes) {
    clean = clean.replace(rx, "");
  }
  return clean.replace(/_+/g, " ").trim();
}

// Extract field dynamically considering various naming configurations
function extractField(data: any, keys: string[]): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  
  const normalize = (str: string) => str.toLowerCase().replace(/_/g, '').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/\s+/g, '');

  const normalizedKeys = keys.map(k => normalize(k));

  for (const [key, value] of Object.entries(data)) {
    const normKey = normalize(key);
    if (normalizedKeys.some(k => normKey.includes(k))) {
      if (value) return String(value).trim();
    }
  }
  return undefined;
}

function getMonthNameFromNumber(numStr: string): string {
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  const n = parseInt(numStr, 10);
  if (n >= 1 && n <= 12) {
    return months[n-1];
  }
  return "ilgili";
}

function hasExplicitFormSignal(rawData: any, defaultFormName?: string, slots?: FormSlots): boolean {
  if (defaultFormName && defaultFormName.trim().length > 0) return true;
  if (rawData && typeof rawData === 'object' && Object.keys(rawData).length > 0) return true;
  if (typeof rawData === 'string' && rawData.trim().length > 0) return true;
  if (!slots) return false;
  return Boolean(
    slots.formName ||
    slots.campaignName ||
    slots.complaintText ||
    slots.requestedAppointmentText ||
    slots.livingCity ||
    slots.age
  );
}

// 1. Slot Extractor Layer
export function extractFormSlots(rawData: any, defaultFormName?: string): FormSlots {
  const data = typeof rawData === 'string' ? JSON.parse(rawData || '{}') : (rawData || {});

  const complaintRaw = extractField(data, ['şikayetiniz_nedir', 'sikayetiniz_nedir', 'şikayet', 'sikayet', 'rahatsızlık', 'rahatsizlık', 'complaint', 'problem', 'başvuru_nedeni', 'basvuru_nedeni']);
  const durationRaw = extractField(data, ['duration', 'ne_zaman_başladı', 'şikayetiniz_ne_zaman_başladı', 'ne_zamandir', 'ne zamandır']);
  const livingCityRaw = extractField(data, ['nerede_yaşıyorsunuz', 'country', 'city', 'sehir', 'şehir', 'ulke', 'ülke', 'yaşadığınız_yer']);
  const requestedAppointmentRaw = extractField(data, ['size_ne_zaman_randevu_oluşturmamızı_istersiniz', 'randevu_tarihi', 'ne_zaman_gelmek_istersiniz', 'appointment_date']);
  const ageRaw = extractField(data, ['yaşınız', 'yaş', 'yas', 'age']);
  const formNameRaw = data.form_name || defaultFormName || "";
  const campaignRaw = extractField(data, ['campaign', 'campaign_name', 'kampanya', 'ad_name']);

  // Typo normalization and greeting cleanup
  let complaintText = complaintRaw ? cleanComplaintGreeting(normalizeFormValue(normalizeTurkishTypos(complaintRaw.trim()))) : "";
  
  // Whitelist / filter internal campaign details or phone checks
  const ignoredKeywords = ["gurbet", "gurbetci", "form", "randevu", "funnel", "campaign", "adset", "leadgen", "dogru", "telefon", "dorgu"];
  if (complaintText) {
    const cleanLower = complaintText.toLowerCase();
    const words = cleanLower.split(/\s+/);
    const hasOnlyIgnored = words.every(w => ignoredKeywords.some(ik => cleanLower.includes(ik) || w.includes(ik)));
    if (hasOnlyIgnored || cleanLower.includes("telefon dogru") || cleanLower.includes("telefon dorgu")) {
      complaintText = "";
    }
  }

  // Safety confidence whitelist for complaint text
  const recognizedKeywords = [
    "diz", "omuz", "kalça", "kalca", "omurga", "bel", "boyun", "kalp", "damar", "göğüs", "gogus", "sinir", "eklem", "kemik",
    "kıkırdak", "kikirdak", "kireçlenme", "kirecleme", "ezilme", "menisküs", "meniskus", "fıtığı", "fitigi", "stent", "bypass", "anjiyo", "akromegali",
    "ağrı", "agri", "ağrısı", "agrisi", "şişlik", "sislik", "takılı", "takili", "kontrol", "muayene", "ameliyat", "tedavi", "check-up", "checkup"
  ];
  
  if (complaintText) {
    const hasAnyRecognized = recognizedKeywords.some(keyword => complaintText.toLowerCase().includes(keyword));
    if (!hasAnyRecognized) {
      complaintText = "";
    }
  }

  // City suffix correction (e.g. England'da -> England)
  let livingCity = livingCityRaw ? normalizeFormValue(sanitizeCampaignString(livingCityRaw.trim())) : "";
  if (livingCity) {
    livingCity = livingCity.replace(/(’da|’de|’ta|’te|'da|'de|'ta|'te|da|de|ta|te)$/i, "");
  }

  const requestedAppointmentText = requestedAppointmentRaw ? normalizeFormValue(requestedAppointmentRaw.trim()) : "";
  const durationText = durationRaw ? normalizeFormValue(durationRaw.trim()) : "";

  // Extract body parts & conditions
  const bodyPartKeywords = ["diz", "omuz", "kalça", "kalca", "omurga", "bel", "boyun", "kalp", "damar", "göğüs", "gogus", "sinir", "eklem", "kemik"];
  const conditionKeywords = ["kıkırdak", "kikirdak", "kireçlenme", "kirecleme", "ezilme", "menisküs", "meniskus", "fıtığı", "fitigi", "stent", "bypass", "anjiyo", "akromegali"];
  
  const bodyPart = bodyPartKeywords.find(part => complaintText.toLowerCase().includes(part)) || "";
  const conditionTerms = conditionKeywords.filter(cond => complaintText.toLowerCase().includes(cond));

  // Branch mapping
  let departmentHint = "";
  const deptLower = (data.department || data.departman || data.bolum || data.bölüm || data.klinik || formNameRaw || campaignRaw || "").toLowerCase();
  
  if (deptLower.includes("ortopedi") || bodyPart === "diz" || bodyPart === "omuz" || bodyPart === "kalça" || bodyPart === "eklem" || bodyPart === "kemik" || conditionTerms.some(c => ["kıkırdak", "kikirdak", "kireçlenme", "kirecleme", "ezilme", "menisküs", "meniskus"].includes(c))) {
    // Make sure spine/backpain is not routed to orthopedics
    if (complaintText.toLowerCase().includes("bel ağrısı") || complaintText.toLowerCase().includes("bel agrisi") || complaintText.toLowerCase().includes("omurga") || complaintText.toLowerCase().includes("bel fıtığı") || complaintText.toLowerCase().includes("boyun fıtığı") || complaintText.toLowerCase().includes("boyun")) {
      departmentHint = "Beyin Cerrahi";
    } else {
      departmentHint = "Ortopedi";
    }
  } else if (deptLower.includes("kardiyoloji") || deptLower.includes("kalp") || bodyPart === "kalp" || bodyPart === "damar" || bodyPart === "göğüs" || bodyPart === "gogus" || conditionTerms.some(c => ["stent", "bypass", "anjiyo"].includes(c))) {
    departmentHint = "Kardiyoloji";
  } else if (deptLower.includes("beyin") || deptLower.includes("nöro") || bodyPart === "omurga" || bodyPart === "bel" || bodyPart === "boyun" || bodyPart === "sinir" || conditionTerms.some(c => ["fıtığı", "fitigi"].includes(c))) {
    departmentHint = "Beyin Cerrahi";
  } else if (deptLower.includes("check-up") || deptLower.includes("checkup") || deptLower.includes("check up")) {
    departmentHint = "Check-up";
  } else {
    departmentHint = "Genel";
  }

  return {
    complaintText,
    durationText,
    bodyPart,
    conditionTerms,
    departmentHint,
    livingCity,
    requestedAppointmentText,
    age: ageRaw ? ageRaw.trim() : "",
    formName: formNameRaw,
    campaignName: campaignRaw ? campaignRaw.trim() : ""
  };
}

// 2. Deterministik Slot-Based Fallback Composer
export function generateDeterministikDraft(
  slots: FormSlots, 
  draftPurpose: DraftPurpose = 'first_contact_intent_check',
  tenantDisplayName: string = 'Kurumumuz',
  locationName: string = '',
  hasExplicitFormContext: boolean = true
): string {
  let summarySentence = "";
  const durationText = slots.durationText ? ` ve bu durumun yaklaşık ${slots.durationText.toLowerCase()} devam ettiğini` : '';
  let resolvedComplaint = slots.complaintText ? slots.complaintText.trim() : "";
  const complaintLower = resolvedComplaint.toLowerCase();

  if (complaintLower.includes("fıtı") || complaintLower.includes("fitig") || complaintLower.includes("fıtıg") || complaintLower.includes("fıtık") || complaintLower.includes("fitik")) {
    if (complaintLower.includes("boyun")) {
      resolvedComplaint = "boyun fıtığına bağlı ağrı";
    } else {
      resolvedComplaint = "bel fıtığına bağlı ağrı";
    }
  } else if (complaintLower.includes("diz ağrısı") || complaintLower.includes("diz agrisi")) {
    resolvedComplaint = "diz ağrısı";
  } else if (complaintLower.includes("diz kapağı ağrısı") || complaintLower.includes("diz kapagi agrisi")) {
    resolvedComplaint = "diz kapağı ağrısı";
  } else if (resolvedComplaint.length > 50) {
    resolvedComplaint = slots.departmentHint === "Ortopedi" ? "ortopedik şikayetleriniz" : 
                        slots.departmentHint === "Kardiyoloji" ? "kalp damar sağlığıyla ilgili şikayetleriniz" :
                        slots.departmentHint === "Beyin Cerrahi" ? "beyin ve sinir cerrahisi alanındaki şikayetleriniz" :
                        "sağlık durumunuzla ilgili şikayetleriniz";
  }

  // Capitalize first letter of resolvedComplaint
  if (resolvedComplaint) {
    resolvedComplaint = resolvedComplaint.charAt(0).toUpperCase() + resolvedComplaint.slice(1);
  }

  if (slots.departmentHint === "Ortopedi") {
    const sikayetOzet = resolvedComplaint ? `${resolvedComplaint} şikayetiniz olduğunu` : "ortopedik şikayetleriniz olduğunu";
    summarySentence = `${sikayetOzet}${durationText} belirtmişsiniz. Öncelikle geçmiş olsun.`;
  } 
  else if (slots.departmentHint === "Kardiyoloji") {
    if (complaintLower.includes("stent") || complaintLower.includes("bypass") || complaintLower.includes("anjiyo")) {
      summarySentence = `Daha önce anjiyo, stent veya bypass işlemi geçirdiğinizi ve kontrol amaçlı değerlendirilmek istediğinizi belirtmişsiniz. Öncelikle geçmiş olsun.`;
    } else if (resolvedComplaint) {
      summarySentence = `${resolvedComplaint} şikayetiniz olduğunu${durationText} belirtmişsiniz. Öncelikle geçmiş olsun.`;
    } else {
      summarySentence = `Kalp damar sağlığınızla ilgili şikayetleriniz olduğunu belirtmişsiniz. Öncelikle geçmiş olsun.`;
    }
  }
  else if (slots.departmentHint === "Beyin Cerrahi") {
    if (complaintLower.includes("boyun fıtığı") || complaintLower.includes("boyun fitigi") || complaintLower.includes("boyun fıtıgı")) {
      summarySentence = `Boyun fıtığı şikayetiniz olduğunu${durationText} belirtmişsiniz. Öncelikle geçmiş olsun.`;
    } else if (complaintLower.includes("bel ağrısı") || complaintLower.includes("bel agrisi") || complaintLower.includes("bel fıtığı") || complaintLower.includes("bel fitigi") || complaintLower.includes("bel fıtıgı") || complaintLower.includes("fıtık") || complaintLower.includes("fitik")) {
      summarySentence = `${resolvedComplaint} şikayetiniz olduğunu${durationText} belirtmişsiniz. Öncelikle geçmiş olsun.`;
    } else {
      const sikayetOzet = resolvedComplaint ? `${resolvedComplaint} şikayetiniz olduğunu` : "beyin ve sinir cerrahisi alanındaki şikayetleriniz olduğunu";
      summarySentence = `${sikayetOzet}${durationText} belirtmişsiniz. Öncelikle geçmiş olsun.`;
    }
  }
  else if (slots.departmentHint === "Check-up") {
    summarySentence = `Check-up programlarımızla ilgilendiğinizi belirtmişsiniz.`;
  }
  else {
    if (slots.complaintText) {
      summarySentence = `${slots.complaintText} ile ilgili değerlendirilmek istediğinizi${durationText} belirtmişsiniz. Öncelikle geçmiş olsun.`;
    } else {
      summarySentence = `Sağlık durumunuzla ilgili bilgi almak istediğinizi belirtmişsiniz. Öncelikle geçmiş olsun.`;
    }
  }

  const travelDestination = locationName ? `Türkiye’ye, ${locationName} lokasyonumuza` : 'Türkiye’ye';

  let bookingQuestion = '';
  const cityInfo = slots.livingCity ? `Yaşadığınız yer olarak ${slots.livingCity} bilgisini paylaşmışsınız. ` : '';

  if (!hasExplicitFormContext) {
    bookingQuestion = `Size doğru yardımcı olabilmemiz için hangi konuda bilgi almak istediğinizi kısaca yazar mısınız?`;
  } else if (slots.requestedAppointmentText) {
    const isOnlyNumber = /^\d+$/.test(slots.requestedAppointmentText);
    if (isOnlyNumber && slots.requestedAppointmentText.length <= 2) {
      bookingQuestion = `${cityInfo}Randevu tarihi alanına “${slots.requestedAppointmentText}” yazmışsınız; bunu ayın ${slots.requestedAppointmentText}’i mi yoksa ${getMonthNameFromNumber(slots.requestedAppointmentText)} ayı olarak mı düşündüğünüzü netleştirebilir misiniz? Randevu planlaması ve uygun yönlendirme için ${travelDestination} gelmeyi düşündüğünüz yaklaşık tarihi bizimle paylaşabilir misiniz?`;
    } else {
      bookingQuestion = `${cityInfo}Randevu tarihi olarak “${slots.requestedAppointmentText}” belirtmişsiniz. Randevu planlaması ve uygun yönlendirme için ${travelDestination} gelmeyi düşündüğünüz yaklaşık tarihi bizimle paylaşabilir misiniz?`;
    }
  } else {
    bookingQuestion = `${cityInfo}Randevu planlaması ve uygun yönlendirme için ${travelDestination} gelmeyi düşündüğünüz yaklaşık tarihi bizimle paylaşabilir misiniz?`;
  }

  let introPara = 'Merhaba,\n\n';
  if (!hasExplicitFormContext) {
    introPara += !tenantDisplayName || tenantDisplayName === 'Kurumumuz' || tenantDisplayName === 'Ekibimiz'
      ? `Size yardımcı olmak için buradayız. ${summarySentence}`
      : `${tenantDisplayName} ekibi olarak size yardımcı olmak için buradayız. ${summarySentence}`;
  } else if (!tenantDisplayName || tenantDisplayName === 'Kurumumuz' || tenantDisplayName === 'Ekibimiz') {
    introPara += `Form başvurunuz bize ulaştı. ${summarySentence}`;
  } else {
    introPara += `${tenantDisplayName} için yaptığınız form başvurusu bize ulaştı. ${summarySentence}`;
  }

  const blocks = [introPara, bookingQuestion];
  return blocks.filter(Boolean).join('\n\n');
}

// 3. Safety Gate Validation
export function validateDraft(draftText: string, slots: FormSlots, detectedDepartment: string, draftPurpose: DraftPurpose = 'first_contact_intent_check'): string[] {
  const flags: string[] = [];

  const blacklist = [
    /\bBey\b/i,
    /\bHanım\b/i,
    /\bBay\b/i,
    /\bBayan\b/i,
    /fiyat/i,
    /garanti/i,
    /kesin tedavi/i,
    /raporunuzu gönderin/i,
    /raporunuzu değerlendirelim/i,
    /ön görüşme/i,
    /ön değerlendirme/i,
    /2026_/i,
    /_FUNNEL/i,
    /campaign/i,
    /adset/i,
    /leadgen/i,
    /funnel/gi,
    /muayene/i,
    /tetkik/i,
    /takip süreci/i,
    /hastanemize geldiğinizde/i,
    /doktorumuz tarafından/i,
    /uzman doktor/i,
    /klinik/i,
    /tedavi/i,
    /ameliyat/i,
    /kesin/i,
    /hareket kısıtlılığı/i,
    /sinir sıkışması/i,
    /omurga problemleri/i,
    /detaylı şekilde değerlendirilmesi/i,
    /mevcut durumunuz ayrıntılı şekilde incelenir/i
  ];

  if (draftPurpose === 'first_contact_intent_check') {
    const medicalBlacklist = [
      /tanınız daha önce konuldu mu/i,
      /tedavi aldınız mı/i,
      /\bmr\b/i,
      /röntgen/i,
      /görüntüleme/i,
      /rapor/i,
      /ilaç/i,
      /ameliyat öneri/i,
      /\bprp\b/i,
      /kök hücre/i,
      /diz içi iğne/i,
      /fizik tedavi/i,
      /anjiyo yapıldı mı/i
    ];
    blacklist.push(...medicalBlacklist);
  }

  for (const rx of blacklist) {
    if (rx.test(draftText)) {
      flags.push(`Yasaklı ifade eşleşti: ${rx.toString()}`);
    }
  }

  // Cross-reference checking
  const complaintLower = slots.complaintText.toLowerCase();
  
  if (detectedDepartment === "Ortopedi" && (complaintLower.includes("bel ağrısı") || complaintLower.includes("bel agrisi") || complaintLower.includes("omurga") || complaintLower.includes("fitik"))) {
    flags.push("Department Ortopedi mapped but complaint seems related to Spine/Neurosurgery.");
  }

  // Leaks check
  if (slots.campaignName && draftText.includes(slots.campaignName)) {
    flags.push("Campaign name leaked directly into draft text.");
  }
  if (slots.formName && draftText.includes(slots.formName)) {
    flags.push("Form name leaked directly into draft text.");
  }

  return flags;
}

function cleanJsonResponse(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```json")) {
    text = text.substring(7);
  } else if (text.startsWith("```")) {
    text = text.substring(3);
  }
  if (text.endsWith("```")) {
    text = text.substring(0, text.length - 3);
  }
  return text.trim();
}

// 4. Main Entry Point (Hybrid Async Flow)
export async function generateSmartDraft(
  rawData: any, 
  defaultFormName?: string, 
  draftPurpose: DraftPurpose = 'first_contact_intent_check',
  tenantId?: string,
  db?: any
): Promise<string> {
  const slots = extractFormSlots(rawData, defaultFormName);
  const hasFormContext = hasExplicitFormSignal(rawData, defaultFormName, slots);
  const apiKey = process.env.GEMINI_API_KEY;

  // Resolve dynamic values
  let tenantDisplayName = 'Kurumumuz';
  let locationName = '';

  if (tenantId && db) {
    try {
      const { resolveTenantDisplayName, resolveTenantLocationName } = await import('@/lib/services/meta/tenant-display-name-resolver');
      const resolvedName = await resolveTenantDisplayName(db, tenantId);
      if (resolvedName) tenantDisplayName = resolvedName;

      const resolvedLoc = await resolveTenantLocationName(db, tenantId);
      if (resolvedLoc) locationName = resolvedLoc;
    } catch (_) {}
  }

  if (!apiKey) {
    // No API key, directly use deterministik fallback
    return generateDeterministikDraft(slots, draftPurpose, tenantDisplayName, locationName, hasFormContext);
  }

  try {
    const travelDestination = locationName ? `Türkiye’ye, ${locationName} lokasyonumuza` : 'Türkiye’ye';
    
    let introGreetingRule = '';
    if (!hasFormContext) {
      introGreetingRule = !tenantDisplayName || tenantDisplayName === 'Kurumumuz' || tenantDisplayName === 'Ekibimiz'
        ? `Size yardımcı olmak için buradayız.`
        : `${tenantDisplayName} ekibi olarak size yardımcı olmak için buradayız.`;
    } else if (!tenantDisplayName || tenantDisplayName === 'Kurumumuz' || tenantDisplayName === 'Ekibimiz') {
      introGreetingRule = `Form başvurunuz bize ulaştı.`;
    } else {
      introGreetingRule = `${tenantDisplayName} için yaptığınız form başvurusu bize ulaştı.`;
    }

    const formSourceRule = hasFormContext
      ? `Form verisi mevcut. Bu nedenle sadece bu durumda "form başvurunuz bize ulaştı" anlamındaki giriş cümlesini kullanabilirsin.`
      : `Form verisi yok veya belirsiz. Bu durumda "doldurduğunuz form", "başvurunuz" veya form doldurduğunu ima eden hiçbir ifade kullanma.`;

    const systemInstruction = `Sen bir Hastane Karşılama Asistanı AI modelisin. Görevin, verilen hasta bağlamını inceleyerek, ona son derece profesyonel, sıcak, kurallara uygun ve güvenli bir WhatsApp karşılama mesaj taslağı hazırlamaktır.
Yanıtını sadece belirtilen JSON formatında üretmelisin. JSON haricinde hiçbir metin, tırnak veya markdown bloğu (örn. \`\`\`json) KESİNLİKLE ekleme.

=== YASAKLI İFADELER VE KURAL LİSTESİ ===
1. KESİNLİKLE İSİMLE HİTAP ETME. "Merhaba Ahmet Bey", "Güley Hanım" gibi ifadeler KESİNLİKLE YASAKTIR. Selamlama her zaman sadece "Merhaba," olmalıdır.
2. "Bey", "Hanım", "Bay", "Bayan" kelimelerini KESİNLİKLE kullanma.
3. KESİNLİKLE fiyat bilgisi veya aralığı verme.
4. KESİNLİKLE kesin tanı, teşhis, tedavi garantisi, ameliyat yönlendirmesi veya hekim adı verme.
5. KESİNLİKLE hastaya tıbbi açıklamalarda bulunma. Hastanın hastalığı, belirtileri, sinir sıkışması veya anatomik durumlarıyla ilgili tıbbi açıklamalar yapmak (örn. "bel fıtığı bacağa yayılan ağrılara neden olabilir") KESİNLİKLE YASAKTIR.
6. KESİNLİKLE hastaneye gelindiğinde yapılacak klinik işlemleri, muayeneleri, tetkikleri veya takip süreçlerini detaylandırma (örn. "hastanemize geldiğinizde doktorumuz muayene eder, takip süreci planlanır" vb.) KESİNLİKLE YASAKTIR.
7. "Ön görüşme", "ön değerlendirme" ifadelerini kullanma.
8. Kampanya kodlarını (örn. 2026_AVRUPA_TR_ORTOPEDI_BF_FUNNEL), internal ID'leri, adset, leadgen gibi teknik kelimeleri KESİNLİKLE hastaya yazma. Bunları sadece departmanı anlamak için kullan.
9. Şehir ve ülke isimlerine ek getirirken hata yapmamak için şu güvenli kalıbı kullan: "Yaşadığınız yer olarak [Şehir/Ülke] bilgisini paylaşmışsınız."
10. Eğer randevu tarihi alanında sadece "8" gibi tekil belirsiz bir sayı varsa: "Randevu tarihi alanına “8” yazmışsınız; bunu ayın 8’i mi yoksa Ağustos ayı olarak mı düşündüğünüzü netleştirebilir misiniz?" şeklinde sor.
11. Hekim adı veya hekim yönlendirme dili kullanma. "Bölümümüz tanı ve tedavi hizmeti vermektedir" gibi broşür dili KULLANMA.
12. Hastaya ${travelDestination} ne zaman gelmeyi düşündüğünü sor.
13. KESİNLİKLE Başkent, Konya, Rüya veya başka bir kurum adını kendin uydurma veya ekleme. Sadece sana verilen ${tenantDisplayName} değerini kullan.
14. Mesajı son derece kısa, doğal, sıcak, hasta-facing tut. KESİNLİKLE tıbbi jargona veya hastane broşür stiline girme.
15. ${formSourceRule}

=== FIRST CONTACT INTENT CHECK RULES (KRİTİK) ===
Bu taslak hastaya atılacak ilk mesajdır ve asıl amaç hastanın randevu veya gelme NİYETİNİ öğrenmektir, TIBBİ DANIŞMANLIK veya yönlendirme vermek değildir.
AŞAĞIDAKİ SORULAR VE KONULAR KESİNLİKLE YASAKTIR:
- "Daha önce tanınız konuldu mu?"
- "Tedavi aldınız mı?"
- "MR çekildi mi?", "Röntgen var mı?", "Tetkik", "Görüntüleme", "Rapor"
- "İlaç kullanıyor musunuz?"
- "Ameliyat önerildi mi?", "PRP", "Kök hücre", "İğne denendi mi?", "Anjiyo yapıldı mı?", "Fizik tedavi gördünüz mü?"

=== TASLAK METNİ BÖLÜM VE SIRALAMA KURALLARI (TASLAK MAKSİMUM 2 KISA PARAGRAF OLMALIDIR) ===
1. Paragraf 1 (Selamlama + Giriş + Şikayet Teyidi): "Merhaba," kelimesinden sonra çift satır boşluk bırak ve ardından "${introGreetingRule}" cümlesini ekle. Hemen ardına hastanın şikayetini ve varsa süresini doğal bir Türkçe ile belirterek geçmiş olsun de.
   - Örn: "Merhaba,\n\n${introGreetingRule} Diz kapağı ağrısı şikayetiniz olduğunu belirtmişsiniz. Öncelikle geçmiş olsun."
   - Hastanın şikayet verisindeki "merhaba", "selam", "benim", "adım" gibi gereksiz giriş kelimelerini tamamen ayıkla.
2. Paragraf 2 (Geliş Niyeti/Tarih Sorusu): Yaşadığı yer belirtilmişse "Yaşadığınız yer olarak Stuttgart bilgisini paylaşmışsınız." ifadesini ekleyerek, "Randevu planlaması ve uygun yönlendirme için ${travelDestination} ne zaman gelmeyi düşündüğünüzü bizimle paylaşabilir misiniz?" veya "Randevu planlaması için ${travelDestination} ne zaman gelmeyi düşündüğünüzü bizimle paylaşabilir misiniz?" sorusunu sor.
3. KESİNLİKLE "İyi günler dileriz." veya "Sağlıklı günler dileriz" gibi erken kapanış/imza cümleleri ekleme. Taslağı her zaman paragraf 2'deki niyet/tarih sorusu ile açık uçlu olarak sonlandır.

=== RETURN JSON FORMAT ===
{
  "draftText": "Oluşturduğun WhatsApp mesaj taslağı (satır boşlukları için \\n\\n kullan. Maksimum 2 kısa paragraf olmalıdır. KESİNLİKLE imza veya kapanış cümlesi ekleme.)",
  "detectedDepartment": "Ortopedi" | "Kardiyoloji" | "Beyin Cerrahi" | "Check-up" | "Genel",
  "complaintSummary": "Hastanın şikayetinin çok kısa özeti",
  "confidence": "high" | "medium" | "low",
  "needsHumanReview": true veya false (yasaklı kelimeler veya belirsizlik varsa true yap),
  "safetyFlags": [] (varsa güvenlik ihlali veya uyarı notları)
}`;

    const prompt = `Aşağıdaki form slot verilerini kullanarak bir WhatsApp karşılama taslağı oluştur:
Form Slotları:
- Departman/Branş İpucu: ${slots.departmentHint}
- Şikayet: ${slots.complaintText || '(Belirtilmemiş)'}
- Şikayet Süresi: ${slots.durationText || '(Belirtilmemiş)'}
- Yaşadığı Yer: ${slots.livingCity || '(Belirtilmemiş)'}
- İstenen Randevu Tarihi: ${slots.requestedAppointmentText || '(Belirtilmemiş)'}
- Yaş: ${slots.age || '(Belirtilmemiş)'}
- Form Adı: ${slots.formName}
- Kampanya Adı: ${slots.campaignName}`;

    const payload = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { 
        temperature: 0.1, 
        maxOutputTokens: 2048,
        responseMimeType: "application/json"
      }
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    if (response.ok) {
      const resData = await response.json();
      const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        const jsonText = cleanJsonResponse(rawText);
        const parsed = JSON.parse(jsonText);

        // Safety Gate validation
        const safetyErrors = validateDraft(parsed.draftText || "", slots, parsed.detectedDepartment || slots.departmentHint, draftPurpose);
        if (safetyErrors.length === 0 && !parsed.needsHumanReview) {
          return parsed.draftText;
        } else {
          // Fallback due to safety gate rejection
          return generateDeterministikDraft(slots, draftPurpose, tenantDisplayName, locationName, hasFormContext);
        }
      }
    }
  } catch (_) {
    // Fetch or parse error -> fallback
  }

  return generateDeterministikDraft(slots, draftPurpose, tenantDisplayName, locationName, hasFormContext);
}

export function enforceGreetingDraftSafety(
  draftText: string,
  slots: FormSlots,
  tenantContext: { tenantDisplayName: string; locationName: string; hasFormContext?: boolean }
): string {
  const safetyErrors = validateDraft(draftText, slots, slots.departmentHint || 'Genel', 'first_contact_intent_check');
  const paras = draftText.split("\n").filter(p => p.trim().length > 0);
  const contentParas = paras.filter(p => !p.startsWith("Merhaba") && !p.includes("İyi günler") && !p.includes("Sağlıklı günler"));
  const hasFormContext = tenantContext.hasFormContext ?? true;
  const invalidFormReference = !hasFormContext && /doldurduğunuz form|başvurunuz|form doğrultusunda/i.test(draftText);

  if (safetyErrors.length > 0 || contentParas.length > 3 || invalidFormReference) {
    return generateDeterministikDraft(slots, 'first_contact_intent_check', tenantContext.tenantDisplayName, tenantContext.locationName, hasFormContext);
  }
  return draftText;
}
