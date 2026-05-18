"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bot, MessageSquare, Globe, Hash, Settings2, Zap, Clock,
  Shield, Cpu, Check
} from "lucide-react";
import {
  getBotSettings, saveBotSetting, getDefaultPrompts,
  getBotStats, getModelUsage, getRecentBotConversations, testBotPrompt
} from "@/app/actions/bot";
import { PageLoader } from "@/components/ui/shared-states";
import { PageShell, PageHeader, ToggleSwitch } from "@/components/governance";
import {
  BotPerformancePanel,
  ChannelStatusPanel,
  PromptGovernancePanel,
  KnowledgeBasePanel,
  AIUsageCostPanel,
  ModerationPanel,
  RecentConversationsPanel,
  BotTestPlayground,
  AIPipelinePanel,
  type BotChannel,
} from "./_components";
import { SettingRow } from "./_components/shared";

// ==========================================
// CHANNEL DEFINITIONS
// ==========================================
const channels: BotChannel[] = [
  {
    id: "whatsapp",
    label: "WhatsApp Botu",
    icon: MessageSquare,
    promptKey: "system_prompt_whatsapp",
    activeKey: "channel_whatsapp_enabled",
    color: "var(--q-whatsapp)",
    description: "Ana satış hunisi — Lead karşılama, ikna, randevu dönüşümü"
  },
  {
    id: "instagram",
    label: "Türkçe Sosyal Medya",
    icon: Hash,
    promptKey: "system_prompt_tr",
    activeKey: "channel_instagram_enabled",
    color: "var(--q-instagram)",
    description: "Instagram ve Facebook TR sayfaları için hasta danışmanı"
  },
  {
    id: "foreign",
    label: "Uluslararası Sayfa",
    icon: Globe,
    promptKey: "system_prompt_foreign",
    activeKey: "channel_foreign_enabled",
    color: "var(--q-blue)",
    description: "Yabancı dilde gelen hastalar — Çok dilli otomatik yanıt"
  }
];

// AI MODELS
const AI_MODELS = [
  { id: 'gemini-2.5-flash-lite', name: 'Flash Lite', desc: 'Hızlı & Ekonomik', speed: 95, cost: 20, iq: 60, color: 'var(--q-green)' },
  { id: 'gemini-2.5-flash', name: 'Flash', desc: 'Dengeli (Önerilen)', speed: 85, cost: 40, iq: 85, color: 'var(--q-blue)' },
  { id: 'gemini-2.5-pro', name: 'Pro', desc: 'Güçlü & Pahalı', speed: 50, cost: 90, iq: 98, color: 'var(--q-purple)' },
];

