export type WhatsAppFormSummaryFields = {
  formName?: string;
  formLink?: string;
  fullName?: string;
  phoneNumber?: string;
  whatsappNumber?: string;
  country?: string;
  complaint?: string;
  travelPlan?: string;
  callbackPreference?: string;
  dateOfBirth?: string;
  reports?: string;
  department?: string;
  rawFields: Array<{ key: string; value: string }>;
};

export type WhatsAppFormSummaryDetection = {
  isFormSummary: boolean;
  score: number;
  formLink?: string;
  fields: WhatsAppFormSummaryFields;
};

const INTRO_PATTERNS = [
  /formunuzu doldurdum/i,
  /formu doldurdum/i,
  /işletmeniz hakkında daha fazla bilgi/i,
  /isletmeniz hakkinda daha fazla bilgi/i,
  /i filled out your form/i,
  /more about your business/i,
  /formular ausgefüllt/i,
  /formular ausgefullt/i,
  /mehr über dein unternehmen/i,
  /mehr uber dein unternehmen/i,
  /j['’]ai rempli/i,
  /formulario/i,
];

function normalizeKey(value: string): string {
  return value
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function extractFields(text: string): WhatsAppFormSummaryFields {
  const rawFields: Array<{ key: string; value: string }> = [];
  const lines = text.split(/\r?\n/);
  let formLink = text.match(/https?:\/\/fb\.me\/[^\s]+/i)?.[0];

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[\s•*-]+/, "").trim();
    if (!line) continue;
    const linkMatch = line.match(/https?:\/\/fb\.me\/[^\s]+/i);
    if (linkMatch && !formLink) {
      formLink = linkMatch[0];
    }

    const fieldMatch = line.match(/^([^:\n]{2,140}?)\??\s*:\s*(.+)$/);
    if (!fieldMatch) continue;
    const key = fieldMatch[1].trim();
    const value = fieldMatch[2].trim();
    if (!key || !value) continue;
    rawFields.push({ key, value });
  }

  const by = (predicate: (key: string) => boolean) => {
    const field = rawFields.find((item) => predicate(normalizeKey(item.key)));
    return field?.value;
  };

  const whatsappNumber = by((key) => key.includes("whatsapp"));
  const phoneNumber = by((key) =>
    (key.includes("phone") || key.includes("telefon") || key.includes("numara")) &&
    !key.includes("whatsapp")
  );

  return {
    formName: by((key) => key.includes("form name") || key === "form"),
    formLink,
    fullName: by((key) => key.includes("full name") || key.includes("ad soyad") || key === "name"),
    phoneNumber,
    whatsappNumber,
    country: by((key) =>
      key.includes("hangi ulkede") ||
      key.includes("nerede yasiyorsunuz") ||
      key.includes("nerede yasiyor") ||
      key.includes("ulke") ||
      key.includes("country")
    ),
    complaint: by((key) =>
      key.includes("sikayet") ||
      key.includes("talep") ||
      key.includes("mevcut kalp") ||
      key.includes("sagligi durum") ||
      key.includes("health") ||
      key.includes("tedavi beklentisi")
    ),
    travelPlan: by((key) =>
      key.includes("turkiye") ||
      key.includes("konya") ||
      key.includes("gelis plani") ||
      key.includes("gelme plani") ||
      key.includes("randevu olustur")
    ),
    callbackPreference: by((key) =>
      key.includes("arayalim") ||
      key.includes("arama") ||
      key.includes("on gorusme") ||
      key.includes("tedavi planlamaniz") ||
      key.includes("randevu tercihi")
    ),
    dateOfBirth: by((key) => key.includes("date of birth") || key.includes("dogum tarihi") || key.includes("yas")),
    reports: by((key) =>
      key.includes("tetkik") ||
      key.includes("rapor") ||
      key.includes("mr") ||
      key.includes("emar") ||
      key.includes("rontgen") ||
      key.includes("ekg")
    ),
    department: by((key) => key.includes("onerilen bolum") || key.includes("bolum") || key.includes("department")),
    rawFields,
  };
}

export function detectWhatsAppFormSummaryMessage(text: string | null | undefined): WhatsAppFormSummaryDetection {
  const source = String(text || "").trim();
  const fields = extractFields(source);
  const fieldCount = fields.rawFields.length;
  const hasIntro = INTRO_PATTERNS.some((pattern) => pattern.test(source));
  const hasFormLink = !!fields.formLink;
  const hasStrongFormFields = [
    fields.fullName,
    fields.phoneNumber,
    fields.whatsappNumber,
    fields.country,
    fields.complaint,
    fields.travelPlan,
    fields.callbackPreference,
  ].filter(Boolean).length;

  const score =
    (hasIntro ? 2 : 0) +
    (hasFormLink ? 2 : 0) +
    Math.min(fieldCount, 6) +
    hasStrongFormFields;

  return {
    isFormSummary: ((hasIntro || hasFormLink) && fieldCount >= 2) || fieldCount >= 5 || score >= 7,
    score,
    formLink: fields.formLink,
    fields,
  };
}

export function buildCompactWhatsAppFormSummaryForAi(
  input: string | WhatsAppFormSummaryDetection
): string {
  const detection = typeof input === "string" ? detectWhatsAppFormSummaryMessage(input) : input;
  const f = detection.fields;
  const phone = firstNonEmpty(f.whatsappNumber, f.phoneNumber);
  const lines = [
    "[WhatsApp form özeti]",
    "Hasta Meta/WhatsApp form özetini sohbetten gönderdi. Bunu normal sohbet cümlesi değil, mevcut form başvurusu olarak değerlendir.",
    "Bu mesaj hastanın ilk temasıdır; ayrıca otomatik şablon isteme. Sohbet içinde doğal, kısa ve form bilgilerine bağlı ilk yanıt ver.",
    f.formName ? `Form: ${f.formName}` : null,
    f.fullName ? `Ad: ${f.fullName}` : null,
    phone ? `Telefon/WhatsApp: ${phone}` : null,
    f.country ? `Ülke/konum: ${f.country}` : null,
    f.dateOfBirth ? `Doğum tarihi/yaş: ${f.dateOfBirth}` : null,
    f.department ? `Bölüm: ${f.department}` : null,
    f.complaint ? `Şikayet/talep: ${f.complaint}` : null,
    f.travelPlan ? `Geliş planı: ${f.travelPlan}` : null,
    f.callbackPreference ? `Arama tercihi: ${f.callbackPreference}` : null,
    f.reports ? `Tetkik/rapor: ${f.reports}` : null,
    f.formLink ? `Form linki: ${f.formLink}` : null,
    "Yanıt verirken formu tekrar okumaya çalışma, kurum/isim karşılama cümlesini tekrar etme; hastanın asıl talebine doğal şekilde cevap ver ve gerekiyorsa tek net takip sorusu sor.",
  ].filter(Boolean);

  return lines.join("\n").slice(0, 1800);
}

export function compactWhatsAppFormSummaryHistory<T extends { content?: unknown }>(history: T[]): T[] {
  if (!Array.isArray(history)) return history;
  return history.map((item) => {
    const content = typeof item?.content === "string" ? item.content : "";
    const detection = detectWhatsAppFormSummaryMessage(content);
    if (!detection.isFormSummary) return item;
    return {
      ...item,
      content: buildCompactWhatsAppFormSummaryForAi(detection),
    };
  });
}
