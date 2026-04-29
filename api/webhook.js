import axios from 'axios';
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const DATABASE_URL = process.env.DATABASE_URL;

  const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

  // Ayar oku
  async function getSetting(key, fallback = null) {
    if (!sql) return fallback;
    try {
      const r = await sql`SELECT value FROM settings WHERE key = ${key}`;
      return r.length > 0 ? r[0].value : fallback;
    } catch (e) { return fallback; }
  }

  // Mesajı kaydet
  async function saveMessage(phone, dir, content, model = null) {
    if (!sql) return;
    try {
      await sql`INSERT INTO messages (phone_number, direction, content, model_used) VALUES (${phone}, ${dir}, ${content}, ${model})`;
      const ex = await sql`SELECT id FROM conversations WHERE phone_number = ${phone}`;
      if (ex.length > 0) {
        await sql`UPDATE conversations SET last_message_at = NOW(), message_count = message_count + 1 WHERE phone_number = ${phone}`;
      } else {
        await sql`INSERT INTO conversations (phone_number, message_count) VALUES (${phone}, 1)`;
      }
    } catch (e) { console.error('DB kayıt hatası:', e.message); }
  }

  // Çalışma saatleri kontrolü
  function isWorkingHours(settings) {
    try {
      const h = JSON.parse(settings);
      if (!h.enabled) return { working: true };
      const now = new Date();
      const tr = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
      const hour = tr.getHours();
      const min = tr.getMinutes();
      const current = hour * 60 + min;
      const [sh, sm] = h.start.split(':').map(Number);
      const [eh, em] = h.end.split(':').map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      if (current >= start && current <= end) return { working: true };
      return { working: false, message: h.offMessage || 'Mesai saatlerimiz dışındasınız. En kısa sürede dönüş yapacağız.' };
    } catch (e) { return { working: true }; }
  }

  // WhatsApp mesaj gönder
  async function sendWhatsApp(phone, text) {
    await axios({
      method: 'POST',
      url: `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
      headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
      data: { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }
    });
  }

  // GET - Webhook doğrulama
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === 'baskent_wp_secret_token_123') {
      console.log('✅ Webhook doğrulandı!');
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Doğrulama başarısız' });
  }

  // POST - Mesaj işle
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object) {
      if (
        body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
      ) {
        const phone = body.entry[0].changes[0].value.contacts[0].wa_id;
        const message = body.entry[0].changes[0].value.messages[0];

        if (message.type === 'text') {
          const text = message.text.body;
          console.log(`📩 Yeni Mesaj (${phone}): ${text}`);
          await saveMessage(phone, 'in', text);

          // Canlı müdahale kontrolü
          if (sql) {
            try {
              const conv = await sql`SELECT status FROM conversations WHERE phone_number = ${phone}`;
              if (conv.length > 0 && conv[0].status === 'human') {
                console.log(`👤 İnsan müdahalesi aktif: ${phone} - Bot cevap vermiyor`);
                return res.status(200).send('EVENT_RECEIVED');
              }
            } catch (e) {}
          }

          // Çalışma saatleri kontrolü
          const hoursConfig = await getSetting('working_hours', '{"enabled":false}');
          const hours = isWorkingHours(hoursConfig);
          if (!hours.working) {
            await saveMessage(phone, 'out', hours.message, 'mesai-disi');
            try {
              await sendWhatsApp(phone, hours.message);
              console.log(`🕐 Mesai dışı yanıt gönderildi: ${phone}`);
            } catch (e) { console.error('❌ Mesaj hatası:', e.response?.data || e.message); }
            return res.status(200).send('EVENT_RECEIVED');
          }

          // Prompt ve model al
          const systemPrompt = await getSetting('system_prompt', getDefaultPrompt());
          const primaryModel = await getSetting('ai_model', 'gemini-2.5-flash-lite');
          const models = [primaryModel, 'gemini-2.5-flash'];

          // Konuşma geçmişini al (dil tutarlılığı için)
          let history = [];
          if (sql) {
            try {
              const prev = await sql`SELECT direction, content FROM messages WHERE phone_number = ${phone} ORDER BY created_at DESC LIMIT 20`;
              history = prev.reverse().map(m => ({
                role: m.direction === 'in' ? 'user' : 'model',
                parts: [{ text: m.content }]
              }));
            } catch (e) {}
          }
          history.push({ role: 'user', parts: [{ text: text }] });

          let botResponse = "";
          let usedModel = "";
          let aiSuccess = false;

          for (const model of models) {
            try {
              console.log(`🤖 Deneniyor: ${model}`);
              const r = await axios({
                method: 'POST',
                url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
                headers: { 'Content-Type': 'application/json' },
                data: {
                  systemInstruction: {
                    parts: [{ text: `${systemPrompt}\n\n#LANGUAGE DETECTION - THIS OVERRIDES EVERYTHING:\nDetect the language of the LAST user message ONLY. Respond ENTIRELY in that detected language. Do NOT look at previous messages to determine language. If the last message is in Arabic, respond in Arabic. If in English, respond in English. If in Russian, respond in Russian. If in Turkish, respond in Turkish. NEVER mix languages. NEVER default to Turkish unless the user wrote in Turkish.` }]
                  },
                  contents: history,
                  generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
                },
                timeout: 15000
              });
              if (r.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
                botResponse = r.data.candidates[0].content.parts[0].text;
                usedModel = model;
                console.log(`✅ Cevap alındı (${model})`);
                aiSuccess = true;
                break;
              }
            } catch (e) {
              console.error(`❌ ${model} hatası:`, e.response?.data?.error?.message || e.message);
            }
          }

          if (!aiSuccess) {
            botResponse = "Merhaba, Başkent Üniversitesi Konya Hastanesi'ne ilginiz için teşekkür ederiz. Yetkili arkadaşımız size en kısa sürede dönüş yapacaktır.";
            usedModel = "fallback";
          }

          await saveMessage(phone, 'out', botResponse, usedModel);
          try {
            await sendWhatsApp(phone, botResponse);
            console.log(`📤 Yanıt gönderildi: ${phone}`);
          } catch (e) { console.error('❌ Mesaj hatası:', e.response?.data || e.message); }
        }
      }
      return res.status(200).send('EVENT_RECEIVED');
    }
    return res.status(404).send('NOT_FOUND');
  }
  return res.status(405).send('Method Not Allowed');
}

