import { isValidPatientName } from '@/lib/utils/patient-name-resolver';

export type PatientKnownFacts = {
  name?: string;
  complaint?: string;
  availableTime?: string;
  askedDoctors?: boolean;
  askedProcess?: boolean;
  askedPrice?: boolean;
  previousDepartments?: string[];
  hasLinkedForm?: boolean;
  formTopic?: string;
  countryOrLanguageHint?: string;
};

export class ConversationKnownFactsResolver {
  /**
   * Resolves structured PatientKnownFacts from unified context and history.
   * Completely safe: parses metadata and context without leaking raw JSON or dumps.
   */
  public static resolve(params: {
    history: { role: string; content: string }[];
    opportunity?: any;
    profile?: any;
    latestForm?: any;
    conversation?: any;
    patient_known_facts?: string[];
  }): PatientKnownFacts {
    const { history = [], opportunity, profile, latestForm, conversation, patient_known_facts } = params;

    const facts: PatientKnownFacts = {
      askedDoctors: false,
      askedProcess: false,
      askedPrice: false,
      previousDepartments: [],
      hasLinkedForm: !!latestForm,
      formTopic: latestForm?.name || undefined,
    };

    // Parse any existing string-based patient_known_facts for compatibility
    if (Array.isArray(patient_known_facts)) {
      for (const fact of patient_known_facts) {
        if (typeof fact === 'string') {
          const lowerFact = fact.toLowerCase();
          if (lowerFact.includes('şikayet') || lowerFact.includes('sikayet')) {
            const match = fact.match(/(?:şikayeti|sikayeti|şikayet|sikayet):\s*(.+)/i);
            if (match && match[1]) {
              facts.complaint = match[1].replace(/[.]+$/, '').trim();
            }
          }
          if (lowerFact.includes('adı') || lowerFact.includes('adi') || lowerFact.includes('hastanın adı') || lowerFact.includes('hastanin adi')) {
            const match = fact.match(/(?:adı|adi|hastanın adı|hastanin adi):\s*(.+)/i);
            if (match && match[1]) {
              facts.name = match[1].replace(/[.]+$/, '').trim();
            }
          }
          if (lowerFact.includes('tarih') || lowerFact.includes('zaman')) {
            const match = fact.match(/(?:tarih aralığı|uygun olduğu tarih aralığı|tarih|zaman):\s*(.+)/i);
            if (match && match[1]) {
              facts.availableTime = match[1].replace(/[.]+$/, '').trim();
            }
          }
        }
      }
    }

    // 1. Resolve Country/Language Hint
    const country = opportunity?.country || profile?.country || conversation?.country || null;
    if (country && typeof country === 'string' && country.trim().length > 0) {
      facts.countryOrLanguageHint = country.trim();
    }

    // 2. Resolve Name
    let resolvedName = '';
    
    // Check opportunity patient name
    if (opportunity?.patient_name && isValidPatientName(opportunity.patient_name)) {
      resolvedName = opportunity.patient_name.trim();
    } else if (opportunity?.metadata?.patient_name && isValidPatientName(opportunity.metadata.patient_name)) {
      resolvedName = opportunity.metadata.patient_name.trim();
    }

    // Check conversation patient name
    if (!resolvedName && conversation?.patient_name && isValidPatientName(conversation.patient_name)) {
      resolvedName = conversation.patient_name.trim();
    } else if (!resolvedName && conversation?.name && isValidPatientName(conversation.name)) {
      resolvedName = conversation.name.trim();
    }

    // Check form raw data full_name
    if (!resolvedName && latestForm?.data) {
      const data = typeof latestForm.data === 'string' ? (() => {
        try { return JSON.parse(latestForm.data); } catch { return {}; }
      })() : latestForm.data;
      const formName = data?.full_name || data?.ad_soyad || data?.name || '';
      if (formName && isValidPatientName(formName)) {
        resolvedName = String(formName).trim();
      }
    }

    // Check profile
    if (!resolvedName && profile?.first_name && isValidPatientName(profile.first_name)) {
      resolvedName = profile.first_name.trim();
    }

    // Scan history for user name introduction
    if (!resolvedName && history.length > 0) {
      const nameRegexes = [
        /\bismim\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
        /\badım\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
        /\badim\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i,
        /\bben\s+([a-zA-ZçıüşöğİÇIÜŞÖĞ\s]+)/i
      ];

      for (const m of history) {
        if (m.role !== 'user' || !m.content) continue;
        for (const regex of nameRegexes) {
          const match = m.content.match(regex);
          if (match && match[1]) {
            const candidate = match[1].split(/[.,!?\s]+/)[0].trim();
            if (isValidPatientName(candidate)) {
              resolvedName = candidate;
              break;
            }
          }
        }
        if (resolvedName) break;
      }
    }

    if (resolvedName) {
      // Capitalize first letter properly (supporting Turkish İ/ı)
      const firstChar = resolvedName.charAt(0);
      const upperFirst = firstChar === 'i' ? 'İ' : (firstChar === 'ı' ? 'I' : firstChar.toUpperCase());
      facts.name = upperFirst + resolvedName.slice(1);
    }

    // 3. Resolve Complaint
    let resolvedComplaint = '';
    
    // Check opportunity summary or metadata
    if (opportunity?.metadata?.complaint) {
      resolvedComplaint = String(opportunity.metadata.complaint).trim();
    }

    // Check form raw data
    if (!resolvedComplaint && latestForm?.data) {
      const data = typeof latestForm.data === 'string' ? (() => {
        try { return JSON.parse(latestForm.data); } catch { return {}; }
      })() : latestForm.data;
      const formComplaint = data?.sikayet || data?.şikayet || data?.şikayetiniz_nedir || data?.sikayetiniz_nedir || '';
      if (formComplaint) {
        resolvedComplaint = String(formComplaint).trim();
      }
    }

    // Scan history for complaint keywords (last message takes precedence)
    const complaintKeywords = [
      { kw: 'bel fıtığı', canonical: 'bel fıtığı' },
      { kw: 'bel fitigi', canonical: 'bel fıtığı' },
      { kw: 'boyun fıtığı', canonical: 'boyun fıtığı' },
      { kw: 'boyun fitigi', canonical: 'boyun fıtığı' },
      { kw: 'fıtık', canonical: 'fıtık' },
      { kw: 'fitik', canonical: 'fıtık' }
    ];

    if (!resolvedComplaint && history.length > 0) {
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.role !== 'user' || !m.content) continue;
        const lowerContent = m.content.toLowerCase();
        const found = complaintKeywords.find(item => lowerContent.includes(item.kw));
        if (found) {
          resolvedComplaint = found.canonical;
          break;
        }
      }
    }

    if (resolvedComplaint) {
      facts.complaint = resolvedComplaint;
    }

    // 4. Resolve Available Time / Travel Date
    let resolvedTime = opportunity?.travel_date || opportunity?.metadata?.travel_date || '';

    // Check form raw data for available time
    if (!resolvedTime && latestForm?.data) {
      const data = typeof latestForm.data === 'string' ? (() => {
        try { return JSON.parse(latestForm.data); } catch { return {}; }
      })() : latestForm.data;
      const formTime = data?.randevu_ayi || data?.randevu_tarihi || data?.ne_zaman_gelmek_istiyorsunuz || '';
      if (formTime) {
        resolvedTime = String(formTime).trim();
      }
    }

    // Scan history for travel date / available time
    const months = [
      'ocak', 'şubat', 'subat', 'mart', 'nisan', 'mayıs', 'mayis', 'haziran',
      'temmuz', 'ağustos', 'agustos', 'eylül', 'eylul', 'ekim', 'kasım', 'kasim', 'aralık', 'aralik'
    ];

    if (!resolvedTime && history.length > 0) {
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m.role !== 'user' || !m.content) continue;
        const lowerContent = m.content.toLowerCase();
        
        // Find if user mentions a month
        const foundMonth = months.find(mo => lowerContent.includes(mo));
        if (foundMonth) {
          // Check for contextual indicators
          if (lowerContent.includes('ayında') || lowerContent.includes('gelebilirim') || lowerContent.includes('iznim var') || lowerContent.includes('planlıyorum') || lowerContent.includes('düşünüyorum')) {
            const canonicalMonth = foundMonth === 'agustos' ? 'ağustos' : (foundMonth === 'subat' ? 'şubat' : (foundMonth === 'mayis' ? 'mayıs' : (foundMonth === 'eylul' ? 'eylül' : (foundMonth === 'kasim' ? 'kasım' : foundMonth))));
            resolvedTime = `${canonicalMonth} ayı`;
            break;
          }
        }
      }
    }

    if (resolvedTime) {
      facts.availableTime = resolvedTime;
    }

    // 5. Scan History for Asked Flags
    if (history.length > 0) {
      for (const m of history) {
        if (!m.content) continue;
        const lower = m.content.toLowerCase();

        // Asked Doctors
        if (!facts.askedDoctors && m.role === 'user' && ['doktor', 'hekim', 'uzman', 'cerrah'].some(kw => lower.includes(kw))) {
          facts.askedDoctors = true;
        }

        // Asked Process
        if (!facts.askedProcess && m.role === 'user' && ['süreç', 'surec', 'nasıl işliyor', 'nasil isliyor', 'işleyiş', 'isleyis'].some(kw => lower.includes(kw))) {
          facts.askedProcess = true;
        }

        // Asked Price
        if (!facts.askedPrice && m.role === 'user' && ['fiyat', 'ücret', 'ucret', 'tutar', 'ne kadar', 'kac para'].some(kw => lower.includes(kw))) {
          facts.askedPrice = true;
        }
      }
    }

    // 6. Resolve Previous Departments
    const deptSet = new Set<string>();
    const dept = opportunity?.department || conversation?.department || null;
    if (dept && typeof dept === 'string' && dept.trim().length > 0) {
      deptSet.add(dept.trim());
    }

    // Scan history for departments
    const departmentsList = [
      'Beyin ve Sinir Cerrahisi',
      'Fizik Tedavi ve Rehabilitasyon',
      'Fizik Tedavi',
      'Kardiyoloji',
      'Dahiliye',
      'Ortopedi'
    ];

    for (const m of history) {
      if (!m.content) continue;
      for (const d of departmentsList) {
        if (m.content.toLowerCase().includes(d.toLowerCase())) {
          deptSet.add(d);
        }
      }
    }

    if (deptSet.size > 0) {
      facts.previousDepartments = Array.from(deptSet);
    }

    return facts;
  }

  /**
   * Formats structured PatientKnownFacts into clean, safe string sentences.
   * Completely avoids raw message/JSON leakage.
   */
  public static formatFacts(facts: PatientKnownFacts): string[] {
    const list: string[] = [];
    if (facts.name) {
      list.push(`Hastanın adı: ${facts.name}.`);
    }
    if (facts.complaint) {
      list.push(`Şikayeti: ${facts.complaint}.`);
    }
    if (facts.availableTime) {
      list.push(`Gelmek istediği/uygun olduğu tarih aralığı: ${facts.availableTime}.`);
    }
    if (facts.previousDepartments && facts.previousDepartments.length > 0) {
      list.push(`İlgilendiği veya yönlendirildiği bölümler: ${facts.previousDepartments.join(', ')}.`);
    }
    if (facts.askedDoctors) {
      list.push(`Hasta hekim/doktor isimlerini sordu.`);
    }
    if (facts.askedProcess) {
      list.push(`Hasta süreç/tedavi işleyişini sordu.`);
    }
    if (facts.askedPrice) {
      list.push(`Hasta fiyat/ücret bilgisini sordu.`);
    }
    if (facts.hasLinkedForm) {
      list.push(`Sistemde bağlı bir form başvurusu bulunmaktadır${facts.formTopic ? ` (Konu: ${facts.formTopic})` : ''}.`);
    }
    if (facts.countryOrLanguageHint) {
      list.push(`Hastanın bulunduğu ülke veya dil ipucu: ${facts.countryOrLanguageHint}.`);
    }
    return list;
  }
}
