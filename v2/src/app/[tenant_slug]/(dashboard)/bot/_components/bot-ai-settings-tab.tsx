"use client";

import { useState, useEffect } from "react";
import { Cpu, Check, MessageSquare, Clock, Settings2, Info } from "lucide-react";
import { updateBot, type BotData } from "@/app/actions/bot";

// ==========================================
// BOT AI SETTINGS TAB
// Authority: AI model, response length, max messages, working hours
// ONLY shows settings that are ACTUALLY consumed by worker/runtime.
//
// Phantom settings NOT shown here:
//   - aggression_level (stored but never read by worker/prompt-builder)
//   - auto_greeting (only used by sheets-ingestion, not general bot)
//   - greeting_language (only used by sheets-ingestion)
// ==========================================

// ── Model Definitions ──
const AI_MODELS = [
  { id: "gemini-2.5-flash-lite", name: "Flash Lite", desc: "Hızlı & Ekonomik", speed: 95, cost: 20, iq: 60, color: "var(--q-green)" },
  { id: "gemini-2.5-flash", name: "Flash", desc: "Dengeli (Önerilen)", speed: 85, cost: 40, iq: 85, color: "var(--q-blue)" },
  { id: "gemini-2.5-pro", name: "Pro", desc: "Güçlü & Pahalı", speed: 50, cost: 90, iq: 98, color: "var(--q-purple)" },
];

// ── Response Length Presets ──
const RESPONSE_PRESETS = [
  { value: 500, label: "Kısa", desc: "Hızlı ve öz yanıtlar" },
  { value: 1000, label: "Dengeli", desc: "Detaylı ama odaklı" },
  { value: 2000, label: "Detaylı", desc: "Kapsamlı açıklamalar" },
];

// ── Max Messages Options ──
const MAX_MSG_OPTIONS = [
  { value: 5, label: "5 mesaj" },
  { value: 8, label: "8 mesaj" },
  { value: 12, label: "12 mesaj" },
  { value: 20, label: "20 mesaj" },
  { value: 0, label: "Sınırsız" },
];

interface BotAISettingsTabProps {
  bot: BotData;
  onRefresh: () => Promise<void>;
}

