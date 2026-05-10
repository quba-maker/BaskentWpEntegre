import { handleWhatsAppMessage } from '../lib/channels/whatsapp.js';
import { handleMessengerMessage } from '../lib/channels/messenger.js';
import { handleInstagramMessage } from '../lib/channels/instagram.js';
import leadWebhookHandler from './lead-webhook.js';

// 🔄 Arka planda escalation/recall kontrolü (cron yerine webhook-triggered)
async function runBackgroundChecks() {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    const { checkEscalations, sendTelegramAlert } = await import('../lib/ai/handoverManager.js');
    
    // Escalation check (5dk SLA)
    await checkEscalations(sql);
    
    // Geri arama hatırlatması (30dk sonra)
    const callmissPatients = await sql`
      SELECT c.phone_number, c.patient_name, c.department
      FROM conversations c
      WHERE c.status = 'human' AND c.temperature = 'hot'
        AND c.notes LIKE '%ulaşılamadı%'
        AND c.updated_at < NOW() - INTERVAL '30 minutes'
        AND c.updated_at > NOW() - INTERVAL '2 hours'
        AND NOT EXISTS (
          SELECT 1 FROM messages m 
          WHERE m.phone_number = c.phone_number 
          AND m.model_used = 'recall-reminder'
          AND m.created_at > NOW() - INTERVAL '30 minutes'
        )
    `;
    
    for (const p of callmissPatients) {
      await sendTelegramAlert(`⏰ <b>GERİ ARAMA HATIRLATMASI</b>\n\n👤 <b>${p.patient_name || p.phone_number}</b>\n📱 <code>${p.phone_number}</code>\n🏥 ${p.department || 'Genel'}\n\n📞 <i>30 dk önce arandı ama ulaşılamadı. Tekrar arayın!</i>`, {
        inline_keyboard: [
          [
            { text: "📞 Aradım - Ulaştım", callback_data: `crm_contacted_${p.phone_number}` },
            { text: "📞 Aradım - Ulaşamadım", callback_data: `crm_callmiss_${p.phone_number}` }
          ]
        ]
      });
      await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${p.phone_number}, 'out', '[SİSTEM] Geri arama hatırlatması', 'recall-reminder', 'system')`;
    }
  } catch(e) {
    // Arka plan kontrollerinde hata olursa webhook'u bloke etme
    console.error('Background check hatası:', e.message);
  }
}

export default async function handler(req, res) {
  // GET - Webhook doğrulama
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === (process.env.WEBHOOK_VERIFY_TOKEN || 'baskent_wp_secret_token_123')) {
      console.log('✅ Trafik Polisi: Webhook doğrulandı!');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Doğrulama başarısız' });
  }

  // POST - Mesaj işle (Trafik Yönlendirme)
  if (req.method === 'POST') {
    const body = req.body;
    
    if (!body || !body.object) {
      return res.status(404).send('NOT_FOUND');
    }

    try {
      // 🔄 Her gelen mesajda arka planda escalation/recall kontrolü yap
      // Bu sayede Vercel Hobby plan (günlük cron) kısıtlamasını aşıyoruz
      runBackgroundChecks().catch(() => {});

      // 1. WHATSAPP
      if (
        body.object === 'whatsapp_business_account' && 
        body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
      ) {
        await handleWhatsAppMessage(body);
        return res.status(200).send('EVENT_RECEIVED');
      }

      // 2. MESSENGER
      if (
        body.object === 'page' && 
        body.entry?.[0]?.messaging?.[0]
      ) {
        await handleMessengerMessage(body);
        return res.status(200).send('EVENT_RECEIVED');
      }

      // 3. INSTAGRAM
      if (
        body.object === 'instagram' && 
        body.entry?.[0]?.messaging?.[0]
      ) {
        await handleInstagramMessage(body);
        return res.status(200).send('EVENT_RECEIVED');
      }

      // 4. FACEBOOK LEAD ADS (FORM)
      if (
        body.object === 'page' && 
        body.entry?.[0]?.changes?.[0]?.field === 'leadgen'
      ) {
        return leadWebhookHandler(req, res);
      }

      // Diğer durumlarda (Okundu bilgisi, vs) sadece 200 dönelim
      return res.status(200).send('EVENT_RECEIVED');
      
    } catch (e) {
      console.error('❌ Trafik Polisi Yönlendirme Hatası:', e);
      return res.status(500).send('SERVER_ERROR');
    }
  }

  return res.status(405).send('Method Not Allowed');
}
