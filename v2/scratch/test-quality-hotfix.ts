import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { TurkishReplyQualityGate } from '../src/lib/services/ai/turkish-quality-gate';
import { PromptBuilder } from '../src/lib/services/ai/prompt-builder';
import { TenantBrain } from '../src/lib/brain/tenant-brain';
import { detectAbuse } from '../src/lib/services/ai/abuse-detector';
import { whatsappPrompt, turkcePrompt, foreignPrompt } from '../src/lib/domain/conversation/prompts';

// Define the production v56 prompt locally for testing the specific Başkent scenario
const baskentWhatsappPromptV56 = `--- IDENTITY ---
Sen Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi adına çalışan hasta danışmanı Rüya'sın. Kendini tanıtırken veya kim olduğun sorulduğunda şu doğal kimlik çizgilerini kullan:
- "Ben Rüya, Başkent Üniversitesi Konya Hastanesi'nden yazıyorum"
- "Rüya ben, Başkent Konya'dan yazıyorum"
- "Rüya, Başkent Konya hasta danışma tarafından yazıyorum"

YASAKLI KİMLİK CEVAPLARI (KESİNLİKLE KULLANMA):
- "Ben Başkent asistanıyım" / "Başkent asistanı"
- "Süreçler hakkında yardımcı oluyorum"
- "Size nasıl yardımcı olabilirim?"
- "Ben bot değilim" / "Yapay zeka değilim" / "Sistem gereği" / "Teknik ifade kullanmamam gerekiyordu"

--- INSTRUCTIONS ---
GÖREVİN:
Gelen mesajları analiz ederek hastaya kısa, güven veren, profesyonel cevaplar vermek. Hastayı önce anla, sonra doğal akışta telefon görüşmesine veya randevuya yönlendir.
Örnekler birebir kopyalanacak hazır cevaplar değildir. Hastanın niyetini ve konuşma bağlamını anlayarak yeni, doğal, samimi ve kısa cevaplar üret.

HASTANE BİLGİLERİ:
Başkent Üniversitesi Konya Uygulama ve Araştırma Merkezi
Kurucu: Prof. Dr. Mehmet Haberal
Adres: Hocacihan Mahallesi, Saray Caddesi No:1, Selçuklu/KONYA
Telefon (Yerli hastalar için): 0332 257 06 06
WhatsApp (Uluslararası hastalar için): +90 501 015 42 42
Organ Nakli: 3422+ Böbrek, 724+ Karaciğer, 376+ Kornea, 148+ Kalp, 1372+ Kemik İliği

İSTANBUL HASTANESİ KURALI (ÇOK ÖNEMLİ!):
Başkent Üniversitesi'nin İstanbul'da da kampüsü/hastanesi VARDIR. ASLA "İstanbul'da hastanemiz yok" deme! Konya merkezini temsil ettiğini belirterek Konya'ya yönlendir.

KURUCU: PROF. DR. MEHMET HABERAL
Transplantasyon alanında dünya öncüsüdür. Böbrek ve karaciğer nakillerinde tarihi ilkleri vardır. 2024 Medawar Ödülü sahibidir. Organ nakli konusu açılırsa bu bilgileri güven ve ikna aracı olarak paylaş.

--- DAVRANIŞ VE DİYALOG ÇERÇEVESİ ---
1. Önce dinle ve pratik engelleri gider. İlk 1-2 mesajda hemen randevu/arama teklif etme.
2. Doktor adı sorulduğunda: Sistemde doğrulanmış hekim bilgisi yoksa veya emin değilsen hekim ismi uydurmayın. Bunun yerine, hekim bilgisini doğrulamak veya netleştirmek gerektiğini belirten doğal ve dinamik bir cümle kurun. Her konuşmada aynı kalıbı tekrar etmeyin. "Döneceğim" veya "kontrol edip döneyim" gibi kesin geri dönüş sözleri vermekten kaçının.
3. Karmaşık vakalar (Örn: Akromegali) sorulduğunda: Doktor ismi hemen verilmemelidir. Önce şikayetlerin/durumun Endokrinoloji ve Beyin Cerrahisi gibi bölümler tarafından ortak değerlendirilmesi gereken özel bir alan olduğunu belirt. Ameliyat gerekliliğinin tetkikler ve fiziksel muayene sonrası netleşeceğini söyle. Ardından hastanın planlarını sor (örn: "Türkiye'ye gelmeyi düşünüyor musunuz, yoksa önce genel süreç hakkında mı bilgi almak istiyorsunuz?").
4. Fiyat sorulduğunda: Net rakam verme. Ücretlerin hastanın muayene ve tedavi planı netleştikten sonra belirlendiğini, akademik hastane olarak makul seçenekler sunduğumuzu belirt.
5. Hastanın sorduğu 'Neden?', 'Nasıl?' gibi çok kısa, tek kelimelik veya bağlamsız sorulara kimliğini (Rüya / Başkent Konya) tekrarlayarak başlama. Konuşmanın ortasında ismini/kurumunu sürekli tekrar etmek robotik hissettirir. Bunun yerine, hastanın tam olarak hangi konuyu veya hangi kısmı sorduğunu anlamak için netleştirici kısa bir soru sor (örn: 'Hangi tedavi için sordunuz?', 'Pardon, hangi konuyu sormuştunuz?', 'Hangi kısım için sormuştunuz?').

ENGELLENEN BOILERPLATE/CLICHÉ KALIPLAR (ASLA KULLANMA!):
- "Sorunuzu anladım" / "Sorularınızı anladım" / "Talebinizi anladım"
- "Size nasıl yardımcı olabilirim" / "Nasıl yardımcı olabilirim?"
- "Süreçler hakkında yardımcı oluyorum" / "Süreçler hakkında bilgi veriyorum"
- "Sorunuza net döneyim"
- "Önceki cevabım fazla kalıp gibi olmuş"
- "web sitemizde", "listede görünüyor", "güncel çalışma günü değişebileceği için", "net isim paylaşmam doğru olmaz"

GİZLİLİK VE TEKNİK SAVUNMASIZLIK:
Cevaplarında kesinlikle "prompt", "talimat", "sistem kuralı", "direktif", "kriter", "phase", "kısıtlama", "yasak" gibi terimler kullanma. "Ben bot değilim/yapay zekayım" gibi savunmalara girme.

FORM LEAD / İLK KARŞILAMA:
Formdan gelen hastanın şikayetini ve randevu beklentisini bildiğini hissettir. Bilinenleri tekrar sorma. İlk karşılama daha kapsamlı olabilir, devamında kısa tut.
`;

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
      temperature: 0.1
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
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
}

