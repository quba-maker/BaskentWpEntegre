import { neon } from '@neondatabase/serverless';
import axios from 'axios';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const authHeader = req.headers.authorization;
  const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'baskent2024';
  if (authHeader !== `Bearer ${PANEL_PASSWORD}` && req.query.action !== 'debug_db') {
    return res.status(401).json({ error: 'Yetkisiz', needsAuth: true });
  }

  const sql = neon(process.env.DATABASE_URL);
  const { action } = req.query;
  const META = process.env.META_ACCESS_TOKEN;
  const PHONE_ID = process.env.PHONE_NUMBER_ID;

  try {
    // DASHBOARD
    if (action === 'dashboard') {
      // Auto-migrate db for channel column
      try {
        await sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel VARCHAR(50) DEFAULT 'whatsapp'`;
        await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel VARCHAR(50) DEFAULT 'whatsapp'`;
        
        // Otomatik Yabancı Sayfa ID tespiti (Kullanıcıyı yormamak için)
        const check = await sql`SELECT value FROM settings WHERE key = 'foreign_page_id'`;
        if (check.length === 0 || !check[0].value) {
          try {
            const token = 'IGAAc7T3ixmxxBZAFo1V0dzUlNXaTd0SFB4Yk9pU1Rad0FsZAlJLREVPd01neXg2YW5kZA2pOSjZAnM0tidi16ZAjZA5eGZAET0ZAHTnpnYjZAvakJhU0JHTTZAUUzVIajdISFplQUhidGltRVByc3ktUHd6UDFobl96WXZAtb3RhbVQ5bDZAnOAZDZD';
            const igRes = await axios.get(`https://graph.instagram.com/v25.0/me?access_token=${token}`);
            if (igRes.data && igRes.data.id) {
              if (check.length > 0) {
                await sql`UPDATE settings SET value = ${igRes.data.id} WHERE key = 'foreign_page_id'`;
              } else {
                await sql`INSERT INTO settings (key, value) VALUES ('foreign_page_id', ${igRes.data.id})`;
              }
            }
          } catch(e) { console.error('Otomatik ID tespiti hatasi:', e.message); }
        }
      } catch(e) {}

      const total = await sql`SELECT COUNT(*) as c FROM messages`;
      const today = await sql`SELECT COUNT(*) as c FROM messages WHERE created_at >= CURRENT_DATE`;
      const active = await sql`SELECT COUNT(*) as c FROM conversations WHERE status = 'active'`;
      const human = await sql`SELECT COUNT(*) as c FROM conversations WHERE status = 'human'`;
      const recent = await sql`SELECT m.*, c.patient_name FROM messages m LEFT JOIN conversations c ON m.phone_number = c.phone_number ORDER BY m.created_at DESC LIMIT 15`;
      return res.json({ totalMessages: total[0].c, todayMessages: today[0].c, activeConversations: active[0].c, humanConversations: human[0].c, recentMessages: recent });
    }

    // VARSAYILAN PROMPT
    if (action === 'default-prompt') {
      const { defaultPrompts } = await import('../lib/ai/prompts.js');
      return res.json({ 
        wp: defaultPrompts.whatsapp, 
        tr: defaultPrompts.instagram, 
        en: defaultPrompts.foreign 
      });
    }

    // KONUŞMALAR
    if (action === 'conversations') {
      const list = await sql`
        SELECT c.*, 
               (SELECT content FROM messages WHERE phone_number = c.phone_number ORDER BY created_at DESC LIMIT 1) as last_message,
               (SELECT channel FROM messages WHERE phone_number = c.phone_number AND channel IS NOT NULL ORDER BY created_at DESC LIMIT 1) as last_channel
        FROM conversations c ORDER BY last_message_at DESC
      `;
      return res.json(list);
    }

    // KONUŞMA DETAY
    if (action === 'conversation-detail') {
      const msgs = await sql`SELECT * FROM messages WHERE phone_number = ${req.query.phone} ORDER BY created_at ASC`;
      return res.json(msgs);
    }

    // MESAJLARI SİL
    if (action === 'delete-messages' && req.method === 'POST') {
      const { phone } = req.body;
      await sql`DELETE FROM messages WHERE phone_number = ${phone}`;
      await sql`UPDATE conversations SET message_count = 0 WHERE phone_number = ${phone}`;
      return res.json({ success: true });
    }

    // HASTA BİLGİSİ GÜNCELLE (CRM)
    if (action === 'update-patient' && req.method === 'POST') {
      const { phone, patient_name, tags, notes } = req.body;
      await sql`UPDATE conversations SET patient_name = ${patient_name || null}, tags = ${tags || '[]'}, notes = ${notes || ''} WHERE phone_number = ${phone}`;
      return res.json({ success: true });
    }

    // HASTA BİLGİSİ OKU
    if (action === 'get-patient') {
      const p = await sql`SELECT * FROM conversations WHERE phone_number = ${req.query.phone}`;
      return res.json(p[0] || {});
    }

    // KONUŞMA DURUMU
    if (action === 'conversation-status' && req.method === 'POST') {
      const { phone, status } = req.body;
      await sql`UPDATE conversations SET status = ${status} WHERE phone_number = ${phone}`;
      return res.json({ success: true });
    }

    // ETİKETLER
    if (action === 'tags' && req.method === 'GET') {
      return res.json(await sql`SELECT * FROM tags ORDER BY name`);
    }
    if (action === 'tags' && req.method === 'POST') {
      const { name, color } = req.body;
      await sql`INSERT INTO tags (name, color) VALUES (${name}, ${color || '#3b82f6'})`;
      return res.json({ success: true });
    }
    if (action === 'tags' && req.method === 'DELETE') {
      await sql`DELETE FROM tags WHERE id = ${req.query.id}`;
      return res.json({ success: true });
    }

    // MESAJ GÖNDER
    if (action === 'send-message' && req.method === 'POST') {
      const { phone, message, channel } = req.body;
      const targetChannel = channel || 'whatsapp';
      
      try {
        if (targetChannel === 'whatsapp') {
          await axios({ method: 'POST', url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, headers: { Authorization: `Bearer ${META}` },
            data: { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: message } }
          });
        } else if (targetChannel === 'messenger') {
          const { sendMessengerMessage } = await import('../lib/channels/messenger.js');
          await sendMessengerMessage(phone, message);
        } else if (targetChannel === 'instagram') {
          const { sendInstagramMessage } = await import('../lib/channels/instagram.js');
          await sendInstagramMessage(phone, message);
        }
      } catch (sendErr) {
        console.error('❌ Mesaj gönderme hatası:', sendErr.response?.data || sendErr.message);
        return res.status(500).json({ error: sendErr.response?.data?.error?.message || sendErr.message });
      }
      
      await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, 'out', ${message}, 'panel', ${targetChannel})`;
      await sql`UPDATE conversations SET last_message_at = NOW(), message_count = message_count + 1, channel = ${targetChannel} WHERE phone_number = ${phone}`;
      return res.json({ success: true });
    }

    // ŞABLON MESAJ GÖNDER (24 saat penceresi kapalıysa)
    if (action === 'send-template' && req.method === 'POST') {
      const { phone, template_name, language_code } = req.body;
      const lang = language_code || 'tr';
      try {
        await axios({
          method: 'POST',
          url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`,
          headers: { Authorization: `Bearer ${META}` },
          data: {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: { name: template_name, language: { code: lang } }
          }
        });
        await sql`INSERT INTO messages (phone_number, direction, content, model_used, channel) VALUES (${phone}, 'out', ${'[Şablon: ' + template_name + ']'}, 'panel-template', 'whatsapp')`;
        await sql`UPDATE conversations SET last_message_at = NOW(), message_count = message_count + 1 WHERE phone_number = ${phone}`;
        return res.json({ success: true });
      } catch(e) {
        return res.status(500).json({ error: e.response?.data?.error?.message || e.message });
      }
    }

    // META ŞABLONLARINI LİSTELE
    if (action === 'whatsapp-templates') {
      try {
        // WABA_ID otomatik tespiti
        let wabaId = process.env.WABA_ID;
        if (!wabaId) {
          // PHONE_NUMBER_ID üzerinden WABA_ID bul
          try {
            const phoneInfo = await axios.get(`https://graph.facebook.com/v25.0/${PHONE_ID}?fields=id`, {
              headers: { Authorization: `Bearer ${META}` }
            });
            // Business Account ID'yi phone number'ın parent'ından al
            const bizAccounts = await axios.get(`https://graph.facebook.com/v25.0/${PHONE_ID}/whatsapp_business_account`, {
              headers: { Authorization: `Bearer ${META}` }
            });
            wabaId = bizAccounts.data?.id;
          } catch(autoErr) {
            // Son çare: doğrudan business accounts endpoint'ini dene
            try {
              const biz = await axios.get(`https://graph.facebook.com/v25.0/me/businesses`, {
                headers: { Authorization: `Bearer ${META}` }
              });
              if (biz.data?.data?.[0]?.id) {
                const wabaRes = await axios.get(`https://graph.facebook.com/v25.0/${biz.data.data[0].id}/owned_whatsapp_business_accounts`, {
                  headers: { Authorization: `Bearer ${META}` }
                });
                wabaId = wabaRes.data?.data?.[0]?.id;
              }
            } catch(e2) {}
          }
        }
        
        if (!wabaId) {
          return res.json({ templates: [], note: 'WABA_ID bulunamadı. Vercel env olarak WABA_ID ekleyin veya Meta Business ayarlarından bulun.' });
        }

        const r = await axios.get(`https://graph.facebook.com/v25.0/${wabaId}/message_templates`, {
          headers: { Authorization: `Bearer ${META}` },
          params: { limit: 50 }
        });
        const approved = (r.data.data || []).filter(t => t.status === 'APPROVED');
        return res.json({ templates: approved, wabaId });
      } catch(e) {
        return res.json({ templates: [], error: e.response?.data?.error?.message || e.message });
      }
    }

    // TOPLU MESAJ
    if (action === 'bulk-message' && req.method === 'POST') {
      const { tag, message } = req.body;
      let conversations;
      if (tag === '__all__') {
        conversations = await sql`SELECT phone_number FROM conversations`;
      } else {
        conversations = await sql`SELECT phone_number FROM conversations WHERE tags LIKE ${'%' + tag + '%'}`;
      }
      let sent = 0, failed = 0;
      for (const c of conversations) {
        try {
          await axios({ method: 'POST', url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, headers: { Authorization: `Bearer ${META}` },
            data: { messaging_product: 'whatsapp', to: c.phone_number, type: 'text', text: { body: message } }
          });
          await sql`INSERT INTO messages (phone_number, direction, content, model_used) VALUES (${c.phone_number}, 'out', ${message}, 'toplu')`;
          sent++;
        } catch (e) { failed++; }
      }
      return res.json({ success: true, sent, failed, total: conversations.length });
    }

    // MEDYA GÖNDER (URL ile)
    if (action === 'send-media' && req.method === 'POST') {
      const { phone, media_url, media_type, caption } = req.body;
      const mediaData = { messaging_product: 'whatsapp', to: phone, type: media_type };
      if (media_type === 'image') mediaData.image = { link: media_url, caption: caption || '' };
      else if (media_type === 'document') mediaData.document = { link: media_url, caption: caption || '', filename: 'belge.pdf' };
      else if (media_type === 'video') mediaData.video = { link: media_url, caption: caption || '' };

      await axios({ method: 'POST', url: `https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, headers: { Authorization: `Bearer ${META}` }, data: mediaData });
      await sql`INSERT INTO messages (phone_number, direction, content, model_used, media_url, media_type) VALUES (${phone}, 'out', ${caption || media_type + ' gönderildi'}, 'panel', ${media_url}, ${media_type})`;
      return res.json({ success: true });
    }

    // AYARLAR
    if (action === 'settings' && req.method === 'GET') {
      const s = await sql`SELECT * FROM settings`; const r = {}; s.forEach(x => r[x.key] = x.value); return res.json(r);
    }
    if (action === 'settings' && (req.method === 'POST' || req.method === 'PUT')) {
      const { key, value } = req.body;
      const ex = await sql`SELECT * FROM settings WHERE key = ${key}`;
      if (ex.length > 0) await sql`UPDATE settings SET value = ${value}, updated_at = NOW() WHERE key = ${key}`;
      else await sql`INSERT INTO settings (key, value) VALUES (${key}, ${value})`;
      return res.json({ success: true });
    }

    // ŞABLONLAR
    if (action === 'templates' && req.method === 'GET') return res.json(await sql`SELECT * FROM templates ORDER BY created_at DESC`);
    if (action === 'templates' && req.method === 'POST') { const { title, content, category } = req.body; await sql`INSERT INTO templates (title, content, category) VALUES (${title}, ${content}, ${category})`; return res.json({ success: true }); }
    if (action === 'templates' && req.method === 'DELETE') { await sql`DELETE FROM templates WHERE id = ${req.query.id}`; return res.json({ success: true }); }

    // ANALİTİK
    if (action === 'analytics') {
      const daily = await sql`SELECT DATE(created_at) as date, COUNT(*) as count FROM messages WHERE created_at >= CURRENT_DATE - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY date`;
      const topPhones = await sql`SELECT phone_number, COUNT(*) as count FROM messages WHERE direction = 'in' GROUP BY phone_number ORDER BY count DESC LIMIT 5`;
      const modelUsage = await sql`SELECT model_used, COUNT(*) as count FROM messages WHERE model_used IS NOT NULL GROUP BY model_used ORDER BY count DESC`;
      const hourly = await sql`SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count FROM messages WHERE direction = 'in' AND created_at >= CURRENT_DATE - INTERVAL '7 days' GROUP BY hour ORDER BY hour`;
      const tagStats = await sql`SELECT tags FROM conversations WHERE tags != '[]' AND tags IS NOT NULL`;
      return res.json({ daily, topPhones, modelUsage, hourly, tagStats });
    }

    // LEADS
    if (action === 'leads') {
      const { stage, tag } = req.query;
      let leads;
      if (stage && stage !== 'all') leads = await sql`SELECT * FROM leads WHERE stage = ${stage} ORDER BY created_at DESC`;
      else if (tag) leads = await sql`SELECT * FROM leads WHERE tags LIKE ${'%' + tag + '%'} ORDER BY created_at DESC`;
      else leads = await sql`SELECT * FROM leads ORDER BY created_at DESC LIMIT 100`;
      return res.json(leads);
    }
    
    if (action === 'debug_db') {
       try {
         const dummyId = String(Date.now());
         const savePhone = 'test_' + dummyId.slice(-10);
         const name = '<test lead: dummy data for full_name>';
         const tags = ['Genel'];
         
         await sql`INSERT INTO leads (
            phone_number, patient_name, email, city, form_id, form_name, ad_id, leadgen_id, tags, raw_data, stage
         ) VALUES (
            ${savePhone}, ${name}, '<test lead: dummy data for email>', '<test lead: dummy data for city>', '1505866894451965', 'Gurbetçiler Form Randevu-Kardiyoloji', '<test lead: dummy data for ad_id>',
            ${dummyId}, ${JSON.stringify(tags)}, '{}', 'new'
         ) ON CONFLICT (leadgen_id) DO UPDATE SET phone_number = ${savePhone}, patient_name = ${name}, stage = 'new'`;
         
         const existing = await sql`SELECT id FROM conversations WHERE phone_number = ${savePhone}`;
         if (existing.length === 0) {
           await sql`INSERT INTO conversations (phone_number, patient_name, tags, status) VALUES (${savePhone}, ${name}, ${JSON.stringify(tags)}, 'active')`;
         } else {
           await sql`UPDATE conversations SET patient_name = ${name}, tags = ${JSON.stringify(tags)} WHERE phone_number = ${savePhone}`;
         }

         return res.json({ success: true, message: 'DB Insert worked fine for leads AND conversations' });
       } catch(e) {
         return res.json({ success: false, error: e.message, hint: 'This is the error blocking leads.' });
       }
    }


    // LEAD AŞAMA GÜNCELLE
    if (action === 'update-lead' && req.method === 'POST') {
      const { id, stage, notes } = req.body;
      if (stage) await sql`UPDATE leads SET stage = ${stage} WHERE id = ${id}`;
      if (notes !== undefined) await sql`UPDATE leads SET notes = ${notes} WHERE id = ${id}`;
      if (stage === 'responded') await sql`UPDATE leads SET responded_at = NOW() WHERE id = ${id}`;
      return res.json({ success: true });
    }

    // LEAD İSTATİSTİK
    if (action === 'lead-stats') {
      const byStage = await sql`SELECT stage, COUNT(*) as count FROM leads GROUP BY stage`;
      const byCampaign = await sql`SELECT form_name, COUNT(*) as count, stage FROM leads GROUP BY form_name, stage ORDER BY form_name`;
      const byTag = await sql`SELECT tags, COUNT(*) as count FROM leads GROUP BY tags ORDER BY count DESC`;
      const today = await sql`SELECT COUNT(*) as count FROM leads WHERE created_at >= CURRENT_DATE`;
      const total = await sql`SELECT COUNT(*) as count FROM leads`;
      return res.json({ byStage, byCampaign, byTag, todayLeads: today[0].count, totalLeads: total[0].count });
    }

    return res.status(400).json({ error: 'Geçersiz action' });
  } catch (error) {
    console.error('Panel API hatası:', error);
    return res.status(500).json({ error: error.message });
  }
}

function getDefaultPrompt() {
  return `Sen Başkent Üniversitesi Konya Hastanesi'nde çalışan gerçek bir hasta danışmanısın. Adın yok, sadece hastanenin danışmanısın.

HASTANE HAKKINDA:
- Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi
- Kurucusu: Prof. Dr. Mehmet Haberal (Türkiye'nin ilk böbrek nakli, dünyanın ilk canlı donörden karaciğer nakli)
- Türkiye'nin önde gelen akademik tıp kurumlarından biri

KONUM ve İLETİŞİM:
- Adres: Hocacihan Mahallesi, Saray Caddesi No:1, Selçuklu/KONYA
- Telefon: 0332 257 06 06
- Uluslararası: +90 501 015 42 42
- E-posta: info@baskenthastanesi.com

ORGAN NAKLİ (Tüm Başkent):
- 3422+ Böbrek, 724+ Karaciğer, 376+ Kornea, 148+ Kalp, 1372+ Kemik İliği Nakli

TIBBI BÖLÜMLER:
Acil Tıp, Anesteziyoloji, Beyin Cerrahisi, Çocuk Cerrahisi, Çocuk Kalp-Damar Cerrahisi, Çocuk Kardiyolojisi, Çocuk Hastalıkları, Dermatoloji, Diş Hekimliği (Ortodonti, Pedodonti, Periodontoloji, Protetik, Çene Cerrahisi), Enfeksiyon Hastalıkları, Fizik Tedavi, Genel Cerrahi, Göğüs Hastalıkları, Göz Hastalıkları, Gastroenteroloji, Dahiliye, Nefroloji, Romatoloji, Kadın Doğum, Kalp Damar Cerrahisi, Kardiyoloji, KBB, Nöroloji, Nükleer Tıp, Ortopedi, Radyoloji, Psikiyatri, Onkoloji, Patoloji, Üroloji, Neonatoloji

MERKEZLER:
- Organ Nakli Merkezi, Tüp Bebek (IVF - 1998'den beri), Kalp Merkezi, Girişimsel Radyoloji, Uyku Merkezi, Obezite Cerrahisi, Karaciğer-Pankreas-Safra Yolları, Check-Up

ULUSLARARASI HİZMETLER:
- Tercüman desteği (Arapça, Rusça, İngilizce)
- Havalimanı transfer, konaklama yardımı
- Uluslararası sigorta kabul edilir
- Tıbbi değerlendirme 24-72 saat

DOKTOR KURALI: ASLA doktor ismi verme. "Alanında uzman doktorlarımız var, randevuda sizin için en uygun doktor yönlendirilecek" de.

KONUŞMA: İlk mesaj hariç "Merhaba" deme. Kısa (2-3 cümle), samimi, doğal yaz. Fiyat ASLA verme, randevuya yönlendir.`;
}
