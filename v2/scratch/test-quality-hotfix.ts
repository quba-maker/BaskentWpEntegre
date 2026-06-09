import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { TurkishReplyQualityGate } from '../src/lib/services/ai/turkish-quality-gate';
import { PromptBuilder } from '../src/lib/services/ai/prompt-builder';
import { TenantBrain } from '../src/lib/brain/tenant-brain';

// Simple direct Gemini caller for testing to avoid running full worker pipeline/outbounds
async function callGeminiDirect(promptText: string, history: any[]): Promise<string> {
  const modelId = 'gemini-2.5-flash';
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in environment");
  }

  const contents = history.map(m => {
    if (m.role === 'user') {
      return { role: 'user', parts: [{ text: m.content }] };
    } else {
      return { role: 'model', parts: [{ text: m.content }] };
    }
  });

  const payload = {
    systemInstruction: { parts: [{ text: promptText }] },
    contents,
    generationConfig: {
      temperature: 0.1 // low temperature for deterministic test
    }
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API Error: ${err}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || '';
  
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    console.log(`[WARNING] Gemini finishReason: ${candidate.finishReason}`);
  }
  
  return text;
}

async function runUnitTests() {
  console.log("=== RUNNING QUALITY GATE UNIT TESTS ===");

  const testCases = [
    // Duplicate Suffix Cases (Should Fail)
    { text: "Lütfen adınızızı paylaşır mısınız?", expected: false, desc: "adınızızı suffix duplicate" },
    { text: "Sorularınızızı cevaplayalım.", expected: false, desc: "sorularınızızı suffix duplicate" },
    { text: "Çocuğunuzunuz tedavisini planlayalım.", expected: false, desc: "çocuğunuzunuz suffix duplicate" },
    { text: "Hastanemiziniz doktorları son derece iyidir.", expected: false, desc: "hastanemiziniz suffix duplicate" },
    { text: "Burunuz yapınızız doğrultusunda.", expected: false, desc: "yapınızız suffix duplicate" },
    { text: "Süreciniziniz detayları buradadır.", expected: false, desc: "süreciniziniz suffix duplicate" },
    { text: "Doktorlarımızınız muayenesi sonrasında.", expected: false, desc: "doktorlarımızınız suffix duplicate" },
    { text: "Uzmanlarımızınız yardımıyla.", expected: false, desc: "uzmanlarımızınız suffix duplicate" },
    { text: "Hastanızınız durumunu takip ediyoruz.", expected: false, desc: "hastanızınız suffix duplicate" },
    { text: "Bu tedaviyi planızı olarak yapıyoruz.", expected: false, desc: "planızı suffix duplicate" },
    
    // Exception Cases (Should Pass)
    { text: "Biz bu yolda yalnızız.", expected: true, desc: "yalnızız exception" },
    { text: "Burası sizin deniziniz.", expected: true, desc: "deniziniz exception" },
    { text: "Evimiz oldukça temiziniz.", expected: true, desc: "temiziniz exception" },
    { text: "Sizin kılavuzunuz burada.", expected: true, desc: "kılavuzunuz exception" },
    { text: "Sizin sorularınızı aldık.", expected: true, desc: "sorularınızı valid usecase" },
    
    // CTA blocking options test
    { text: "Size uygun bir randevu planlayalım.", expected: false, options: { ctaOfferedRecently: true }, desc: "CTA randevu planlayalım blocked under ctaOfferedRecently" },
    { text: "Sağlığınız için size uygun bir zaman paylaşır mısınız?", expected: false, options: { angryPatientMode: true }, desc: "CTA uygun zaman blocked under angryPatientMode" },
    { text: "Görüşme ayarlayalım.", expected: false, options: { ctaOfferedRecently: true }, desc: "CTA görüşme blocked under ctaOfferedRecently" }
  ];

  let failed = 0;
  for (const tc of testCases) {
    const res = TurkishReplyQualityGate.validate(tc.text, tc.options);
    const passed = res.valid === tc.expected;
    console.log(`- [${passed ? 'PASS' : 'FAIL'}] "${tc.text}" - ${tc.desc} (result: ${res.valid}, expected: ${tc.expected})`);
    if (!passed) {
      failed++;
    }
  }

  if (failed > 0) {
    throw new Error(`Unit tests failed: ${failed} failures`);
  }
  console.log("✔ ALL UNIT TESTS PASSED SUCCESSFULLY!\n");
}