async function runUnitTests() {
  console.log("=== RUNNING QUALITY GATE UNIT TESTS ===");

  const testCases = [
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
    
    { text: "Biz bu yolda yalnızız.", expected: true, desc: "yalnızız exception" },
    { text: "Burası sizin deniziniz.", expected: true, desc: "deniziniz exception" },
    { text: "Evimiz oldukça temiziniz.", expected: true, desc: "temiziniz exception" },
    { text: "Sizin kılavuzunuz burada.", expected: true, desc: "kılavuzunuz exception" },
    { text: "Sizin sorularınızı aldık.", expected: true, desc: "sorularınızı valid usecase" },
    
    { text: "Size uygun bir randevu planlayalım.", expected: false, options: { ctaOfferedRecently: true }, desc: "CTA randevu planlayalım blocked under ctaOfferedRecently" },
    { text: "Sağlığınız için size uygun bir zaman paylaşır mısınız?", expected: false, options: { angryPatientMode: true }, desc: "CTA uygun zaman blocked under angryPatientMode" },
    { text: "Görüşme ayarlayalım.", expected: false, options: { ctaOfferedRecently: true }, desc: "CTA görüşme blocked under ctaOfferedRecently" }
  ];

  let failed = 0;
  for (const tc of testCases) {
    const res = TurkishReplyQualityGate.validate(tc.text, tc.options);
    const passed = res.valid === tc.expected;
    console.log(`- [${passed ? 'PASS' : 'FAIL'}] "${tc.text}" - ${tc.desc} (result: ${res.valid}, expected: ${tc.expected})`);
    if (!passed) failed++;
  }

  console.log("\n=== RUNNING ABUSE DETECTOR UNIT TESTS ===");
  const abuseTestCases = [
    { text: "Bot gibi konuşuyorsun", expected: false, desc: "bot eleştirisi (sitem)" },
    { text: "Cevap vermiyorsunuz", expected: false, desc: "cevap vermiyorsunuz (sitem)" },
    { text: "Bu cevap olmadı", expected: false, desc: "bu cevap olmadı (sitem)" },
    { text: "Yeter artık randevu deme", expected: false, desc: "randevu baskısı eleştirisi (sitem)" },
    { text: "cevap vermiyorsunuz lan", expected: false, desc: "slang (lan) containing sitem" },
    { text: "ne biçim danışmansın sen", expected: false, desc: "complaint (ne biçim) sitem" },
    { text: "doktorlarınız da sizin gibi mi", expected: false, desc: "complaint (da sizin gibi) sitem" },
    { text: "mal mısın", expected: true, desc: "mal mısın (abuse)" },
    { text: "salak mısın", expected: true, desc: "salak mısın (abuse)" },
    { text: "siktir git burdan", expected: true, desc: "vulgar swearing (abuse)" },
    { text: "rüya tam bir aptal", expected: true, desc: "direct target insult (abuse)" }
  ];

  for (const tc of abuseTestCases) {
    const res = detectAbuse(tc.text);
    const passed = res.abuse_detected === tc.expected;
    console.log(`- [${passed ? 'PASS' : 'FAIL'}] "${tc.text}" - ${tc.desc} (abuse_detected: ${res.abuse_detected}, expected: ${tc.expected})`);
    if (!passed) failed++;
  }

  console.log("\n=== RUNNING SAAS ISOLATION CHECKS ON GLOBAL FALLBACKS ===");
  const brandKeywords = [
    'başkent', 'haberal', 'saray caddesi', '0332 257 06 06', 'saray caddesi', 'saray caddesı',
    '3422', '724', '1372', '148', '376', 'konya uygulama', 'konya araştırma'
  ];

  const fallbackFiles = [
    { name: 'whatsappPrompt', text: whatsappPrompt },
    { name: 'turkcePrompt', text: turkcePrompt },
    { name: 'foreignPrompt', text: foreignPrompt }
  ];

  for (const file of fallbackFiles) {
    let leaked = false;
    const lowerText = file.text.toLowerCase();
    for (const kw of brandKeywords) {
      if (lowerText.includes(kw)) {
        console.log(`- [FAIL] ${file.name} fallback prompt contains brand keyword "${kw}"!`);
        leaked = true;
        failed++;
      }
    }
    if (!leaked) {
      console.log(`- [PASS] ${file.name} has ZERO brand leakage.`);
    }
  }

  if (failed > 0) {
    throw new Error(`Unit tests failed: ${failed} failures`);
  }
  console.log("✔ ALL UNIT TESTS PASSED SUCCESSFULLY!\n");
}

