export interface FormExtraction {
  department: string | null;
  complaint: string | null;
  reportStatus: 'none' | 'waiting' | 'sent' | 'received' | 'reviewed' | null;
  appointmentPref: string | null;
  age: string | null;
  country: string | null;
  departmentSource: 'campaign_name' | 'form_name' | 'complaint_keyword' | null;
  confidence: number;
}

const DEPARTMENT_MAP: Record<string, string> = {
  'ORTOPEDİ': 'Ortopedi',
  'ORTOPEDI': 'Ortopedi',
  'BEL FITIĞI': 'Ortopedi',
  'DİZ': 'Ortopedi',
  'DIZ': 'Ortopedi',
  'KADİYOLOJİ': 'Kardiyoloji',
  'KARDIYOLOJI': 'Kardiyoloji',
  'KARDİYOLOJİ': 'Kardiyoloji',
  'KALP': 'Kardiyoloji',
  'SAÇ EKİMİ': 'Saç Ekimi',
  'SAC EKIMI': 'Saç Ekimi',
  'HAIR': 'Saç Ekimi',
  'DİŞ': 'Diş',
  'DIS': 'Diş',
  'DENTAL': 'Diş',
  'GÖZ': 'Göz',
  'GOZ': 'Göz',
  'OFTALMOLOJİ': 'Göz',
  'CHECK-UP': 'Check-Up',
  'CHECK UP': 'Check-Up',
  'NÖROLOJİ': 'Nöroloji',
  'NEURO': 'Nöroloji',
  'ÜROLOJİ': 'Üroloji',
  'UROLOJI': 'Üroloji',
  'ESTETİK': 'Estetik',
  'ESTETIK': 'Estetik',
  'OBEZİTE': 'Obezite',
  'OBEZITE': 'Obezite',
  'TÜP BEBEK': 'Tüp Bebek',
  'TUP BEBEK': 'Tüp Bebek',
  'ONKOLOJİ': 'Onkoloji',
  'ORGAN NAKLİ': 'Organ Nakli',
  'PSİKİYATRİ': 'Psikiyatri',
  'FİZİK TEDAVİ': 'Fizik Tedavi',
  'GASTRO': 'Gastroenteroloji'
};

// Deterministic Turkish keyword mapping for complaint texts in the form
const COMPLAINT_KEYWORD_MAP: { keywords: string[]; department: string; confidence: number }[] = [
  { keywords: ['çarpıntı', 'kalp', 'kalp doktoru', 'ritim', 'kalp krizi', 'bypass', 'kardiyoloji'], department: 'Kardiyoloji', confidence: 1.0 },
  { keywords: ['diz', 'diz ağrısı', 'menisküs', 'eklem', 'kireçlenme', 'dizim ağrıyor', 'kalça protezi', 'diz protezi'], department: 'Ortopedi', confidence: 1.0 },
  { keywords: ['bel ağrısı', 'boyun fıtığı', 'fıtık', 'siyatik', 'bel fıtığı', 'bel'], department: 'Ortopedi', confidence: 0.5 }, // Medium confidence
  { keywords: ['diş', 'implant', 'dolgu', 'kanal tedavisi', 'zirkonyum'], department: 'Diş', confidence: 1.0 },
  { keywords: ['göz', 'görme', 'katarakt', 'lazer göz', 'retina'], department: 'Göz', confidence: 1.0 },
  { keywords: ['saç ekimi', 'saç dökülmesi', 'sacekim'], department: 'Saç Ekimi', confidence: 1.0 },
  { keywords: ['check-up', 'check up', 'genel kontrol', 'checkup'], department: 'Check-Up', confidence: 1.0 }
];

