import axios from 'axios';
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const DATABASE_URL = process.env.DATABASE_URL;
  const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL;
  const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

  // GET - Meta webhook doğrulama
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
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
              let leadgenId = change.value.leadgen_id;
              // Test verisi aynı ID gönderiyor, benzersiz yap
              if (/^4+$/.test(leadgenId)) leadgenId = `${leadgenId}_${Date.now()}`;
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

              // Kampanya etiketlerini belirle (Genişletilmiş — brain.js ile senkron)
              const tags = [];
              const formLower = formName.toLowerCase();
              const deptMap = [
                { re: /ortopedi|orthop|bel fıtığı|omurga|diz|kalça|kırık|eklem/i, tag: 'Ortopedi' },
                { re: /kardiyoloji|cardio|kalp|tansiyon|stent|anjio|bypass/i, tag: 'Kardiyoloji' },
                { re: /estetik|aesthetic|burun|yüz germe|liposuction|botox|dolgu|meme|rhino/i, tag: 'Estetik' },
                { re: /diş|dental|implant|ortodonti|kanal tedavi|çekim|zirkonyum/i, tag: 'Diş' },
                { re: /göz|eye|katarakt|lazer|retina|lens/i, tag: 'Göz' },
                { re: /tüp bebek|ivf|kısırlık|gebelik|doğum|kadın|fertility/i, tag: 'Tüp Bebek' },
                { re: /nakil|organ|böbrek|karaciğer|haberal|transplant|kidney|liver/i, tag: 'Organ Nakli' },
                { re: /onkoloji|kanser|tümör|kemoterapi|oncology|cancer/i, tag: 'Onkoloji' },
                { re: /obezite|mide küçültme|sleeve|bariatrik|obesity|gastric/i, tag: 'Obezite' },
                { re: /nöroloji|beyin|baş ağrısı|epilepsi|neurology/i, tag: 'Nöroloji' },
                { re: /üroloji|prostat|böbrek taşı|mesane|urology/i, tag: 'Üroloji' },
                { re: /check.?up|genel kontrol|tarama|screening/i, tag: 'Check-Up' }
              ];
              
              // Form adı VE form alanlarından bölüm tespiti
              const combinedText = `${formLower} ${Object.values(fields).join(' ').toLowerCase()}`;
              deptMap.forEach(d => {
                if (d.re.test(combinedText) && !tags.includes(d.tag)) tags.push(d.tag);
              });

              // Coğrafi etiketler
              if (/ortaasya|kazak|kirgiz|ozbek|central.?asia/i.test(combinedText)) tags.push('Ortaasya');
              if (/avrupa|europe|gurbetci|germany|france|netherlands/i.test(combinedText)) tags.push('Avrupa');
              if (tags.length === 0) tags.push('Genel');

              // Hasta tipi: Telefon numarasından tespit
              let patientType = 'Yerli';
              let cleanPhone = (phone || '').replace(/[\s\-\(\)\+]/g, '');
              if (cleanPhone.startsWith('0')) cleanPhone = '90' + cleanPhone.substring(1);
              
              if (cleanPhone && !cleanPhone.startsWith('90')) {
                // Avrupa ülke kodları (Gurbetçi tespiti)
                const gurbetciCodes = ['49','44','33','31','32','43','41','46','45','47','39','34','48','420','36','40'];
                const isGurbetci = gurbetciCodes.some(c => cleanPhone.startsWith(c));
                patientType = isGurbetci ? 'Gurbetçi' : 'Yabancı Turist';
              }

              const department = tags.filter(t => !['Genel','Ortaasya','Avrupa'].includes(t)).join(', ') || '';

              console.log(`👤 Lead: ${name} | 📱 ${phone} | 🏷 ${tags.join(', ')} | 📋 Form: ${formName} | 🩺 Dep: ${department} | 👤 Tip: ${patientType}`);

              // Veritabanına kaydet
              let savePhone = cleanPhone || `test_${String(Date.now()).slice(-10)}`;
              if (savePhone.length > 20) savePhone = `test_${String(Date.now()).slice(-10)}`;

              if (sql) {
                try {
                  await sql`INSERT INTO leads (
                    phone_number, patient_name, email, city, form_id, form_name, ad_id,
                    leadgen_id, tags, raw_data, stage
                  ) VALUES (
                    ${savePhone}, ${name}, ${email}, ${city}, ${formId}, ${formName}, ${adId},
                    ${leadgenId}, ${JSON.stringify(tags)}, ${JSON.stringify(fields)}, 'new'
                  ) ON CONFLICT (leadgen_id) DO UPDATE SET
                    phone_number = ${savePhone}, patient_name = ${name}, stage = 'new'`;

                  // Conversations tablosuna da ekle (department ve patient_type ile!)
                  const existing = await sql`SELECT id FROM conversations WHERE phone_number = ${savePhone}`;
                  if (existing.length === 0) {
                    await sql`INSERT INTO conversations (phone_number, patient_name, tags, status, department, patient_type) VALUES (${savePhone}, ${name}, ${JSON.stringify(tags)}, 'active', ${department}, ${patientType})`;
                  } else {
                    await sql`UPDATE conversations SET patient_name = ${name}, tags = ${JSON.stringify(tags)}, department = ${department}, patient_type = ${patientType} WHERE phone_number = ${savePhone}`;
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

              // Otomatik WhatsApp karşılama mesajı gönder
              if (phone && cleanPhone.match(/^\d{10,15}$/)) {
                // 🕐 Saat kontrolü: Türkiye saatine göre 08:00-21:00 arası mı?
                const trHour = new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul', hour: 'numeric', hour12: false });
                const hourNow = parseInt(trHour);
                const isBusinessHours = hourNow >= 8 && hourNow < 21;

                if (!isBusinessHours) {
                  // Gece saati — mesajı GÖNDERME, sabah gönderilmek üzere işaretle
                  console.log(`🌙 Gece saati (${hourNow}:00 TR) — ${cleanPhone} için mesaj sabah 08:00'e ertelendi`);
                  if (sql) {
                    try {
                      await sql`UPDATE conversations SET phase = 'pending_welcome' WHERE phone_number = ${savePhone}`;
                      await sql`UPDATE leads SET stage = 'new' WHERE leadgen_id = ${leadgenId}`;
                    } catch(e) {}
                  }
                } else {
                // Dil tespiti: +90 ise Türkçe, değilse İngilizce
                const isTurkish = cleanPhone.startsWith('90');
                
                // Panelden düzenlenebilir karşılama mesajları (DB'den oku)
                let greetingTr = '';
                let greetingEn = '';
                if (sql) {
                  try {
                    const trSet = await sql`SELECT value FROM settings WHERE key = 'form_greeting_tr'`;
                    const enSet = await sql`SELECT value FROM settings WHERE key = 'form_greeting_en'`;
                    greetingTr = trSet.length > 0 ? trSet[0].value : '';
                    greetingEn = enSet.length > 0 ? enSet[0].value : '';
                  } catch(e) {}
                }
                
                const deptLabel = department || 'sağlık';
                const greeting = name ? (isTurkish ? `Merhaba ${name}!` : `Hello ${name}!`) : (isTurkish ? 'Merhaba!' : 'Hello!');

                let welcomeMsg;
                if (isTurkish) {
                  welcomeMsg = greetingTr
                    ? greetingTr.replace('{isim}', name || '').replace('{bolum}', deptLabel).trim()
                    : `${greeting} Başkent Üniversitesi Konya Hastanesi'nden yazıyoruz 🙏\n\n${deptLabel} konusunda bize ulaştığınızı gördük. Şikayetiniz ne zamandır devam ediyor?\n\nDurumunuzu daha iyi anlamamız için birkaç soru sormak istiyoruz, sonrasında size en uygun değerlendirmeyi sunalım.`;
                } else {
                  welcomeMsg = greetingEn
                    ? greetingEn.replace('{name}', name || '').replace('{department}', deptLabel).trim()
                    : `${greeting} We're reaching out from Başkent University Konya Hospital 🙏\n\nWe noticed your interest in ${deptLabel}. How long have you been experiencing this issue?\n\nWe'd like to understand your situation better so we can recommend the best course of action for you.`;
                }

                try {
                  await axios({
                    method: 'POST',
                    url: `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
                    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
                    data: { messaging_product: 'whatsapp', to: cleanPhone, type: 'text', text: { body: welcomeMsg } }
                  });

                  if (sql) {
                    await sql`INSERT INTO messages (phone_number, direction, content, model_used) VALUES (${cleanPhone}, 'out', ${welcomeMsg}, 'lead-auto')`;
                    await sql`UPDATE leads SET stage = 'contacted', contacted_at = NOW() WHERE leadgen_id = ${leadgenId}`;
                  }

                  console.log(`📤 Lead'e ${isTurkish ? 'TR' : 'EN'} otomatik mesaj gönderildi: ${cleanPhone}`);
                } catch (e) {
                  console.error('❌ WhatsApp gönderim hatası:', e.response?.data || e.message);
                }
                } // end business hours
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
