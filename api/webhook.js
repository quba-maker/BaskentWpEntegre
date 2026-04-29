import axios from 'axios';

export default async function handler(req, res) {
  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

          const systemPrompt = `Sen Başkent Üniversitesi Konya Hastanesi adına çalışan profesyonel bir hasta danışmanısın.

TEMEL GÖREVİN:
- Gelen mesajlara hızlı, güven veren ve profesyonel şekilde cevap vermek
- Hastanın ihtiyacını anlamak
- Kısa ve net bilgi vermek
- ASLA fiyat vermemek
- Konuşmayı randevu almaya yönlendirmek
- Hastayı Konya'ya gelmeye ikna etmek

KONUŞMA TARZI:
- Samimi ama profesyonel
- Kısa ve net (maksimum 3-4 cümle)
- Güven veren, kurumsal
- Asla uzun paragraf yazma
- Emoji kullanımı minimum (gereksiz değilse kullanma)

DİL:
- Kullanıcının yazdığı dilde cevap ver (Türkçe, İngilizce, Arapça vb.)
- Eğer dil belirsizse Türkçe başla

KRİTİK KURALLAR:

1. FİYAT YASAĞI:
- Hiçbir durumda fiyat verme
- Fiyat sorulursa: "Net fiyat için doktor değerlendirmesi gerekmektedir" şeklinde cevap ver
- Konuyu hemen randevuya bağla

2. KISA CEVAP:
- Maksimum 3-4 cümle
- Gereksiz bilgi verme
- Tıbbi makale gibi yazma

3. YÖNLENDİRME:
- Her konuşma sonunda bir aksiyon iste:
  "Sizi randevuya yönlendirelim" veya "Uygun gününüzü paylaşabilir misiniz?"

4. GÜVEN OLUŞTUR:
- Hastane kurumsal gücünü hissettir: Uzman doktorlar, Gelişmiş teknoloji, Kişiye özel tedavi

5. KONYA'YA İKNA:
- Şehir dışı / yurtdışı hastalar için: Süreç kolaylığı, Havalimanı ulaşımı, Destek hizmetleri

YASAKLAR:
- Fiyat verme
- Uzun yazı yazma
- Kesin teşhis koyma
- Abartılı vaatler
- Tıbbi riskleri yok sayma

HEDEF:
Her konuşmayı randevu almaya yönlendir.`;

          // Sırayla denenecek modeller
          const models = [
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite'
          ];

          let botResponse = "";
          let aiSuccess = false;

          for (const modelName of models) {
            try {
              console.log(`🤖 Deneniyor: ${modelName}`);
              const geminiResponse = await axios({
                method: 'POST',
                url: `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`,
                headers: { 'Content-Type': 'application/json' },
                data: {
                  contents: [{
                    role: 'user',
                    parts: [{ text: `${systemPrompt}\n\n---\nHasta Mesajı: ${textMessage}` }]
                  }],
                  generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 300
                  }
                },
                timeout: 10000
              });

              if (geminiResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                botResponse = geminiResponse.data.candidates[0].content.parts[0].text;
                console.log(`✅ Yapay Zeka cevabı alındı (${modelName})`);
                aiSuccess = true;
                break;
              }
            } catch (e) {
              console.error(`❌ ${modelName} hatası:`, e.response?.data?.error?.message || e.message);
            }
          }

          if (!aiSuccess) {
            botResponse = "Merhaba, Başkent Üniversitesi Konya Hastanesi'ne ilginiz için teşekkür ederiz. Size en iyi şekilde yardımcı olabilmemiz için sizi en kısa sürede yetkili arkadaşımız arayacaktır.";
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
                text: { body: botResponse }
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
