import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

// Serve frontend locally
app.use(express.static('public'));

const {
  META_ACCESS_TOKEN,
  META_VERIFY_TOKEN,
  PHONE_NUMBER_ID,
  GEMINI_API_KEY,
  PORT
} = process.env;

// Webhook doğrulama ucu (Meta'nın webhook'u bağlarken yapacağı güvenlik kontrolü)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    console.log('✅ Webhook başarıyla doğrulandı!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Hastalardan gelen mesajları aldığımız yer
app.post('/webhook', async (req, res) => {
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
        
        // Şimdilik robotun çalıştığını anlamak için basit bir cevap verelim
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
                body: `Sistem kurulumu başarılı! Mesajınızı aldım: "${textMessage}"`
              }
            }
          });
          console.log(`📤 Yanıt gönderildi: ${phoneNumber}`);
        } catch (error) {
          console.error('❌ Mesaj gönderilirken hata oluştu:', error.response?.data || error.message);
        }
      }
    }
    // Meta'ya "mesajı aldık" bilgisini dönüyoruz
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT || 3000, () => {
  console.log(`🤖 Başkent WP Bot sunucusu ${PORT || 3000} portunda çalışıyor...`);
});
