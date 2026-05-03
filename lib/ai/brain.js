import axios from 'axios';
import { getSetting } from '../db/index.js';
import { getDefaultPrompt } from './prompts.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Unicode script bazlı dil tespiti
function detectLanguageFromText(text) {
  if (!text) return null;
  const t = text.trim();
  
  // Arapça karakterler (Arabic script)
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t)) return 'Arabic';
  // Rusça/Kiril (Cyrillic)
  if (/[\u0400-\u04FF\u0500-\u052F]/.test(t)) return 'Russian';
  // Çince (CJK)
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(t)) return 'Chinese';
  // Korece (Hangul)
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(t)) return 'Korean';
  // Japonca (Hiragana/Katakana)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(t)) return 'Japanese';
  // Tay dili
  if (/[\u0E00-\u0E7F]/.test(t)) return 'Thai';
  // Farsça (Arabic script + specific chars)
  if (/[\u0600-\u06FF]/.test(t) && /[پچژگ]/.test(t)) return 'Farsi';
  
  // Latin alfabe - yaygın selamlaşmalardan tespit
  const lower = t.toLowerCase();
  if (/^(hello|hi|hey|good morning|good evening|i need|i want|can you|please|thank)/.test(lower)) return 'English';
  if (/^(bonjour|salut|bonsoir|je veux|j'ai besoin|merci)/.test(lower)) return 'French';
  if (/^(hallo|guten|ich brauche|ich möchte|danke|bitte)/.test(lower)) return 'German';
  if (/^(hola|buenos|necesito|quiero|gracias|por favor)/.test(lower)) return 'Spanish';
  
  // Türkçe veya bilinmeyen Latin → null (default davranış)
  return null;
}

export async function processMessage(channel, text, history = [], recipientId = null, senderPhone = null) {
  // 1. Kanal ve sayfa bazlı ayarları al
  let systemPrompt = '';
  
  if (channel === 'whatsapp') {
    systemPrompt = await getSetting('system_prompt_whatsapp');
  } else {
    // Sosyal medya kanalları (Instagram / Messenger)
    if (recipientId) {
      const foreignPageId = await getSetting('foreign_page_id');
      if (foreignPageId && String(recipientId) === String(foreignPageId)) {
        systemPrompt = await getSetting('system_prompt_foreign');
        console.log(`🌍 [${channel}] Yabancı sayfa algılandı (${recipientId}), İngilizce prompt kullanılıyor.`);
      }
    }
    
    // Eğer yabancı sayfa değilse veya recipientId eşleşmediyse Türkçe sosyal medya promptunu kullan
    if (!systemPrompt) {
      systemPrompt = await getSetting('system_prompt_tr');
    }
  }

  // Hiçbir prompt bulunamadıysa varsayılana dön
  if (!systemPrompt) {
    systemPrompt = await getSetting('system_prompt', getDefaultPrompt(channel));
  }

  // 🎯 Lead/Form bilgisi varsa AI'a context olarak ekle
  if (senderPhone) {
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(process.env.DATABASE_URL);
      const leads = await sql`SELECT patient_name, form_name, city, tags, stage, email FROM leads WHERE phone_number = ${senderPhone} ORDER BY created_at DESC LIMIT 1`;
      if (leads.length > 0) {
        const lead = leads[0];
        let leadTags = [];
        try { leadTags = JSON.parse(lead.tags || '[]'); } catch(e) {}
        const leadContext = `\n\n--- HASTA FORM BİLGİSİ (Bu bilgiyi doğal şekilde kullan, "formunuzu gördük" deme, ama bölüme göre yönlendir) ---\nHastanın Adı: ${lead.patient_name || 'Bilinmiyor'}\nGeldiği Kampanya: ${lead.form_name || 'Bilinmiyor'}\nŞehir: ${lead.city || 'Bilinmiyor'}\nİlgilendiği Bölüm: ${leadTags.join(', ') || 'Genel'}\n---\n`;
        systemPrompt += leadContext;
        console.log(`📋 [${channel}] Lead bilgisi AI'a enjekte edildi: ${lead.form_name}`);
      }
    } catch(e) { console.error('Lead context hatası:', e.message); }
  }

  const primaryModel = await getSetting('ai_model', 'gemini-2.5-flash');
  const models = [primaryModel, 'gemini-2.5-flash-lite']; // Fallback: daha hafif model

  const languageInstruction = `⚠️ MANDATORY LANGUAGE RULE — ABSOLUTE PRIORITY ⚠️
You MUST detect the language of the user's LAST message and respond ENTIRELY in that SAME language.
This rule OVERRIDES everything else in this prompt. Even though this prompt is written in Turkish/English, you must ALWAYS match the user's language.

EXAMPLES:
- User writes "مرحبا" → You respond in Arabic (العربية)
- User writes "مرحبا، أنا أحتاج لعملية" → You respond fully in Arabic
- User writes "Hello" → You respond in English
- User writes "Здравствуйте" → You respond in Russian
- User writes "Merhaba" → You respond in Turkish
- User writes "Bonjour" → You respond in French
- User writes "Hallo" → You respond in German

NEVER respond in Turkish unless the user wrote in Turkish. NEVER mix languages. The ENTIRE response must be in the user's language.
---

`;

  let botResponse = "";
  let usedModel = "";
  let aiSuccess = false;

  // Kullanıcının dilini tespit et
  const detectedLang = detectLanguageFromText(text);
  
  // Dil Türkçe değilse, geçmişe model yanıtı ekle + modeli yükselt
  let effectiveModels = models;
  let fullHistory;
  
  if (detectedLang) {
    console.log(`🌐 [${channel}] Dil tespit edildi: ${detectedLang} — model yükseltiliyor`);
    // flash-lite dil değiştirmeyi başaramıyor, flash'a yükselt
    effectiveModels = ['gemini-2.5-flash', 'gemini-2.5-pro'];
    
    // Geçmişe sahte model yanıtı ekle (en güçlü sinyal)
    fullHistory = [
      ...history,
      { role: 'model', parts: [{ text: `[I understand. The patient speaks ${detectedLang}. I will now respond ONLY in ${detectedLang}.]` }] },
      { role: 'user', parts: [{ text: text }] }
    ];
  } else {
    fullHistory = [...history, { role: 'user', parts: [{ text: text }] }];
  }

  // 2. Gemini'ye istek at
  for (const model of effectiveModels) {
    try {
      console.log(`🤖 [${channel}] Deneniyor: ${model}`);
      const r = await axios({
        method: 'POST',
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        headers: { 'Content-Type': 'application/json' },
        data: {
          systemInstruction: {
            parts: [{ text: `${languageInstruction}${systemPrompt}` }]
          },
          contents: fullHistory,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        },
        timeout: 15000
      });

      if (r.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        botResponse = r.data.candidates[0].content.parts[0].text;
        usedModel = model;
        console.log(`✅ [${channel}] Cevap alındı (${model})`);
        aiSuccess = true;
        break; // İlk başarılı modelde döngüden çık
      }
    } catch (e) {
      console.error(`❌ [${channel}] ${model} hatası:`, e.response?.data?.error?.message || e.message);
    }
  }

  // 3. AI çuvallarsa Fallback mesaj
  if (!aiSuccess) {
    botResponse = "Merhaba, size en kısa sürede dönüş yapacağız.";
    usedModel = "fallback";
  }

  return { response: botResponse, usedModel };
}