async function runRegressionSimulation() {
  console.log("=== RUNNING REGRESSION SIMULATION (HOSPITAL OWNER DIALOGUE) ===");

  // Mock isolated TenantBrain representation
  const mockBrain = {
    context: {
      tenantId: 'caab9ea1-9591-45e4-bbc5-9c9b498982c8', // Baskent
      channel: 'whatsapp',
      config: { industry: 'healthcare' },
      settings: {
        aiModel: 'gemini-2.5-flash',
        maxMessages: 20,
        maxResponseTokens: 2000,
        workingHours: { enabled: false }
      }
    },
    prompts: {
      systemPrompt: null // will fallback to the default prompts.ts whatsappPrompt we updated
    }
  } as unknown as TenantBrain;

  // Exact dialogue scenario step-by-step
  const history: any[] = [];
  
  // Step 1: Rhinoplasty interest + pricing query
  console.log("\n[Step 1] Patient asks: 'Merhaba, ben Mustafa. Burnum için ameliyat olmak istiyorum, fiyatı nedir?'");
  history.push({ role: 'user', content: 'Merhaba, ben Mustafa. Burnum için ameliyat olmak istiyorum, fiyatı nedir?' });
  
  let systemPrompt = PromptBuilder.buildSystemPrompt(mockBrain, 'discovery', false, {
    history,
    currentMessageText: 'Merhaba, ben Mustafa. Burnum için ameliyat olmak istiyorum, fiyatı nedir?',
    languageContext: { reply_language: 'Turkish', detected_patient_language: 'Turkish' }
  });

  let response = await callGeminiDirect(systemPrompt, history);
  console.log(`Bot Response: "${response}"`);
  
  // Verify Step 1 properties
  verifyResponseQuality(response, {
    shouldNotContain: ['randevu', 'görüşme', 'arayalım', 'arama', 'telefon', 'prompt', 'talimat', 'kural', 'yasak'],
    shouldContain: ['ücret', 'değerlendirme'],
    priceShort: true
  });
  
  history.push({ role: 'assistant', content: response });

  // Step 2: Palate surgery + doctor name question
  console.log("\n[Step 2] Patient asks: 'Çocuğumun yarık damak ameliyatı için hangi hekiminiz var?'");
  history.push({ role: 'user', content: 'Çocuğumun yarık damak ameliyatı için hangi hekiminiz var?' });

  systemPrompt = PromptBuilder.buildSystemPrompt(mockBrain, 'discovery', false, {
    history,
    currentMessageText: 'Çocuğumun yarık damak ameliyatı için hangi hekiminiz var?',
    languageContext: { reply_language: 'Turkish', detected_patient_language: 'Turkish' }
  });

  response = await callGeminiDirect(systemPrompt, history);
  console.log(`Bot Response: "${response}"`);
  
  // Verify Step 2 properties
  verifyResponseQuality(response, {
    shouldNotContain: ['mehmet haberal', 'haberal', 'doktorumuz', 'ismini', 'prompt', 'talimat', 'kural', 'yasak'],
    shouldContain: ['hekim', 'çalışma takvimi', 'deneyimli', 'kadro', 'güncel hekim çalışma takvimini ve bilgisini yanlış paylaşmak istemem'],
    hasDoctorPlaceholder: true
  });
  
  history.push({ role: 'assistant', content: response });

  // Step 3: Obesity query (changed topic!)
  console.log("\n[Step 3] Patient asks: 'Peki obezite tedavisi ne kadar sürer?'");
  history.push({ role: 'user', content: 'Peki obezite tedavisi ne kadar sürer?' });

  systemPrompt = PromptBuilder.buildSystemPrompt(mockBrain, 'discovery', false, {
    history,
    currentMessageText: 'Peki obezite tedavisi ne kadar sürer?',
    languageContext: { reply_language: 'Turkish', detected_patient_language: 'Turkish' }
  });

  response = await callGeminiDirect(systemPrompt, history);
  console.log(`Bot Response: "${response}"`);
  
  // Verify Step 3 properties (should focus on obesity, not carry over rhinoplasty or cleft palate)
  verifyResponseQuality(response, {
    shouldNotContain: ['burun', 'damak', 'yarık', 'cleft', 'nose', 'rhinoplasty', 'prompt', 'talimat', 'kural', 'yasak'],
    shouldContain: ['obezite', 'tedavi'],
  });

  history.push({ role: 'assistant', content: response });

  // Step 4: Sitem/Anger message
  console.log("\n[Step 4] Patient gets angry: 'Hangi doktor yapacak diyorum, neden söylemiyorsunuz?'");
  history.push({ role: 'user', content: 'Hangi doktor yapacak diyorum, neden söylemiyorsunuz?' });

  systemPrompt = PromptBuilder.buildSystemPrompt(mockBrain, 'discovery', false, {
    history,
    currentMessageText: 'Hangi doktor yapacak diyorum, neden söylemiyorsunuz?',
    languageContext: { reply_language: 'Turkish', detected_patient_language: 'Turkish' }
  });

  response = await callGeminiDirect(systemPrompt, history);
  console.log(`Bot Response: "${response}"`);
  
  // Verify Step 4 properties (Angry mode active! Should apologize, not suggest appointment/call)
  verifyResponseQuality(response, {
    shouldNotContain: ['randevu', 'görüşme', 'arayalım', 'arama', 'telefon', 'paylaşır mısınız', 'uygun zaman', 'tarih', 'prompt', 'talimat', 'kural', 'yasak'],
    shouldContain: ['hekim', 'uzman'],
    isApologetic: true
  });

  history.push({ role: 'assistant', content: response });

  // Step 5: Identity check
  console.log("\n[Step 5] Patient asks: 'Sen kimsin?'");
  history.push({ role: 'user', content: 'Sen kimsin?' });

  systemPrompt = PromptBuilder.buildSystemPrompt(mockBrain, 'discovery', false, {
    history,
    currentMessageText: 'Sen kimsin?',
    languageContext: { reply_language: 'Turkish', detected_patient_language: 'Turkish' }
  });

  response = await callGeminiDirect(systemPrompt, history);
  console.log(`Bot Response: "${response}"`);
  
  // Verify Step 5 properties (Identity confirmation)
  verifyResponseQuality(response, {
    shouldContain: ['başkent asistanıyım'],
    shouldNotContain: ['prompt', 'talimat', 'kural', 'yasak']
  });

  console.log("✔ REGRESSION SIMULATION COMPLETED SUCCESSFULLY!");
}

