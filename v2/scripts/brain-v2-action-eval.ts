import dotenv from "dotenv";
import fs from "fs";

type Role = "user" | "assistant";

interface ChatMessage {
  role: Role;
  content: string;
}

interface AssistantEvaluation {
  stepIndex: number;
  status?: string;
  score?: number;
  summary?: string;
  missingAnswers?: string[];
  forbiddenHits?: string[];
  qualityWarnings?: string[];
}

interface Step {
  text: string;
  burst?: boolean;
}

interface Scenario {
  id: string;
  title: string;
  steps: Step[];
  sandboxForm?: {
    formName?: string;
    rawText: string;
  };
  checks: Array<(messages: ChatMessage[]) => string | null>;
}

dotenv.config({ path: "../.env", quiet: true });
dotenv.config({ path: ".env.local", quiet: true });

const TENANT_ID = process.env.BRAIN_EVAL_TENANT_ID || "caab9ea1-9591-45e4-bbc5-9c9b498982c8";
const BOT_GROUP_ID = process.env.BRAIN_EVAL_BOT_GROUP_ID || "f4d5ef12-72e0-4f2a-af11-7792e210fc93";
const OUT_PATH = process.env.BRAIN_EVAL_OUT || "/tmp/brain-v2-action-eval.json";

process.env.TEST_TENANT_ID = process.env.TEST_TENANT_ID || TENANT_ID;
process.env.TEST_USER_ID = process.env.TEST_USER_ID || "codex-sandbox";
process.env.TEST_USER_ROLE = process.env.TEST_USER_ROLE || "platform_admin";

let testBotPromptAction: null | ((
  botGroupId: string,
  messages: { role: "user" | "assistant"; content: string }[],
  channelId?: string,
  options?: { sandboxForm?: { formName?: string; rawText: string } | null }
) => Promise<{ success: boolean; reply: string; metadata?: any }>) = null;

async function getTestBotPromptAction() {
  if (!testBotPromptAction) {
    const mod = await import("../src/app/actions/bot");
    testBotPromptAction = mod.testBotPrompt;
  }
  return testBotPromptAction;
}

