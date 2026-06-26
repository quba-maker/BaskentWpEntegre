"use client";

import { useState, useEffect } from "react";
import { Save, FileText, Layers, SlidersHorizontal, ShieldCheck } from "lucide-react";
import type { BotData } from "@/app/actions/bot";

// ==========================================
// BOT PROMPT TAB
// Authority: System prompt + knowledge base editing
// Data owner: channel_prompts table (via updateBot action)
// ==========================================

interface BotPromptTabProps {
  bot: BotData;
  onSavePrompt: (promptText: string, prices: string, rules: string, qubaBrainSetup?: any) => Promise<void>;
}

function splitSetupText(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function serviceCatalogToText(items: any[] | undefined): string {
  if (!Array.isArray(items)) return "";
  return items
    .map(item => [
      item.name || "",
      Array.isArray(item.aliases) ? item.aliases.join(", ") : "",
      Array.isArray(item.safeAnswerHints) ? item.safeAnswerHints.join("; ") : "",
    ].join(" | ").replace(/\s+\|\s+\|\s*$/g, "").trim())
    .filter(Boolean)
    .join("\n");
}

function parseServiceCatalog(value: string) {
  return value
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [namePart, aliasesPart, hintsPart] = line.split("|").map(part => part?.trim() || "");
      const name = namePart || `Hizmet ${index + 1}`;
      return {
        id: name
          .toLocaleLowerCase("tr-TR")
          .replace(/[^a-z0-9çğıöşü]+/gi, "_")
          .replace(/^_+|_+$/g, "")
          || `service_${index + 1}`,
        name,
        aliases: splitSetupText(aliasesPart),
        verifiedFacts: [],
        requiredInfo: [],
        safeAnswerHints: hintsPart ? [hintsPart] : [],
      };
    });
}

function buildPrimaryAction(action: string) {
  if (!action || action === "sector_default") return undefined;

  const base = {
    id: "tenant_primary_action",
    triggerSignals: [],
    forbiddenBeforeAction: [],
    confirmationRequired: action !== "answer_only" && action !== "handoff_human",
  };

  if (action === "schedule_callback") {
    return {
      ...base,
      action,
      requiredBeforeAction: ["net gün", "net saat veya saat aralığı", "saat dilimi", "hasta teyidi"],
      forbiddenBeforeAction: ["çelişkili gün/saat", "çalışma saati dışı"],
      humanFacingInstruction: "Telefon görüşmesi sadece gün, saat, saat dilimi ve teyit netleşince planlanır.",
    };
  }

  if (action === "create_appointment") {
    return {
      ...base,
      action,
      requiredBeforeAction: ["hizmet veya bölüm", "geliş niyeti", "uygun tarih"],
      humanFacingInstruction: "Randevu talebinde önce hizmet/bölüm ve uygun tarih netleştirilir.",
    };
  }

  if (action === "handoff_human") {
    return {
      ...base,
      action,
      requiredBeforeAction: ["aktarım nedeni"],
      humanFacingInstruction: "Bot sınırına gelince danışmana aktarılacağını kısa ve doğal şekilde belirtir.",
    };
  }

  return {
    ...base,
    action: "answer_only",
    requiredBeforeAction: [],
    humanFacingInstruction: "Bot soru yanıtlar; aksiyon veya randevu dayatmaz.",
  };
}

function buildBaskentHealthcareServiceCatalogDraft() {
  return [
    "Bel fıtığı / Boyun fıtığı | bel fıtığı, boyun fıtığı, omurga, fıtık | Uzaktan net değerlendirme yapılmaz; ilgili uzman muayenesi ve gerekirse tetkik gerekir.",
    "Kardiyoloji | kalp ağrısı, kalp rahatsızlığı, nefes darlığı, merdiven çıkarken zorlanma | Acil belirti varsa acile yönlendir; diğer durumlarda kardiyoloji değerlendirmesi gerekir.",
    "Check-up | check up, genel kontrol, genel muayene | Kadın/erkek paket ayrımını ve geliş dönemini doğal şekilde netleştir.",
    "Dermatoloji | egzama, saç egzaması, cildiye, deri | Doğrulanmış hekim adı varsa paylaş; hekim hakkında başarı/kıyas yorumu yapma.",
    "Kadın Hastalıkları ve Doğum | kadın doğum, gebelik, tekrar anne olmak, doğurganlık | Net tedavi sözü verme; uzman değerlendirmesi gerektiğini söyle.",
    "Ortopedi | diz ağrısı, protez, yürüme zorluğu, merdiven | Protez/ameliyat kararı uzaktan verilmez; muayene ve görüntüleme ile değerlendirilir.",
    "Konaklama / ulaşım | konaklama, kalacak yer, transfer, ulaşım | Hastaneye yakın seçenekler ve anlaşmalı oteller konusunda danışmanlık yapılabilir; garanti veya rezervasyon sözü verme.",
    "Fiyat / ödeme | fiyat, ücret, paket fiyatı, TA12, ödeme | Fiyat bilgisi paylaşılmaz; fiyat hastanedeki değerlendirme ve planlanacak sürece göre değişir.",
  ].join("\n");
}

