import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  const META_ACCESS_TOKEN = 'EAAMEZBSqN8IQBRRF3R7utZCv3cZBAKnE1WjNsYQmpZBnRJf1hgoEHiI938L0QbONhmxCsp4QlteKvH9ypiUMSZAJpOt6PFW28vWZBpAVG8SIgSCQrJpB6Em9IHWL1F5ZAm3K8ZAw2p98nDpeifS7AmJFXkmxogKCK3KkXhOcfB8u5SZA7Vt75BbErykMggkIuuxEoaBBnxHZAAmLSjoFJAOV8c9iPu43CwF3SwuivZAa43JgDra30ZCLbymaBFUNsVNiN5AJAjiYHX3m9yzER7HLGRrvLimzQ1u3i9hDLVhJ7wZDZD';
  const PHONE_NUMBER_ID = '1072536945944841';
  const GEMINI_API_KEY = 'AIzaSyBBI54hC9g6MCPCwsEWcqR0q_UEH1RY3T8';

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
          const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

          const systemPrompt = `Sen Başkent Üniversitesi Konya Hastanesi adına çalışan profesyonel bir hasta danışmanısın.

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
1. Hasta fiyat sorarsa: Fiyatı reddet, Sebep açıkla, Randevuya yönlendir
2. Hasta bilgi isterse: Kısa bilgi ver, Detaya girme, "Size özel değerlendirelim" de
3. Hasta kararsızsa: Güven ver, Süreci basit anlat, Randevuya çek
4. Hasta direkt randevu isterse: Hızlı aksiyon al, Tarih iste, İletişim bilgisi iste

---

ÖRNEK CEVAP YAPISI:
"Merhaba, ilginiz için teşekkür ederiz. 
[Konuya kısa cevap]
Net değerlendirme için doktorumuzun sizi görmesi gerekir. 
Size uygun bir randevu oluşturalım mı?"

---

YASAKLAR:
- Fiyat verme
- Uzun yazı yazma
- Kesin teşhis koyma
- Abartılı vaatler
- Tıbbi riskleri yok sayma

HEDEF:
Her konuşmayı şu noktaya getir:
👉 "Randevu alalım"

-----------------
Hasta Mesajı: ${textMessage}`;

          let botResponse = "";
          try {
            const result = await model.generateContent(systemPrompt);
            botResponse = result.response.text();
          } catch (e) {
            console.error("Yapay Zeka Hatası:", e);
            botResponse = "Şu an sistemimde kısa süreli bir yoğunluk var, sorunuzu not aldım, yetkili arkadaşım size birazdan dönüş yapacaktır.";
          }

          try {
            await axios({
              method: 'POST',
              url: `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
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
