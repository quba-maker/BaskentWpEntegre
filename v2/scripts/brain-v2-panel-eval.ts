import { chromium, type Page } from "playwright";
import fs from "fs";

type ChatRole = "user" | "assistant";

interface Step {
  text: string;
  burst?: boolean;
}

interface Scenario {
  id: string;
  title: string;
  steps: Step[];
  checks: Array<(transcript: ChatMessage[]) => string | null>;
}

interface ChatMessage {
  role: ChatRole;
  text: string;
}

const BASE_URL = process.env.BRAIN_EVAL_BASE_URL || "http://localhost:3000";
const TENANT_SLUG = process.env.BRAIN_EVAL_TENANT || "baskent";
const EMAIL = process.env.BRAIN_EVAL_EMAIL || "";
const PASSWORD = process.env.BRAIN_EVAL_PASSWORD || "";
const OUT_PATH = process.env.BRAIN_EVAL_OUT || "/tmp/brain-v2-panel-eval.json";

function normalize(text: string): string {
  return (text || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\u0307/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function assistantMessages(transcript: ChatMessage[]): string[] {
  return transcript.filter(m => m.role === "assistant").map(m => m.text);
}

function lastAssistant(transcript: ChatMessage[]): string {
  return assistantMessages(transcript).at(-1) || "";
}

function noGenericEscape(transcript: ChatMessage[]): string | null {
  const bad = assistantMessages(transcript).find(text =>
    /Size sağlık talebinizle ilgili yardımcı olayım\.\s*Hangi konuda bilgi almak istiyorsunuz\?/i.test(text) ||
    /^Hangi konuda bilgi almak istiyorsunuz\??$/i.test(text.trim())
  );
  return bad ? `Generic kaçış cevabı var: ${bad}` : null;
}

function noHonorific(transcript: ChatMessage[]): string | null {
  const bad = assistantMessages(transcript).find(text => /\b(?:Bey|Hanım|Hanim|Sayın|Sayin|Bay|Bayan)\b/.test(text));
  return bad ? `İsimli/cinsiyetli hitap var: ${bad}` : null;
}

function noRepeatedIdentityAfterGreeting(transcript: ChatMessage[]): string | null {
  const assistants = assistantMessages(transcript);
  const repeated = assistants.slice(1).find(text =>
    /Başkent Üniversitesi Konya Hastanesi[’']nden ben Rüya|Başkent Üniversitesi Konya Hastanesi[’']nden Rüya ben|Rüya ben/i.test(text)
  );
  return repeated ? `Devam konuşmasında tekrar kimlik var: ${repeated}` : null;
}

function noPromptLeak(transcript: ChatMessage[]): string | null {
  const bad = assistantMessages(transcript).find(text =>
    /Hasta .* sorarsa|doğrulanmış listedeki|SYSTEM PROMPT|VERIFIED BİLGİ|BRAIN V2 TEST REHBERI/i.test(text)
  );
  return bad ? `Prompt/bilgi arşivi sızıntısı var: ${bad}` : null;
}

function containsAny(text: string, needles: string[]): boolean {
  const clean = normalize(text);
  return needles.some(n => clean.includes(normalize(n)));
}

function expectLastContains(label: string, needles: string[]): (transcript: ChatMessage[]) => string | null {
  return (transcript) => {
    const last = lastAssistant(transcript);
    return containsAny(last, needles) ? null : `${label} bekleniyordu; son cevap: ${last}`;
  };
}

function expectAnyAssistantContains(label: string, needles: string[]): (transcript: ChatMessage[]) => string | null {
  return (transcript) => {
    const hit = assistantMessages(transcript).some(text => containsAny(text, needles));
    return hit ? null : `${label} hiçbir bot cevabında yok.`;
  };
}

const scenarios: Scenario[] = [
  {
    id: "bel-fitigi-doktor-surec",
    title: "Bel fıtığı: doktor + süreç + doğal devam",
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
      noRepeatedIdentityAfterGreeting,
      noGenericEscape,
      expectAnyAssistantContains("Bel fıtığı doktor adı", ["Mustafa Kemal İLİK", "Beyin ve Sinir Cerrahisi"]),
      expectLastContains("Süreç cevabında muayene/değerlendirme", ["muayene", "değerlendirme"]),
    ],
  },
  {
    id: "checkup-fiyat-doktor-konaklama",
    title: "Check-up: fiyat + dermatoloji doktoru + konaklama burst",
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
      expectLastContains("Fiyat politikası", ["buradan net fiyat paylaşamıyorum"]),
      expectLastContains("Konaklama yanıtı", ["konaklama", "otel", "anlaşmalı"]),
      expectLastContains("Doktor adı veya doğrulanmış hekim bilgisi", ["Dermatoloji", "Dr."]),
    ],
  },
  {
    id: "doktor-ismi-guven-krizi",
    title: "Dermatoloji doktor ismi ısrarı + güven krizi",
    steps: [
      { text: "Merhaba" },
      { text: "Randevu oluşturacam" },
      { text: "Dermatolojibölümünden" },
      { text: "Aysu" },
      { text: "Kazakistan" },
      { text: "Doktorların ismini öğrenebilir miyim" },
      { text: "Ben o şekilde güvenemem" },
      { text: "İsim söyle bana araştıracam" },
    ],
    checks: [
      noHonorific,
      noGenericEscape,
      expectLastContains("Israrlı doktor adı talebinde isim paylaşımı", ["Dermatoloji", "Dr."]),
      (transcript) => /yanlış vermek istemem/i.test(lastAssistant(transcript)) ? `Son cevap hâlâ doktor ismini yuvarlıyor: ${lastAssistant(transcript)}` : null,
    ],
  },
  {
    id: "form-fertility-no-prompt-leak",
    title: "Form lead: tekrar anne olmak istiyorum, prompt leak yok",
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
          "Şikayetiniz Nedir?: 39 yaşindayim ikki çocuğum var tekrar anne olmak istiyorum"
        ].join("\n")
      },
    ],
    checks: [
      noPromptLeak,
      noGenericEscape,
      expectLastContains("Fertilite/kadın doğum yönlendirmesi", ["Kadın Hastalıkları", "Tüp Bebek", "gebelik", "anne olmak"]),
      expectLastContains("Gelememe bilgisi sahiplenilmeli", ["gelemeyeceğinizi", "yurt dışına çıkamadığınızı", "Konya’ya gelemeyeceğinizi"]),
    ],
  },
  {
    id: "zayif-turkce-ulke-fiyat",
    title: "Zayıf Türkçe: hastalık + fiyat + ülke reset yok",
    steps: [
      { text: "Psoryaziçeskiy artrit" },
      { text: "Fiyatları ne kadar" },
      { text: "Haman" },
      { text: "O'zbekiston" },
    ],
    checks: [
      noGenericEscape,
      noPromptLeak,
      expectAnyAssistantContains("Fiyat politikası", ["buradan net fiyat paylaşamıyorum"]),
      expectAnyAssistantContains("Özbekistan/ülke bağlamı", ["Özbekistan", "O'zbekiston", "ülke"]),
    ],
  },
];