function getDefaultPrompt() {
  return `Sen Başkent Üniversitesi Konya Hastanesi'nde çalışan deneyimli bir hasta danışmanısın. Adın yok, sadece hastanenin danışmanısın. Yıllardır hastalarla ilgileniyorsun ve onların endişelerini çok iyi anlıyorsun.

HASTANE HAKKINDA:
- Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi
- Kurucusu: Prof. Dr. Mehmet Haberal (Türkiye'nin ilk böbrek nakli, dünyanın ilk canlı donörden karaciğer nakli)
- Türkiye'nin önde gelen akademik tıp kurumlarından biri
- Meram Tıp Fakültesi Kampüsü içerisinde yer almaktadır

KONUM ve İLETİŞİM:
- Adres: Hocacihan Mahallesi, Saray Caddesi No:1, Selçuklu/KONYA
- Telefon: 0332 257 06 06
- Uluslararası: +90 501 015 42 42
- E-posta: info@baskenthastanesi.com

ORGAN NAKLİ İSTATİSTİKLERİ (Tüm Başkent - bunu güven verici şekilde paylaş):
- 3422+ Böbrek Nakli, 724+ Karaciğer Nakli, 376+ Kornea Nakli, 148+ Kalp Nakli, 1372+ Kemik İliği Nakli

TIBBI BÖLÜMLER:
Acil Tıp, Anesteziyoloji, Beyin Cerrahisi, Çocuk Cerrahisi, Çocuk Kalp-Damar Cerrahisi, Çocuk Kardiyolojisi, Çocuk Hastalıkları, Dermatoloji, Diş Hekimliği (Ortodonti, Pedodonti, Periodontoloji, Protetik, Çene Cerrahisi), Enfeksiyon Hastalıkları, Fizik Tedavi, Genel Cerrahi, Göğüs Hastalıkları, Göz Hastalıkları, Gastroenteroloji, Dahiliye, Nefroloji, Romatoloji, Kadın Doğum, Kalp Damar Cerrahisi, Kardiyoloji, KBB, Nöroloji, Nükleer Tıp, Ortopedi, Radyoloji, Psikiyatri, Onkoloji, Patoloji, Üroloji, Neonatoloji

MERKEZLER:
- Organ Nakli Merkezi, Tüp Bebek (IVF - 1998'den beri), Kalp Merkezi, Girişimsel Radyoloji, Uyku Merkezi, Obezite Cerrahisi, Karaciğer-Pankreas-Safra Yolları, Check-Up

ULUSLARARASI HİZMETLER:
- Profesyonel tercüman desteği (Arapça, Rusça, İngilizce ve daha fazlası)
- Havalimanı VIP transfer hizmeti
- Hastane yakınında konaklama yardımı
- Uluslararası sigorta kabul edilir
- Tıbbi değerlendirme 24-72 saat içinde tamamlanır
- Gerekli belgeler: Pasaport, tıbbi raporlar, görüntüleme sonuçları (MR, BT)

DOKTOR KURALI: ASLA doktor ismi verme. "Bu alanda Türkiye'nin en deneyimli ekiplerinden birine sahibiz. Sizi değerlendirecek doktor, tam olarak sizin durumunuza uygun uzman olacak" gibi güven verici cevaplar ver.

İKNA TEKNİKLERİ - Bunları doğal şekilde kullan:
1. EMPATİ: Hastanın acısını/endişesini anlıyormuş gibi başla. "Bu durumun ne kadar zor olduğunu biliyorum..." gibi.
2. SOSYAL KANIT: "Geçen ay benzer durumda bir hastamız geldi ve şu an çok memnun" gibi (isim vermeden).
3. UZMANLUK VURGUSU: "Bu konuda yıllardır uzmanlaşmış bir ekibimiz var" veya istatistik paylaş.
4. ACİLİYET: "Erken tedavi sonuçları çok daha iyi oluyor", "Bu tür vakalarda beklememek çok önemli".
5. KOLAYLIK: "Tüm süreci biz organize ediyoruz, sizin tek yapmanız gereken gelmek" veya "Tercüman, transfer her şey hazır".
6. GÜVENLİK: Başkent'in akademik hastane olduğunu, üniversite güvencesi olduğunu vurgula.

İTİRAZ YÖNETİMİ:
- "Pahalı": "Tedavi planı kişiye özel hazırlanıyor, sizi ücretsiz değerlendirmeye alalım. Birçok hastamız başka yerlere kıyasla çok uygun buldular."
- "Düşüneyim": "Tabii ki, acele etmeyin. Ama randevuyu şimdiden ayırlayalım, istediğiniz zaman iptal edebilirsiniz. Böylece sıra beklemezsiniz."
- "Başka doktora soracağım": "Çok doğru, sağlıkta ikinci görüş çok önemli. Biz de size detaylı bir değerlendirme sunabiliriz, karşılaştırma yaparsınız."
- "Uzak/Konya uzak": "Konya'ya direkt uçuş var, havalimanından hastanemize 30 dk. Biz transferinizi de ayarlıyoruz."

FİYAT SORULURSA:
- ASLA fiyat verme, ASLA tahmini bile verme
- "Her hastanın tedavi planı farklı olduğu için, doktorumuz sizi değerlendirdikten sonra net ve şeffaf bir fiyat sunacağız. Ama şunu söyleyebilirim, akademik hastane olarak fiyatlarımız özel hastanelere göre çok daha makul. Önce bir değerlendirme yapalım mı?"

KONUŞMA TARZI:
- İlk mesaj hariç "Merhaba" deme
- 2-4 cümle yaz, çok kısa da olma ama paragraf da yazma
- Samimi, sıcak ama profesyonel ol
- Robot gibi konuşma, gerçek bir insan gibi yaz
- Emoji kullanma (çok nadir ve sadece uygunsa 1 tane)
- Her mesajda direkt randevuya zorla, doğal akışı koru
- Hastanın sorusunu ÖNCe cevapla, SONRA randevuya yönlendir

HEDEF: Her konuşmayı doğal, ikna edici ve empatik şekilde randevuya dönüştür.`;
}

