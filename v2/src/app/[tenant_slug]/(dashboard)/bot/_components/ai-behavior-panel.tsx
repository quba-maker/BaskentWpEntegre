import { Settings2, Zap, Globe, MessageSquare, Clock, Shield } from "lucide-react";
import { SettingRow, ToggleSwitch } from "./shared";

// ==========================================
// AI BEHAVIOR PANEL
// Authority: Bot behavior configuration
// Data owner: bot_auto_greeting, bot_greeting_language,
//   bot_max_messages, working_hours, bot_aggression_level
// ==========================================

interface AIBehaviorPanelProps {
  botConfig: {
    auto_greeting: string;
    greeting_language: string;
    max_messages: string;
    working_hours: string;
    aggression_level: string;
  };
  onConfigChange: (key: string, value: string) => void;
}

export function AIBehaviorPanel({ botConfig, onConfigChange }: AIBehaviorPanelProps) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-bold text-[--q-text-primary] mb-4 flex items-center gap-2">
        <Settings2 className="w-5 h-5 text-[--q-text-secondary]" />
        Bot Davranış Ayarları
      </h2>
      
      <div className="bg-white rounded-2xl border border-[--q-border-default] shadow-sm divide-y divide-black/5">
        {/* Auto Greeting */}
        <SettingRow
          icon={Zap}
          iconColor="var(--q-orange)"
          title="Otonom Karşılama"
          description="Yeni lead geldiğinde otomatik WhatsApp mesajı gönder"
        >
          <ToggleSwitch 
            active={botConfig.auto_greeting === "true"} 
            onToggle={() => onConfigChange("auto_greeting", botConfig.auto_greeting === "true" ? "false" : "true")} 
          />
        </SettingRow>

        {/* Greeting Language */}
        <SettingRow
          icon={Globe}
          iconColor="var(--q-blue)"
          title="Karşılama Dili"
          description="Otomatik karşılama mesajının dili"
        >
          <select
            value={botConfig.greeting_language}
            onChange={(e) => onConfigChange("greeting_language", e.target.value)}
            className="px-3 py-1.5 text-sm font-semibold text-[--q-text-primary] bg-black/[0.04] border-0 rounded-lg outline-none cursor-pointer"
          >
            <option value="auto">Otomatik (Numara bazlı)</option>
            <option value="tr">Türkçe</option>
            <option value="en">İngilizce</option>
          </select>
        </SettingRow>

        {/* Max Messages */}
        <SettingRow
          icon={MessageSquare}
          iconColor="var(--q-purple)"
          title="Maksimum Bot Mesaj Sayısı"
          description="Bot kaç mesaj sonra otomatik insana devretsin"
        >
          <select
            value={botConfig.max_messages}
            onChange={(e) => onConfigChange("max_messages", e.target.value)}
            className="px-3 py-1.5 text-sm font-semibold text-[--q-text-primary] bg-black/[0.04] border-0 rounded-lg outline-none cursor-pointer"
          >
            <option value="5">5 mesaj</option>
            <option value="8">8 mesaj</option>
            <option value="12">12 mesaj</option>
            <option value="20">20 mesaj</option>
            <option value="unlimited">Sınırsız</option>
          </select>
        </SettingRow>

        {/* Working Hours */}
        <SettingRow
          icon={Clock}
          iconColor="var(--q-green)"
          title="Çalışma Saatleri"
          description="Botun aktif olacağı zaman dilimi"
        >
          <select
            value={botConfig.working_hours}
            onChange={(e) => onConfigChange("working_hours", e.target.value)}
            className="px-3 py-1.5 text-sm font-semibold text-[--q-text-primary] bg-black/[0.04] border-0 rounded-lg outline-none cursor-pointer"
          >
            <option value="24/7">7/24 Aktif</option>
            <option value="business">Mesai Saatleri (09:00-18:00)</option>
            <option value="after_hours">Mesai Dışı (18:00-09:00)</option>
          </select>
        </SettingRow>

        {/* Aggression Level */}
        <SettingRow
          icon={Shield}
          iconColor="var(--q-red)"
          title="İkna Seviyesi"
          description="Botun satış ve ikna agresiflik düzeyi"
        >
          <div className="flex items-center gap-1 p-0.5 bg-black/[0.04] rounded-lg">
            {[
              { value: "low", label: "Düşük" },
              { value: "medium", label: "Orta" },
              { value: "high", label: "Yüksek" }
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => onConfigChange("aggression_level", opt.value)}
                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                  botConfig.aggression_level === opt.value
                    ? "bg-white text-[--q-text-primary] shadow-sm"
                    : "text-[--q-text-secondary]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </SettingRow>
      </div>
    </div>
  );
}
