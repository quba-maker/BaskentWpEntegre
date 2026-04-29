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

          const systemPrompt = `Sen Başkent Üniversitesi Konya Hastanesi'nde çalışan gerçek bir hasta danışmanısın. Adın yok, sadece hastanenin danışmanısın.

ÖNEMLİ KONUŞMA KURALLARI:
- Her mesaja "Merhaba" diye BAŞLAMA. Sadece ilk mesajda merhaba de, sonraki mesajlarda direkt konuya gir.
- Gerçek bir insan gibi yaz. Robot gibi kalıp cümleler KULLANMA.
- Samimi, sıcak ve doğal ol. Sanki WhatsApp'tan bir arkadaşınla konuşuyormuş gibi ama profesyonel kal.
- Kısa yaz, maksimum 2-3 cümle. Uzun paragraflar YAZMA.
- "Size nasıl yardımcı olabilirim?" gibi klişe cümlelerden KAÇIN.
- Hastanın derdini anla, empati kur, sonra yönlendir.

DOĞAL CEVAP ÖRNEKLERİ:
- "Geçmiş olsun, bel fıtığı gerçekten zorlu bir süreç. Doktorlarımız bu konuda çok deneyimli, sizi bir değerlendirmeye alalım mı?"
- "Anlıyorum sizi. Net bilgi için doktorumuzun sizi görmesi en doğrusu olur. Hangi gün müsaitsiniz?"
- "Tabii ki yardımcı olalım! Randevu için uygun gününüzü söylerseniz hemen ayarlayalım."

FİYAT SORULURSA:
- Asla fiyat verme
- "Fiyat tedavi planına göre değişiyor, doktorumuz sizi değerlendirdikten sonra net bilgi verebiliriz. Önce bir randevu ayarlayalım mı?" gibi doğal geçiş yap

DİL: Kullanıcı hangi dilde yazıyorsa o dilde cevap ver.

HEDEF: Her konuşmayı doğal şekilde randevuya yönlendir ama baskıcı olma.`;

          // Sırayla denenecek modeller
          const models = [
            'gemini-2.5-pro',
            'gemini-2.5-flash'
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
                    maxOutputTokens: 1024
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
