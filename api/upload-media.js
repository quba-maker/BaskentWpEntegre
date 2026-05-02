import { neon } from '@neondatabase/serverless';
import axios from 'axios';

// Vercel'de büyük dosyalar için body parser ayarı
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth kontrolü
  const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'baskent2024';
  if (req.headers.authorization !== `Bearer ${PANEL_PASSWORD}`) {
    return res.status(401).json({ error: 'Yetkisiz' });
  }

  const sql = neon(process.env.DATABASE_URL);
  const META = process.env.META_ACCESS_TOKEN;
  const PHONE_ID = process.env.PHONE_NUMBER_ID;

  try {
    const { phone, channel, caption, fileName, fileType, fileBase64 } = req.body;

    if (!phone || !fileBase64) {
      return res.status(400).json({ error: 'phone ve fileBase64 gerekli' });
    }

    // Base64'ten Buffer'a çevir
    const base64Data = fileBase64.split(',')[1] || fileBase64;
    const fileBuffer = Buffer.from(base64Data, 'base64');

    // Medya tipini belirle
    let mediaType = 'document';
    const mimeType = fileType || 'application/octet-stream';
    if (mimeType.startsWith('image/')) mediaType = 'image';
    else if (mimeType.startsWith('video/')) mediaType = 'video';
    else if (mimeType.startsWith('audio/')) mediaType = 'audio';

    const targetChannel = channel || 'whatsapp';

    if (targetChannel === 'whatsapp') {
      // ═══════════════════════════════════════
      // WHATSAPP: Meta Graph API ile upload
      // ═══════════════════════════════════════
      
      // 1. Dosyayı Meta'ya yükle (media_id al)
      const boundary = '----FormBoundary' + Date.now();
      const name = fileName || ('upload.' + (mimeType.split('/')[1] || 'bin'));
      
      const parts = [];
      // messaging_product
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp`);
      // type
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${mimeType}`);
      // file
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
      
      const header = Buffer.from(parts.join('\r\n') + '\r\n', 'utf-8');
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
      const body = Buffer.concat([header, fileBuffer, footer]);

      const uploadRes = await axios({
        method: 'POST',
        url: `https://graph.facebook.com/v25.0/${PHONE_ID}/media`,
        headers: {
          Authorization: `Bearer ${META}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        data: body,
        maxBodyLength: Infinity
      });

      const mediaId = uploadRes.data.id;
      console.log(`📤 Medya yüklendi: ${mediaId} (${mediaType})`);

      // 2. Media ID ile mesaj gönder
      const msgData = {
        messaging_product: 'whatsapp',
        to: phone,
        type: mediaType
      };

      if (mediaType === 'image') {
        msgData.image = { id: mediaId, caption: caption || '' };
      } else if (mediaType === 'video') {
        msgData.video = { id: mediaId, caption: caption || '' };
      } else if (mediaType === 'audio') {
        msgData.audio = { id: mediaId };
      } else {
        msgData.document = { id: mediaId, caption: caption || '', filename: name };
      }

      await axios({
        method: 'POST',
        url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`,
        headers: { Authorization: `Bearer ${META}` },
        data: msgData
      });

      console.log(`✅ Medya mesajı gönderildi: ${phone} (${mediaType})`);

    } else {
      // ═══════════════════════════════════════
      // MESSENGER / INSTAGRAM: Attachment API
      // ═══════════════════════════════════════
      
      // Sosyal medyada dosya gönderme henüz desteklenmiyor, metin olarak bildir
      const fallbackMsg = caption ? `📎 [Dosya: ${fileName || 'belge'}] ${caption}` : `📎 [Dosya gönderildi: ${fileName || 'belge'}]`;
      
      if (targetChannel === 'messenger') {
        const { sendMessengerMessage } = await import('../lib/channels/messenger.js');
        await sendMessengerMessage(phone, fallbackMsg);
      } else if (targetChannel === 'instagram') {
        const { sendInstagramMessage } = await import('../lib/channels/instagram.js');
        await sendInstagramMessage(phone, fallbackMsg);
      }
    }

    // DB'ye kaydet
    const contentText = caption || `📎 ${mediaType} gönderildi`;
    
    // media_url ve media_type kolonları yoksa ekle
    try {
      await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT`;
      await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(50)`;
    } catch(e) {}
    
    await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel, media_type) 
              VALUES (${phone}, 'out', ${contentText}, 'panel', ${targetChannel}, ${mediaType})`;
    await sql`UPDATE conversations SET last_message_at = NOW(), message_count = message_count + 1 WHERE phone_number = ${phone}`;

    return res.json({ success: true, mediaType });

  } catch (error) {
    console.error('❌ Upload hatası:', error.response?.data || error.message);
    return res.status(500).json({ error: error.response?.data?.error?.message || error.message });
  }
}
