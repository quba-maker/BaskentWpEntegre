import { handleWhatsAppMessage } from '../lib/channels/whatsapp.js';
import { handleMessengerMessage } from '../lib/channels/messenger.js';

export default async function handler(req, res) {
  // GET - Webhook doğrulama (Hem WP hem Messenger aynı webhook url'ini kullanabilir)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    // Güvenlik token'ınız
    if (mode === 'subscribe' && token === 'baskent_wp_secret_token_123') {
      console.log('✅ Trafik Polisi: Webhook doğrulandı!');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Doğrulama başarısız' });
  }

  // POST - Mesaj işle (Trafik Yönlendirme)
  if (req.method === 'POST') {
    const body = req.body;
    
    // Güvenlik kontrolü
    if (!body || !body.object) {
      return res.status(404).send('NOT_FOUND');
    }

    try {
      // 1. WHATSAPP KONTROLÜ
      if (
        body.object === 'whatsapp_business_account' && 
        body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
      ) {
        // Vercel serverless ortamında fonksiyonun ölmemesi için await eklenmeli
        await handleWhatsAppMessage(body);
        return res.status(200).send('EVENT_RECEIVED');
      }

      // 2. MESSENGER KONTROLÜ
      if (
        body.object === 'page' && 
        body.entry?.[0]?.messaging?.[0]
      ) {
        // Vercel serverless ortamında fonksiyonun ölmemesi için await eklenmeli
        await handleMessengerMessage(body);
        return res.status(200).send('EVENT_RECEIVED');
      }

      // Diğer durumlarda (Okundu bilgisi, vs) sadece 200 dönelim ki Meta hata vermesin
      return res.status(200).send('EVENT_RECEIVED');
      
    } catch (e) {
      console.error('❌ Trafik Polisi Yönlendirme Hatası:', e);
      return res.status(500).send('SERVER_ERROR');
    }
  }

  return res.status(405).send('Method Not Allowed');
}
