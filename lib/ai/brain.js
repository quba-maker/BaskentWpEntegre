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

  const primaryModel = await getSetting('ai_model', 'gemini-2.5-flash-lite');
  const models = [primaryModel, 'gemini-2.5-flash']; // Fallback mekanizması

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
