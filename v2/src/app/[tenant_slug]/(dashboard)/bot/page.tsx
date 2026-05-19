"use client";

import { useState, useEffect, useCallback } from "react";
import { Bot, MessageSquare, Globe, Hash } from "lucide-react";
import {
  getBotSettings, saveBotSetting, getDefaultPrompts,
  getBotStats, getModelUsage, getRecentBotConversations, testBotPrompt
} from "@/app/actions/bot";
import { PageLoader } from "@/components/ui/shared-states";
import { PageShell, PageHeader } from "@/components/governance";
import {
  BotPerformancePanel,
  ChannelStatusPanel,
  PromptGovernancePanel,
  RecentConversationsPanel,
  BotTestPlayground,
  UnifiedSettingsPanel,
  type BotChannel,
} from "./_components";

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
  // Knowledge Base (Global)
  const [knowledgePrices, setKnowledgePrices] = useState("");
  const [knowledgeRules, setKnowledgeRules] = useState("");

  // Consolidated Bot Config (single source of truth)
  const [botConfig, setBotConfig] = useState({
    auto_greeting: "true",
    greeting_language: "auto",
    max_messages: "8",
    max_response_tokens: "1000",
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
          max_response_tokens: settingsRes.settings['bot_max_response_tokens']?.value || "1000",
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

      setIsLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    async function reloadStats() {
      const [statsRes, usageRes] = await Promise.all([
        getBotStats(statsPeriod),
        getModelUsage(statsPeriod)
      ]);
      setStats(statsRes);
      setModelUsage(usageRes);
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
    
    setSettings(prev => ({
      ...prev,
      [ch.promptKey]: { 
        ...(prev[ch.promptKey] || {}), 
        value: prompts[channelId] || "", 
        updated_at: new Date().toISOString() 
      }
    }));

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
    await saveBotSetting('bot_knowledge_prices', knowledgePrices);
    await saveBotSetting('bot_knowledge_rules', knowledgeRules);
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
        modelUsage={modelUsage}
      />

      {/* 2. KANAL YÖNETİMİ */}
      <ChannelStatusPanel
        channels={channels}
        isChannelActive={isChannelActive}
        onToggleChannel={toggleChannel}
        onSelectChannel={setActiveTab}
      />

      {/* 3 & 4. PROMPT YÖNETİMİ VE TEST (Yan Yana) */}
      <div className="mt-8 grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2">
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
            knowledgePrices={knowledgePrices}
            knowledgeRules={knowledgeRules}
            onPricesChange={setKnowledgePrices}
            onRulesChange={setKnowledgeRules}
            onSaveKnowledge={saveKnowledgeBase}
          />
        </div>
        <div className="xl:col-span-1 sticky top-6">
          <BotTestPlayground
            activeChannel={activeChannel}
            currentPrompt={prompts[activeTab] || ""}
            activeTab={activeTab}
            onTestPrompt={testBotPrompt}
          />
        </div>
      </div>

      {/* 5. BOT AYARLARI */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <UnifiedSettingsPanel
          botConfig={botConfig}
          onBotConfigChange={handleBotConfigChange}
        />
        <RecentConversationsPanel conversations={recentConvs} />
      </div>
    </PageShell>
  );
}
