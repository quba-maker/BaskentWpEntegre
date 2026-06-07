/**
 * Akıllı Karşılama Taslağı Üreticisi v2 (AI-Assisted Hybrid)
 * Form verilerini slot-based analiz eder, AI ile kişiselleştirilmiş güvenli taslak oluşturur.
 * Hata veya güvenlik ihlali durumunda slot-based deterministik taslağa (fallback) düşer.
 */

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
    if (normalizedKeys.some(k => normKey.includes(k) || k.includes(normKey))) {
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

  // Typo normalization
  let complaintText = complaintRaw ? normalizeTurkishTypos(complaintRaw.trim()) : "";
  
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
  let livingCity = livingCityRaw ? sanitizeCampaignString(livingCityRaw.trim()) : "";
  if (livingCity) {
    livingCity = livingCity.replace(/(’da|’de|’ta|’te|'da|'de|'ta|'te|da|de|ta|te)$/i, "");
  }

  const requestedAppointmentText = requestedAppointmentRaw ? requestedAppointmentRaw.trim() : "";

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
    if (complaintText.toLowerCase().includes("bel ağrısı") || complaintText.toLowerCase().includes("bel agrisi") || complaintText.toLowerCase().includes("omurga") || complaintText.toLowerCase().includes("bel fıtığı")) {
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
    durationText: durationRaw ? durationRaw.trim() : "",
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
export function generateDeterministikDraft(slots: FormSlots, draftPurpose: DraftPurpose = 'first_contact_intent_check'): string {
  let summarySentence = "";
  let contextualDetails = "";

  const durationText = slots.durationText ? `, bu durumun yaklaşık ${slots.durationText.toLowerCase()} devam ettiğini` : '';

  if (slots.departmentHint === "Ortopedi") {
    const sikayetOzet = slots.complaintText ? slots.complaintText.toLowerCase() : "ortopedik şikayetleriniz";
    summarySentence = `Formunuzda ${sikayetOzet} şikayeti olduğunu${durationText} belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nDiz eklemiyle ilgili kireçlenme, kıkırdak hasarı veya benzer ortopedik rahatsızlıklar; ağrı, yürüme güçlüğü, merdiven çıkarken zorlanma ve hareket kısıtlılığı gibi şikayetlere neden olabilir. Kesin değerlendirme hastanemizde ortopedi hekimi muayenesi sonrası yapılır.`;
  } 
  else if (slots.departmentHint === "Kardiyoloji") {
    let sikayetOzet = "";
    if (slots.complaintText.toLowerCase().includes("stent")) {
      sikayetOzet = "kalp damar sağlığınızla ilgili işlem geçmişiniz olduğunu ve";
    } else if (slots.complaintText) {
      sikayetOzet = `${slots.complaintText.toLowerCase()} şikayetiniz olduğunu ve`;
    } else {
      sikayetOzet = "kalp damar sağlığınızla ilgili şikayetleriniz olduğunu ve";
    }
    summarySentence = `Formunuzda ${sikayetOzet} değerlendirilmek istediğinizi belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nKalp ve damar sağlığıyla ilgili takiplerde düzenli kontrol önemlidir. Hastanemize geldiğinizde kardiyoloji hekimimiz tarafından gerekli muayene ve değerlendirmeler yapılır, uygun takip süreci hakkında bilgilendirme sağlanır.`;
  }
  else if (slots.departmentHint === "Beyin Cerrahi") {
    let sikayetOzet = slots.complaintText ? slots.complaintText.toLowerCase() : "beyin ve sinir cerrahisi alanındaki şikayetleriniz";
    summarySentence = `Formunuzda ${sikayetOzet} olduğunu${durationText} belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nOmurga ve sinir sistemi sağlığında (bel/boyun fıtığı, sinir sıkışması vb.) detaylı klinik inceleme çok önemlidir. Hastanemize geldiğinizde ilgili hekimimiz tarafından gerekli muayene ve değerlendirmeler yapılarak mevcut durumunuz ayrıntılı şekilde incelenir.`;
  }
  else if (slots.departmentHint === "Check-up") {
    summarySentence = `Formunuzda Check-up programlarımızla ilgilendiğinizi belirttiğinizi görüyoruz. Sağlığınıza gösterdiğiniz özen için tebrik ederiz.\n\nCheck-up programlarımız yaşınıza, cinsiyetinize ve tıbbi geçmişinize özel olarak planlanmaktadır. Hastanemize geldiğinizde ilgili hekimlerimiz tarafından gerekli değerlendirmeler yapılır.`;
  }
  else {
    // Genel / Bilinmeyen / Akromegali vb.
    if (slots.complaintText) {
      summarySentence = `Formunuzda ${slots.complaintText.toLowerCase()} ile ilgili değerlendirilmek istediğinizi belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nBu tür durumlarda kesin değerlendirme, hastanemizde ilgili hekim muayenesi ve gerekli klinik incelemeler sonrası yapılır.`;
    } else {
      summarySentence = `Formunuzda sağlık durumunuzla ilgili bilgi almak istediğinizi görüyoruz.\n\nKesin değerlendirme hastanemizde ilgili hekim muayenesi sonrası yapılır.`;
    }
  }

  if (slots.livingCity) {
    contextualDetails += `Yaşadığınız yer olarak ${slots.livingCity} bilgisini paylaşmışsınız. `;
  }

  let bookingQuestion = '';
  if (slots.requestedAppointmentText) {
    const isOnlyNumber = /^\d+$/.test(slots.requestedAppointmentText);
    if (isOnlyNumber && slots.requestedAppointmentText.length <= 2) {
      bookingQuestion = `Randevu tarihi alanına “${slots.requestedAppointmentText}” yazmışsınız; bunu ayın ${slots.requestedAppointmentText}’i mi yoksa ${getMonthNameFromNumber(slots.requestedAppointmentText)} ayı olarak mı düşündüğünüzü netleştirebilir misiniz? Türkiye’ye / Konya’ya gelmeyi düşünüyor musunuz? Yaklaşık geliş tarihinizi paylaşırsanız randevu planlamanız için yardımcı olabiliriz.`;
    } else {
      bookingQuestion = `Randevu tarihi olarak “${slots.requestedAppointmentText}” belirtmişsiniz. Türkiye’ye / Konya’ya gelmeyi düşünüyor musunuz? Yaklaşık geliş tarihinizi netleştirdiğinizde randevu planlamanız için yardımcı olabiliriz.`;
    }
  } else {
    bookingQuestion = `Türkiye’ye / Konya’ya gelmeyi düşünüyor musunuz? Yaklaşık geliş tarihinizi paylaşırsanız randevu planlamanız için yardımcı olabiliriz.`;
  }

  const greeting = `Merhaba,\n\nBaşkent Üniversitesi Konya Hastanesi’nden, doldurduğunuz form doğrultusunda sizinle iletişime geçiyoruz.`;
  const closing = `İyi günler dileriz.`;

  const blocks = [greeting, summarySentence];
  if (contextualDetails || bookingQuestion) blocks.push((contextualDetails + bookingQuestion).trim());
  blocks.push(closing);

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
    /funnel/gi
  ];

  if (draftPurpose === 'first_contact_intent_check') {
    const medicalBlacklist = [
      /tanınız daha önce konuldu mu/i,
      /tedavi aldınız mı/i,
      /\bmr\b/i,
      /röntgen/i,
      /tetkik/i,
      /görüntüleme/i,
      /rapor/i,
      /ilaç/i,
      /ameliyat öneri/i,
      /\bprp\b/i,
      /kök hücre/i,
      /diz içi iğne/i,
      /fizik tedavi/i,
      /anjiyo/i
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
export async function generateSmartDraft(rawData: any, defaultFormName?: string, draftPurpose: DraftPurpose = 'first_contact_intent_check'): Promise<string> {
  const slots = extractFormSlots(rawData, defaultFormName);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    // No API key, directly use deterministik fallback
    return generateDeterministikDraft(slots, draftPurpose);
  }

  try {
    const systemInstruction = `Sen bir Hastane Karşılama Asistanı AI modelisin. Görevin, hastanın doldurduğu form verilerini (slotları) inceleyerek, ona son derece profesyonel, sıcak, kurallara uygun ve güvenli bir WhatsApp karşılama mesaj taslağı hazırlamaktır.
Yanıtını sadece belirtilen JSON formatında üretmelisin. JSON haricinde hiçbir metin, tırnak veya markdown bloğu (örn. \`\`\`json) KESİNLİKLE ekleme.

=== YASAKLI İFADELER VE KURAL LİSTESİ ===
1. KESİNLİKLE İSİMLE HİTAP ETME. "Merhaba Ahmet Bey", "Güley Hanım" gibi ifadeler KESİNLİKLE YASAKTIR. Selamlama her zaman sadece "Merhaba," olmalıdır.
2. "Bey", "Hanım", "Bay", "Bayan" kelimelerini KESİNLİKLE kullanma.
3. KESİNLİKLE fiyat bilgisi veya aralığı verme.
4. KESİNLİKLE kesin tanı, teşhis veya tedavi garantisi verme.
5. "Ön görüşme", "ön değerlendirme" ifadelerini kullanma.
6. Kampanya kodlarını (örn. 2026_AVRUPA_TR_ORTOPEDI_BF_FUNNEL), internal ID'leri, adset, leadgen gibi teknik kelimeleri KESİNLİKLE hastaya yazma. Bunları sadece departmanı anlamak için kullan.
7. Şehir ve ülke isimlerine ek getirirken hata yapmamak için şu güvenli kalıbı kullan: "Yaşadığınız yer olarak [Şehir/Ülke] bilgisini paylaşmışsınız."
8. Eğer randevu tarihi alanında sadece "8" gibi tekil belirsiz bir sayı varsa: "Randevu tarihi alanına “8” yazmışsınız; bunu ayın 8’i mi yoksa Ağustos ayı olarak mı düşündüğünüzü netleştirebilir misiniz?" şeklinde sor.
9. Tıbbi değerlendirme uyarısı olarak her zaman şu cümleyi ekle: "Kesin değerlendirme hastanemizde ilgili hekim muayenesi sonrası yapılır."

=== FIRST CONTACT INTENT CHECK RULES (KRİTİK) ===
Bu taslak hastaya atılacak ilk mesajdır ve asıl amaç hastanın randevu veya gelme NİYETİNİ öğrenmektir, TIBBİ DANIŞMANLIK vermek değildir.
AŞAĞIDAKİ SORULAR VE KONULAR KESİNLİKLE YASAKTIR:
- "Daha önce tanınız konuldu mu?"
- "Tedavi aldınız mı?"
- "MR çekildi mi?", "Röntgen var mı?", "Tetkik", "Görüntüleme", "Rapor"
- "İlaç kullanıyor musunuz?"
- "Ameliyat önerildi mi?", "PRP", "Kök hücre", "İğne denendi mi?", "Anjiyo yapıldı mı?", "Fizik tedavi gördünüz mü?"

Bunun yerine sadece geliş niyetini ve randevu hedefini sor:
- "Türkiye’ye / Konya’ya gelmeyi düşünüyor musunuz? Yaklaşık geliş tarihinizi paylaşırsanız randevu planlamanız için yardımcı olabiliriz."
veya
- "Gelme planınız net değilse, uygun olduğunuzda telefonla süreç ve randevu planlaması hakkında bilgi paylaşabiliriz."

=== TASLAK METNİ BÖLÜM VE SIRALAMA KURALLARI ===
1. Nötr selamlama: "Merhaba,"
2. Kurumsal giriş: "Başkent Üniversitesi Konya Hastanesi’nden, doldurduğunuz form doğrultusunda sizinle iletişime geçiyoruz."
3. Form özeti: Hastanın formda belirttiği şikayeti/şikayetleri doğal ve düzgün bir Türkçe ile özetle. Eğer formda şikayet süresi de varsa (örn. "2 senedir", "3 aydır") mutlaka şu formatta ekle: "Formunuzda X ile ilgili değerlendirilmek istediğinizi ve bu durumun yaklaşık Y devam ettiğini belirttiğinizi görüyoruz." (Süre verisi yoksa sadece şikayeti özetle). "Öncelikle geçmiş olsun." ekle.
4. Genel Bilgilendirme: Branşla alakalı genel, risksiz, teşhis içermeyen 1-2 cümlelik bilgi ver.
5. Hekim Değerlendirmesi: "Kesin değerlendirme hastanemizde ilgili hekim muayenesi sonrası yapılır."
6. Şehir ve Randevu Detayı: Yaşadığı şehir belirtilmişse nazikçe ekle. Randevu tarihi veya geliş niyeti belirsizse bunu netleştirecek soruyu ekle (Yukarıdaki First Contact kurallarına göre).
7. Kapanış: "İyi günler dileriz."

=== RETURN JSON FORMAT ===
{
  "draftText": "Oluşturduğun WhatsApp mesaj taslağı (satır boşlukları için \\n kullan)",
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
          return generateDeterministikDraft(slots, draftPurpose);
        }
      }
    }
  } catch (_) {
    // Fetch or parse error -> fallback
  }

  return generateDeterministikDraft(slots, draftPurpose);
}
