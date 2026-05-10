import { getConversationState, updateConversationState } from '../db/index.js';

export const PHASES = {
  GREETING: 'greeting',     // 1. Friction Discovery & Empathy
  DISCOVERY: 'discovery',   // 2. Clinical Discovery
  TRUST: 'trust',           // 3. Solution Mapping
  TIME_CONFIRM: 'time_confirm', // 4. Double Opt-in (Saat Teyidi)
  HANDOVER: 'handover'      // 5. The Close
};

// Fazların ilerleme mantığı
export function determineNextPhase(currentPhase, userMessage, aiResponse) {
  const text = (userMessage || '').toLowerCase();
  
  // HIZLI GEÇİŞ: Hasta hangi fazda olursa olsun doğrudan onay veya zaman veriyorsa
  if (currentPhase !== PHASES.HANDOVER && currentPhase !== PHASES.TIME_CONFIRM) {
    if (/(arayın|görüşelim|ne zaman|randevu|planla)/i.test(text)) {
      return PHASES.TIME_CONFIRM;
    }
  }

  if (currentPhase === PHASES.GREETING) {
    // Daha esnek geçiş: Herhangi bir tıbbi kelime veya makul uzunlukta bir cevap (15 karakterden uzun)
    if (/mr|röntgen|tahlil|tetkik|rapor|sonuç|kanser|tümör|ameliyat|doktor|görüş|ağrı|kalp|şikayet/i.test(text)) {
      return PHASES.DISCOVERY;
    }
    if (text.length > 15 && !/fiyat|ücret|nasıl|uzak|gelecem|konya|bilet/i.test(text)) {
      return PHASES.DISCOVERY;
    }
  }
  
  if (currentPhase === PHASES.DISCOVERY) {
    if (/gönderdim|attım|bakın|nasılsınız|evet|yok|var|çekildi/i.test(text) || text.length > 25) {
      return PHASES.TRUST;
    }
  }
  
  if (currentPhase === PHASES.TRUST) {
    // Phase 3 -> 4: Hasta randevuya OK verdiğinde direkt handover değil, saat teyidi
    if (/olur|tamam|evet|uygun|kabul|ok|randevu|geleceğim|geliyorum|ayarla|planla|oluştur|istiyorum|arayın|görüşelim/i.test(text)) {
      return PHASES.TIME_CONFIRM;
    }
  }

  if (currentPhase === PHASES.TIME_CONFIRM) {
    // Phase 4 -> 5: Hasta saat onayını verdi veya bir zaman belirtti
    if (/\d|sabah|öğle|akşam|farketmez|uygun|olur|tamam|şimdi|hemen/i.test(text) || text.length > 3) {
      return PHASES.HANDOVER;
    }
  }
  
  // Fazlar arası geri gitme yok — sadece ileri
  return currentPhase;
}

