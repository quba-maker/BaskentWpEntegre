"use client";

import { useState } from "react";
import {
  Settings2, Zap, Globe, MessageSquare, Clock, Shield, Cpu, Check,
  BookOpen, ShieldAlert, Plus, X
} from "lucide-react";
import { ToggleSwitch } from "@/components/governance";
import { SettingRow } from "./shared";

// ==========================================
// UNIFIED SETTINGS PANEL
// Authority: General bot configuration (models, hours, aggression)
// ==========================================

const AI_MODELS = [
  { id: 'gemini-2.5-flash-lite', name: 'Flash Lite', color: 'var(--q-green)' },
  { id: 'gemini-2.5-flash', name: 'Flash', color: 'var(--q-blue)' },
  { id: 'gemini-2.5-pro', name: 'Pro', color: 'var(--q-purple)' },
];

interface UnifiedSettingsPanelProps {
  botConfig: {
    auto_greeting: string;
    greeting_language: string;
    max_messages: string;
    working_hours: string;
    aggression_level: string;
    ai_model: string;
  };
  onBotConfigChange: (key: string, value: string) => void;
}

export function UnifiedSettingsPanel({
  botConfig, onBotConfigChange
}: UnifiedSettingsPanelProps) {

  return (
    <div className="mt-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
        <Settings2 className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
        Bot Ayarları
      </h2>

      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: "var(--q-border-default)" }}>
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
      </div>
    </div>
  );
}