function buildBaskentAvoidPhrasesDraft() {
  return [
    "Size sağlık talebinizle ilgili yardımcı olayım. Hangi konuda bilgi almak istiyorsunuz?",
    "Bu konuda isimleri yanlış vermek istemem",
    "Görüşme sırasında en uygun uzman bilgisi netleştirilecektir",
    "İlerleyen dönemde Türkiye'ye/Konya'ya gelme ihtimaliniz olur mu?",
    "Sizin için uygun görünüyor",
    "Konuşma geçmişimizdeki bilgileri dikkatle takip ediyorum",
    "Bey",
    "Hanım",
    "Sayın",
    "Bayan",
    "ön görüşme",
  ].join("\n");
}

function buildBaskentPreferredClosersDraft() {
  return [
    "Bu konuda en çok hangi kısmı netleştirmek istersiniz?",
    "İsterseniz önce aklınızdaki soruyu buradan yanıtlayayım.",
    "Geliş planınız netleştiyse günü birlikte netleştirebiliriz.",
    "Bu bilgi karar vermeniz için yeterli oldu mu, başka bir noktayı da açıklayayım mı?",
  ].join("\n");
}

export function BotPromptTab({ bot, onSavePrompt }: BotPromptTabProps) {
  const [prompt, setPrompt] = useState(bot.prompt?.text || "");
  const [prices, setPrices] = useState(bot.prompt?.knowledgePrices || "");
  const [rules, setRules] = useState(bot.prompt?.knowledgeRules || "");
  const existingSetup = bot.prompt?.metadata?.qubaBrain || {};
  const [industry, setIndustry] = useState(existingSetup.industry || "");
  const [rolloutMode, setRolloutMode] = useState(existingSetup.rolloutMode || "sandbox");
  const [organizationName, setOrganizationName] = useState(existingSetup.identity?.organizationName || "");
  const [assistantName, setAssistantName] = useState(existingSetup.identity?.assistantName || "");
  const [defaultLanguage, setDefaultLanguage] = useState(existingSetup.identity?.defaultLanguage || "tr");
  const [supportedLanguages, setSupportedLanguages] = useState((existingSetup.identity?.supportedLanguages || ["tr"]).join(", "));
  const [tonePreset, setTonePreset] = useState(existingSetup.tone?.preset || "");
  const [primaryAction, setPrimaryAction] = useState(existingSetup.actions?.[0]?.id === "tenant_primary_action" ? existingSetup.actions[0].action : "sector_default");
  const [servicesText, setServicesText] = useState(serviceCatalogToText(existingSetup.serviceCatalog));
  const [avoidPhrases, setAvoidPhrases] = useState((existingSetup.tone?.avoidPhrases || []).join("\n"));
  const [preferredClosers, setPreferredClosers] = useState((existingSetup.tone?.preferredClosers || []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset when bot changes
  useEffect(() => {
    setPrompt(bot.prompt?.text || "");
    setPrices(bot.prompt?.knowledgePrices || "");
    setRules(bot.prompt?.knowledgeRules || "");
    const setup = bot.prompt?.metadata?.qubaBrain || {};
    setIndustry(setup.industry || "");
    setRolloutMode(setup.rolloutMode || "sandbox");
    setOrganizationName(setup.identity?.organizationName || "");
    setAssistantName(setup.identity?.assistantName || "");
    setDefaultLanguage(setup.identity?.defaultLanguage || "tr");
    setSupportedLanguages((setup.identity?.supportedLanguages || ["tr"]).join(", "));
    setTonePreset(setup.tone?.preset || "");
    setPrimaryAction(setup.actions?.[0]?.id === "tenant_primary_action" ? setup.actions[0].action : "sector_default");
    setServicesText(serviceCatalogToText(setup.serviceCatalog));
    setAvoidPhrases((setup.tone?.avoidPhrases || []).join("\n"));
    setPreferredClosers((setup.tone?.preferredClosers || []).join("\n"));
    setSaved(false);
  }, [bot.id, bot.prompt?.text, bot.prompt?.knowledgePrices, bot.prompt?.knowledgeRules, bot.prompt?.metadata]);

  const isDirty =
    prompt !== (bot.prompt?.text || "") ||
    prices !== (bot.prompt?.knowledgePrices || "") ||
    rules !== (bot.prompt?.knowledgeRules || "") ||
    industry !== (existingSetup.industry || "") ||
    rolloutMode !== (existingSetup.rolloutMode || "sandbox") ||
    organizationName !== (existingSetup.identity?.organizationName || "") ||
    assistantName !== (existingSetup.identity?.assistantName || "") ||
    defaultLanguage !== (existingSetup.identity?.defaultLanguage || "tr") ||
    supportedLanguages !== ((existingSetup.identity?.supportedLanguages || ["tr"]).join(", ")) ||
    tonePreset !== (existingSetup.tone?.preset || "") ||
    primaryAction !== (existingSetup.actions?.[0]?.id === "tenant_primary_action" ? existingSetup.actions[0].action : "sector_default") ||
    servicesText !== serviceCatalogToText(existingSetup.serviceCatalog) ||
    avoidPhrases !== ((existingSetup.tone?.avoidPhrases || []).join("\n")) ||
    preferredClosers !== ((existingSetup.tone?.preferredClosers || []).join("\n"));

  async function handleSave() {
    setSaving(true);
    const serviceCatalog = parseServiceCatalog(servicesText);
    const actionPolicy = buildPrimaryAction(primaryAction);
    const persistedRolloutMode = rolloutMode === "disabled" ? "disabled" : "sandbox";
    const qubaBrainSetup = {
      ...(existingSetup || {}),
      industry: industry || undefined,
      rolloutMode: persistedRolloutMode,
      identity: {
        ...(existingSetup.identity || {}),
        organizationName: organizationName.trim() || undefined,
        assistantName: assistantName.trim() || undefined,
        defaultLanguage: defaultLanguage.trim() || "tr",
        supportedLanguages: splitSetupText(supportedLanguages),
        revealBotIdentity: false,
      },
      tone: {
        ...(existingSetup.tone || {}),
        preset: tonePreset || undefined,
        addressStyle: "neutral_you",
        avoidPhrases: splitSetupText(avoidPhrases),
        preferredClosers: splitSetupText(preferredClosers),
      },
      serviceCatalog: serviceCatalog.length > 0 ? serviceCatalog : undefined,
      actions: actionPolicy ? [actionPolicy] : undefined,
    };

    await onSavePrompt(prompt, prices, rules, qubaBrainSetup);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function applyBaskentBrainDraft() {
    setIndustry("healthcare");
    setRolloutMode("sandbox");
    setOrganizationName("Başkent Üniversitesi Konya Hastanesi");
    setAssistantName("Rüya");
    setDefaultLanguage("tr");
    setSupportedLanguages("tr, en, de, nl, fr, ru, uz, ar");
    setTonePreset("warm_corporate");
    setPrimaryAction("schedule_callback");
    setServicesText(buildBaskentHealthcareServiceCatalogDraft());
    setAvoidPhrases(buildBaskentAvoidPhrasesDraft());
    setPreferredClosers(buildBaskentPreferredClosersDraft());
  }

  const isBrainMode = rolloutMode !== "disabled";
  const activeEditorTitle = isBrainMode ? "Yeni V2 Brain" : "Eski Sistem";

  return (
    <div className="space-y-6">
      {/* Architecture Mode */}
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" style={{ color: "var(--q-blue, #007aff)" }} />
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>
                  Çalışma Modu
                </h3>
                <p className="text-xs leading-relaxed max-w-2xl" style={{ color: "var(--q-text-secondary)" }}>
                  Hangi yapıyı düzenlemek ve sağdaki test alanında denemek istediğinizi seçin. Canlı hastaya mesaj gönderimi bu ekrandan yapılmaz.
                </p>
              </div>
            </div>
            <div
              className="px-3 py-2 rounded-xl border text-xs font-semibold"
              style={{
                borderColor: isBrainMode ? "rgba(34,197,94,0.25)" : "rgba(59,130,246,0.25)",
                backgroundColor: isBrainMode ? "rgba(34,197,94,0.08)" : "rgba(59,130,246,0.08)",
                color: isBrainMode ? "var(--q-green, #22c55e)" : "var(--q-blue, #007aff)",
              }}
            >
              Düzenlenen: {activeEditorTitle}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRolloutMode("disabled")}
              className="text-left rounded-2xl border p-4 transition-all hover:bg-gray-50"
              style={{
                borderColor: rolloutMode === "disabled" ? "var(--q-blue, #007aff)" : "var(--q-border-default)",
                backgroundColor: rolloutMode === "disabled" ? "rgba(0,122,255,0.06)" : "#fff",
                boxShadow: rolloutMode === "disabled" ? "0 0 0 1px rgba(0,122,255,0.12)" : "none",
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>Mevcut Sistem</span>
                <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-gray-100" style={{ color: "var(--q-text-secondary)" }}>Canlı çekirdek</span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--q-text-secondary)" }}>
                Mevcut Sistem Prompt ve bilgi bankası. Başkent’in bugünkü güvenli düzeni.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setRolloutMode("sandbox")}
              className="text-left rounded-2xl border p-4 transition-all hover:bg-gray-50"
              style={{
                borderColor: isBrainMode ? "var(--q-green, #22c55e)" : "var(--q-border-default)",
                backgroundColor: isBrainMode ? "rgba(34,197,94,0.08)" : "#fff",
                boxShadow: isBrainMode ? "0 0 0 1px rgba(34,197,94,0.12)" : "none",
              }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>Yeni SaaS V2 Brain</span>
                <span className="text-[10px] font-bold px-2 py-1 rounded-md" style={{ backgroundColor: "rgba(34,197,94,0.10)", color: "var(--q-green, #22c55e)" }}>Parçalı test</span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--q-text-secondary)" }}>
                Yeni müşteri mantığı: kurum, ton, hizmet, aksiyon ve kaçınılacak kalıplar ayrı alanlardan yönetilir.
              </p>
            </button>
          </div>

          <div className="rounded-xl border px-3 py-2 bg-gray-50" style={{ borderColor: "var(--q-border-default)" }}>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--q-text-secondary)" }}>
              Sağdaki test alanında da aynı iki seçenek vardır. Orada seçtiğiniz sistem sadece test cevabını etkiler; gerçek hasta akışı korunur.
            </p>
          </div>
        </div>
      </div>

      {/* System Prompt Editor */}
      {!isBrainMode && (
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
            <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>
              Sistem Prompt
            </h3>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100" style={{ color: "var(--q-text-secondary)" }}>
              eski canlı çekirdek
            </span>
            {bot.prompt && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-md"
                style={{ backgroundColor: "rgba(0,0,0,0.04)", color: "var(--q-text-secondary)" }}
              >
                v{bot.prompt.version}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <span className="text-[10px] font-medium" style={{ color: "var(--q-yellow, #f59e0b)" }}>
                Kaydedilmemiş değişiklik
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl text-white transition-all disabled:opacity-50"
              style={{ backgroundColor: saved ? "var(--q-green)" : "var(--q-primary, #6366f1)" }}
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "Kaydediliyor..." : saved ? "Kaydedildi ✓" : "Kaydet"}
            </button>
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          className="w-full px-3 py-2 rounded-xl border text-sm font-mono resize-y"
          style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-primary)" }}
          placeholder="Bu botun sistem promptunu yazın..."
        />
        <p className="text-[10px] mt-1" style={{ color: "var(--q-text-secondary)" }}>
          {prompt.length.toLocaleString()} karakter
        </p>
      </div>
      )}

      {/* Brain Setup Wizard */}
      {isBrainMode && (
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}
      >
          <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
            <div>
              <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>
                Yeni SaaS Brain Kurulumu
              </h3>
              <p className="text-[10px]" style={{ color: "var(--q-text-secondary)" }}>
                Promptu büyütmeden firma davranışını sektör, ton, aksiyon ve hizmet alanlarına böler.
              </p>
            </div>
          </div>
          <span
            className="text-[10px] font-bold px-2 py-1 rounded-lg uppercase"
            style={{
              backgroundColor: "rgba(59,130,246,0.10)",
              color: "var(--q-blue, #007aff)",
            }}
          >
            test alanı
          </span>
        </div>

        <div className="mb-4 rounded-xl border p-3 bg-green-50/40" style={{ borderColor: "rgba(34,197,94,0.20)" }}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-xs font-bold" style={{ color: "var(--q-text-primary)" }}>Başkent V2 Brain taslağı</div>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--q-text-secondary)" }}>
                Eski prompttaki ana davranışı SaaS alanlarına ayırır. Canlıya almaz; önce sağ panelde test edilir.
              </p>
            </div>
            <button
              type="button"
              onClick={applyBaskentBrainDraft}
              className="px-3 py-2 rounded-xl text-xs font-bold text-white"
              style={{ backgroundColor: "var(--q-green, #22c55e)" }}
            >
              Başkent alanlarını doldur
            </button>
          </div>
        </div>

        <div className="mb-4 rounded-xl border px-3 py-2 flex items-start gap-2 bg-blue-50/50" style={{ borderColor: "rgba(59,130,246,0.18)" }}>
          <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--q-blue, #007aff)" }} />
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--q-text-secondary)" }}>
            Yeni V2 Brain şu an sadece test alanı için hazırlanır. Başkent canlı geçişi ayrıca onaylandıktan sonra yapılacak.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Sektör</label>
            <select value={industry} onChange={e => setIndustry(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-xs" style={{ borderColor: "var(--q-border-default)" }}>
              <option value="">Otomatik algıla</option>
              <option value="healthcare">Sağlık / Hastane</option>
              <option value="fitness">Fitness / Havuz / Kurs</option>
              <option value="construction">İnşaat / Gayrimenkul</option>
              <option value="general">Genel İşletme</option>
            </select>
          </div>
          <input type="hidden" value={rolloutMode} readOnly />
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Kurum adı</label>
            <input value={organizationName} onChange={e => setOrganizationName(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-xs" style={{ borderColor: "var(--q-border-default)" }} placeholder="Örn: Başkent Üniversitesi Konya Hastanesi" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Asistan adı</label>
            <input value={assistantName} onChange={e => setAssistantName(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-xs" style={{ borderColor: "var(--q-border-default)" }} placeholder="Örn: Rüya" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Varsayılan dil</label>
            <input value={defaultLanguage} onChange={e => setDefaultLanguage(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-xs" style={{ borderColor: "var(--q-border-default)" }} placeholder="tr" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Desteklenen diller</label>
            <input value={supportedLanguages} onChange={e => setSupportedLanguages(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-xs" style={{ borderColor: "var(--q-border-default)" }} placeholder="tr, en, de, ru, uz, ar" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Ton</label>
            <select value={tonePreset} onChange={e => setTonePreset(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-xs" style={{ borderColor: "var(--q-border-default)" }}>
              <option value="">Sektör varsayılanı</option>
              <option value="warm_corporate">Sıcak kurumsal</option>
              <option value="calm_professional">Sakin profesyonel</option>
              <option value="friendly_support">Samimi destek</option>
              <option value="direct_sales">Satış odaklı</option>
              <option value="luxury_consultant">Premium danışman</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Ana aksiyon</label>
            <select value={primaryAction} onChange={e => setPrimaryAction(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-xs" style={{ borderColor: "var(--q-border-default)" }}>
              <option value="sector_default">Sektör varsayılanı</option>
              <option value="answer_only">Sadece yanıtla</option>
              <option value="schedule_callback">Telefon görüşmesi planla</option>
              <option value="create_appointment">Randevu talebi al</option>
              <option value="handoff_human">Danışmana aktar</option>
            </select>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>
              Hizmet kataloğu
            </label>
            <textarea
              value={servicesText}
              onChange={e => setServicesText(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-xl border text-xs resize-y"
              style={{ borderColor: "var(--q-border-default)" }}
              placeholder="Her satır: Hizmet adı | alias1, alias2 | güvenli cevap notu"
            />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>
              Kaçınılacak kalıplar
            </label>
            <textarea
              value={avoidPhrases}
              onChange={e => setAvoidPhrases(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-xl border text-xs resize-y"
              style={{ borderColor: "var(--q-border-default)" }}
              placeholder="Her satıra bir kalıp"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>
              Tercih edilen kapanış / takip soruları
            </label>
            <textarea
              value={preferredClosers}
              onChange={e => setPreferredClosers(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-xl border text-xs resize-y"
              style={{ borderColor: "var(--q-border-default)" }}
              placeholder="Her satıra bir doğal takip cümlesi"
            />
          </div>
        </div>
      </div>
      )}

      {/* Knowledge Base */}
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
          <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>
            Bilgi Bankası
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>
              Fiyatlar
            </label>
            <textarea
              value={prices}
              onChange={(e) => setPrices(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-xl border text-xs resize-y"
              style={{ borderColor: "var(--q-border-default)" }}
              placeholder="Fiyat bilgileri..."
            />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>
              Kurallar
            </label>
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-xl border text-xs resize-y"
              style={{ borderColor: "var(--q-border-default)" }}
              placeholder="Bot kuralları..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
