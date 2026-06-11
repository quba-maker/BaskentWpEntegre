"use client";

import { useState, useEffect } from "react";
import { Save, FileText, Layers } from "lucide-react";
import type { BotData } from "@/app/actions/bot";

// ==========================================
// BOT PROMPT TAB
// Authority: System prompt + knowledge base editing
// Data owner: channel_prompts table (via updateBot action)
// ==========================================

interface BotPromptTabProps {
  bot: BotData;
  onSavePrompt: (promptText: string, prices: string, rules: string) => Promise<void>;
}

export function BotPromptTab({ bot, onSavePrompt }: BotPromptTabProps) {
  const [prompt, setPrompt] = useState(bot.prompt?.text || "");
  const [prices, setPrices] = useState(bot.prompt?.knowledgePrices || "");
  const [rules, setRules] = useState(bot.prompt?.knowledgeRules || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset when bot changes
  useEffect(() => {
    setPrompt(bot.prompt?.text || "");
    setPrices(bot.prompt?.knowledgePrices || "");
    setRules(bot.prompt?.knowledgeRules || "");
    setSaved(false);
  }, [bot.id, bot.prompt?.text, bot.prompt?.knowledgePrices, bot.prompt?.knowledgeRules]);

  const isDirty =
    prompt !== (bot.prompt?.text || "") ||
    prices !== (bot.prompt?.knowledgePrices || "") ||
    rules !== (bot.prompt?.knowledgeRules || "");

  async function handleSave() {
    setSaving(true);
    await onSavePrompt(prompt, prices, rules);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      {/* System Prompt Editor */}
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
