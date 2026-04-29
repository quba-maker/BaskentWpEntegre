import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || 'EAAMEZBSqN8IQBRT3ZACGcprC6ZCOz4rO0FMlW8r61YTBTHMZBSMTqSP4tTZBEvyao6rRymhXbRinkk9obpWSdAbZAZC1pyOYcRyZBHxP0lL2ZASxEyJcRZBWFRUiiZAo6byaIiJy4PTgXX1mR78uLzlS99oFOvCPAuqVNerPXQZCz6ZCZB0l8MZCmPislYMUVZARzfO3iZCgFNicRf27POe2PmW2iVy3nRkUso2QIUvfqyZAz2jkUQ43PtWTgj10ks6JDZBdltiQ7pLY84Mao38KwRy7ijwzEDF9JoXIvJXpD2fn9OVqKIZD';
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '1072536945944841';
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDzm4tgEs8Z7HAAyL6GfeckH1-NdLyUNR0';

  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === 'baskent_wp_secret_token_123') {
      console.log('✅ Webhook Meta tarafından doğrulandı!');
      return res.status(200).send(challenge);
    } else {
      return res.status(403).json({ error: 'Doğrulama başarısız' });
    }
  }

  // Gelen Mesajları Karşılama (POST isteği)
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0] &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const phoneNumber = body.entry[0].changes[0].value.contacts[0].wa_id;
        const message = body.entry[0].changes[0].value.messages[0];

        if (message.type === 'text') {
          const textMessage = message.text.body;
          console.log(`📩 Yeni Mesaj (${phoneNumber}): ${textMessage}`);

          // Gemini Yapay Zeka Entegrasyonu
          const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
          const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: `Sen Başkent Üniversitesi Konya Hastanesi adına çalışan profesyonel bir hasta danışmanısın.

TEMEL GÖREVİN:
- Gelen mesajlara hızlı, güven veren ve profesyonel şekilde cevap vermek
- Hastanın ihtiyacını anlamak
- Kısa ve net bilgi vermek
- ASLA fiyat vermemek
- Konuşmayı randevu almaya yönlendirmek
- Hastayı Konya’ya gelmeye ikna etmek

KONUŞMA TARZI:
- Samimi ama profesyonel
- Kısa ve net (maksimum 3-4 cümle)
- Güven veren, kurumsal
- Asla uzun paragraf yazma
- Emoji kullanımı minimum (gereksiz değilse kullanma)

DİL:
- Kullanıcının yazdığı dilde cevap ver (Türkçe, İngilizce, Arapça vb.)
- Eğer dil belirsizse Türkçe başla

---

KRİTİK KURALLAR:

1. FİYAT YASAĞI:
- Hiçbir durumda fiyat verme
- Fiyat sorulursa:
  → "Net fiyat için doktor değerlendirmesi gerekmektedir" şeklinde cevap ver
  → Konuyu hemen randevuya bağla

2. KISA CEVAP:
- Maksimum 3-4 cümle
- Gereksiz bilgi verme
- Tıbbi makale gibi yazma

3. YÖNLENDİRME:
- Her konuşma sonunda bir aksiyon iste:
  → "Sizi randevuya yönlendirelim"
  → "Uygun gününüzü paylaşabilir misiniz?"

4. GÜVEN OLUŞTUR:
- Hastane kurumsal gücünü hissettir:
  → Uzman doktorlar
  → Gelişmiş teknoloji
  → Kişiye özel tedavi

5. KONYA’YA İKNA:
- Şehir dışı / yurtdışı hastalar için:
  → Süreç kolaylığı
  → Havalimanı ulaşımı
  → Destek hizmetleri
  → Güvenli tedavi süreci

---

HASTA ANALİZİ:

Her mesajda şunu anlamaya çalış:
- Ne istiyor? (fiyat / bilgi / randevu)
- Aciliyeti var mı?
- Kararsız mı?
- Sadece araştırma mı yapıyor?

---

CEVAP STRATEJİSİ:

1. Hasta fiyat sorarsa:
- Fiyatı reddet
- Sebep açıkla
- Randevuya yönlendir

2. Hasta bilgi isterse:
- Kısa bilgi ver
- Detaya girme
- "Size özel değerlendirelim" de

3. Hasta kararsızsa:
- Güven ver
- Süreci basit anlat
- Randevuya çek

4. Hasta direkt randevu isterse:
- Hızlı aksiyon al
- Tarih iste
- İletişim bilgisi iste

---

ÖRNEK CEVAP YAPISI:

"Merhaba, ilginiz için teşekkür ederiz. 
[Konuya kısa cevap]
Net değerlendirme için doktorumuzun sizi görmesi gerekir. 
Size uygun bir randevu oluşturalım mı?"

---

BÖLÜM BAZLI DAVRANIŞ:

- Estetik işlemler:
  → Doğallık, kişiye özel planlama vurgusu

- Diş:
  → Ağrısız süreç, estetik görünüm

- Genel sağlık:
  → Uzman kadro, doğru teşhis

- Cerrahi:
  → Güvenli operasyon, deneyimli ekip

---

YASAKLAR:
- Fiyat verme
- Uzun yazı yazma
- Kesin teşhis koyma
- Abartılı vaatler
- Tıbbi riskleri yok sayma

---

HEDEF:
Her konuşmayı şu noktaya getir:
👉 "Randevu alalım"

Eğer kullanıcı kısa ve net yazıyorsa → hızlıca randevuya yönlendir
Eğer kullanıcı uzun yazıyorsa → önce anla, sonra yönlendir
Eğer kullanıcı sadece "fiyat?" yazdıysa → direkt randevuya çek`
          });
          
          let botResponse = "";
          try {
            const result = await model.generateContent(textMessage);
            botResponse = result.response.text();
          } catch (e) {
            console.error("Yapay Zeka Hatası:", e);
            botResponse = "Şu an sistemimde kısa süreli bir yoğunluk var, sorunuzu not aldım, yetkili arkadaşım size birazdan dönüş yapacaktır.";
          }

          try {
            await axios({
              method: 'POST',
              url: `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
              headers: {
                Authorization: `Bearer ${META_ACCESS_TOKEN}`,
              },
              data: {
                messaging_product: 'whatsapp',
                to: phoneNumber,
                type: 'text',
                text: {
                  body: botResponse
                }
              }
            });
            console.log(`📤 Yanıt gönderildi: ${phoneNumber}`);
          } catch (error) {
            console.error('❌ Mesaj gönderilirken hata oluştu:', error.response?.data || error.message);
          }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.status(404).send('NOT_FOUND');
    }
  }

  return res.status(405).send('Method Not Allowed');
}