export function BotAISettingsTab({ bot, onRefresh }: BotAISettingsTabProps) {
  const profile = bot.profile;

  const [aiModel, setAiModel] = useState(profile?.aiModel || "gemini-2.5-flash");
  const [maxTokens, setMaxTokens] = useState(profile?.maxResponseTokens || 1000);
  const [maxMessages, setMaxMessages] = useState(profile?.maxMessages ?? 8);
  const [workingHours, setWorkingHours] = useState<{
    enabled: boolean;
    start?: string;
    end?: string;
    offMessage?: string;
  }>(profile?.workingHours || { enabled: false });
  const [responseStyle, setResponseStyle] = useState(profile?.responseStyle || "balanced");
  const [responseDelay, setResponseDelay] = useState(profile?.responseDelaySeconds || 5);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync when bot changes
  useEffect(() => {
    setAiModel(profile?.aiModel || "gemini-2.5-flash");
    setMaxTokens(profile?.maxResponseTokens || 1000);
    setMaxMessages(profile?.maxMessages ?? 8);
    setWorkingHours(profile?.workingHours || { enabled: false });
    setResponseStyle(profile?.responseStyle || "balanced");
    setResponseDelay(profile?.responseDelaySeconds || 5);
    setSaved(false);
  }, [
    bot.id,
    profile?.aiModel,
    profile?.maxResponseTokens,
    profile?.maxMessages,
    profile?.workingHours,
    profile?.responseStyle,
    profile?.responseDelaySeconds
  ]);

  const isDirty =
    aiModel !== (profile?.aiModel || "gemini-2.5-flash") ||
    maxTokens !== (profile?.maxResponseTokens || 1000) ||
    maxMessages !== (profile?.maxMessages ?? 8) ||
    responseStyle !== (profile?.responseStyle || "balanced") ||
    responseDelay !== (profile?.responseDelaySeconds || 5) ||
    JSON.stringify(workingHours) !== JSON.stringify(profile?.workingHours || { enabled: false });

  const isCustomDelay = ![2, 5, 10].includes(responseDelay);
  const [customDelay, setCustomDelay] = useState(isCustomDelay ? responseDelay : 15);

  const handleStyleChange = (style: string) => {
    setResponseStyle(style);
    const tokenMap: Record<string, number> = {
      short: 500,
      balanced: 1000,
      detailed: 2000,
    };
    setMaxTokens(tokenMap[style]);
  };

  async function handleSave() {
    setSaving(true);
    try {
      await updateBot(bot.id, {
        aiModel,
        maxResponseTokens: maxTokens,
        maxMessages,
        workingHours,
        responseStyle,
        responseDelaySeconds: responseDelay,
      });
      await onRefresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* AI Model Selection */}
      <div className="rounded-2xl border p-5" style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}>
        <div className="flex items-center gap-2 mb-4">
          <Cpu className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
          <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>Yapay Zeka Modeli</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {AI_MODELS.map((m) => {
            const isActive = aiModel === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setAiModel(m.id)}
                className="relative p-4 rounded-xl border-2 transition-all text-left"
                style={{
                  borderColor: isActive ? m.color : "var(--q-border-default)",
                  backgroundColor: isActive ? `color-mix(in srgb, ${m.color} 5%, white)` : "#fff",
                }}
              >
                {isActive && (
                  <div
                    className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: m.color }}
                  >
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                <p className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>{m.name}</p>
                <p className="text-[11px] mb-3" style={{ color: "var(--q-text-secondary)" }}>{m.desc}</p>
                <div className="space-y-1.5">
                  {[
                    { label: "Hız", val: m.speed },
                    { label: "Zeka", val: m.iq },
                    { label: "Maliyet", val: m.cost },
                  ].map((bar) => (
                    <div key={bar.label} className="flex items-center gap-2">
                      <span className="text-[10px] w-10" style={{ color: "var(--q-text-secondary)" }}>{bar.label}</span>
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(0,0,0,0.05)" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${bar.val}%`, backgroundColor: m.color }} />
                      </div>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Response Length + Max Messages + Response Delay */}
      <div className="rounded-2xl border p-5" style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}>
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
          <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>Yanıt Kontrolü</h3>
        </div>

        {/* Response Style Presets */}
        <div className="mb-6">
          <label className="text-xs font-semibold mb-2 block" style={{ color: "var(--q-text-secondary)" }}>
            Cevap Stili
          </label>
          <div className="flex items-center gap-2">
            {[
              { value: "short", label: "Kısa", desc: "Hızlı ve öz yanıtlar (~500 token)" },
              { value: "balanced", label: "Dengeli", desc: "Detaylı ama odaklı (~1000 token)" },
              { value: "detailed", label: "Detaylı", desc: "Kapsamlı açıklamalar (~2000 token)" },
            ].map((s) => {
              const isActive = responseStyle === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => handleStyleChange(s.value)}
                  className="flex-1 px-3 py-3 rounded-xl border-2 transition-all text-center"
                  style={{
                    borderColor: isActive ? "var(--q-primary, #6366f1)" : "var(--q-border-default)",
                    backgroundColor: isActive ? "color-mix(in srgb, var(--q-primary, #6366f1) 5%, white)" : "#fff",
                  }}
                >
                  <p className="text-xs font-bold" style={{ color: "var(--q-text-primary)" }}>{s.label}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--q-text-secondary)" }}>{s.desc}</p>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] mt-1.5" style={{ color: "var(--q-text-placeholder)" }}>
            Cevap stili, yapay zekanın üslup talimatını ve yanıt token limitini belirler.
          </p>
        </div>

        {/* Response Delay */}
        <div className="mb-6">
          <label className="text-xs font-semibold mb-2 block" style={{ color: "var(--q-text-secondary)" }}>
            Yanıt Gecikmesi
          </label>
          <div className="grid grid-cols-4 gap-2 mb-3">
            {[
              { value: 2, label: "Hızlı", desc: "2 saniye" },
              { value: 5, label: "Dengeli", desc: "5 saniye" },
              { value: 10, label: "Doğal", desc: "10 saniye" },
            ].map((p) => {
              const isActive = !isCustomDelay && responseDelay === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    setResponseDelay(p.value);
                  }}
                  className="px-3 py-3 rounded-xl border-2 transition-all text-center"
                  style={{
                    borderColor: isActive ? "var(--q-primary, #6366f1)" : "var(--q-border-default)",
                    backgroundColor: isActive ? "color-mix(in srgb, var(--q-primary, #6366f1) 5%, white)" : "#fff",
                  }}
                >
                  <p className="text-xs font-bold" style={{ color: "var(--q-text-primary)" }}>{p.label}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--q-text-secondary)" }}>{p.desc}</p>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setResponseDelay(customDelay);
              }}
              className="px-3 py-3 rounded-xl border-2 transition-all text-center"
              style={{
                borderColor: isCustomDelay ? "var(--q-primary, #6366f1)" : "var(--q-border-default)",
                backgroundColor: isCustomDelay ? "color-mix(in srgb, var(--q-primary, #6366f1) 5%, white)" : "#fff",
              }}
            >
              <p className="text-xs font-bold" style={{ color: "var(--q-text-primary)" }}>Özel</p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--q-text-secondary)" }}>{isCustomDelay ? `${responseDelay} sn` : "Belirt..."}</p>
            </button>
          </div>

          {isCustomDelay && (
            <div className="space-y-2 p-3 rounded-xl border mb-3" style={{ borderColor: "var(--q-border-default)", backgroundColor: "rgba(0,0,0,0.01)" }}>
              <div className="flex items-center justify-between text-xs font-medium">
                <span style={{ color: "var(--q-text-secondary)" }}>Özel Gecikme Süresi</span>
                <span className="font-bold" style={{ color: "var(--q-primary, #6366f1)" }}>{responseDelay} saniye</span>
              </div>
              <input
                type="range"
                min="2"
                max="30"
                value={responseDelay}
                onChange={(e) => {
                  const val = Math.max(2, Math.min(30, parseInt(e.target.value) || 2));
                  setResponseDelay(val);
                  setCustomDelay(val);
                }}
                className="w-full accent-[#6366f1]"
              />
              <div className="flex justify-between text-[9px]" style={{ color: "var(--q-text-placeholder)" }}>
                <span>2 sn</span>
                <span>15 sn</span>
                <span>30 sn</span>
              </div>
            </div>
          )}
          <p className="text-[10px] mt-1.5" style={{ color: "var(--q-text-placeholder)" }}>
            Gecikme süresi, kullanıcının mesajından sonra botun yanıt vermeden önce bekleyeceği süreyi ayarlar. Canlı WhatsApp/Instagram akışlarında uygulanır.
          </p>
        </div>

        {/* Max Messages */}
        <div>
          <label className="text-xs font-semibold mb-2 block" style={{ color: "var(--q-text-secondary)" }}>
            Maksimum Bot Mesajı
          </label>
          <p className="text-[10px] mb-2" style={{ color: "var(--q-text-placeholder)" }}>
            Bot bu sayıda mesaj sonra otomatik olarak insana devredilir. Sınırsız modda devir yapılmaz.
          </p>
          <div className="flex items-center gap-1.5 p-1 rounded-xl" style={{ backgroundColor: "rgba(0,0,0,0.03)" }}>
            {MAX_MSG_OPTIONS.map((opt) => {
              const isActive = maxMessages === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMaxMessages(opt.value)}
                  className="flex-1 px-3 py-2 text-xs font-bold rounded-lg transition-all"
                  style={{
                    backgroundColor: isActive ? "white" : "transparent",
                    color: isActive ? "var(--q-text-primary)" : "var(--q-text-secondary)",
                    boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Working Hours */}
      <div className="rounded-2xl border p-5" style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
            <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>Çalışma Saatleri</h3>
          </div>
          <button
            onClick={() => setWorkingHours((prev) => ({ ...prev, enabled: !prev.enabled }))}
            className="relative w-11 h-6 rounded-full transition-all"
            style={{ backgroundColor: workingHours.enabled ? "var(--q-green)" : "rgba(0,0,0,0.15)" }}
          >
            <div
              className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all"
              style={{ left: workingHours.enabled ? "calc(100% - 22px)" : "2px" }}
            />
          </button>
        </div>

        {workingHours.enabled && (
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>
                  Başlangıç
                </label>
                <input
                  type="time"
                  value={workingHours.start || "09:00"}
                  onChange={(e) => setWorkingHours((prev) => ({ ...prev, start: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ borderColor: "var(--q-border-default)" }}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>
                  Bitiş
                </label>
                <input
                  type="time"
                  value={workingHours.end || "18:00"}
                  onChange={(e) => setWorkingHours((prev) => ({ ...prev, end: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border text-sm"
                  style={{ borderColor: "var(--q-border-default)" }}
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>
                Mesai Dışı Mesajı
              </label>
              <input
                type="text"
                value={workingHours.offMessage || ""}
                onChange={(e) => setWorkingHours((prev) => ({ ...prev, offMessage: e.target.value }))}
                placeholder="Mesai saatlerimiz dışındasınız. En kısa sürede dönüş yapılacaktır."
                className="w-full px-3 py-2 rounded-lg border text-sm"
                style={{ borderColor: "var(--q-border-default)" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-bold rounded-xl text-white transition-all disabled:opacity-50"
          style={{ backgroundColor: saved ? "var(--q-green)" : "var(--q-primary, #6366f1)" }}
        >
          <Settings2 className="w-4 h-4" />
          {saving ? "Kaydediliyor..." : saved ? "Kaydedildi ✓" : "Ayarları Kaydet"}
        </button>
      </div>
    </div>
  );
}
