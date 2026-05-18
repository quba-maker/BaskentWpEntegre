"use client";

import { useState } from "react";
import {
  Settings2, Zap, Globe, MessageSquare, Clock, Shield, Cpu, Check,
  BookOpen, ShieldAlert, Plus, X
} from "lucide-react";
import { ToggleSwitch } from "@/components/governance";
import { SettingRow } from "./shared";

// ==========================================
// UNIFIED SETTINGS PANEL (Tabbed)
// Apple Settings style — Genel + Bilgi Bankası + Yasaklar
// ==========================================

const AI_MODELS = [
  { id: 'gemini-2.5-flash-lite', name: 'Flash Lite', color: 'var(--q-green)' },
  { id: 'gemini-2.5-flash', name: 'Flash', color: 'var(--q-blue)' },
  { id: 'gemini-2.5-pro', name: 'Pro', color: 'var(--q-purple)' },
];

type TabId = 'general' | 'knowledge' | 'moderation';

interface UnifiedSettingsPanelProps {
  // General
  botConfig: {
    auto_greeting: string;
    greeting_language: string;
    max_messages: string;
    working_hours: string;
    aggression_level: string;
    ai_model: string;
  };
  onBotConfigChange: (key: string, value: string) => void;

  // Knowledge
  knowledgePrices: string;
  knowledgeRules: string;
  onPricesChange: (value: string) => void;
  onRulesChange: (value: string) => void;
  savingKnowledge: boolean;
  savedKnowledge: boolean;
  onSaveKnowledge: () => void;

  // Moderation
  bannedWords: string[];
  onAddWord: (word: string) => void;
  onRemoveWord: (index: number) => void;
}

const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: 'general', label: 'Genel', icon: Settings2 },
  { id: 'knowledge', label: 'Bilgi Bankası', icon: BookOpen },
  { id: 'moderation', label: 'Yasaklar', icon: ShieldAlert },
];