async function login(page: Page) {
  if (!EMAIL || !PASSWORD) {
    throw new Error("BRAIN_EVAL_EMAIL ve BRAIN_EVAL_PASSWORD env değerleri olmadan panel testi çalıştırılamaz.");
  }
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  const emailInput = page.locator("input[type='email']").first();
  if (await emailInput.isVisible({ timeout: 8000 }).catch(() => false)) {
    await emailInput.fill(EMAIL);
    await page.locator("input[type='password']").first().fill(PASSWORD);
    await page.locator("button[type='submit']").first().click();
    await page.waitForURL(`**/${TENANT_SLUG}**`, { timeout: 30000 });
  }
}

async function openBotPanel(page: Page) {
  await page.goto(`${BASE_URL}/${TENANT_SLUG}/bot`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Bot Test Alanı", { timeout: 45000 });
}

async function clearPlayground(page: Page) {
  const clear = page.getByRole("button", { name: /Temizle/i });
  if (await clear.isVisible({ timeout: 1500 }).catch(() => false)) {
    await clear.click();
    await page.waitForTimeout(500);
  }
}

async function sendOne(page: Page, text: string, waitForReply = true) {
  const input = page.locator("input[placeholder^='Test mesajı yazın']").first();
  const before = await page.locator("div:has-text('WhatsApp Botu')").count();
  await input.fill(text);
  await input.press("Enter");
  if (!waitForReply) return;
  await page.waitForFunction(
    (count) => {
      const nodes = Array.from(document.querySelectorAll("div"));
      return nodes.filter(n => (n.textContent || "").includes("WhatsApp Botu")).length > count;
    },
    before,
    { timeout: 60000 }
  );
  await page.waitForTimeout(500);
}

async function collectTranscript(page: Page): Promise<ChatMessage[]> {
  return page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll("div.max-w-\\[85\\%\\]"));
    return bubbles.map((node) => {
      const text = (node.textContent || "").replace(/^WhatsApp Botu\s*/, "").trim();
      const isUser = node.className.includes("text-white");
      return { role: isUser ? "user" : "assistant", text };
    });
  }) as Promise<ChatMessage[]>;
}

async function runScenario(page: Page, scenario: Scenario) {
  await clearPlayground(page);
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const next = scenario.steps[i + 1];
    const wait = !(step.burst && next?.burst);
    await sendOne(page, step.text, wait);
  }
  await page.waitForTimeout(1000);
  const transcript = await collectTranscript(page);
  const failures = scenario.checks.map(check => check(transcript)).filter(Boolean) as string[];
  return {
    id: scenario.id,
    title: scenario.title,
    passed: failures.length === 0,
    failures,
    transcript,
  };
}

async function main() {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: process.env.BRAIN_EVAL_HEADLESS !== "false"
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  const results: any[] = [];

  try {
    await login(page);
    await openBotPanel(page);

    for (const scenario of scenarios) {
      console.log(`\n▶ ${scenario.id} — ${scenario.title}`);
      const result = await runScenario(page, scenario);
      results.push(result);
      console.log(result.passed ? "  ✅ geçti" : `  ❌ ${result.failures.length} hata`);
      for (const failure of result.failures) console.log(`   - ${failure}`);
    }
  } finally {
    await browser.close();
  }

  const summary = {
    baseUrl: BASE_URL,
    tenant: TENANT_SLUG,
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
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
