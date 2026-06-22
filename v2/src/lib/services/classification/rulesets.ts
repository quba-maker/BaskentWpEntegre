export interface ClassificationRule {
  id: string;
  pattern: RegExp;
  category: 'department' | 'intent' | 'patient_type' | 'spam' | 'escalation';
  tag?: string;
  scoreContribution: number;
  confidence: number;
  isTerminal?: boolean; // True ise aramaya devam etmez, direk eşleşir (örn: kesin randevu)
}

export interface TenantRuleset {
  version: string;
  tenantSlug: string;
  industry: string;
  rules: ClassificationRule[];
}

export const BaskentRuleset_V1: TenantRuleset = {
  version: "v1.0",
  tenantSlug: "baskent",
  industry: "healthcare",
  rules: [
    // --- Departments ---
    { id: 'dept_ortopedi', pattern: /ortopedi|diz|kalça|kırık|eklem|menisküs|protez|omuz|bağ yaralanması/i, category: 'department', tag: 'Ortopedi', scoreContribution: 15, confidence: 0.9 },
    { id: 'dept_beyin_cerrahi', pattern: /beyin ve sinir cerrahisi|beyin cerrahi|nöroşirürji|bel fıtığı|boyun fıtığı|fıtık|omurga|omurilik|sinir sıkışması/i, category: 'department', tag: 'Beyin Cerrahi', scoreContribution: 20, confidence: 0.9 },
    { id: 'dept_kardiyoloji', pattern: /kardiyoloji|kalp|tansiyon|stent|anjio|bypass/i, category: 'department', tag: 'Kardiyoloji', scoreContribution: 20, confidence: 0.9 },
    { id: 'dept_estetik', pattern: /estetik|burun|yüz germe|liposuction|botox|dolgu|meme/i, category: 'department', tag: 'Estetik', scoreContribution: 15, confidence: 0.9 },
    { id: 'dept_dis', pattern: /diş|implant|ortodonti|kanal tedavi|çekim|zirkonyum/i, category: 'department', tag: 'Diş', scoreContribution: 12, confidence: 0.9 },
    { id: 'dept_goz', pattern: /göz|katarakt|lazer|retina|lens/i, category: 'department', tag: 'Göz', scoreContribution: 15, confidence: 0.9 },
    { id: 'dept_tupbebek', pattern: /tüp bebek|ivf|kısırlık|gebelik|doğum|kadın/i, category: 'department', tag: 'Tüp Bebek', scoreContribution: 25, confidence: 0.9 },
    { id: 'dept_organ', pattern: /nakil|organ|böbrek|karaciğer|haberal/i, category: 'department', tag: 'Organ Nakli', scoreContribution: 40, confidence: 0.95 },
    { id: 'dept_onkoloji', pattern: /onkoloji|kanser|tümör|kemoterapi/i, category: 'department', tag: 'Onkoloji', scoreContribution: 30, confidence: 0.95 },
    { id: 'dept_obezite', pattern: /obezite|mide küçültme|sleeve|bariatrik/i, category: 'department', tag: 'Obezite', scoreContribution: 20, confidence: 0.9 },
    { id: 'dept_noroloji', pattern: /nöroloji|beyin|baş ağrısı|epilepsi|ms/i, category: 'department', tag: 'Nöroloji', scoreContribution: 18, confidence: 0.9 },
    { id: 'dept_uroloji', pattern: /üroloji|prostat|böbrek taşı|mesane/i, category: 'department', tag: 'Üroloji', scoreContribution: 15, confidence: 0.9 },
    { id: 'dept_checkup', pattern: /check.?up|genel kontrol|tarama/i, category: 'department', tag: 'Check-Up', scoreContribution: 8, confidence: 0.8 },

    // --- Intent Signals ---
    { id: 'intent_price', pattern: /fiyat|ücret|ne kadar|maliyet|price|cost|كم|سعر|цена/i, category: 'intent', tag: 'Fiyat Sordu', scoreContribution: 10, confidence: 0.85 },
    { id: 'intent_appointment_confirm', pattern: /geleceğim|geliyorum|gelirim|hemen gel|ayarlayın|ayarlayalım|planlayalım|onaylıyorum|kabul/i, category: 'intent', tag: 'Randevu Onayı', scoreContribution: 25, confidence: 0.95, isTerminal: true },
    { id: 'intent_appointment_interest', pattern: /randevu|appointment|موعد|запись|termin|rendez|müsait|ne zaman|gelebilir|gelmek istiyorum|görüşelim|görşelim|uygun|saat\s*\d+|tarih|sabah|öğle|akşam|yarın|bugün/i, category: 'intent', tag: 'Randevu İlgisi', scoreContribution: 15, confidence: 0.8 },
    { id: 'intent_short_approval', pattern: /^(olur|tamam|evet|uygun)$/i, category: 'intent', tag: 'Kısa Onay', scoreContribution: 10, confidence: 0.7 },
    { id: 'intent_lost_patient', pattern: /istemiyorum|gerek yok|başka\s+hastane(?:ye|de|den)?\s+(?:gittim|gideceğim|gitmeye\s+karar|tercih\s+ettim)|başka yere|vazgeçtim|iptal|cancel|no thanks|لا شكرا|не нужно|kein interesse|pas intéressé|almıyorum|gitmeye.*karar|başka.*(doktor|yer)/i, category: 'intent', tag: 'Kaybedildi', scoreContribution: -50, confidence: 0.95, isTerminal: true },

    // --- Patient Types ---
    { id: 'type_expat', pattern: /almanya|deutschland|germany|hollanda|fransa|belçika|avusturya|ingiltere|isviçre|gurbetçi|abroad|yurtdışı/i, category: 'patient_type', tag: 'Gurbetçi', scoreContribution: 30, confidence: 0.9 }
  ]
};

export const GenericRuleset_V1: TenantRuleset = {
  version: "v1.0",
  tenantSlug: "generic",
  industry: "general",
  rules: [
    // --- Intent Signals ---
    { id: 'intent_price', pattern: /fiyat|ücret|ne kadar|maliyet|price|cost|كم|سعر|цена/i, category: 'intent', tag: 'Fiyat Sordu', scoreContribution: 10, confidence: 0.85 },
    { id: 'intent_appointment_confirm', pattern: /geleceğim|geliyorum|gelirim|hemen gel|ayarlayın|ayarlayalım|planlayalım|onaylıyorum|kabul/i, category: 'intent', tag: 'Onay', scoreContribution: 25, confidence: 0.95, isTerminal: true },
    { id: 'intent_appointment_interest', pattern: /randevu|appointment|موعد|запись|termin|rendez|müsait|ne zaman|gelebilir|gelmek istiyorum|görüşelim|görşelim|uygun|saat\s*\d+|tarih|sabah|öğle|akşam|yarın|bugün/i, category: 'intent', tag: 'İlgi', scoreContribution: 15, confidence: 0.8 },
    { id: 'intent_short_approval', pattern: /^(olur|tamam|evet|uygun)$/i, category: 'intent', tag: 'Kısa Onay', scoreContribution: 10, confidence: 0.7 },
    { id: 'intent_lost_patient', pattern: /istemiyorum|gerek yok|başka yere|vazgeçtim|iptal|cancel|no thanks|لا شكra|не нужно|kein interesse|pas intéressé|almıyorum/i, category: 'intent', tag: 'Vazgeçti', scoreContribution: -50, confidence: 0.95, isTerminal: true },
  ]
};