interface VerificationOptions {
  shouldNotContain?: string[];
  shouldContain?: string[];
  priceShort?: boolean;
  hasDoctorPlaceholder?: boolean;
  isApologetic?: boolean;
}

function verifyResponseQuality(text: string, opts: VerificationOptions) {
  const normalized = text.toLowerCase();
  
  // Suffix checks on all responses
  const qgRes = TurkishReplyQualityGate.validate(text);
  if (!qgRes.valid) {
    throw new Error(`Quality Gate failed for response: "${text}". Reason: ${qgRes.reason}`);
  }

  // Not contain checks
  if (opts.shouldNotContain) {
    for (const phrase of opts.shouldNotContain) {
      if (normalized.includes(phrase)) {
        throw new Error(`Response contains forbidden phrase "${phrase}": "${text}"`);
      }
    }
  }

  // Contain checks
  if (opts.shouldContain) {
    for (const phrase of opts.shouldContain) {
      if (!normalized.includes(phrase)) {
        throw new Error(`Response missing expected phrase "${phrase}": "${text}"`);
      }
    }
  }

  // Price short check
  if (opts.priceShort) {
    if (text.length > 450) {
      throw new Error(`Price response is too long: "${text}"`);
    }
  }

  // Doctor placeholder check
  if (opts.hasDoctorPlaceholder) {
    if (!normalized.includes("bilgisini yanlış paylaşmak istemem") && !normalized.includes("çalışma takvimini")) {
      throw new Error(`Response lacks standard doctor fallback placeholder: "${text}"`);
    }
  }

  // Apology check
  if (opts.isApologetic) {
    if (!normalized.includes("özür") && !normalized.includes("kusura")) {
      throw new Error(`Angry patient response did not apologize: "${text}"`);
    }
  }
}

async function run() {
  try {
    await runUnitTests();
    await runRegressionSimulation();
    console.log("\n=== ALL HOTFIX VERIFICATION TESTS PASSED SUCCESSFULLY! ===");
  } catch (e: any) {
    console.error("\n❌ VERIFICATION TEST FAILED:");
    console.error(e.message);
    process.exit(1);
  }
}

run();