async function generateResponseWithQualityRetry(
  mockBrain: TenantBrain,
  history: any[],
  currentMessageText: string,
  options?: any
): Promise<string> {
  const languageContext = { reply_language: 'Turkish', detected_patient_language: 'Turkish' };
  const systemPrompt = PromptBuilder.buildSystemPrompt(mockBrain, 'discovery', false, {
    history,
    currentMessageText,
    languageContext
  });

  let response = await callGeminiDirect(systemPrompt, history);
  let qgRes = TurkishReplyQualityGate.validate(response, options);

  if (!qgRes.valid) {
    console.log(`  [SIMULATED RETRY] First attempt failed quality gate: ${qgRes.reason}. Retrying with feedback...`);
    const retryHistory = [
      ...history,
      { role: 'assistant', content: response },
      {
        role: 'user',
        content: `DİKKAT: Ürettiğin Türkçe metinde ek hatası, yasaklı bot kalıbı veya gereksiz iyelik eki/çift ek tespit edildi (Hata: ${qgRes.reason}). Lütfen bu hatayı düzelterek resmi ama sade Türkçe ile kısa bir cevap üret. Tanı koyma, fiyat verme, gereksiz sahiplik ekleri kullanma.`
      }
    ];

    response = await callGeminiDirect(systemPrompt, retryHistory);
    qgRes = TurkishReplyQualityGate.validate(response, options);
    if (!qgRes.valid) {
      console.log(`  [SIMULATED RETRY FAILED] Second attempt also failed: ${qgRes.reason}`);
    } else {
      console.log(`  [SIMULATED RETRY SUCCESS] Second attempt passed quality gate!`);
    }
  }
  return response;
}

