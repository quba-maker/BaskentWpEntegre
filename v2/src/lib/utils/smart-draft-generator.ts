/**
 * Deterministik Akıllı Karşılama Taslağı Üreticisi
 * LLM API maliyeti yaratmadan, form verilerini analiz ederek güvenli taslaklar üretir.
 */

export function generateSmartDraft(rawData: any, defaultFormName?: string): string {
  const data = typeof rawData === 'string' ? JSON.parse(rawData || '{}') : (rawData || {});

  // 1. Normalize Extracted Fields
  const department = extractField(data, ['department', 'departman', 'bolum', 'bölüm', 'klinik']);
  const complaint = extractField(data, ['complaint', 'sikayet', 'şikayet', 'hastalık', 'sorun', 'neden']);
  const treatments = extractField(data, ['previous_treatments', 'gecmis_islem', 'geçmiş işlem', 'ameliyat', 'tedavi']);
  
  // 2. Build the Form Summary Sentence
  let summarySentence = '';
  
  // Custom department mappings for safe sentences
  const deptLower = (department || defaultFormName || '').toLowerCase();
  
  if (deptLower.includes('kardiyoloji') || deptLower.includes('kalp') || (treatments && treatments.toLowerCase().match(/(anjiyo|stent|bypass)/))) {
    const hasSpecificTreatment = treatments && treatments.toLowerCase().match(/(anjiyo|stent|bypass)/);
    const summaryAction = hasSpecificTreatment ? 'anjiyo, stent veya bypass işlemi' : 'kalp damar sağlığınızla ilgili işlem';
    summarySentence = `Formunuzda daha önce ${summaryAction} geçirdiğinizi ve kontrol amaçlı değerlendirilmek istediğinizi belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nKalp ve damar sağlığıyla ilgili takiplerde düzenli kontrol önemlidir. Hastanemize geldiğinizde kardiyoloji hekimimiz tarafından gerekli muayene ve değerlendirmeler yapılır, uygun takip süreci hakkında bilgilendirme sağlanır.`;
  } 
  else if (deptLower.includes('ortopedi') || (complaint && complaint.toLowerCase().match(/(diz|eklem|omuz|kalça|kemik)/))) {
    let sikayetOzet = 'ortopedik şikayetlerinizle';
    if (complaint) {
      const c = complaint.toLowerCase();
      if (c.includes('diz')) sikayetOzet = 'diz ağrısı ve şikayetlerinizle';
      else if (c.includes('omuz')) sikayetOzet = 'omuz ağrısı ve şikayetlerinizle';
      else if (c.includes('kalça')) sikayetOzet = 'kalça ağrısı ve şikayetlerinizle';
    }
    summarySentence = `Formunuzda ${sikayetOzet} değerlendirilmek istediğinizi belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nOrtopedik rahatsızlıklarda doğru değerlendirme büyük önem taşır. Hastanemize geldiğinizde ortopedi hekimimiz tarafından gerekli muayene ve değerlendirmeler yapılarak mevcut durumunuz incelenir ve uygun takip süreci hakkında detaylı bilgi verilir.`;
  }
  else if (deptLower.includes('beyin') || deptLower.includes('nöro') || (complaint && complaint.toLowerCase().match(/(bel|boyun|omurga|sinir)/))) {
    let sikayetOzet = 'beyin ve sinir cerrahisi alanındaki şikayetlerinizle';
    if (complaint) {
      const c = complaint.toLowerCase();
      if (c.includes('bel fıtığı') || c.includes('bel')) sikayetOzet = 'bel fıtığı ve ağrı şikayetiyle';
      else if (c.includes('boyun')) sikayetOzet = 'boyun fıtığı ve ağrı şikayetiyle';
    }
    summarySentence = `Formunuzda ${sikayetOzet} değerlendirilmek istediğinizi belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nOmurga ve sinir sistemi sağlığında detaylı klinik inceleme çok önemlidir. Hastanemize geldiğinizde ilgili hekimimiz tarafından gerekli muayene ve değerlendirmeler yapılarak mevcut durumunuz ayrıntılı şekilde incelenir ve size uygun takip süreci hakkında detaylı bilgi verilir.`;
  }
  else if (deptLower.includes('check-up') || deptLower.includes('checkup') || deptLower.includes('check up')) {
    summarySentence = `Formunuzda Check-up programlarımızla ilgilendiğinizi belirttiğinizi görüyoruz. Sağlığınıza gösterdiğiniz özen için tebrik ederiz.\n\nCheck-up programlarımız yaşınıza, cinsiyetinize ve tıbbi geçmişinize özel olarak planlanmaktadır. Hastanemize geldiğinizde ilgili hekimlerimiz tarafından gerekli değerlendirmeler yapılır. Değerlendirme sonuçlarınız ve gerekli bilgilendirmeler sizinle paylaşılır.`;
  }
  else {
    // Fallback/Generic (No raw copy-paste)
    if (department) {
      // Capitalize first letter of department for nicer output if we use it, but safe generic is better.
      summarySentence = `Formunuzda ${department.charAt(0).toUpperCase() + department.slice(1)} bölümümüzle ilgili değerlendirilmek istediğinizi belirttiğinizi görüyoruz.\n\nKesin değerlendirme hastanemizde ilgili hekim muayenesi sonrası yapılır.`;
    } else {
      summarySentence = `Formunuzda sağlık durumunuzla ilgili değerlendirilmek istediğinizi belirttiğinizi görüyoruz.\n\nKesin değerlendirme hastanemizde ilgili hekim muayenesi sonrası yapılır.`;
    }
  }

  // 3. Assemble the Draft
  const greeting = `Merhaba,\n\nBaşkent Üniversitesi Konya Hastanesi’nden, doldurduğunuz form doğrultusunda sizinle iletişime geçiyoruz.`;
  const bookingQuestion = `Türkiye’ye / Konya’ya ne zaman gelmeyi düşünüyorsunuz? Yaklaşık tarihinizi paylaşırsanız randevu planlamanız için yardımcı olabiliriz.`;
  const closing = `İyi günler dileriz.`;

  return `${greeting}\n\n${summarySentence}\n\n${bookingQuestion}\n\n${closing}`;
}

// Helper to extract values dynamically considering case insensitivity
function extractField(data: any, keys: string[]): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  for (const key of keys) {
    // Direct match
    if (data[key]) return String(data[key]).trim();
    
    // Case insensitive match
    const foundKey = Object.keys(data).find(k => k.toLowerCase() === key.toLowerCase());
    if (foundKey && data[foundKey]) {
      return String(data[foundKey]).trim();
    }
  }
  return undefined;
}
