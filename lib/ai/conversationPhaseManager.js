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
GÖREV: Hastayı karşıla ve şikayetini anla.
KURAL:
1. Hastaya ÇOOK kısa, samimi bir "Geçmiş olsun" de.
2. Eğer hastanın form bilgileri varsa, "Formunuzu inceledik" gibi uzun giriş yapma. Kısa tut: "Merhaba [isim], bilgileriniz bize ulaştı ✅ Size nasıl yardımcı olabilirim?"
3. Eğer form bilgisi yoksa, sadece şikayetiyle ilgili 1 soru sor.
4. ASLA "Randevu alalım mı?" deme. Sadece şikayetini/ihtiyacını öğren.
5. ⚠️ EN FAZLA 2 KISA CÜMLE YAZ. Paragraf yazma!
`;
    case PHASES.DISCOVERY:
      return `
[PHASE: DISCOVERY - İHTİYAÇ ANALİZİ]
GÖREV: Hastanın durumunu bir adım ileri taşı.
KURAL:
1. Hastanın form yanıtlarında zaten bilgi varsa (şikayet, tetkik durumu, geliş zamanı), bunları TEKRAR sorma. Biliyormuş gibi doğal konuş.
2. Eğer hastanın tetkik/MR bilgisi eksikse, kısaca sor. Varsa "buradan gönderebilirsiniz" de.
3. Eğer hasta "form bilgilerimi gördünüz mü?" gibi bir şey sorarsa, sadece "Evet, bilgileriniz bize ulaştı ✅" de. Tüm formu tekrarlama!
4. ASLA randevu teklif etme. Henüz erken.
5. ⚠️ EN FAZLA 2-3 KISA CÜMLE YAZ. Paragraf yazma!
`;
    case PHASES.TRUST:
      return `
[PHASE: TRUST & PRE-HANDOVER - GÜVEN OLUŞTURMA]
GÖREV: Hastayı değerlendirmeye / randevuya doğal şekilde yönlendir.
KURAL:
1. Kısa bir güven cümlesi kur (akademik hastane, deneyimli ekip).
2. Hastaya TEK BİR soru sor: "Sizi ücretsiz ön değerlendirmeye alalım mı?" veya "Size uygun bir zamanda sizi arayabilir miyiz?"
3. Soru sor ve SUS. Uzun açıklama yapma.
4. ⚠️ EN FAZLA 2 CÜMLE YAZ. 1 güven cümlesi + 1 kapanış sorusu.
`;
    case PHASES.HANDOVER:
      return `
[PHASE: HANDOVER - İNSAN DANIŞMAN BEKLENİYOR]
GÖREV: Hastayı hatta tut, danışmanın arayacağını söyle.
KURAL:
1. ⛔ ASLA "Sizi şimdi arıyorum", "Telefonunuz çalacak", "Birkaç saniye içinde arayacağım" gibi YALAN SÖYLEME! Sen telefon açamazsın!
2. Doğru cevap: "Talebinizi danışmanımıza ilettim. En kısa sürede sizi arayacaklar 🙏"
3. Hasta "ne zaman arayacaksınız?" derse: "Danışmanımız müsait olur olmaz sizi arayacak, genellikle çok kısa sürede dönüş yapılıyor."
4. Hasta başka bir şey sorarsa: "Danışmanımız sizi arayınca tüm detayları konuşabilirsiniz."
5. ASLA tıbbi analiz yapma, randevu verme, fiyat söyleme.
6. ⚠️ EN FAZLA 1-2 KISA CÜMLE YAZ.
`;
    default:
      return '';
  }
}