async function runRegressionSimulation() {
  console.log("=== RUNNING REGRESSION SIMULATION (RÜYA PERSONA & DOCTOR NAME GATE) ===");

  const mockBrain = {
    context: {
      tenantId: 'caab9ea1-9591-45e4-bbc5-9c9b498982c8',
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
      systemPrompt: baskentWhatsappPromptV56
    }
  } as unknown as TenantBrain;

  const history: any[] = [];
  
  // Step 1: Rhinoplasty pricing query
  console.log("\n[Step 1] Patient asks: 'Merhaba, ben Mustafa. Burnum için ameliyat olmak istiyorum, fiyatı nedir?'");
  history.push({ role: 'user', content: 'Merhaba, ben Mustafa. Burnum için ameliyat olmak istiyorum, fiyatı nedir?' });
  let response = await generateResponseWithQualityRetry(mockBrain, history, 'Merhaba, ben Mustafa. Burnum için ameliyat olmak istiyorum, fiyatı nedir?');
  console.log(`Bot Response: "${response}"`);
  verifyResponseQuality(response, {
    shouldNotContain: ['randevu', 'görüşme', 'arayalım', 'arama', 'telefon', 'prompt', 'talimat', 'kural', 'yasak'],
    isPricingQuery: true,
    priceShort: true
  });
  history.push({ role: 'assistant', content: response });

  // Step 2: Cleft Palate Doctor name query
  console.log("\n[Step 2] Patient asks: 'Çocuğumun yarık damak ameliyatı için hangi hekiminiz var?'");
  history.push({ role: 'user', content: 'Çocuğumun yarık damak ameliyatı için hangi hekiminiz var?' });
  response = await generateResponseWithQualityRetry(mockBrain, history, 'Çocuğumun yarık damak ameliyatı için hangi hekiminiz var?');
  console.log(`Bot Response: "${response}"`);
  verifyResponseQuality(response, {
    shouldNotContain: ['mehmet haberal', 'haberal', 'doktorumuz', 'ismini', 'prompt', 'talimat', 'kural', 'yasak', 'döneceğim', 'kontrol edip döneyim', 'güncel hekim bilgisini yanlış paylaşmak istemem'],
    shouldContain: ['hekim|uzman'],
    hasDoctorPlaceholder: true
  });
  history.push({ role: 'assistant', content: response });

  // Step 3: Obesity query (context reset check)
  console.log("\n[Step 3] Patient asks: 'Peki obezite tedavisi ne kadar sürer?'");
  history.push({ role: 'user', content: 'Peki obezite tedavisi ne kadar sürer?' });
  response = await generateResponseWithQualityRetry(mockBrain, history, 'Peki obezite tedavisi ne kadar sürer?');
  console.log(`Bot Response: "${response}"`);
  verifyResponseQuality(response, {
    shouldNotContain: ['burun', 'damak', 'yarık', 'cleft', 'nose', 'rhinoplasty', 'prompt', 'talimat', 'kural', 'yasak'],
    shouldContain: ['obezite', 'tedavi'],
  });
  history.push({ role: 'assistant', content: response });

  // Step 4: Akromegali complex query (multidisciplinary routing check)
  console.log("\n[Step 4] Patient asks: 'Akromegali hastasıyım bu konuda deneyiminiz var mı, doktor var mı, ameliyat yapılıyor mu?'");
  history.push({ role: 'user', content: 'Akromegali hastasıyım bu konuda deneyiminiz var mı, doktor var mı, ameliyat yapılıyor mu?' });
  response = await generateResponseWithQualityRetry(mockBrain, history, 'Akromegali hastasıyım bu konuda deneyiminiz var mı, doktor var mı, ameliyat yapılıyor mu?');
  console.log(`Bot Response: "${response}"`);
  verifyResponseQuality(response, {
    shouldNotContain: ['prompt', 'talimat', 'kural', 'yasak'],
    shouldContain: ['endokrin', 'cerrah', 'değerlendir'],
    noImmediateDoctorName: true
  });
  history.push({ role: 'assistant', content: response });

  // Step 5: Patient gets frustrated (Anger Mode)
  console.log("\n[Step 5] Patient gets angry: 'Hangi doktor yapacak diyorum, neden söylemiyorsunuz?'");
  history.push({ role: 'user', content: 'Hangi doktor yapacak diyorum, neden söylemiyorsunuz?' });
  response = await generateResponseWithQualityRetry(mockBrain, history, 'Hangi doktor yapacak diyorum, neden söylemiyorsunuz?');
  console.log(`Bot Response: "${response}"`);
  verifyResponseQuality(response, {
    shouldNotContain: ['randevu', 'görüşme', 'arayalım', 'arama', 'telefon', 'paylaşır mısınız', 'uygun zaman', 'tarih', 'prompt', 'talimat', 'kural', 'yasak'],
    isApologetic: true
  });
  history.push({ role: 'assistant', content: response });

  // Step 6: Identity query
  console.log("\n[Step 6] Patient asks: 'Sen kimsin?'");
  history.push({ role: 'user', content: 'Sen kimsin?' });
  response = await generateResponseWithQualityRetry(mockBrain, history, 'Sen kimsin?');
  console.log(`Bot Response: "${response}"`);
  verifyResponseQuality(response, {
    shouldContain: ['rüya', 'başkent', 'konya'],
    shouldNotContain: ['başkent asistanıyım', 'başkent asistanı', 'süreçler hakkında yardımcı oluyorum', 'size nasıl yardımcı olabilirim', 'prompt', 'talimat', 'kural', 'yasak']
  });
  history.push({ role: 'assistant', content: response });

  // Step 7: Name query
  console.log("\n[Step 7] Patient asks: 'İsmin ne?'");
  history.push({ role: 'user', content: 'İsmin ne?' });
  response = await generateResponseWithQualityRetry(mockBrain, history, 'İsmin ne?');
  console.log(`Bot Response: "${response}"`);
  verifyResponseQuality(response, {
    shouldContain: ['rüya'],
    shouldNotContain: ['başkent asistanı', 'robot', 'yapay zeka', 'prompt', 'talimat', 'kural', 'yasak']
  });
  history.push({ role: 'assistant', content: response });

  // Step 8: Context question check
  console.log("\n[Step 8] Patient asks: 'Neden?'");
  history.push({ role: 'user', content: 'Neden?' });
  response = await generateResponseWithQualityRetry(mockBrain, history, 'Neden?');
  console.log(`Bot Response: "${response}"`);
  verifyResponseQuality(response, {
    shouldNotContain: ['rüya', 'başkent', 'asistan', 'yapay zeka', 'robot', 'prompt', 'talimat', 'kural', 'yasak'],
    shouldContain: ['hang', 'sor']
  });
  history.push({ role: 'assistant', content: response });

  // Step 9: Bot defense check
  console.log("\n[Step 9] Patient claims: 'Sen botsun'");
  history.push({ role: 'user', content: 'Sen botsun' });
  response = await generateResponseWithQualityRetry(mockBrain, history, 'Sen botsun');
  console.log(`Bot Response: "${response}"`);
  verifyResponseQuality(response, {
    shouldNotContain: ['bot', 'yapay zeka', 'sistem', 'robot', 'asistanıyım', 'prompt', 'talimat', 'kural', 'yasak']
  });
  history.push({ role: 'assistant', content: response });

  // Step 10: Abuse check
  console.log("\n[Step 10] Patient swears: 'mal mısın ismin ne'");
  const abuseRes = detectAbuse('mal mısın ismin ne');
  if (!abuseRes.abuse_detected) {
    throw new Error("Swearing message was not detected as abuse!");
  }
  console.log(`Abuse Detection Result: abuse_detected = ${abuseRes.abuse_detected} (PASS)`);

  console.log("✔ REGRESSION SIMULATION COMPLETED SUCCESSFULLY!");
}

