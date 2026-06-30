"use client";

import { useState, useEffect } from "react";
import { Save, FileText, Layers, ShieldCheck } from "lucide-react";
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

  const isBrainMode = false;
  const activeEditorTitle = "V3 Tek Prompt";

  return (
    <div className="space-y-6">
      {/* V3 Mode Summary */}
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" style={{ color: "var(--q-green, #22c55e)" }} />
            </div>
            <div>
              <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>
                V3 Tek Prompt
              </h3>
              <p className="text-xs leading-relaxed max-w-3xl" style={{ color: "var(--q-text-secondary)" }}>
                Başkent botu bu ana prompt, bilgi bankası ve AI Ayarları’nda seçilen model ile çalışır. Sağdaki test alanı da aynı yapıyı güvenli şekilde dener; gerçek hastaya mesaj göndermez.
              </p>
            </div>
          </div>
          <div
            className="px-3 py-2 rounded-xl border text-xs font-semibold"
            style={{
              borderColor: "rgba(34,197,94,0.25)",
              backgroundColor: "rgba(34,197,94,0.08)",
              color: "var(--q-green, #22c55e)",
            }}
          >
            Aktif yapı: {activeEditorTitle}
          </div>
        </div>
      </div>

      {/* System Prompt Editor */}
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
            <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>
              V3 Ana Prompt
            </h3>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100" style={{ color: "var(--q-text-secondary)" }}>
              canlı çekirdek
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
          placeholder="Başkent V3 tek promptunu yazın..."
        />
        <p className="text-[10px] mt-1" style={{ color: "var(--q-text-secondary)" }}>
          {prompt.length.toLocaleString()} karakter
        </p>
      </div>

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
