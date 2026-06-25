import dotenv from "dotenv";
import fs from "fs";

type Role = "user" | "assistant";

interface ChatMessage {
  role: Role;
  content: string;
}

interface Step {
  text: string;
  burst?: boolean;
}

interface Scenario {
  id: string;
  title: string;
  steps: Step[];
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
  channelId?: string
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

function expectLastContains(label: string, needles: string[]) {
  return (messages: ChatMessage[]) => {
    const last = lastAssistant(messages);
    return containsAny(last, needles) ? null : `${label} bekleniyordu; son cevap: ${last}`;
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
      expectLastContains("Israrli doktor adi talebi", ["Dermatoloji", "Dr."]),
      (messages) => /yanlış vermek istemem/i.test(lastAssistant(messages))
        ? `Son cevap halen doktor ismini yuvarliyor: ${lastAssistant(messages)}`
        : null,
    ],
  },
  {
    id: "form-fertilite-prompt-leak",
    title: "Form lead: tekrar anne olmak istiyorum",
    steps: [
      {
        text: [
          "Merhaba! Formunuzu doldurdum ve işletmeniz hakkında daha fazla bilgi edinmek istiyorum.",
          "WhatsApp number: +998991244018",
          "Full name: Medine",
          "Phone number: +998991244018",
          "Hangi ülkede yaşıyorsunuz?: Özbeksitan",
          "Türkiye'ye (Konya'ya) tedavi için gelme planınız nedir?: Malesef Yurdışına çıkamam ve Konya'ya gelemem.",
          "Tedavi planlamanız ve ön görüşme için sizi ne zaman arayalım?: Öğleden sonra (12:00 - 18:00)",
          "Şikayetiniz Nedir?: 39 yaşindayim ikki çocuğum var tekrar anne olmak istiyorum",
        ].join("\n"),
      },
    ],
    checks: [
      noPromptLeak,
      noGenericEscape,
      expectLastContains("Dogurganlik/kadin dogum yonlendirmesi", ["Kadın Hastalıkları", "gebelik", "anne olmak"]),
      expectLastContains("Gelememe bilgisi", ["gelemeyeceğinizi", "yurt dışına çıkamadığınızı", "Konya'ya gelemeyeceğinizi", "Konya’ya gelemeyeceğinizi"]),
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
      expectAnyContains("Fiyat politikasi", ["buradan net fiyat paylaşamıyorum"]),
      expectAnyContains("Ozbekistan baglami", ["Özbekistan", "O'zbekiston", "ülke"]),
      (messages) => /\bHaman\b/i.test(lastAssistant(messages))
        ? `Haman isim gibi kullanılmamalı: ${lastAssistant(messages)}`
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
      expectLastContains("Adres talebi yaniti", ["Hocacihan", "Saray Caddesi", "Selçuklu", "Konya"]),
      (messages) => /Rica ederiz|iyi günler dileriz/i.test(lastAssistant(messages))
        ? `Tesekkur kapanisi yapilmis: ${lastAssistant(messages)}`
        : null,
    ],
  },
];

async function ask(messages: ChatMessage[]): Promise<string> {
  const testBotPrompt = await getTestBotPromptAction();
  const result = await testBotPrompt(BOT_GROUP_ID, messages);
  if (!result.success) {
    throw new Error(result.reply || "Sandbox test failed");
  }
  return result.reply;
}

async function runScenario(scenario: Scenario) {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < scenario.steps.length; i += 1) {
    const step = scenario.steps[i];
    messages.push({ role: "user", content: step.text });
    const next = scenario.steps[i + 1];
    if (step.burst && next?.burst) {
      continue;
    }
    const reply = await ask(messages);
    messages.push({ role: "assistant", content: reply });
  }

  const failures = scenario.checks.map((check) => check(messages)).filter(Boolean) as string[];
  return {
    id: scenario.id,
    title: scenario.title,
    passed: failures.length === 0,
    failures,
    transcript: messages,
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
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
