import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // Yetki Kontrolü
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader.split(' ')[1] !== process.env.PANEL_PASSWORD) {
    return res.status(401).json({ error: 'Yetkisiz erişim' });
  }

  const { phone, channel, fileName, pdfBase64, message } = req.body;
  if (!phone || !pdfBase64) return res.status(400).json({ error: 'Eksik veri' });

  // Sadece WhatsApp destekleniyor şimdilik
  if (channel !== 'whatsapp') {
    return res.status(400).json({ error: 'PDF gönderimi şu an sadece WhatsApp için geçerlidir.' });
  }

  const META_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_ID = process.env.PHONE_NUMBER_ID;
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!META_TOKEN || !PHONE_ID || !DATABASE_URL) {
    return res.status(500).json({ error: 'Sistem ayarları eksik' });
  }

  const sql = neon(DATABASE_URL);

  try {
    // 1. Base64'ü Buffer'a (Blob) çevir
    // Base64 formatı genelde şöyledir: data:application/pdf;base64,JVBERi0xLjMK...
    const base64Data = pdfBase64.split(';base64,').pop();
    const buffer = Buffer.from(base64Data, 'base64');
    const blob = new Blob([buffer], { type: 'application/pdf' });

    // 2. WhatsApp Media API'ye yükle
    const formData = new FormData();
    formData.append('file', blob, fileName || 'Teklif.pdf');
    formData.append('type', 'application/pdf');
    formData.append('messaging_product', 'whatsapp');

    const uploadReq = await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_TOKEN}`
      },
      body: formData
    });

    const uploadRes = await uploadReq.json();
    if (!uploadReq.ok || !uploadRes.id) {
      console.error('Media Upload Error:', uploadRes);
      return res.status(500).json({ error: 'Medya WhatsAppa yüklenemedi', details: uploadRes });
    }

    const mediaId = uploadRes.id;

    // 3. Hastaya Document mesajı at
    const msgPayload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'document',
      document: {
        id: mediaId,
        filename: fileName || 'Teklif.pdf',
        caption: message || 'Teklifiniz ektedir.'
      }
    };

    const sendReq = await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${META_TOKEN}`
      },
      body: JSON.stringify(msgPayload)
    });

    const sendRes = await sendReq.json();
    if (!sendReq.ok) {
      console.error('Document Send Error:', sendRes);
      return res.status(500).json({ error: 'Mesaj gönderilemedi', details: sendRes });
    }

    // 4. Veritabanına kaydet
    const dbText = `📄 PDF Gönderildi: ${fileName}\n\n${message || ''}`;
    await sql`
      INSERT INTO messages (phone_number, direction, content, model_used, channel)
      VALUES (${phone}, 'out', ${dbText}, 'panel', 'whatsapp')
    `;

    return res.json({ success: true, message_id: sendRes.messages?.[0]?.id });

  } catch (error) {
    console.error('Send PDF endpoint error:', error);
    return res.status(500).json({ error: 'Sunucu hatası: ' + error.message });
  }
}
