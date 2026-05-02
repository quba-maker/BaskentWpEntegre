import axios from 'axios';
import { getSetting } from '../db/index.js';
import { getDefaultPrompt } from './prompts.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function processMessage(channel, text, history = [], recipientId = null) {
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

  const fullHistory = [...history, { role: 'user', parts: [{ text: text }] }];

  // 2. Gemini'ye istek at
  for (const model of models) {
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