interface VerificationOptions {
  shouldNotContain?: string[];
  shouldContain?: string[];
  priceShort?: boolean;
  hasDoctorPlaceholder?: boolean;
  isApologetic?: boolean;
  noImmediateDoctorName?: boolean;
  isPricingQuery?: boolean;
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
      if (phrase.includes('|')) {
        const parts = phrase.split('|');
        const hasOne = parts.some(p => normalized.includes(p));
        if (!hasOne) {
          throw new Error(`Response missing one of expected phrases "${phrase}": "${text}"`);
        }
      } else {
        if (!normalized.includes(phrase)) {
          throw new Error(`Response missing expected phrase "${phrase}": "${text}"`);
        }
      }
    }
  }

  // Price short check
  if (opts.priceShort) {
    if (text.length > 500) {
      throw new Error(`Price response is too long: "${text}"`);
    }
  }

  // Doctor placeholder check
  if (opts.hasDoctorPlaceholder) {
    if (normalized.includes("bilgisini yanlış paylaşmak istemem") || normalized.includes("kontrol ederek paylaşmam daha doğru olur")) {
      throw new Error(`Response uses prohibited boilerplate doctor fallback: "${text}"`);
    }
    if (!normalized.includes("netleştir") && !normalized.includes("doğrulama") && !normalized.includes("kontrol ed") && !normalized.includes("yönlendir") && !normalized.includes("bilgi")) {
      throw new Error(`Response lacks natural doctor fallback expression: "${text}"`);
    }
  }

  // Apology check
  if (opts.isApologetic) {
    if (!normalized.includes("özür") && !normalized.includes("kusura")) {
      throw new Error(`Angry patient response did not apologize: "${text}"`);
    }
  }

  // Pricing check
  if (opts.isPricingQuery) {
    if (!normalized.includes('fiyat') && !normalized.includes('ücret') && !normalized.includes('tutar') && !normalized.includes('maliyet')) {
      throw new Error(`Pricing response lacks pricing terms (fiyat/ücret/tutar/maliyet): "${text}"`);
    }
    if (!normalized.includes('değerlendirme') && !normalized.includes('muayene') && !normalized.includes('belirlen') && !normalized.includes('plan')) {
      throw new Error(`Pricing response lacks medical evaluation reference (değerlendirme/muayene/belirlen/plan): "${text}"`);
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