// ==========================================
// PAGE ORCHESTRATOR — UNIFIED BOT MANAGEMENT
// ==========================================
export default function BotManagementPage() {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [defaults, setDefaults] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("whatsapp");
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statsPeriod, setStatsPeriod] = useState("7d");
  const [modelUsage, setModelUsage] = useState<any>(null);
  const [recentConvs, setRecentConvs] = useState<any[]>([]);
  const [bannedWords, setBannedWords] = useState<string[]>([]);

  // Knowledge Base
  const [knowledgePrices, setKnowledgePrices] = useState("");
  const [knowledgeRules, setKnowledgeRules] = useState("");
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  // Consolidated Bot Config (single source of truth)
  const [botConfig, setBotConfig] = useState({
    auto_greeting: "true",
    greeting_language: "auto",
    max_messages: "8",
    working_hours: "24/7",
    aggression_level: "medium",
    ai_model: "gemini-2.5-flash"
  });

  // ---- Data Loading ----
  useEffect(() => {
    async function load() {
      setIsLoading(true);
      const [settingsRes, defaultsRes, statsRes, usageRes, convsRes] = await Promise.all([
        getBotSettings(),
        getDefaultPrompts(),
        getBotStats(),
        getModelUsage('30d'),
        getRecentBotConversations(8)
      ]);

      if (settingsRes.success) {
        setSettings(settingsRes.settings);

        const p: Record<string, string> = {};
        channels.forEach(ch => {
          const s = settingsRes.settings as Record<string, any>;
          p[ch.id] = s[ch.promptKey]?.value || "";
        });
        setPrompts(p);

        // Detect working hours mode from JSON
        let whMode = "24/7";
        try {
          const whJson = JSON.parse(settingsRes.settings['working_hours']?.value || '{}');
          if (whJson.enabled) {
            whMode = whJson.start === "09:00" ? "business" : "after_hours";
          }
        } catch(e) {}

        setBotConfig({
          auto_greeting: settingsRes.settings['bot_auto_greeting']?.value || "true",
          greeting_language: settingsRes.settings['bot_greeting_language']?.value || "auto",
          max_messages: settingsRes.settings['bot_max_messages']?.value || "8",
          working_hours: whMode,
          aggression_level: settingsRes.settings['bot_aggression_level']?.value || "medium",
          ai_model: settingsRes.settings['ai_model']?.value || "gemini-2.5-flash"
        });

        setKnowledgePrices(settingsRes.settings['bot_knowledge_prices']?.value || "");
        setKnowledgeRules(settingsRes.settings['bot_knowledge_rules']?.value || "");
      }

      setDefaults(defaultsRes);
      setStats(statsRes);
      setModelUsage(usageRes);
      setRecentConvs(convsRes);

      if (settingsRes.success && settingsRes.settings['bot_banned_words']?.value) {
        try { setBannedWords(JSON.parse(settingsRes.settings['bot_banned_words'].value)); } catch(e) {}
      }

      setIsLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    async function reloadStats() {
      const statsRes = await getBotStats(statsPeriod);
      setStats(statsRes);
    }
    if (!isLoading) reloadStats();
  }, [statsPeriod]);

  // ---- Action Handlers ----

  const isChannelActive = useCallback((channelId: string) => {
    const ch = channels.find(c => c.id === channelId);
    if (!ch) return false;
    const val = settings[ch.activeKey]?.value;
    if (val === undefined || val === null) return channelId === "whatsapp";
    return val === "true";
  }, [settings]);

  const toggleChannel = async (channelId: string) => {
    const ch = channels.find(c => c.id === channelId)!;
    const newVal = isChannelActive(channelId) ? "false" : "true";
    setSettings(prev => ({
      ...prev,
      [ch.activeKey]: { value: newVal, updated_at: new Date().toISOString() }
    }));
    await saveBotSetting(ch.activeKey, newVal);
  };

  const savePrompt = async (channelId: string) => {
    const ch = channels.find(c => c.id === channelId)!;
    setSaving(channelId);
    await saveBotSetting(ch.promptKey, prompts[channelId] || "");
    setSaving(null);
    setSaved(channelId);
    setTimeout(() => setSaved(null), 2000);
  };

  const resetToDefault = (channelId: string) => {
    if (!defaults) return;
    const defaultMap: Record<string, string> = {
      whatsapp: defaults.whatsapp,
      instagram: defaults.turkish,
      foreign: defaults.foreign
    };
    setPrompts(prev => ({ ...prev, [channelId]: defaultMap[channelId] }));
  };

  const saveKnowledgeBase = async () => {
    setSavingKnowledge(true);
    await saveBotSetting('bot_knowledge_prices', knowledgePrices);
    await saveBotSetting('bot_knowledge_rules', knowledgeRules);
    setSavingKnowledge(false);
    setSaved('knowledge');
    setTimeout(() => setSaved(null), 2000);
  };

  const handleBotConfigChange = async (key: string, value: string) => {
    setBotConfig(prev => ({ ...prev, [key]: value }));
    if (key === 'working_hours') {
      const hoursMap: Record<string, string> = {
        '24/7': '{"enabled":false}',
        'business': '{"enabled":true,"start":"09:00","end":"18:00","offMessage":"Mesai saatlerimiz dışındasınız. En kısa sürede dönüş yapacağız."}',
        'after_hours': '{"enabled":true,"start":"18:00","end":"09:00","offMessage":"Şu an mesai saatlerimiz içindeyiz. Bot mesai dışında aktif olacaktır."}'
      };
      await saveBotSetting('working_hours', hoursMap[value] || '{"enabled":false}');
      return;
    }
    if (key === 'ai_model') {
      await saveBotSetting('ai_model', value);
      return;
    }
    await saveBotSetting(`bot_${key}`, value);
  };

  const handleAddBannedWord = (word: string) => {
    const updated = [...bannedWords, word];
    setBannedWords(updated);
    saveBotSetting('bot_banned_words', JSON.stringify(updated));
  };

  const handleRemoveBannedWord = (index: number) => {
    const updated = bannedWords.filter((_, idx) => idx !== index);
    setBannedWords(updated);
    saveBotSetting('bot_banned_words', JSON.stringify(updated));
  };

  const activeChannel = channels.find(c => c.id === activeTab)!;

  if (isLoading) return <PageLoader />;

  return (
    <PageShell>
      <PageHeader
        icon={Bot}
        title="Bot Yönetimi"
        subtitle="AI asistanlarınızı tek noktadan yapılandırın ve yönetin"
      />

      {/* 1. PERFORMANS */}
      <BotPerformancePanel
        stats={stats}
        statsPeriod={statsPeriod}
        onPeriodChange={setStatsPeriod}
      />

      {/* 2. KANAL YÖNETİMİ */}
      <ChannelStatusPanel
        channels={channels}
        isChannelActive={isChannelActive}
        onToggleChannel={toggleChannel}
        onSelectChannel={setActiveTab}
      />

      {/* 3. PROMPT YÖNETİMİ */}
      <PromptGovernancePanel
        channels={channels}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        prompts={prompts}
        onPromptChange={(channelId, value) => setPrompts(prev => ({ ...prev, [channelId]: value }))}
        settings={settings}
        saving={saving}
        saved={saved}
        onSave={savePrompt}
        onResetToDefault={resetToDefault}
      />

      {/* 4. BOT AYARLARI (Konsolide — tek panel) */}
      <div className="mt-8">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
          <Settings2 className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
          Bot Yapılandırması
        </h2>
        <div className="bg-white rounded-2xl border shadow-sm divide-y divide-black/5" style={{ borderColor: "var(--q-border-default)" }}>
          {/* Auto Greeting */}
          <SettingRow icon={Zap} iconColor="var(--q-orange)" title="Otonom Karşılama" description="Yeni lead geldiğinde otomatik WhatsApp mesajı gönder">
            <ToggleSwitch active={botConfig.auto_greeting === "true"} onToggle={() => handleBotConfigChange("auto_greeting", botConfig.auto_greeting === "true" ? "false" : "true")} />
          </SettingRow>

          {/* Greeting Language */}
          <SettingRow icon={Globe} iconColor="var(--q-blue)" title="Karşılama Dili" description="Otomatik karşılama mesajının dili">
            <select value={botConfig.greeting_language} onChange={e => handleBotConfigChange("greeting_language", e.target.value)} className="px-3 py-1.5 text-sm font-semibold border-0 rounded-lg outline-none cursor-pointer" style={{ color: "var(--q-text-primary)", backgroundColor: "rgba(0,0,0,0.04)" }}>
              <option value="auto">Otomatik</option>
              <option value="tr">Türkçe</option>
              <option value="en">İngilizce</option>
            </select>
          </SettingRow>

          {/* Max Messages */}
          <SettingRow icon={MessageSquare} iconColor="var(--q-purple)" title="Maksimum Bot Mesajı" description="Bot kaç mesaj sonra insana devretsin">
            <select value={botConfig.max_messages} onChange={e => handleBotConfigChange("max_messages", e.target.value)} className="px-3 py-1.5 text-sm font-semibold border-0 rounded-lg outline-none cursor-pointer" style={{ color: "var(--q-text-primary)", backgroundColor: "rgba(0,0,0,0.04)" }}>
              <option value="5">5</option>
              <option value="8">8</option>
              <option value="12">12</option>
              <option value="20">20</option>
              <option value="0">Sınırsız</option>
            </select>
          </SettingRow>

          {/* Working Hours */}
          <SettingRow icon={Clock} iconColor="var(--q-green)" title="Çalışma Saatleri" description="Botun aktif olacağı zaman dilimi">
            <select value={botConfig.working_hours} onChange={e => handleBotConfigChange("working_hours", e.target.value)} className="px-3 py-1.5 text-sm font-semibold border-0 rounded-lg outline-none cursor-pointer" style={{ color: "var(--q-text-primary)", backgroundColor: "rgba(0,0,0,0.04)" }}>
              <option value="24/7">7/24 Aktif</option>
              <option value="business">Mesai (09-18)</option>
              <option value="after_hours">Mesai Dışı (18-09)</option>
            </select>
          </SettingRow>

          {/* Aggression Level */}
          <SettingRow icon={Shield} iconColor="var(--q-red)" title="İkna Seviyesi" description="Botun satış agresiflik düzeyi">
            <div className="flex items-center gap-1 p-0.5 bg-black/[0.04] rounded-lg">
              {[
                { value: "low", label: "Düşük" },
                { value: "medium", label: "Orta" },
                { value: "high", label: "Yüksek" }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleBotConfigChange("aggression_level", opt.value)}
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

          {/* AI Model — Inline */}
          <SettingRow icon={Cpu} iconColor="var(--q-purple-alt)" title="Yapay Zeka Modeli" description="AI yanıtları için kullanılacak model">
            <div className="flex items-center gap-1.5">
              {AI_MODELS.map(m => {
                const isActive = botConfig.ai_model === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => handleBotConfigChange("ai_model", m.id)}
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

      {/* 5. BİLGİ BANKASI */}
      <KnowledgeBasePanel
        knowledgePrices={knowledgePrices}
        knowledgeRules={knowledgeRules}
        onPricesChange={setKnowledgePrices}
        onRulesChange={setKnowledgeRules}
        saving={savingKnowledge}
        saved={saved === 'knowledge'}
        onSave={saveKnowledgeBase}
      />

      {/* 6. YASAKLI KELİMELER */}
      <ModerationPanel
        bannedWords={bannedWords}
        onAddWord={handleAddBannedWord}
        onRemoveWord={handleRemoveBannedWord}
      />

      {/* 7. AI PIPELINE MODÜLLERI */}
      <AIPipelinePanel />

      {/* 8. AI KULLANIM & MALİYET */}
      <AIUsageCostPanel modelUsage={modelUsage} />

      {/* 9. SON KONUŞMALAR */}
      <RecentConversationsPanel conversations={recentConvs} />

      {/* 10. TEST PLAYGROUND */}
      <BotTestPlayground
        activeChannel={activeChannel}
        currentPrompt={prompts[activeTab] || ""}
        activeTab={activeTab}
        onTestPrompt={testBotPrompt}
      />
    </PageShell>
  );
}
