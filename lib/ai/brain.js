import axios from 'axios';
import { getSetting } from '../db/index.js';
import { getDefaultPrompt } from './prompts.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function processMessage(channel, text, history = []) {
  // 1. Kanal bazlı ayarları ve promptu al
  let systemPrompt = await getSetting(`system_prompt_${channel}`);
  if (!systemPrompt) {
    // Eğer o kanal için özel bir prompt girilmemişse, genel system_prompt veya varsayılanı kullan
    systemPrompt = await getSetting('system_prompt', getDefaultPrompt(channel));
  }

  const primaryModel = await getSetting('ai_model', 'gemini-2.5-flash-lite');
  const models = [primaryModel, 'gemini-2.5-flash']; // Fallback mekanizması

  const languageInstruction = `\n\n#LANGUAGE DETECTION - THIS OVERRIDES EVERYTHING:\nDetect the language of the LAST user message ONLY. Respond ENTIRELY in that detected language. Do NOT look at previous messages to determine language. If the last message is in Arabic, respond in Arabic. If in English, respond in English. If in Russian, respond in Russian. If in Turkish, respond in Turkish. NEVER mix languages. NEVER default to Turkish unless the user wrote in Turkish.`;

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
            parts: [{ text: `${systemPrompt}${languageInstruction}` }]
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