export function extractFormFields(rawData: any): FormExtraction {
  const result: FormExtraction = {
    department: null,
    complaint: null,
    reportStatus: 'none',
    appointmentPref: null,
    age: null,
    country: null,
    departmentSource: null,
    confidence: 0.0
  };

  if (!rawData || typeof rawData !== 'object') {
    return result;
  }

  // 1. Try to extract from campaign name
  const campaignName = String(rawData.campaign_name || rawData.campaignName || '').toUpperCase();
  if (campaignName) {
    for (const [key, dept] of Object.entries(DEPARTMENT_MAP)) {
      if (campaignName.includes(key)) {
        result.department = dept;
        result.departmentSource = 'campaign_name';
        result.confidence = 1.0;
        break;
      }
    }
  }

  // 2. Try to extract from form name
  if (!result.department) {
    const formName = String(rawData.form_name || rawData.formName || '').toUpperCase();
    if (formName) {
      for (const [key, dept] of Object.entries(DEPARTMENT_MAP)) {
        if (formName.includes(key)) {
          result.department = dept;
          result.departmentSource = 'form_name';
          result.confidence = 1.0;
          break;
        }
      }
    }
  }

  // Find form keys dynamically to get complaint, report status, appointment preference, country and age
  let rawComplaint: string | null = null;
  let rawReportStatus: string | null = null;
  let rawAppointmentPref: string | null = null;
  let rawAge: string | null = null;
  let rawCountry: string | null = null;

  for (const [key, value] of Object.entries(rawData)) {
    const k = key.toLowerCase()
      .replace(/ı/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/[^a-z0-9]/g, '');
    
    const valStr = String(value || '').trim();

    // Match complaint keys
    if (
      k.includes('sikayet') || 
      k.includes('sagligidurumu') || 
      k.includes('durumunuzunasil') || 
      k.includes('hastaliginiz') ||
      k.includes('complaint')
    ) {
      rawComplaint = valStr;
    }
    // Match report/MR status keys
    else if (
      k.includes('mrveyarontgen') || 
      k.includes('mrverontgen') || 
      k.includes('filmcektirdiniz') || 
      k.includes('tetkik') || 
      k.includes('rapor')
    ) {
      rawReportStatus = valStr;
    }
    // Match appointment pref keys
    else if (
      k.includes('nezamanarayalim') || 
      k.includes('randevutercih') || 
      k.includes('iletisimzamani') || 
      k.includes('randevutarih')
    ) {
      rawAppointmentPref = valStr;
    }
    // Match age keys
    else if (
      k.includes('yasiniz') || 
      k.includes('yas') || 
      k.includes('dogumtarihi')
    ) {
      rawAge = valStr;
    }
    // Match country keys
    else if (
      k.includes('country') ||
      k.includes('ulke') ||
      k.includes('neredeyasiyorsunuz') ||
      k.includes('ulkeniz')
    ) {
      rawCountry = valStr;
    }
  }

  result.complaint = rawComplaint;
  result.appointmentPref = rawAppointmentPref;
  result.age = rawAge;
  result.country = rawCountry;

  // Normalize report status values
  if (rawReportStatus) {
    const rs = rawReportStatus.toLowerCase();
    if (rs.includes('evet') || rs.includes('var') || rs.includes('gonderdim') || rs.includes('sent')) {
      result.reportStatus = 'sent';
    } else if (rs.includes('bekliyor') || rs.includes('waiting') || rs.includes('sonra')) {
      result.reportStatus = 'waiting';
    } else if (rs.includes('hayir') || rs.includes('yok') || rs.includes('no')) {
      result.reportStatus = 'none';
    } else {
      result.reportStatus = 'none';
    }
  }

  // 3. Fallback to parsing complaint keyword if department is still unresolved
  if (!result.department && rawComplaint) {
    const compLower = rawComplaint.toLowerCase();
    let bestMatch: { department: string; confidence: number } | null = null;

    for (const group of COMPLAINT_KEYWORD_MAP) {
      for (const keyword of group.keywords) {
        if (compLower.includes(keyword)) {
          if (!bestMatch || group.confidence > bestMatch.confidence) {
            bestMatch = { department: group.department, confidence: group.confidence };
          }
        }
      }
    }

    if (bestMatch) {
      result.department = bestMatch.department;
      result.departmentSource = 'complaint_keyword';
      result.confidence = bestMatch.confidence;
    }
  }

  return result;
}
