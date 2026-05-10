import { getConversationState, updateConversationState } from '../db/index.js';

export const PHASES = {
  GREETING: 'greeting',
  DISCOVERY: 'discovery',
  TRUST: 'trust',
  HANDOVER: 'handover'
};

// Fazların ilerleme mantığı
export function determineNextPhase(currentPhase, userMessage, aiResponse) {
  const text = (userMessage || '').toLowerCase();
  
  if (currentPhase === PHASES.GREETING) {
    // Hasta durumu/şikayetini anlattıysa discovery'ye geç
    // Sadece uzun mesaj yetmez, tıbbi/kişisel bir içerik olmalı
    if (/ağrı|şikayet|var|yok|sorun|problem|hasta|tedavi|ameliyat|ay|yıl|hafta|gün|sırt|bel|diz|baş|göz|diş|kalp|böbrek|karaciğer|mide|akciğer|kanser|tümör|kırık|çıkık|fıtık|mr|röntgen/i.test(text)) {
      return PHASES.DISCOVERY;
    }
    // 30+ karakter ve soru cevap formatında ise de geç
    if (text.length > 30) {
      return PHASES.DISCOVERY;
    }
  }
  
  if (currentPhase === PHASES.DISCOVERY) {
    // Hasta tetkik/MR cevabı verdiyse, detay anlattıysa veya onay verdiyse → Trust'a geç
    if (/mr|röntgen|tahlil|tetkik|rapor|sonuç|çektirdim|çekildi|var|yok|gönder/i.test(text)) {
      return PHASES.TRUST;
    }
    // Hasta yeterince detay verdiyse (2+ cümle)
    if (text.length > 50) {
      return PHASES.TRUST;
    }
  }
  
  if (currentPhase === PHASES.TRUST) {
    // Hasta olumlu sinyal veriyorsa → Handover'a geç (Bot TRUST'ta takılıp kalmasın)
    // Bu geçiş, brain.js'deki checkHandoverTriggers ile birlikte çalışır
    if (/olur|tamam|evet|uygun|kabul|ok|randevu|geleceğim|geliyorum|ayarla|planla|oluştur|istiyorum/i.test(text)) {
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
[PHASE: GREETING - KARŞILAMA VE EMPATİ]
GÖREV: Hastanın şikayetini tam olarak anlamak.
KURAL: 
1. Hastaya ÇOK kısa, samimi bir "Geçmiş olsun" de.
2. SADECE şikayetiyle ilgili 1 veya 2 soru sor (Ne zamandır var? Nasıl etkiliyor? vb.).
3. ASLA "Randevu alalım mı?", "Fiyat veremem" veya "MR gönderin" deme. Sadece şikayetini dinle.
4. Mesajın en fazla 2 kısa cümle olsun.
`;
    case PHASES.DISCOVERY:
      return `
[PHASE: DISCOVERY - İHTİYAÇ ANALİZİ VE TETKİK]
GÖREV: Tıbbi durumunu bir adım ileri taşımak ve elindeki verileri (Rapor/MR) istemek.
KURAL:
1. Hastanın şikayetini anladığını belirten kısa bir empati cümlesi kur.
2. Daha iyi değerlendirebilmemiz için yakın zamanda çekilmiş bir MR, röntgen veya tahlil olup olmadığını nazikçe sor. Varsa buradan fotoğrafını/PDF'ini gönderebileceğini söyle.
3. ASLA randevu teklif etme. Sadece tetkik sor.
`;
    case PHASES.TRUST:
      return `
[PHASE: TRUST & PRE-HANDOVER - GÜVEN OLUŞTURMA VE KAPANIŞA HAZIRLIK]
GÖREV: Hastanemizin otoritesini hissettirip, görüşmeyi tıbbi bir uzmana veya randevu planlamasına devretmek için zemin hazırlamak.
KURAL:
1. Durumunu anladığını söyle ve akademik bir hastane (Başkent Üniversitesi) güvencesiyle uzmanlarımızın bu konuda çok deneyimli olduğunu kısaca belirt.
2. Hastaya "Sürecinizi daha detaylı konuşmak ve tedavinizi planlamak için sizi ücretsiz bir ön görüşmeye alalım mı?" VEYA (yabancı ise) "Doktorlarımız durumunuzu değerlendirebilir, size uygun bir zamanda sizi arayabilir miyiz?" de.
3. Soruyu sor ve sus. Bekle.
`;
    case PHASES.HANDOVER:
      return `
[PHASE: HANDOVER - İNSAN DANIŞMAN BEKLENİYOR]
GÖREV: Hastayı, insan bir danışmanın/doktorun kendisiyle iletişime geçeceğine dair bilgilendirip onu hatta tutmak.
KURAL:
1. Sen şu an bir sekreter/receptionist modundasın. Hasta sana ne sorarsa sorsun çok kısa ve kibar cevap ver.
2. "Talebinizi danışmanımıza ilettim, lütfen kısa bir süre bekleyin, birazdan detaylıca ilgilenecekler." mesajını vermek ana hedefin olsun.
3. Asla yeni bir randevu vermeye veya medikal analiz yapmaya çalışma. Sadece beklemesini rica et ve empati kur.
`;
    default:
      return '';
  }
}
