import { isValidPatientName } from '@/lib/utils/patient-name-resolver';

export type RelatedPersonFact = {
  relation: 'mother' | 'father' | 'spouse' | 'relative' | 'acquaintance';
  topic?: string;
  urgency?: string;
};

export type PatientKnownFacts = {
  name?: string;
  complaint?: string; // Backwards compatibility getter/field
  self?: {
    complaint?: string;
    symptoms?: string[];
    location?: string;
  };
  relatedPersons?: RelatedPersonFact[];
  availableTime?: string;
  formDepartment?: string; // Recommended department from form (onerilen_bolum)
  askedDoctors?: boolean;
  askedProcess?: boolean;
  askedPrice?: boolean;
  previousDepartments?: string[];
  hasLinkedForm?: boolean;
  formTopic?: string;
  countryOrLanguageHint?: string;
  scheduledCall?: {
    time?: string;
    note?: string;
  };
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
          if (lowerFact.includes('yakın') || lowerFact.includes('yakin') || lowerFact.includes('anne') || lowerFact.includes('baba') || lowerFact.includes('eşi') || lowerFact.includes('esi')) {
            const match = fact.match(/(?:konusu|şikayeti|şikayet|sikayet):\s*(.+)/i);
            const topic = match && match[1] ? match[1].replace(/[.]+$/, '').trim() : fact;
            let relation: 'mother' | 'father' | 'spouse' | 'relative' = 'relative';
            if (lowerFact.includes('anne')) relation = 'mother';
            else if (lowerFact.includes('baba')) relation = 'father';
            else if (lowerFact.includes('eşi') || lowerFact.includes('esi')) relation = 'spouse';
            
            if (!facts.relatedPersons) facts.relatedPersons = [];
            facts.relatedPersons.push({
              relation,
              topic
            });
          } else if (lowerFact.includes('şikayet') || lowerFact.includes('sikayet')) {
            const match = fact.match(/(?:şikayeti|sikayeti|şikayet|sikayet):\s*(.+)/i);
            if (match && match[1]) {
              if (!facts.self) facts.self = {};
              facts.self.complaint = match[1].replace(/[.]+$/, '').trim();
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
    // Priority: opportunity > profile > conversation > form safeData.country
    const country = opportunity?.country || profile?.country || conversation?.country || null;
    if (country && typeof country === 'string' && country.trim().length > 0) {
      facts.countryOrLanguageHint = country.trim();
    } else if (latestForm?.data) {
      // Use safeData.country (normalized key lookup already done by safeLatestForm)
      const formData = typeof latestForm.data === 'string' ? (() => { try { return JSON.parse(latestForm.data); } catch { return {}; } })() : latestForm.data;
      const formCountry = formData?.country || null;
      if (formCountry && typeof formCountry === 'string' && formCountry.trim().length > 0) {
        facts.countryOrLanguageHint = formCountry.trim();
      }
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

    // 3. Resolve Self & Related Persons facts
    const self: { complaint?: string; symptoms: string[]; location?: string } = {
      symptoms: []
    };
    const relatedPersons: RelatedPersonFact[] = [];

    if (facts.countryOrLanguageHint) {
      self.location = facts.countryOrLanguageHint;
    }

    const relationshipMapping = [
      { keys: ['annem', 'annemin', 'annesi', 'anne'], relation: 'mother' as const, label: 'Annesi' },
      { keys: ['babam', 'babamın', 'babası', 'baba'], relation: 'father' as const, label: 'Babası' },
      { keys: ['eşim', 'eşimin', 'eşi', 'karım', 'kocam', 'esim', 'esimin', 'esi'], relation: 'spouse' as const, label: 'Eşi' },
      { keys: ['kardeşim', 'abim', 'ablam', 'çocuğum', 'oğlum', 'kızım', 'teyzem', 'halam', 'dayım', 'amcam', 'kardesim', 'cocugum', 'oglum', 'kizim'], relation: 'relative' as const, label: 'Yakını' },
      { keys: ['arkadaşım', 'tanıdığım', 'biri', 'arkadasim', 'tanidigim'], relation: 'acquaintance' as const, label: 'Tanıdığı' }
    ];

    const symptomKeywords = ['ağrı', 'agri', 'uyuşma', 'uyusma', 'fıtık', 'fitik', 'sancı', 'sanci', 'lezyon', 'kist', 'ağrısı', 'agrisi'];

    for (const m of history) {
      if (m.role !== 'user' || !m.content) continue;
      const lower = m.content.toLowerCase();

      // Extract symptoms safely using Unicode word tokens
      const tokens = lower.split(/[^\p{L}\p{N}]+/u);
      for (const kw of symptomKeywords) {
        const matches = tokens.some(t => {
          if (t === kw) return true;
          if (kw.length >= 4 && t.startsWith(kw)) {
            // Prevent false match for 'kist' in 'özbekistan' / 'uzbekistan'
            if (kw === 'kist' && (t.startsWith('özbekistan') || t.startsWith('uzbekistan') || t.startsWith('ozbekistan'))) return false;
            return true;
          }
          return false;
        });
        if (matches && !self.symptoms.includes(kw)) {
          self.symptoms.push(kw);
        }
      }

      // Check if location is mentioned, e.g. "Kaliforniya'dan yazıyorum"
      const locMatch = m.content.match(/\b([A-ZÇĞİÖŞÜa-zçğışöü]+)'?(?:dan|den|danım|denim|dayım|deyim|ta|te|tan|ten|dan yazıyorum|den yazıyorum)\b/i);
      if (locMatch && locMatch[1]) {
        const candidate = locMatch[1].trim();
        const ignoreList = ['ben', 'sen', 'biz', 'siz', 'onlar', 'bunu', 'şunu', 'orada', 'burada', 'nereden', 'oradan', 'buradan'];
        if (candidate.length > 3 && !ignoreList.includes(candidate.toLowerCase())) {
          self.location = candidate;
        }
      }

      // Check relationship mentions
      let foundRelation = false;
      for (const rel of relationshipMapping) {
        if (rel.keys.some(key => lower.includes(key))) {
          foundRelation = true;
          let topic: string | undefined = undefined;
          
          if (lower.includes('nakil') || lower.includes('transplant') || lower.includes('karaciğer') || lower.includes('böbrek') || lower.includes('karaciger') || lower.includes('bobrek')) {
            if (lower.includes('karaciğer') || lower.includes('karaciger') || lower.includes('liver')) topic = 'Karaciğer nakli';
            else if (lower.includes('böbrek') || lower.includes('bobrek') || lower.includes('kidney')) topic = 'Böbrek nakli';
            else topic = 'Organ nakli';
          } else if (lower.includes('fıtık') || lower.includes('fitik')) {
            if (lower.includes('bel')) topic = 'Bel fıtığı';
            else if (lower.includes('boyun')) topic = 'Boyun fıtığı';
            else topic = 'Fıtık';
          }

          let urgency = undefined;
          if (lower.includes('acil') || lower.includes('hemen') || lower.includes('kötü') || lower.includes('kotu')) {
            urgency = 'high';
          }

          const existing = relatedPersons.find(rp => rp.relation === rel.relation);
          if (existing) {
            if (topic) existing.topic = topic;
            if (urgency) existing.urgency = urgency;
          } else {
            relatedPersons.push({
              relation: rel.relation,
              topic,
              urgency
            });
          }
        }
      }

      // If no relationship was mentioned, check if self complaint
      if (!foundRelation) {
        if (lower.includes('fıtık') || lower.includes('fitik') || lower.includes('belim') || lower.includes('boynum')) {
          if (lower.includes('bel')) self.complaint = 'Bel fıtığı';
          else if (lower.includes('boyn')) self.complaint = 'Boyun fıtığı';
          else self.complaint = 'Fıtık';
        } else if (lower.includes('kalp') || lower.includes('anjiyo') || lower.includes('bypass') || lower.includes('kardiyo')) {
          self.complaint = 'Kardiyoloji';
        }
      }
    }

    // Fallbacks from opportunity/form
    if (!self.complaint) {
      if (opportunity?.metadata?.complaint) {
        self.complaint = opportunity.metadata.complaint;
      } else if (latestForm?.data) {
        const data = typeof latestForm.data === 'string' ? (() => { try { return JSON.parse(latestForm.data); } catch { return {}; } })() : latestForm.data;
        // Primary: sikayet field
        const formComplaint = data?.sikayet || data?.complaint || null;
        // Fallback: randevu_tercihi (many forms put complaint text there)
        const formAppointmentPref = data?.randevu_tercihi || null;
        if (formComplaint) {
          self.complaint = formComplaint;
        } else if (formAppointmentPref) {
          self.complaint = formAppointmentPref;
        }
      }
    }

    // Resolve recommended department from form (onerilen_bolum)
    if (latestForm?.data) {
      const data = typeof latestForm.data === 'string' ? (() => { try { return JSON.parse(latestForm.data); } catch { return {}; } })() : latestForm.data;
      const formDept = data?.onerilen_bolum || null;
      if (formDept && typeof formDept === 'string' && formDept.trim().length > 0) {
        facts.formDepartment = formDept.trim();
      }
    }


    if (facts.self) {
      self.complaint = self.complaint || facts.self.complaint;
      self.location = self.location || facts.self.location;
      self.symptoms = self.symptoms.length > 0 ? self.symptoms : (facts.self.symptoms || []);
    }
    facts.self = self;
    if (facts.relatedPersons && facts.relatedPersons.length > 0) {
      relatedPersons.push(...facts.relatedPersons);
    }
    facts.relatedPersons = relatedPersons;

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
        
        const foundMonth = months.find(mo => lowerContent.includes(mo));
        if (foundMonth) {
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

    const departmentsList = [
      'Beyin ve Sinir Cerrahisi',
      'Fizik Tedavi ve Rehabilitasyon',
      'Fizik Tedavi',
      'Kardiyoloji',
      'Dahiliye',
      'Ortopedi',
      'Organ Nakli Merkezi',
      'Plastik ve Rekonstrüktif Cerrahi'
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

    // 7. Resolve Scheduled Call
    const lastCallAction = opportunity?.outreachContext?.lastCallAction || conversation?.outreachContext?.lastCallAction;
    const lastCallNote = opportunity?.outreachContext?.lastCallNote || conversation?.outreachContext?.lastCallNote;
    if (lastCallAction) {
      facts.scheduledCall = {
        time: lastCallAction,
        note: lastCallNote || undefined
      };
    }

    if (facts.self?.complaint) {
      facts.complaint = facts.self.complaint;
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

    // Self facts
    if (facts.self) {
      if (facts.self.complaint) {
        list.push(`Kendisinin şikayeti: ${facts.self.complaint}.`);
      }
      if (facts.self.symptoms && facts.self.symptoms.length > 0) {
        list.push(`Kendisinin belirttiği şikayet belirtileri: ${facts.self.symptoms.join(', ')}.`);
      }
      if (facts.self.location) {
        list.push(`Kendisinin bulunduğu konum: ${facts.self.location}.`);
      }
    }

    // Related person facts
    if (facts.relatedPersons && facts.relatedPersons.length > 0) {
      for (const rp of facts.relatedPersons) {
        const relLabel = rp.relation === 'mother' ? 'Annesi' 
                       : rp.relation === 'father' ? 'Babası'
                       : rp.relation === 'spouse' ? 'Eşi'
                       : rp.relation === 'relative' ? 'Yakını'
                       : 'Tanıdığı';
        list.push(`Yakını (${relLabel}) konusu: ${rp.topic || 'Belirtilmedi'}${rp.urgency ? ` (Durum acil)` : ''}.`);
      }
    }

    if (facts.availableTime) {
      list.push(`Gelmek istediği/uygun olduğu tarih aralığı: ${facts.availableTime}.`);
    }
    if (facts.formDepartment) {
      list.push(`Formdan gelen önerilen bölüm: ${facts.formDepartment}.`);
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
    if (facts.countryOrLanguageHint && !facts.self?.location) {
      list.push(`Hastanın bulunduğu ülke veya dil ipucu: ${facts.countryOrLanguageHint}.`);
    }
    if (facts.scheduledCall) {
      list.push(`Arama durumu/notu: ${facts.scheduledCall.time}${facts.scheduledCall.note ? ` - Not: ${facts.scheduledCall.note}` : ''}.`);
    }
    return list;
  }
}