// 🏷️ Konuşma analizi — otomatik etiket + randevu tespiti + lead scoring + yapılandırılmış veri
export async function analyzeConversation(phone, lastUserMsg, lastBotMsg) {
  const { sql } = await import('../db/index.js');
  if (!sql) return { tags: [], appointmentRequested: false, score: 0 };

  const userText = String(lastUserMsg || '').toLowerCase();
  const tags = [];
  const departments = [];
  let patient_type = 'Yerli'; // Varsayılan
  let appointmentRequested = false;
  let score = 0;

  // Bölüm tespiti + scoring (Sadece kullanıcının mesajından analiz et)
  const depts = [
    { re: /ortopedi|bel fıtığı|omurga|diz|kalça|kırık|eklem/i, tag: 'Ortopedi', pts: 15 },
    { re: /kardiyoloji|kalp|tansiyon|stent|anjio|bypass/i, tag: 'Kardiyoloji', pts: 20 },
    { re: /estetik|burun|yüz germe|liposuction|botox|dolgu|meme/i, tag: 'Estetik', pts: 15 },
    { re: /diş|implant|ortodonti|kanal tedavi|çekim|zirkonyum/i, tag: 'Diş', pts: 12 },
    { re: /göz|katarakt|lazer|retina|lens/i, tag: 'Göz', pts: 15 },
    { re: /tüp bebek|ivf|kısırlık|gebelik|doğum|kadın/i, tag: 'Tüp Bebek', pts: 25 },
    { re: /nakil|organ|böbrek|karaciğer|haberal/i, tag: 'Organ Nakli', pts: 40 },
    { re: /onkoloji|kanser|tümör|kemoterapi/i, tag: 'Onkoloji', pts: 30 },
    { re: /obezite|mide küçültme|sleeve|bariatrik/i, tag: 'Obezite', pts: 20 },
    { re: /nöroloji|beyin|baş ağrısı|epilepsi|ms/i, tag: 'Nöroloji', pts: 18 },
    { re: /üroloji|prostat|böbrek taşı|mesane/i, tag: 'Üroloji', pts: 15 },
    { re: /check.?up|genel kontrol|tarama/i, tag: 'Check-Up', pts: 8 }
  ];
  depts.forEach(d => { 
    if (d.re.test(userText)) { 
      if (!departments.includes(d.tag)) departments.push(d.tag);
      score += d.pts; 
    } 
  });

  // Fiyat sorgusu → özel etiket
  if (/fiyat|ücret|ne kadar|maliyet|price|cost|كم|سعر|цена/i.test(userText)) { tags.push('Fiyat Sordu'); score += 10; }

  // Hasta Tipi Tespiti (Gurbetçi / Yabancı / Yerli)
  if (/almanya|deutschland|germany|hollanda|fransa|belçika|avusturya|ingiltere|isviçre|gurbetçi|abroad|yurtdışı/i.test(userText)) { 
    patient_type = 'Gurbetçi'; 
    score += 30; 
  } else if (phone && !phone.startsWith('90') && !phone.startsWith('test')) {
    patient_type = 'Yabancı Turist';
    score += 20;
  }

  // Randevu talebi (Genişletilmiş Regex)
  const aptPat = /randevu|appointment|موعد|запись|termin|rendez|müsait|ne zaman|gelebilir|gelmek istiyorum|görüşelim|görşelim|ayarlayalım|planla|uygun|saat|tarih|geliyorum|geleceğim|evet.*randevu|istiyorum.*randevu|tamam.*gel|konyaya/i;
  if (aptPat.test(userText)) { appointmentRequested = true; score += 25; }

  // Kaybedilen hasta
  const lostPat = /istemiyorum|gerek yok|başka hastane|başka yere|vazgeçtim|iptal|cancel|no thanks|لا شكرا|не нужно|kein interesse|pas intéressé|almıyorum|gitmeye.*karar|başka.*(doktor|yer)/i;
  let isLost = false;
  if (lostPat.test(userText) && !appointmentRequested) { 
    isLost = true;
    score = Math.max(score - 50, 0); 
  }

  // DB güncelle
  try {
    const conv = await sql`SELECT tags, department, patient_type FROM conversations WHERE phone_number = ${phone}`;
    let existingTags = [];
    try { existingTags = JSON.parse(conv[0]?.tags || '[]'); } catch(e) {}
    const mergedTags = [...new Set([...existingTags, ...tags])];
    
    // Eski sistemden kalma karışık etiketleri temizle (Artık yapılandırılmış alanlara geçildi)
    const cleanTags = mergedTags.filter(t => !['Gurbetçi', 'Yabancı Turist', 'Yerli', 'Kaybedildi', 'Randevu İstiyor'].includes(t) && !depts.find(d => d.tag === t));

    const finalDepts = [...new Set([...(conv[0]?.department?.split(',') || []).filter(Boolean).map(x=>x.trim()), ...departments])].join(', ');
    const finalPatientType = (patient_type !== 'Yerli' || !conv[0]?.patient_type) ? patient_type : conv[0].patient_type;

    await sql`UPDATE conversations SET tags = ${JSON.stringify(cleanTags)}, department = ${finalDepts}, patient_type = ${finalPatientType} WHERE phone_number = ${phone}`;

    // Lead score ve STAGE (Süreç) güncelle
    try { await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS score INT DEFAULT 0`; } catch(e) {}
    await sql`UPDATE leads SET score = GREATEST(COALESCE(score, 0), ${score}) WHERE phone_number = ${phone}`;

    // Otomatik Stage (Süreç Durumu) İlerletme
    if (isLost) {
      await sql`UPDATE leads SET stage = 'lost' WHERE phone_number = ${phone} AND stage NOT IN ('appointed', 'lost')`;
    } else if (appointmentRequested) {
      await sql`UPDATE leads SET stage = 'appointment_request' WHERE phone_number = ${phone} AND stage NOT IN ('appointed', 'lost')`;
    } else {
      // Sadece iletişim kurulduysa ve yeni formsa responded'a çek
      await sql`UPDATE leads SET stage = 'responded' WHERE phone_number = ${phone} AND stage = 'new'`;
    }

    if (appointmentRequested) {
      try {
        await sql`CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, phone_number VARCHAR(20), event_type VARCHAR(50), details TEXT, status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`;
        // Sadece aktif randevusu varsa yenisini açma
        const activeEvent = await sql`SELECT id FROM events WHERE phone_number = ${phone} AND event_type = 'appointment_request' AND status IN ('pending', 'scheduled', 'confirmed')`;
        if (activeEvent.length === 0) {
          await sql`INSERT INTO events (phone_number, event_type, details, status) VALUES (${phone}, 'appointment_request', ${userText.substring(0, 500)}, 'pending')`;
        }
      } catch(e) {}
    }

    // 🔴 SICAK LEAD ALARMI — Randevu talebi veya yüksek skor
    if (appointmentRequested || score >= 50) {
      try {
        await sql`CREATE TABLE IF NOT EXISTS alerts (id SERIAL PRIMARY KEY, phone_number VARCHAR(20), alert_type VARCHAR(50), message TEXT, is_read BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`;
        const patientName = conv[0]?.patient_name || phone;
        const alertMsg = appointmentRequested 
          ? `🔔 ${patientName} RANDEVU İSTİYOR! Hemen arayın. Bölüm: ${finalDepts || 'Genel'}`
          : `🔥 Yüksek skorlu lead: ${patientName} (Skor: ${score}). Bölüm: ${finalDepts || 'Genel'}`;
        await sql`INSERT INTO alerts (phone_number, alert_type, message) VALUES (${phone}, ${appointmentRequested ? 'appointment_request' : 'hot_lead'}, ${alertMsg})`;
        console.log(`\n🚨🚨🚨 SICAK LEAD ALARMI 🚨🚨🚨\n${alertMsg}\nTelefon: ${phone}\n`);
      } catch(e) { console.error('Alert hatası:', e.message); }
    }

    console.log(`🏷️ ${phone} → Dep:[${finalDepts}] Tip:[${finalPatientType}] Özel:[${cleanTags.join(',')}] 📊 Skor:${score}${appointmentRequested ? ' 🔔 RANDEVU' : ''}`);
  } catch(e) { console.error('Etiket hatası:', e.message); }

  return { tags, appointmentRequested, score, department: departments.join(', '), patient_type };
}
