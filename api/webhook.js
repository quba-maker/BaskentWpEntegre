import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  const {
    META_ACCESS_TOKEN,
    META_VERIFY_TOKEN,
    PHONE_NUMBER_ID,
    GEMINI_API_KEY
  } = process.env;

  // Webhook Doğrulama (GET isteği Meta tarafından webhook bağlanırken atılır)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
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

          // Şimdilik Gemini entegrasyonu pasif, test mesajı dönüyoruz
          // const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
          // const model = genAI.getGenerativeModel({ model: "gemini-pro"});
          // const result = await model.generateContent(`Sen bir klinik asistanısın. Şu mesaja cevap ver: ${textMessage}`);
          // const aiResponse = result.response.text();
          
          const botResponse = `Vercel üzerinden Başkent WP Bot aktif! Mesajınızı aldım: "${textMessage}". (Yapay zeka entegrasyonu birazdan yapılacak)`;

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
