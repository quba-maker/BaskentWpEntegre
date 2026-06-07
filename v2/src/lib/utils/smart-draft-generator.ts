/**
 * Deterministik Akıllı Karşılama Taslağı Üreticisi
 * LLM API maliyeti yaratmadan, form verilerini analiz ederek güvenli taslaklar üretir.
 */

export function generateSmartDraft(rawData: any, defaultFormName?: string): string {
  const data = typeof rawData === 'string' ? JSON.parse(rawData || '{}') : (rawData || {});

  // 1. Slot Extraction & Normalization
  const department = extractField(data, ['department', 'departman', 'bolum', 'bölüm', 'klinik']);
  const complaint = extractField(data, ['şikayetiniz_nedir', 'sikayetiniz_nedir', 'complaint', 'sikayet', 'şikayet', 'hastalık', 'sorun', 'neden', 'rahatsızlık']);
  const treatments = extractField(data, ['previous_treatments', 'gecmis_islem', 'geçmiş işlem', 'ameliyat', 'tedavi']);
  const duration = extractField(data, ['duration', 'ne_zaman_başladı', 'şikayetiniz_ne_zaman_başladı', 'ne_zamandir', 'ne zamandır']);
  const livingCity = extractField(data, ['nerede_yaşıyorsunuz', 'country', 'city', 'sehir', 'şehir', 'ulke', 'ülke', 'yaşadığınız_yer']);
  const requestedAppointment = extractField(data, ['size_ne_zaman_randevu_oluşturmamızı_istersiniz', 'randevu_tarihi', 'ne_zaman_gelmek_istersiniz', 'appointment_date']);
  
  // 2. Build the Form Summary Sentence
  let summarySentence = '';
  let followUpQuestion = '';
  let contextualDetails = '';
  
  // Normalize variables for safe processing
  const deptLower = (department || defaultFormName || '').toLowerCase();
  const complaintLower = (complaint || '').toLowerCase();
  const treatmentsLower = (treatments || '').toLowerCase();

  // -- ORTHOPEDICS --
  if (deptLower.includes('ortopedi') || complaintLower.match(/(diz|eklem|omuz|kalça|kemik|kıkırdak|kikirdak|kireçlenme|kirecleme|ezilme|menisküs|meniskus)/)) {
    let sikayetOzet = complaint ? complaint.toLowerCase() : 'ortopedik şikayetleriniz';
    
    const durationText = duration ? `, bu durumun yaklaşık ${duration.toLowerCase()} devam ettiğini` : '';
    
    summarySentence = `Formunuzda ${sikayetOzet} şikayeti olduğunu${durationText} belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nDiz eklemiyle ilgili kireçlenme, kıkırdak hasarı veya benzer ortopedik rahatsızlıklar; ağrı, yürüme güçlüğü, merdiven çıkarken zorlanma ve hareket kısıtlılığı gibi şikayetlere neden olabilir. Kesin değerlendirme hastanemizde ortopedi hekimi muayenesi sonrası yapılır.`;
    
    if (complaintLower.includes('diz') || complaintLower.includes('kıkırdak') || complaintLower.includes('kireç') || complaintLower.includes('kirec') || complaintLower.includes('ezilme') || complaintLower.includes('menis')) {
        followUpQuestion = `Dizleriniz için daha önce fizik tedavi, diz içi iğne, PRP, ilaç tedavisi veya ameliyat önerisi oldu mu?`;
    }
  }
  // -- CARDIOLOGY --
  else if (deptLower.includes('kardiyoloji') || deptLower.includes('kalp') || treatmentsLower.match(/(anjiyo|stent|bypass)/) || complaintLower.match(/(göğüs ağrısı|gogus agrisi|çarpıntı)/)) {
    let sikayetOzet = complaint ? complaint.toLowerCase() : 'kalp damar sağlığınızla ilgili şikayetleriniz';
    if (treatmentsLower.match(/(anjiyo|stent|bypass)/)) {
        sikayetOzet = 'daha önce geçirdiğiniz anjiyo, stent veya bypass işlemleriyle ilgili şikayetleriniz';
    }
    
    const durationText = duration ? `, bu durumun yaklaşık ${duration.toLowerCase()} devam ettiğini` : '';
    
    summarySentence = `Formunuzda ${sikayetOzet} olduğunu${durationText} belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nKalp ve damar sağlığıyla ilgili takiplerde düzenli kontrol önemlidir. Hastanemize geldiğinizde kardiyoloji hekimimiz tarafından gerekli muayene ve değerlendirmeler yapılır, uygun takip süreci hakkında bilgilendirme sağlanır.`;
    
    followUpQuestion = `Daha önce anjiyo yapıldı mı veya düzenli kullandığınız tansiyon/kalp ilacınız var mı?`;
  }
  // -- NEUROSURGERY --
  else if (deptLower.includes('beyin') || deptLower.includes('nöro') || complaintLower.match(/(bel fıtığı|boyun fıtığı|omurga|sinir sıkışması|bel|boyun|ağrı|uyuşma)/)) {
    let sikayetOzet = complaint ? complaint.toLowerCase() : 'beyin ve sinir cerrahisi alanındaki şikayetleriniz';
    
    const durationText = duration ? `, bu durumun yaklaşık ${duration.toLowerCase()} devam ettiğini` : '';
    
    summarySentence = `Formunuzda ${sikayetOzet} olduğunu${durationText} belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nOmurga ve sinir sistemi sağlığında (bel/boyun fıtığı, sinir sıkışması vb.) detaylı klinik inceleme çok önemlidir. Hastanemize geldiğinizde ilgili hekimimiz tarafından gerekli muayene ve değerlendirmeler yapılarak mevcut durumunuz ayrıntılı şekilde incelenir.`;
    
    followUpQuestion = `Daha önce bu şikayetiniz için MR çekildi mi veya fizik tedavi gördünüz mü?`;
  }
  // -- CHECK-UP --
  else if (deptLower.includes('check-up') || deptLower.includes('checkup') || deptLower.includes('check up') || complaintLower.includes('genel sağlık taraması') || complaintLower.includes('kontrol')) {
    summarySentence = `Formunuzda Check-up programlarımızla ilgilendiğinizi belirttiğinizi görüyoruz. Sağlığınıza gösterdiğiniz özen için tebrik ederiz.\n\nCheck-up programlarımız yaşınıza, cinsiyetinize ve tıbbi geçmişinize özel olarak planlanmaktadır. Hastanemize geldiğinizde ilgili hekimlerimiz tarafından gerekli değerlendirmeler yapılır.`;
  }
  // -- DEFAULT --
  else {
    if (complaint) {
      const durationText = duration ? `, bu durumun yaklaşık ${duration.toLowerCase()} devam ettiğini` : '';
      summarySentence = `Formunuzda ${complaint.toLowerCase()} şikayetiniz olduğunu${durationText} belirttiğinizi görüyoruz. Öncelikle geçmiş olsun.\n\nKesin değerlendirme hastanemizde ilgili hekim muayenesi sonrası yapılır.`;
    } else if (department || defaultFormName) {
      const dept = department || defaultFormName || '';
      summarySentence = `Formunuzda ${dept} bölümümüzle ilgili değerlendirilmek istediğinizi belirttiğinizi görüyoruz.\n\nKesin değerlendirme hastanemizde ilgili hekim muayenesi sonrası yapılır.`;
    } else {
      summarySentence = `Formunuzda sağlık durumunuzla ilgili değerlendirilmek istediğinizi belirttiğinizi görüyoruz.\n\nKesin değerlendirme hastanemizde ilgili hekim muayenesi sonrası yapılır.`;
    }
  }

  // 3. Assemble Contextual Details (City, Requested Date)
  if (livingCity) {
    // Capitalize first letter of city
    const formattedCity = livingCity.charAt(0).toUpperCase() + livingCity.slice(1).toLowerCase();
    contextualDetails += `${formattedCity}’da yaşadığınızı belirtmişsiniz. `;
  }
  
  let bookingQuestion = '';
  if (requestedAppointment) {
    const isOnlyNumber = /^\d+$/.test(requestedAppointment.trim());
    if (isOnlyNumber && requestedAppointment.trim().length <= 2) {
      bookingQuestion = `Randevu tarihi alanına “${requestedAppointment.trim()}” yazmışsınız; bunu ayın ${requestedAppointment.trim()}’i mi yoksa ${getMonthNameFromNumber(requestedAppointment.trim())} ayı olarak mı düşündüğünüzü netleştirebilir misiniz? Türkiye’ye / Konya’ya geliş tarihinizi paylaşırsanız randevu planlamanız için yardımcı olabiliriz.`;
    } else {
      bookingQuestion = `Randevu tarihi olarak “${requestedAppointment.trim()}” belirtmişsiniz. Türkiye’ye / Konya’ya geliş tarihinizi netleştirdiğinizde randevu planlamanız için yardımcı olabiliriz.`;
    }
  } else {
    bookingQuestion = `Türkiye’ye / Konya’ya ne zaman gelmeyi düşünüyorsunuz? Yaklaşık tarihinizi paylaşırsanız randevu planlamanız için yardımcı olabiliriz.`;
  }

  // 4. Final Assembly
  const greeting = `Merhaba,\n\nBaşkent Üniversitesi Konya Hastanesi’nden, doldurduğunuz form doğrultusunda sizinle iletişime geçiyoruz.`;
  const closing = `İyi günler dileriz.`;

  const blocks = [greeting, summarySentence];
  if (followUpQuestion) blocks.push(followUpQuestion);
  if (contextualDetails || bookingQuestion) blocks.push((contextualDetails + bookingQuestion).trim());
  blocks.push(closing);

  return blocks.filter(Boolean).join('\n\n');
}

// Helper to extract values dynamically considering case insensitivity and Turkish chars
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
