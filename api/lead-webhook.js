import axios from 'axios';
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const DATABASE_URL = process.env.DATABASE_URL;
  const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbw8djmWax0nw1oPmGmaB8M1i_p5EX3tBg5voXuWFaC3r_A7rnUCCboE37DQdNrXndOA/exec';
  const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

  // GET - Meta webhook doğrulama
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === 'baskent_wp_secret_token_123') {
      console.log('✅ Lead webhook doğrulandı!');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // POST - Meta Lead Form geldi
  if (req.method === 'POST') {
    const body = req.body;
    console.log('📋 Lead webhook çağrıldı:', JSON.stringify(body).substring(0, 500));

    try {
      if (body.entry) {
        for (const entry of body.entry) {
          for (const change of entry.changes || []) {
            if (change.field === 'leadgen') {
              const leadgenId = change.value.leadgen_id;
              const formId = change.value.form_id;
              const adId = change.value.ad_id || null;
              const createdTime = change.value.created_time;

              console.log(`📥 Yeni Lead! ID: ${leadgenId}, Form: ${formId}`);

              // Meta API'den lead detaylarını çek
              let leadData = {};
              try {
                const leadResponse = await axios.get(
                  `https://graph.facebook.com/v25.0/${leadgenId}`,
                  { params: { access_token: META_ACCESS_TOKEN } }
                );
                leadData = leadResponse.data;
                console.log('📋 Lead verileri:', JSON.stringify(leadData).substring(0, 500));
              } catch (e) {
                console.error('❌ Lead detay çekme hatası:', e.response?.data || e.message);
              }

              // Form alanlarını parse et
              const fields = {};
              if (leadData.field_data) {
                leadData.field_data.forEach(f => {
                  fields[f.name.toLowerCase()] = f.values?.[0] || '';
                });
              }

              const name = fields.full_name || fields.ad || fields.isim || fields.name || '';
              const phone = fields.phone_number || fields.telefon || fields.phone || '';
              const email = fields.email || fields.eposta || '';
              const city = fields.city || fields.sehir || fields.şehir || '';

              // Form adından kampanya bilgisi çıkar
              let formName = '';
              try {
                const formResponse = await axios.get(
                  `https://graph.facebook.com/v25.0/${formId}`,
                  { params: { access_token: META_ACCESS_TOKEN, fields: 'name' } }
                );
                formName = formResponse.data.name || '';
              } catch (e) { console.error('Form adı alınamadı:', e.message); }

              // Kampanya etiketlerini belirle
              const tags = [];
              const formLower = formName.toLowerCase();
              if (formLower.includes('ortopedi') || formLower.includes('orthop')) tags.push('Ortopedi');
              if (formLower.includes('kardiyoloji') || formLower.includes('cardio')) tags.push('Kardiyoloji');
              if (formLower.includes('estetik') || formLower.includes('aesthetic')) tags.push('Estetik');
              if (formLower.includes('diş') || formLower.includes('dental')) tags.push('Diş');
              if (formLower.includes('ortaasya') || formLower.includes('kazak') || formLower.includes('kirgiz') || formLower.includes('ozbek')) tags.push('Ortaasya');
              if (formLower.includes('avrupa') || formLower.includes('europe') || formLower.includes('gurbetci')) tags.push('Avrupa');
              if (tags.length === 0) tags.push('Genel');

              console.log(`👤 Lead: ${name} | 📱 ${phone} | 🏷 ${tags.join(', ')} | 📋 Form: ${formName}`);

              // Veritabanına kaydet
              if (sql && phone) {
                try {
                  // Leads tablosuna ekle
                  await sql`INSERT INTO leads (
                    phone_number, patient_name, email, city, form_id, form_name, ad_id,
                    leadgen_id, tags, raw_data, stage
                  ) VALUES (
                    ${phone}, ${name}, ${email}, ${city}, ${formId}, ${formName}, ${adId},
                    ${leadgenId}, ${JSON.stringify(tags)}, ${JSON.stringify(fields)}, 'new'
                  )`;

                  // Conversations tablosuna da ekle
                  const existing = await sql`SELECT id FROM conversations WHERE phone_number = ${phone}`;
                  if (existing.length === 0) {
                    await sql`INSERT INTO conversations (phone_number, patient_name, tags, status) VALUES (${phone}, ${name}, ${JSON.stringify(tags)}, 'active')`;
                  } else {
                    await sql`UPDATE conversations SET patient_name = ${name}, tags = ${JSON.stringify(tags)} WHERE phone_number = ${phone}`;
                  }
                } catch (e) { console.error('DB kayıt hatası:', e.message); }
              }

              // Google Sheets'e gönder
              try {
                await axios.post(GOOGLE_SHEET_URL, {
                  name, phone, email, city, form_name: formName, tags, stage: 'new'
                }, { timeout: 10000 });
                console.log('📊 Google Sheets\'e yazıldı');
              } catch (e) {
                console.error('❌ Google Sheets hatası:', e.message);
              }

              // Otomatik WhatsApp mesajı gönder
              if (phone) {
                // Telefon numarasını temizle
                let cleanPhone = phone.replace(/[\s\-\(\)\+]/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = '90' + cleanPhone.substring(1);
                if (!cleanPhone.match(/^\d{10,15}$/)) {
                  console.error('❌ Geçersiz telefon:', phone);
                  continue;
                }

                const department = tags.includes('Ortopedi') ? 'Ortopedi' :
                                   tags.includes('Kardiyoloji') ? 'Kardiyoloji' :
                                   tags.includes('Estetik') ? 'Estetik' : 'sağlık';

                const greeting = name ? `Merhaba ${name}!` : 'Merhaba!';
                const welcomeMsg = `${greeting} Başkent Üniversitesi Konya Hastanesi'nden yazıyoruz. ${department} konusundaki ilginiz için teşekkür ederiz. Uzman doktorlarımız sizi değerlendirmek için hazır. Size uygun bir randevu ayarlayalım mı? 😊`;

                try {
                  await axios({
                    method: 'POST',
                    url: `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
                    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
                    data: { messaging_product: 'whatsapp', to: cleanPhone, type: 'text', text: { body: welcomeMsg } }
                  });

                  // Mesajı kaydet
                  if (sql) {
                    await sql`INSERT INTO messages (phone_number, direction, content, model_used) VALUES (${cleanPhone}, 'out', ${welcomeMsg}, 'lead-auto')`;
                    await sql`UPDATE leads SET stage = 'contacted', contacted_at = NOW() WHERE leadgen_id = ${leadgenId}`;
                  }

                  console.log(`📤 Lead'e otomatik mesaj gönderildi: ${cleanPhone}`);
                } catch (e) {
                  console.error('❌ WhatsApp gönderim hatası:', e.response?.data || e.message);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Lead webhook genel hata:', error.message);
    }

    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.status(405).send('Method Not Allowed');
}