// Faza özel yönergeler
export function getPhaseInstruction(phase) {
  switch(phase) {
    case PHASES.GREETING:
      return `
[PHASE: 1 - FRICTION DISCOVERY & EMPATHY]
GÖREV: Hastayı anla, varsa pratik endişesini (ulaşım, konaklama, uzaklık) hemen çöz. ASLA randevu satma.
KURAL:
1. Eğer hasta "nasıl geleceğim, uzak, nerede" gibi endişeler belirtiyorsa sadece çözümü söyle: "Hiç merak etmeyin, havalimanı transferinizi ve tüm sürecinizi biz organize ediyoruz."
2. ⛔ ASLA ama ASLA bu aşamada "doktorla ön görüşme yapalım", "randevu ayarlayalım", "sizi arayalım" DEME! 
3. Sadece dinle, endişeyi gider ve açık uçlu tek bir soruyla şikayetini sor: "Şu anki güncel durumunuz/şikayetiniz nedir?"
4. Mesajlarını çok kısa ve net tut, sohbet havasında konuş ama cümleyi asla yarım bırakma.
`;
    case PHASES.DISCOVERY:
      return `
[PHASE: 2 - CLINICAL DISCOVERY]
GÖREV: Hastanın tıbbi durumunu bir klinik koordinatörü gibi analiz et.
KURAL:
1. Hastaya güven ver ("Ekibimiz bu konuda oldukça deneyimlidir").
2. ⛔ ASLA randevu teklif etme. Henüz erken.
3. Sadece rapor/tetkik sor: "Sürecinizi en doğru şekilde planlayabilmemiz için, elinizde yakın zamanda çekilmiş MR veya tahlil raporlarınız var mı?"
4. Raporu varsa "buradan gönderebilirsiniz" de.
5. Mesajını kısa tut ve tamamlanmış cümleler kullan, cümleyi yarım bırakma.
`;
    case PHASES.TRUST:
      return `
[PHASE: 3 - SOLUTION MAPPING]
GÖREV: Hastaya sürecin ne kadar kolay ve premium olduğunu anlatıp onay (mikro-evet) al.
KURAL:
1. Süreci Apple sadeliğinde anlat: "Raporlarınızı doktorumuz inceliyor, size özel plan çıkıyor ve sadece 3 gün Konya'da misafirimiz oluyorsunuz."
2. ⛔ Agresif satıcı olma. Şöyle bitir: "Bu süreç sizin için uygun mu? Sizi ücretsiz ön değerlendirmeye alalım mı?"
3. Hasta itiraz ederse (Düşüneyim) saygı duy: "Tabii ki, acele etmeyin. Hazır olduğunuzda buradayız."
4. Mesajlarını sohbet tadında kısa tut, doğal cümleler kur ve asla mesajı yarım bırakma.
`;
    case PHASES.TIME_CONFIRM:
      return `
[PHASE: 4 - TIME CONFIRMATION (DOUBLE OPT-IN)]
GÖREV: Hastadan aranmak için net bir saat veya zaman dilimi onayı al. 
KURAL:
1. ⛔ Hastaya hala süreci anlatma veya başka tıbbi sorular sorma.
2. EĞER hasta bir önceki mesajında "formdaki saatler" veya "14:00" gibi bir zamanı zaten BELİRTTİYSE, sakın tekrar sorma! Sadece "Tamamdır" diyerek onayla.
3. EĞER zaman belirtmemişse SADECE HANGİ SAAT ARALIĞINDA aranmak istediğini sor (Örn: "Ön görüşme için koordinatörümüzün sizi hangi saat aralığında araması uygun olur?").
4. "Harika", "Süper" gibi laubali kelimeler KULLANMA. Daha samimi ve kısa konuş. Cümleleri yarım bırakma.
`;
    case PHASES.HANDOVER:
      return `
[PHASE: 5 - THE CLOSE & HANDOVER]
GÖREV: Hastayı insan danışmana devretmek üzere net bir şekilde kapat.
KURAL:
1. ⛔ ASLA "Sizi şimdi arıyorum", "Telefonunuz çalacak" GİBİ YALAN SÖYLEME! Sen bir botsun, telefon açamazsın.
2. Hastaya tam olarak şöyle bir kapanış yap AMA hastanın formda veya mesajda bahsettiği GÜNCEL SAATİ (örneğin 14:00-16:00, öğleden sonra, vb.) metnin içine yerleştir!
Örnek yapı: "Tamamdır, tüm detayları görüşmek üzere sizi koordinatör arkadaşlarıma yönlendiriyorum. [Hastanın belirttiği saati yaz: Formda belirttiğiniz saatlerde / 14:00 civarı / Yarın sabah] sizi arayacaklar Lütfen telefonunuza bakarak olun 🙏"
3. "Harika", "Süper" gibi laubali kelimeler ASLA KULLANMA. Aşırı resmi olup her cümlenin sonuna nokta KOYMA. Samimi ol.
4. ASLA tıbbi analiz yapma, randevu verme, fiyat söyleme.
5. Mesajı kısa ve net tut, ASLA yarım bırakma. Tamamlanmış cümleler kur.
`;
    default:
      return '';
  }
}
