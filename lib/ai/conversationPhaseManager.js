import { getConversationState, updateConversationState } from '../db/index.js';

export const PHASES = {
  GREETING: 'greeting',     // 1. Friction Discovery & Empathy
  DISCOVERY: 'discovery',   // 2. Clinical Discovery
  TRUST: 'trust',           // 3. Solution Mapping
  HANDOVER: 'handover'      // 4. The Close
};

// Fazların ilerleme mantığı
export function determineNextPhase(currentPhase, userMessage, aiResponse) {
  const text = (userMessage || '').toLowerCase();
  
  if (currentPhase === PHASES.GREETING) {
    // Phase 1 -> 2: Hastanın şikayeti/engeli anlaşıldıysa ve medikal konuya geçildiyse
    // Hastanın endişesi çözülmeden (ulaşım, fiyat vb.) medikal analize geçmeyiz.
    // Ancak hasta doğrudan tıbbi terimler kullanırsa (mr, rapor, kanser vs.) geçiş yapılır.
    if (/mr|röntgen|tahlil|tetkik|rapor|sonuç|kanser|tümör|ameliyat/i.test(text)) {
      return PHASES.DISCOVERY;
    }
    // Sadece merhaba deyip geçiştiriyorsa veya itiraz ediyorsa (nasıl geleceğim, pahalı mı vs) greeting'de kalır.
    // Eğer 3+ mesajlaşma olduysa zorunlu geçiş yapabiliriz (opsiyonel).
    if (text.length > 50 && !/fiyat|ücret|nasıl|uzak|gelecem|konya|bilet/i.test(text)) {
      return PHASES.DISCOVERY;
    }
  }
  
  if (currentPhase === PHASES.DISCOVERY) {
    // Phase 2 -> 3: Hasta medikal detayları / raporu verdi ve artık çözüm istiyor
    if (/gönderdim|attım|bakın|nasılsınız|evet|yok|var|çekildi/i.test(text) || text.length > 60) {
      return PHASES.TRUST;
    }
  }
  
  if (currentPhase === PHASES.TRUST) {
    // Phase 3 -> 4: Hasta çözüm yolunu anladı ve randevuya/görüşmeye OK verdi
    if (/olur|tamam|evet|uygun|kabul|ok|randevu|geleceğim|geliyorum|ayarla|planla|oluştur|istiyorum|arayın|görüşelim/i.test(text)) {
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
4. ⚠️ EN FAZLA 2-3 KISA CÜMLE YAZ.
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
5. ⚠️ EN FAZLA 2 KISA CÜMLE YAZ.
`;
    case PHASES.TRUST:
      return `
[PHASE: 3 - SOLUTION MAPPING]
GÖREV: Hastaya sürecin ne kadar kolay ve premium olduğunu anlatıp onay (mikro-evet) al.
KURAL:
1. Süreci Apple sadeliğinde anlat: "Raporlarınızı doktorumuz inceliyor, size özel plan çıkıyor ve sadece 3 gün Konya'da misafirimiz oluyorsunuz."
2. ⛔ Agresif satıcı olma. Şöyle bitir: "Bu süreç sizin için uygun mu? Sizi ücretsiz ön değerlendirmeye alalım mı?"
3. Hasta itiraz ederse (Düşüneyim) saygı duy: "Tabii ki, acele etmeyin. Hazır olduğunuzda buradayız."
4. ⚠️ EN FAZLA 2-3 KISA CÜMLE YAZ.
`;
    case PHASES.HANDOVER:
      return `
[PHASE: 4 - THE CLOSE & HANDOVER]
GÖREV: Hastayı insan danışmana devretmek üzere beklemeye al.
KURAL:
1. ⛔ ASLA "Sizi şimdi arıyorum", "Telefonunuz çalacak" GİBİ YALAN SÖYLEME! Sen bir botsun, telefon açamazsın.
2. Doğru cevap: "Harika. Sürecinizi başlatmak ve takviminizi netleştirmek üzere koordinatör arkadaşıma notunuzu aktarıyorum. Size en kısa sürede ulaşacak 🙏"
3. Hasta "ne zaman arayacaksınız?" derse: "Danışmanımız müsait olur olmaz sizi arayacak."
4. ASLA tıbbi analiz yapma, randevu verme, fiyat söyleme.
5. ⚠️ EN FAZLA 2 KISA CÜMLE YAZ.
`;
    default:
      return '';
  }
}