export function UnifiedSettingsPanel({
  botConfig, onBotConfigChange,
  knowledgePrices, knowledgeRules, onPricesChange, onRulesChange,
  savingKnowledge, savedKnowledge, onSaveKnowledge,
  bannedWords, onAddWord, onRemoveWord,
}: UnifiedSettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');

  return (
    <div className="mt-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
        <Settings2 className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
        Bot Ayarları
      </h2>

      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: "var(--q-border-default)" }}>
        {/* Tab Bar */}
        <div className="flex border-b" style={{ borderColor: "var(--q-border-default)", backgroundColor: "var(--q-bg-secondary)" }}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all relative"
                style={{
                  color: isActive ? "var(--q-text-primary)" : "var(--q-text-secondary)",
                  backgroundColor: isActive ? "white" : "transparent",
                  borderBottom: isActive ? "2px solid var(--q-blue)" : "2px solid transparent",
                }}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'general' && (
            <div className="divide-y divide-black/5">
              <SettingRow icon={Zap} iconColor="var(--q-orange)" title="Otonom Karşılama" description="Yeni lead geldiğinde otomatik WhatsApp mesajı gönder">
                <ToggleSwitch active={botConfig.auto_greeting === "true"} onToggle={() => onBotConfigChange("auto_greeting", botConfig.auto_greeting === "true" ? "false" : "true")} />
              </SettingRow>

              <SettingRow icon={Globe} iconColor="var(--q-blue)" title="Karşılama Dili" description="Otomatik karşılama mesajının dili">
                <select value={botConfig.greeting_language} onChange={e => onBotConfigChange("greeting_language", e.target.value)} className="px-3 py-1.5 text-sm font-semibold border-0 rounded-lg outline-none cursor-pointer" style={{ color: "var(--q-text-primary)", backgroundColor: "rgba(0,0,0,0.04)" }}>
                  <option value="auto">Otomatik</option>
                  <option value="tr">Türkçe</option>
                  <option value="en">İngilizce</option>
                </select>
              </SettingRow>

              <SettingRow icon={MessageSquare} iconColor="var(--q-purple)" title="Maksimum Bot Mesajı" description="Bot kaç mesaj sonra insana devretsin">
                <select value={botConfig.max_messages} onChange={e => onBotConfigChange("max_messages", e.target.value)} className="px-3 py-1.5 text-sm font-semibold border-0 rounded-lg outline-none cursor-pointer" style={{ color: "var(--q-text-primary)", backgroundColor: "rgba(0,0,0,0.04)" }}>
                  <option value="5">5</option>
                  <option value="8">8</option>
                  <option value="12">12</option>
                  <option value="20">20</option>
                  <option value="0">Sınırsız</option>
                </select>
              </SettingRow>

              <SettingRow icon={Clock} iconColor="var(--q-green)" title="Çalışma Saatleri" description="Botun aktif olacağı zaman dilimi">
                <select value={botConfig.working_hours} onChange={e => onBotConfigChange("working_hours", e.target.value)} className="px-3 py-1.5 text-sm font-semibold border-0 rounded-lg outline-none cursor-pointer" style={{ color: "var(--q-text-primary)", backgroundColor: "rgba(0,0,0,0.04)" }}>
                  <option value="24/7">7/24 Aktif</option>
                  <option value="business">Mesai (09-18)</option>
                  <option value="after_hours">Mesai Dışı (18-09)</option>
                </select>
              </SettingRow>

              <SettingRow icon={Shield} iconColor="var(--q-red)" title="İkna Seviyesi" description="Botun satış agresiflik düzeyi">
                <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ backgroundColor: "rgba(0,0,0,0.04)" }}>
                  {[
                    { value: "low", label: "Düşük" },
                    { value: "medium", label: "Orta" },
                    { value: "high", label: "Yüksek" }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => onBotConfigChange("aggression_level", opt.value)}
                      className="px-3 py-1.5 text-xs font-bold rounded-md transition-all"
                      style={{
                        backgroundColor: botConfig.aggression_level === opt.value ? "white" : "transparent",
                        color: botConfig.aggression_level === opt.value ? "var(--q-text-primary)" : "var(--q-text-secondary)",
                        boxShadow: botConfig.aggression_level === opt.value ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow icon={Cpu} iconColor="var(--q-purple)" title="Yapay Zeka Modeli" description="AI yanıtları için kullanılacak model">
                <div className="flex items-center gap-1.5">
                  {AI_MODELS.map(m => {
                    const isActive = botConfig.ai_model === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => onBotConfigChange("ai_model", m.id)}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg border transition-all"
                        style={isActive
                          ? { backgroundColor: m.color, borderColor: m.color, color: "white", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                          : { borderColor: "var(--q-border-default)", color: "var(--q-text-secondary)", backgroundColor: "white" }
                        }
                      >
                        {isActive && <Check className="w-3 h-3 inline mr-1 -mt-0.5" />}
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </SettingRow>
            </div>
          )}

          {activeTab === 'knowledge' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-medium" style={{ color: "var(--q-text-secondary)" }}>
                  Bot bu bilgileri yanıtlarında referans olarak kullanır. Fiyatları, hizmetleri ve kurallarınızı buraya girin.
                </p>
                <button
                  onClick={onSaveKnowledge}
                  disabled={savingKnowledge}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg text-white flex items-center gap-1.5 disabled:opacity-60"
                  style={{ backgroundColor: savedKnowledge ? "var(--q-green)" : "var(--q-blue)" }}
                >
                  {savingKnowledge ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : savedKnowledge ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : null}
                  {savedKnowledge ? "Kaydedildi" : "Kaydet"}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold mb-2 block" style={{ color: "var(--q-text-primary)" }}>
                    Fiyat Listesi & Hizmetler
                  </label>
                  <textarea
                    value={knowledgePrices}
                    onChange={(e) => onPricesChange(e.target.value)}
                    className="w-full h-44 p-4 text-[13px] font-medium rounded-xl outline-none resize-none border"
                    style={{ backgroundColor: "var(--q-bg-secondary)", borderColor: "var(--q-border-default)", color: "var(--q-text-primary)" }}
                    placeholder={"Örn:\n- Lazer Epilasyon (Tüm Vücut): 2500 TL\n- Cilt Bakımı: 1000 TL"}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold mb-2 block" style={{ color: "var(--q-text-primary)" }}>
                    SSS & Kurallar
                  </label>
                  <textarea
                    value={knowledgeRules}
                    onChange={(e) => onRulesChange(e.target.value)}
                    className="w-full h-44 p-4 text-[13px] font-medium rounded-xl outline-none resize-none border"
                    style={{ backgroundColor: "var(--q-bg-secondary)", borderColor: "var(--q-border-default)", color: "var(--q-text-primary)" }}
                    placeholder={"Örn:\nS: Taksit yapıyor musunuz?\nC: 3 taksit imkanımız var.\n\nKURAL: Muayene ücretsizdir."}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'moderation' && (
            <div className="p-5">
              <p className="text-xs font-medium mb-4" style={{ color: "var(--q-text-secondary)" }}>
                Bot bu kelimeleri ASLA kullanmayacak. Prompt&apos;a otomatik enjekte edilir.
              </p>

              <div className="flex items-center gap-2 mb-4">
                <input
                  type="text"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const val = e.currentTarget.value.trim();
                      if (val) { onAddWord(val); e.currentTarget.value = ""; }
                    }
                  }}
                  placeholder="Kelime ekle ve Enter'a bas..."
                  className="flex-1 px-3 py-2 text-sm rounded-lg outline-none border"
                  style={{ backgroundColor: "var(--q-bg-secondary)", borderColor: "var(--q-border-default)", color: "var(--q-text-primary)" }}
                />
                <button
                  onClick={(e) => {
                    const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                    const val = input.value.trim();
                    if (val) { onAddWord(val); input.value = ""; }
                  }}
                  className="px-3 py-2 text-white rounded-lg text-sm font-bold"
                  style={{ backgroundColor: "var(--q-red)" }}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {bannedWords.map((w, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ backgroundColor: "color-mix(in srgb, var(--q-red) 10%, transparent)", color: "var(--q-red)" }}
                  >
                    {w}
                    <button onClick={() => onRemoveWord(i)}><X className="w-3 h-3" /></button>
                  </span>
                ))}
                {bannedWords.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--q-text-placeholder)" }}>Henüz yasaklı kelime eklenmedi</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