function normalize(text: string): string {
  return (text || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\u0307/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function assistantMessages(messages: ChatMessage[]): string[] {
  return messages.filter((message) => message.role === "assistant").map((message) => message.content);
}

function lastAssistant(messages: ChatMessage[]): string {
  return assistantMessages(messages).at(-1) || "";
}

function containsAny(text: string, needles: string[]): boolean {
  const clean = normalize(text);
  return needles.some((needle) => clean.includes(normalize(needle)));
}

function noGenericEscape(messages: ChatMessage[]): string | null {
  const bad = assistantMessages(messages).find((text) =>
    /Size sağlık talebinizle ilgili yardımcı olayım\.\s*Hangi konuda bilgi almak istiyorsunuz\?/i.test(text) ||
    /^Hangi konuda bilgi almak istiyorsunuz\??$/i.test(text.trim())
  );
  return bad ? `Generic kacis cevabi var: ${bad}` : null;
}

function noHonorific(messages: ChatMessage[]): string | null {
  const bad = assistantMessages(messages).find((text) => /\b(?:Bey|Hanım|Hanim|Sayın|Sayin|Bay|Bayan)\b/.test(text));
  return bad ? `Cinsiyetli/resmi hitap var: ${bad}` : null;
}

function noRepeatedIdentity(messages: ChatMessage[]): string | null {
  const repeated = assistantMessages(messages).slice(1).find((text) =>
    /Başkent Üniversitesi Konya Hastanesi[’']nden ben Rüya|Başkent Üniversitesi Konya Hastanesi[’']nden Rüya ben|Rüya ben/i.test(text)
  );
  return repeated ? `Devam eden konusmada kimlik tekrari var: ${repeated}` : null;
}

function noPromptLeak(messages: ChatMessage[]): string | null {
  const bad = assistantMessages(messages).find((text) =>
    /Hasta .* sorarsa|doğrulanmış listedeki|SYSTEM PROMPT|VERIFIED BİLGİ|BRAIN V2 TEST REHBERI/i.test(text)
  );
  return bad ? `Prompt/bilgi arsivi sizintisi var: ${bad}` : null;
}

function noMechanicalLoop(messages: ChatMessage[]): string | null {
  const starts = assistantMessages(messages)
    .flatMap((text) => text.split(/\n+/))
    .filter((line) => /^\s*(anlıyorum|anladım)\b/i.test(line.trim()));
  return starts.length > 1 ? `Mekanik Anlıyorum/Anladım tekrarı var: ${starts.join(" | ")}` : null;
}

function noEarlyVisitPressure(messages: ChatMessage[]): string | null {
  const bad = assistantMessages(messages).find((text) => {
    const clean = normalize(text.replace(/\*/g, '').replace(/\s+/g, ' '));
    return /ilerleyen\s+d[öo]nemde[\s\S]{0,160}(?:t[üu]rkiye|konya)[\s\S]{0,160}gelme\s+ihtimaliniz\s+olur\s+mu/.test(clean) ||
      /t[üu]rkiye['’]ye[\s\S]{0,80}konya['’]ya\s+gelme\s+ihtimaliniz\s+olur\s+mu/.test(clean);
  });
  return bad ? `Gelme niyeti erken ve kalıp şekilde sorulmuş: ${bad}` : null;
}

function noKnownBadTurkish(messages: ChatMessage[]): string | null {
  const bad = assistantMessages(messages).find((text) =>
    /(?:^|[.!?]\s+)size\s+en\s+uygun/.test(text) ||
    /mümkün\s+değildir\s+olmuyor|kişiniz|süreciniz\s+kapsamı|uzmanızı|tetkikleriniz\s+yapılması/i.test(text)
  );
  return bad ? `Bozuk Türkçe kalıbı var: ${bad}` : null;
}

function noBotIdentityDisclosure(messages: ChatMessage[]): string | null {
  const bad = assistantMessages(messages).find((text) =>
    /\b(?:yapay zekayım|botum|ben bot|ai model|dil modeli)\b/i.test(text)
  );
  return bad ? `Bot kimliği açık edilmiş: ${bad}` : null;
}

function expectLastContains(label: string, needles: string[]) {
  return (messages: ChatMessage[]) => {
    const last = lastAssistant(messages);
    return containsAny(last, needles) ? null : `${label} bekleniyordu; son cevap: ${last}`;
  };
}

function expectLastContainsAll(label: string, groups: string[][]) {
  return (messages: ChatMessage[]) => {
    const last = lastAssistant(messages);
    const missingIndex = groups.findIndex(group => !group.some(needle => containsAny(last, [needle])));
    return missingIndex === -1 ? null : `${label} eksik; son cevap: ${last}`;
  };
}

function expectAnyContains(label: string, needles: string[]) {
  return (messages: ChatMessage[]) => {
    const hit = assistantMessages(messages).some((text) => containsAny(text, needles));
    return hit ? null : `${label} hicbir cevapta yok.`;
  };
}

const scenarios: Scenario[] = [
  {
    id: "ilk-sikayet-bilgi-once",
    title: "İlk şikayette bilgi önce, erken gelme baskısı yok",
    steps: [
      { text: "merhaba" },
      { text: "bel fıtığım var, bilgi almak istiyorum" },
    ],
    checks: [
      noHonorific,
      noRepeatedIdentity,
      noGenericEscape,
      noPromptLeak,
      noMechanicalLoop,
      noKnownBadTurkish,
      noEarlyVisitPressure,
      expectLastContains("Bel fitigi bilgi cevabi", ["bel fıtığı", "muayene", "tetkik", "değerlendirme"]),
    ],
  },
  {
    id: "bel-fitigi-doktor-surec",
    title: "Bel fitigi: doktor + surec",
    steps: [
      { text: "merhaba" },
      { text: "bel fıtığım var" },
      { text: "olur" },
      { text: "mehmet" },
      { text: "hangi doktorlar var bel fıtığında" },
      { text: "peki süreç nasıl oluyor" },
    ],
    checks: [
      noHonorific,
      noRepeatedIdentity,
      noGenericEscape,
      noPromptLeak,
      noMechanicalLoop,
      noKnownBadTurkish,
      expectAnyContains("Bel fitigi doktor adi", ["Mustafa Kemal İLİK", "Beyin ve Sinir Cerrahisi"]),
      expectLastContains("Surec cevabi", ["muayene", "değerlendirme"]),
    ],
  },
  {
    id: "checkup-burst-fiyat-doktor-konaklama",
    title: "Check-up burst: fiyat + dermatoloji doktoru + konaklama",
    steps: [
      { text: "merhaba" },
      { text: "erkek check up düşünüyorum" },
      { text: "paket ücreti ne kadar peki, 10 ağustosta geleceğim konyaya", burst: true },
      { text: "birde dermatoloji doktorunuz kim", burst: true },
      { text: "birde kalacak yerim yok", burst: true },
    ],
    checks: [
      noGenericEscape,
      noPromptLeak,
      noMechanicalLoop,
      noKnownBadTurkish,
      expectLastContains("Fiyat politikasi", ["buradan net fiyat paylaşamıyorum"]),
      expectLastContains("Konaklama yaniti", ["konaklama", "otel", "anlaşmalı"]),
      expectLastContains("Dermatoloji doktor bilgisi", ["Dermatoloji", "Dr."]),
    ],
  },
  {
    id: "dermatoloji-guven-krizi",
    title: "Dermatoloji doktor ismi israri + guven krizi",
    steps: [
      { text: "Merhaba" },
      { text: "Randevu oluşturacam" },
      { text: "Dermatolojibölümünden" },
      { text: "Aysu" },
      { text: "Kazakistan" },
      { text: "Doktorların ismini öğrenebilir miyim" },
      { text: "Ben o şekilde güvenemem", burst: true },
      { text: "İsim söyle bana araştıracam", burst: true },
    ],
    checks: [
      noHonorific,
      noGenericEscape,
      noPromptLeak,
      noMechanicalLoop,
      noKnownBadTurkish,
      expectLastContains("Israrli doktor adi talebi", ["Dermatoloji", "Dr."]),
      (messages) => /yanlış vermek istemem/i.test(lastAssistant(messages))
        ? `Son cevap halen doktor ismini yuvarliyor: ${lastAssistant(messages)}`
        : null,
    ],
  },
  {
    id: "form-fertilite-prompt-leak",
    title: "Form lead: tekrar anne olmak istiyorum",
    sandboxForm: {
      formName: "Uluslararası Kadın Doğum Formu",
      rawText: [
        "WhatsApp number: +998991244018",
        "Full name: Medine",
        "Phone number: +998991244018",
        "Hangi ülkede yaşıyorsunuz?: Özbeksitan",
        "Türkiye'ye (Konya'ya) tedavi için gelme planınız nedir?: Malesef Yurdışına çıkamam ve Konya'ya gelemem.",
        "Tedavi planlamanız ve ön görüşme için sizi ne zaman arayalım?: Öğleden sonra (12:00 - 18:00)",
        "Şikayetiniz Nedir?: 39 yaşindayim ikki çocuğum var tekrar anne olmak istiyorum",
      ].join("\n"),
    },
    steps: [
      { text: "Merhaba" },
    ],
    checks: [
      noPromptLeak,
      noGenericEscape,
      noMechanicalLoop,
      noKnownBadTurkish,
      expectLastContains("Dogurganlik/kadin dogum yonlendirmesi", ["Kadın Hastalıkları", "Kadın Doğum", "gebelik", "anne olmak"]),
      expectLastContains("Gelememe bilgisi", ["gelemeyeceğinizi", "yurt dışına çıkamadığınızı", "Konya'ya gelemeyeceğinizi", "Konya’ya gelemeyeceğinizi"]),
      (messages) => /^[a-zçğıöşü]/.test(lastAssistant(messages).trim())
        ? `Cevap küçük harfle başlıyor: ${lastAssistant(messages)}`
        : null,
    ],
  },
  {
    id: "form-yakini-baba-ulke-ayrimi",
    title: "Form lead: baba hasta, başvuran Almanya, hasta Türkiye ayrımı",
    sandboxForm: {
      formName: "Gurbetçiler Form Randevu",
      rawText: [
        "Full name: Aysu Maysu",
        "Phone number: +905535874260",
        "Hangi ülkede yaşıyorsunuz?: Babam Türkiye'de ben Almanya'dayım",
        "Yaşınız?: 76",
        "Şikayetiniz Nedir?: Bel ve boyun fıtığı nedeniyle 3 yıldır yürüyemiyor babam. Ameliyat riskli, sinirlerinin zedelenebileceğini söylediler.",
        "Şikayetiniz Ne Zaman Başladı?: 3 yıl önce",
        "Size ne zaman randevu oluşturmamızı istersiniz?: Önce bilgi almak istiyorum, daha sonra gelebiliriz",
        "Tedavi planlamanız ve ön görüşme için sizi ne zaman arayalım?: Öğleden sonra (12:00 - 18:00)",
        "Önerilen Bölüm: Ortopedi",
      ].join("\n"),
    },
    steps: [
      { text: "Merhaba" },
      { text: "Önce bilgi almak istiyorum daha sonra gelebilirim", burst: true },
      { text: "Konaklama ve doktorla görüşmek benim için önemli", burst: true },
    ],
    checks: [
      noPromptLeak,
      noGenericEscape,
      noMechanicalLoop,
      noKnownBadTurkish,
      expectAnyContains("Baba hasta ayrımı", ["babanız", "babanızın"]),
      expectAnyContains("Başvuran ülke ayrımı", ["Almanya"]),
      expectAnyContains("Hasta ülke ayrımı", ["Türkiye"]),
      expectLastContains("Konaklama cevabı", ["konaklama", "otel", "anlaşmalı"]),
      (messages) => /gelme ihtimaliniz olur mu/i.test(lastAssistant(messages))
        ? `Gelme niyeti zaten varken tekrar sorulmuş: ${lastAssistant(messages)}`
        : null,
    ],
  },
  {
    id: "zayif-turkce-fiyat-ulke",
    title: "Zayif Turkce: hastalik + fiyat + ulke",
    steps: [
      { text: "Psoryaziçeskiy artrit" },
      { text: "Fiyatları ne kadar" },
      { text: "Haman" },
      { text: "O'zbekiston" },
    ],
    checks: [
      noGenericEscape,
      noPromptLeak,
      noMechanicalLoop,
      noKnownBadTurkish,
      expectAnyContains("Fiyat politikasi", ["buradan net fiyat paylaşamıyorum"]),
      expectAnyContains("Ozbekistan baglami", ["Özbekistan", "O'zbekiston", "ülke"]),
      expectLastContains("Hastalik adi teyidi korunmali", ["psoriatik", "artrit"]),
      (messages) => /\bHaman\b/i.test(lastAssistant(messages))
        ? `Haman isim gibi kullanılmamalı: ${lastAssistant(messages)}`
        : null,
      (messages) => /\bhamam\s+hizmet/i.test(lastAssistant(messages))
        ? `Haman/Hemen ifadesi hamam hizmeti gibi yorumlanmış: ${lastAssistant(messages)}`
        : null,
    ],
  },
  {
    id: "adres-tesekkur-talebi",
    title: "Tesekkur iceren adres talebi kapanis olmamali",
    steps: [
      { text: "Merhaba dizim için bilgi almak istiyorum" },
      { text: "Almanyada kliniğiniz var mı?" },
      { text: "Adres gönderi bir zahmet.. Teşekkürler.." },
    ],
    checks: [
      noGenericEscape,
      noPromptLeak,
      noMechanicalLoop,
      noKnownBadTurkish,
      expectLastContains("Adres talebi yaniti", ["Hocacihan", "Saray Caddesi", "Selçuklu", "Konya"]),
      (messages) => /Rica ederiz|iyi günler dileriz/i.test(lastAssistant(messages))
        ? `Tesekkur kapanisi yapilmis: ${lastAssistant(messages)}`
        : null,
    ],
  },
  {
    id: "tekrarli-fiyat-guven-telefon-secenegi",
    title: "Tekrarlı fiyat sorusunda kalıp tekrarı yerine güven onarımı ve görüşme seçeneği",
    steps: [
      { text: "Merhaba" },
      { text: "check up fiyatı ne kadar" },
      { text: "ama bana net fiyat lazım, yoksa nasıl karar vereyim" },
      { text: "siz bana yardımcı olamayacaksınız galiba" },
    ],
    checks: [
      noHonorific,
      noRepeatedIdentity,
      noGenericEscape,
      noPromptLeak,
      noMechanicalLoop,
      noKnownBadTurkish,
      expectAnyContains("İlk fiyat güvenli cümle", ["buradan net fiyat paylaşamıyorum"]),
      expectLastContainsAll("Güven onarımı ve telefon seçeneği", [
        ["haklısınız", "anlıyorum", "yardımcı"],
        ["telefon", "görüşme", "arayabilir", "hasta danışmanı"],
      ]),
      (messages) => /hangi hizmet veya bölüm/i.test(lastAssistant(messages))
        ? `Hizmet zaten belli olmasına rağmen tekrar soruldu: ${lastAssistant(messages)}`
        : null,
      (messages) => {
        const pricePhraseCount = assistantMessages(messages)
          .filter(text => containsAny(text, ["Fiyat bilgisi, hastanedeki değerlendirme"]))
          .length;
        return pricePhraseCount > 2 ? `Fiyat güvenli cümlesi mekanik şekilde tekrar etmiş: ${pricePhraseCount}` : null;
      },
    ],
  },
  {
    id: "bot-ithami-guven-kurtarma",
    title: "Bot ithamı ve güven kaybı doğal toparlanmalı",
    steps: [
      { text: "Merhaba" },
      { text: "Dermatoloji doktorunuzun adı ne?" },
      { text: "Niye söylemiyorsun sen bot musun?", burst: true },
      { text: "Sana güvenmedim", burst: true },
    ],
    checks: [
      noHonorific,
      noGenericEscape,
      noPromptLeak,
      noBotIdentityDisclosure,
      noMechanicalLoop,
      noKnownBadTurkish,
      expectLastContainsAll("Güven toparlama + doktor", [
        ["haklı", "net olmadı", "doğrudan paylaşayım"],
        ["Dermatoloji"],
        ["Dr.", "Doç.", "Prof.", "Uzm."],
      ]),
    ],
  },
  {
    id: "medya-rapor-guvenli-yanit",
    title: "Rapor/görsel geldiğinde sessiz kalmadan güvenli yanıt",
    steps: [
      { text: "Dizim ağrıyor, protez dediler" },
      { text: "MR görüntüsünü ve raporumu gönderiyorum, yorumlar mısınız?" },
    ],
    checks: [
      noGenericEscape,
      noPromptLeak,
      noMechanicalLoop,
      noKnownBadTurkish,
      expectLastContains("Medya/belge güvenli cevabı", ["ulaştı", "tıbbi yorum", "ne sormak"]),
      (messages) => /doktorumuz inceleyecek|ekibimiz değerlendirecek|rapora göre teşhis|teşhis koyabiliriz|teşhis ver/i.test(lastAssistant(messages))
        ? `Medya için inceleme/tanı vaadi var: ${lastAssistant(messages)}`
        : null,
    ],
  },
];

async function ask(messages: ChatMessage[], scenario?: Scenario): Promise<{ reply: string; metadata?: any }> {
  const testBotPrompt = await getTestBotPromptAction();
  const result = await testBotPrompt(
    BOT_GROUP_ID,
    messages,
    undefined,
    { sandboxForm: scenario?.sandboxForm || null }
  );
  if (!result.success) {
    throw new Error(result.reply || "Sandbox test failed");
  }
  return { reply: result.reply, metadata: result.metadata };
}

async function runScenario(scenario: Scenario) {
  const messages: ChatMessage[] = [];
  const evaluations: AssistantEvaluation[] = [];
  for (let i = 0; i < scenario.steps.length; i += 1) {
    const step = scenario.steps[i];
    messages.push({ role: "user", content: step.text });
    const next = scenario.steps[i + 1];
    if (step.burst && next?.burst) {
      continue;
    }
    const { reply, metadata } = await ask(messages, scenario);
    if (metadata?.brainV2ResponseEvaluation) {
      const evalResult = metadata.brainV2ResponseEvaluation;
      evaluations.push({
        stepIndex: i,
        status: evalResult.status,
        score: evalResult.score,
        summary: evalResult.summary,
        missingAnswers: evalResult.missingAnswers,
        forbiddenHits: evalResult.forbiddenHits,
        qualityWarnings: evalResult.qualityWarnings,
      });
    }
    messages.push({ role: "assistant", content: reply });
  }

  const evaluatorFailures = evaluations
    .filter(item => item.status === 'fail')
    .map(item => `Brain evaluator FAIL step ${item.stepIndex}: ${item.summary || ''} missing=${JSON.stringify(item.missingAnswers || [])} forbidden=${JSON.stringify(item.forbiddenHits || [])}`);
  const failures = [
    ...scenario.checks.map((check) => check(messages)).filter(Boolean) as string[],
    ...evaluatorFailures,
  ];
  return {
    id: scenario.id,
    title: scenario.title,
    passed: failures.length === 0,
    failures,
    transcript: messages,
    evaluations,
  };
}

async function main() {
  const results = [];
  for (const scenario of scenarios) {
    console.log(`\n▶ ${scenario.id} — ${scenario.title}`);
    const result = await runScenario(scenario);
    results.push(result);
    console.log(result.passed ? "  ✅ geçti" : `  ❌ ${result.failures.length} hata`);
    for (const failure of result.failures) {
      console.log(`   - ${failure}`);
    }
    console.log(`  Son cevap: ${lastAssistant(result.transcript)}`);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    tenantId: TENANT_ID,
    botGroupId: BOT_GROUP_ID,
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(`\nRapor: ${OUT_PATH}`);
  console.log(`Özet: ${summary.passed}/${summary.total} geçti`);
  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
