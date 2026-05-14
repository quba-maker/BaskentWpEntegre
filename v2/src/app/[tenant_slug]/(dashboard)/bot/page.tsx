"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  Bot, Save, RotateCcw, MessageSquare, Globe, Hash,
  Zap, Clock, Shield, ChevronRight, Check, X, AlertTriangle,
  Activity, Users, Timer, TrendingUp, Settings2, Power,
  Cpu, DollarSign, MessagesSquare, ShieldAlert, FlaskConical,
  Send, Loader2, Tag, Plus, Trash2
} from "lucide-react";
import { getBotSettings, saveBotSetting, getDefaultPrompts, getBotStats, getModelUsage, getRecentBotConversations, testBotPrompt } from "@/app/actions/bot";

// ==========================================
// TYPES
// ==========================================
interface BotChannel {
  id: string;
  label: string;
  icon: any;
  promptKey: string;
  activeKey: string;
  color: string;
  description: string;
}

const channels: BotChannel[] = [
  {
    id: "whatsapp",
    label: "WhatsApp Botu",
    icon: MessageSquare,
    promptKey: "system_prompt_whatsapp",
    activeKey: "channel_whatsapp_enabled",
    color: "#25D366",
    description: "Ana satış hunisi — Lead karşılama, ikna, randevu dönüşümü"
  },
  {
    id: "instagram",
    label: "Türkçe Sosyal Medya",
    icon: Hash,
    promptKey: "system_prompt_tr",
    activeKey: "channel_instagram_enabled",
    color: "#E1306C",
    description: "Instagram ve Facebook TR sayfaları için hasta danışmanı"
  },
  {
    id: "foreign",
    label: "Uluslararası Sayfa",
    icon: Globe,
    promptKey: "system_prompt_foreign",
    activeKey: "channel_foreign_enabled",
    color: "#007AFF",
    description: "Yabancı dilde gelen hastalar — Çok dilli otomatik yanıt"
  }
];

// ==========================================
// MAIN COMPONENT
// ==========================================
export default function BotManagementPage() {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [forensicData, setForensicData] = useState<any>(null);
  const [defaults, setDefaults] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("whatsapp");
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statsPeriod, setStatsPeriod] = useState("7d");
  const [modelUsage, setModelUsage] = useState<any>(null);
  const [recentConvs, setRecentConvs] = useState<any[]>([]);
  const [bannedWords, setBannedWords] = useState<string[]>([]);
  const [newBannedWord, setNewBannedWord] = useState("");
  const [testMsg, setTestMsg] = useState("");
  const [testReply, setTestReply] = useState("");
  const [testing, setTesting] = useState(false);
  const [knowledgePrices, setKnowledgePrices] = useState("");
  const [knowledgeRules, setKnowledgeRules] = useState("");
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  // Bot behavior settings
  const [botConfig, setBotConfig] = useState({
    auto_greeting: "true",
    greeting_language: "auto",
    max_messages: "8",
    working_hours: "24/7",
    aggression_level: "medium"
  });

  // Load data
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

      if (settingsRes) {
        setForensicData(settingsRes);
      }

      if (settingsRes.success) {
        setSettings(settingsRes.settings);
        
        // Set prompts from DB or defaults
        const p: Record<string, string> = {};
        channels.forEach(ch => {
          const s = settingsRes.settings as Record<string, any>;
          p[ch.id] = s[ch.promptKey]?.value || "";
        });
        setPrompts(p);

        // Set bot config from DB
        setBotConfig({
          auto_greeting: settingsRes.settings['bot_auto_greeting']?.value || "true",
          greeting_language: settingsRes.settings['bot_greeting_language']?.value || "auto",
          max_messages: settingsRes.settings['bot_max_messages']?.value || "8",
          working_hours: settingsRes.settings['bot_working_hours']?.value || "24/7",
          aggression_level: settingsRes.settings['bot_aggression_level']?.value || "medium"
        });

        // Set knowledge base from DB
        setKnowledgePrices(settingsRes.settings['bot_knowledge_prices']?.value || "");
        setKnowledgeRules(settingsRes.settings['bot_knowledge_rules']?.value || "");
      }

      setDefaults(defaultsRes);
      setStats(statsRes);
      setModelUsage(usageRes);
      setRecentConvs(convsRes);

      // Banned words
      if (settingsRes.success && settingsRes.settings['bot_banned_words']?.value) {
        try { setBannedWords(JSON.parse(settingsRes.settings['bot_banned_words'].value)); } catch(e) {}
      }

      setIsLoading(false);
    }
    load();
  }, []);

  // Reload stats when period changes
  useEffect(() => {
    async function reloadStats() {
      const statsRes = await getBotStats(statsPeriod);
      setStats(statsRes);
    }
    if (!isLoading) reloadStats();
  }, [statsPeriod]);

  // Is channel active
  const isChannelActive = useCallback((channelId: string) => {
    const ch = channels.find(c => c.id === channelId);
    if (!ch) return false;
    const val = settings[ch.activeKey]?.value;
    if (val === undefined || val === null) {
      // Defaults: WhatsApp active, others inactive
      return channelId === "whatsapp";
    }
    return val === "true";
  }, [settings]);

  // Toggle channel
  const toggleChannel = async (channelId: string) => {
    const ch = channels.find(c => c.id === channelId)!;
    const newVal = isChannelActive(channelId) ? "false" : "true";
    
    // Optimistic update
    setSettings(prev => ({
      ...prev,
      [ch.activeKey]: { value: newVal, updated_at: new Date().toISOString() }
    }));
    
    await saveBotSetting(ch.activeKey, newVal);
  };

  // Save prompt
  const savePrompt = async (channelId: string) => {
    const ch = channels.find(c => c.id === channelId)!;
    setSaving(channelId);
    
    await saveBotSetting(ch.promptKey, prompts[channelId] || "");
    
    setSaving(null);
    setSaved(channelId);
    setTimeout(() => setSaved(null), 2000);
  };

  // Reset to default
  const resetToDefault = async (channelId: string) => {
    if (!defaults) return;
    const defaultMap: Record<string, string> = {
      whatsapp: defaults.whatsapp,
      instagram: defaults.turkish,
      foreign: defaults.foreign
    };
    
    setPrompts(prev => ({ ...prev, [channelId]: defaultMap[channelId] }));
    setShowResetConfirm(null);
  };

  // Save Knowledge Base
  const saveKnowledgeBase = async () => {
    setSavingKnowledge(true);
    await saveBotSetting('bot_knowledge_prices', knowledgePrices);
    await saveBotSetting('bot_knowledge_rules', knowledgeRules);
    setSavingKnowledge(false);
    alert("Bilgi bankası kaydedildi.");
  };

  // Save bot config
  const saveBotConfig = async (key: string, value: string) => {
    setBotConfig(prev => ({ ...prev, [key]: value }));
    
    // Çalışma saatleri: Backend JSON formatı bekliyor
    if (key === 'working_hours') {
      const hoursMap: Record<string, string> = {
        '24/7': '{"enabled":false}',
        'business': '{"enabled":true,"start":"09:00","end":"18:00","offMessage":"Mesai saatlerimiz dışındasınız. En kısa sürede dönüş yapacağız."}',
        'after_hours': '{"enabled":true,"start":"18:00","end":"09:00","offMessage":"Şu an mesai saatlerimiz içindeyiz. Bot mesai dışında aktif olacaktır."}'
      };
      await saveBotSetting('working_hours', hoursMap[value] || '{"enabled":false}');
      return;
    }
    
    await saveBotSetting(`bot_${key}`, value);
  };

  const activeChannel = channels.find(c => c.id === activeTab)!;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[#86868B] font-medium">Bot ayarları yükleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 h-full flex flex-col relative overflow-y-auto">
      {/* Background */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#5856D6]/5 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#007AFF]/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* FORENSIC DEBUG PANEL */}
      {forensicData && (
        <div className="mb-8 p-4 bg-red-50 border-2 border-red-500 rounded-xl">
          <h2 className="text-red-700 font-bold mb-2">🔥 FORENSIC RUNTIME DUMP</h2>
          <pre className="text-[11px] font-mono text-red-900 whitespace-pre-wrap break-all">
            {JSON.stringify(forensicData, null, 2)}
          </pre>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#5856D6] to-[#007AFF] flex items-center justify-center shadow-lg">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#1D1D1F]">Bot Yönetimi</h1>
              <p className="text-[#86868B] text-sm font-medium">AI asistanlarınızı yapılandırın ve yönetin</p>
            </div>
          </div>
          <a
            href="bot/modules"
            className="flex items-center gap-2 px-4 py-2.5 bg-[#AF52DE] hover:bg-[#9A44C8] text-white text-[13px] font-semibold rounded-xl transition-all"
          >
            <Cpu className="w-4 h-4" /> AI Modülleri
          </a>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-[#1D1D1F] flex items-center gap-2">
              <Activity className="w-5 h-5 text-[#86868B]" />
              Bot Performansı
            </h2>
            {/* Apple-style Segmented Control */}
            <div className="flex items-center gap-0.5 p-[3px] bg-black/[0.06] rounded-lg">
              {[
                { value: "7d", label: "7 Gün" },
                { value: "30d", label: "30 Gün" },
                { value: "90d", label: "90 Gün" },
                { value: "all", label: "Tümü" }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setStatsPeriod(opt.value)}
                  className={`px-3 py-1 text-[12px] font-semibold rounded-md transition-all duration-200 ${
                    statsPeriod === opt.value
                      ? "bg-white text-[#1D1D1F] shadow-sm"
                      : "text-[#86868B] hover:text-[#1D1D1F]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Activity} label="Bot Mesajı" value={stats.weeklyMessages} color="#007AFF" />
            <StatCard icon={TrendingUp} label="Bot Başarı Oranı" value={`%${stats.botSuccessRate}`} color="#34C759" />
            <StatCard icon={Users} label="İnsana Devir" value={`%${stats.handoverRate}`} color="#FF9500" />
            <StatCard icon={Timer} label="Ort. Yanıt Süresi" value={stats.avgResponseMin > 0 ? `${stats.avgResponseMin} dk` : "<1 dk"} color="#5856D6" />
          </div>
        </div>
      )}

      {/* Channel Toggles — Bot Aktiflik Kontrolleri */}
      <div className="mb-8">
        <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
          <Power className="w-5 h-5 text-[#86868B]" />
          Kanal Durumları
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {channels.map(ch => {
            const active = isChannelActive(ch.id);
            const Icon = ch.icon;
            return (
              <div 
                key={ch.id} 
                className={`relative rounded-2xl border p-5 transition-all duration-300 cursor-pointer group ${
                  active 
                    ? "bg-white border-black/5 shadow-sm" 
                    : "bg-black/[0.02] border-black/5 opacity-60"
                }`}
                onClick={() => setActiveTab(ch.id)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-9 h-9 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: `${ch.color}15` }}
                    >
                      <Icon className="w-4.5 h-4.5" style={{ color: ch.color }} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#1D1D1F]">{ch.label}</p>
                      <p className="text-[11px] text-[#86868B] font-medium">{ch.description}</p>
                    </div>
                  </div>
                  
                  {/* Toggle Switch */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleChannel(ch.id); }}
                    className={`relative w-[51px] h-[31px] rounded-full transition-colors duration-300 shrink-0 ${
                      active ? "bg-[#34C759]" : "bg-[#E5E5EA]"
                    }`}
                  >
                    <div className={`absolute top-[2px] w-[27px] h-[27px] bg-white rounded-full shadow-md transition-transform duration-300 ${
                      active ? "translate-x-[22px]" : "translate-x-[2px]"
                    }`} />
                  </button>
                </div>
                
                {/* Status Badge */}
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${active ? "bg-[#34C759] animate-pulse" : "bg-[#8E8E93]"}`} />
                  <span className={`text-[11px] font-semibold uppercase tracking-wider ${active ? "text-[#34C759]" : "text-[#8E8E93]"}`}>
                    {active ? "Aktif" : "Devre Dışı"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Prompt Editor Section */}
      <div className="flex-1 flex flex-col">
        {/* Tab Bar */}
        <div className="flex items-center gap-1 p-1 bg-black/[0.04] rounded-xl mb-6 w-fit">
          {channels.map(ch => {
            const Icon = ch.icon;
            return (
              <button
                key={ch.id}
                onClick={() => setActiveTab(ch.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
                  activeTab === ch.id
                    ? "bg-white text-[#1D1D1F] shadow-sm"
                    : "text-[#86868B] hover:text-[#1D1D1F]"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden md:inline">{ch.label}</span>
              </button>
            );
          })}
        </div>

        {/* Editor Card */}
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden flex-1 flex flex-col">
          {/* Editor Header */}
          <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${activeChannel.color}15` }}
              >
                <activeChannel.icon className="w-4 h-4" style={{ color: activeChannel.color }} />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1D1D1F]">{activeChannel.label} Prompt</h3>
                <p className="text-[11px] text-[#86868B] font-medium">
                  {settings[activeChannel.promptKey]?.updated_at 
                    ? `Son güncelleme: ${new Date(settings[activeChannel.promptKey].updated_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                    : "Varsayılan prompt kullanılıyor"
                  }
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Reset Button */}
              <button
                onClick={() => setShowResetConfirm(activeTab)}
                className="px-3 py-1.5 text-xs font-semibold text-[#FF9500] bg-[#FF9500]/10 border border-[#FF9500]/20 rounded-lg hover:bg-[#FF9500]/20 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Varsayılana Dön
              </button>

              {/* Save Button */}
              <button
                onClick={() => savePrompt(activeTab)}
                disabled={saving === activeTab}
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  saved === activeTab
                    ? "bg-[#34C759] text-white"
                    : "bg-[#007AFF] text-white hover:bg-[#0056CC] shadow-sm"
                }`}
              >
                {saving === activeTab ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : saved === activeTab ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {saved === activeTab ? "Kaydedildi!" : "Kaydet"}
              </button>
            </div>
          </div>

          {/* Textarea */}
          <div className="flex-1 p-0">
            <textarea
              value={prompts[activeTab] || ""}
              onChange={(e) => setPrompts(prev => ({ ...prev, [activeTab]: e.target.value }))}
              className="w-full h-full min-h-[400px] p-6 text-[13px] leading-relaxed font-mono text-[#1D1D1F] bg-[#FAFAFA] border-0 outline-none resize-none placeholder:text-[#C7C7CC]"
              placeholder={`${activeChannel.label} için sistem prompt'unu buraya yazın...`}
              spellCheck={false}
            />
          </div>
        </div>
      </div>

      {/* Knowledge Base Section */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[#1D1D1F] flex items-center gap-2">
            <Globe className="w-5 h-5 text-[#86868B]" />
            Bot Bilgi Bankası (Kolay Yönetim)
          </h2>
          <button
            onClick={saveKnowledgeBase}
            disabled={savingKnowledge}
            className="px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 bg-[#34C759] text-white shadow-sm hover:opacity-90"
          >
            {savingKnowledge ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Bilgileri Kaydet
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Fiyat Listesi */}
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-0 flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-black/5 bg-black/[0.02]">
              <h3 className="text-sm font-bold text-[#1D1D1F]">Fiyat Listesi ve Hizmetler</h3>
              <p className="text-[11px] text-[#86868B]">Kurumun fiyat listesini buraya yapıştırın.</p>
            </div>
            <textarea
              value={knowledgePrices}
              onChange={(e) => setKnowledgePrices(e.target.value)}
              className="flex-1 p-5 min-h-[200px] text-[13px] font-medium text-[#1D1D1F] bg-transparent outline-none resize-none placeholder:text-[#C7C7CC]"
              placeholder="Örn:&#10;- Lazer Epilasyon (Tüm Vücut): 2500 TL&#10;- Cilt Bakımı: 1000 TL"
            />
          </div>

          {/* SSS ve Kurallar */}
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-0 flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-black/5 bg-black/[0.02]">
              <h3 className="text-sm font-bold text-[#1D1D1F]">Sıkça Sorulan Sorular / Kurallar</h3>
              <p className="text-[11px] text-[#86868B]">Hastaların sık sorduğu soruları ve cevapları yazın.</p>
            </div>
            <textarea
              value={knowledgeRules}
              onChange={(e) => setKnowledgeRules(e.target.value)}
              className="flex-1 p-5 min-h-[200px] text-[13px] font-medium text-[#1D1D1F] bg-transparent outline-none resize-none placeholder:text-[#C7C7CC]"
              placeholder="Örn:&#10;S: Taksit yapıyor musunuz?&#10;C: Kredi kartlarına vade farksız 3 taksit imkanımız var.&#10;&#10;KURAL: Muayene ücretsizdir ancak randevu alınması zorunludur."
            />
          </div>
        </div>
      </div>

      {/* Bot Behavior Settings */}
      <div className="mt-8">
        <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-[#86868B]" />
          Bot Davranış Ayarları
        </h2>
        
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm divide-y divide-black/5">
          {/* Auto Greeting */}
          <SettingRow
            icon={Zap}
            iconColor="#FF9500"
            title="Otonom Karşılama"
            description="Yeni lead geldiğinde otomatik WhatsApp mesajı gönder"
          >
            <ToggleSwitch 
              active={botConfig.auto_greeting === "true"} 
              onToggle={() => saveBotConfig("auto_greeting", botConfig.auto_greeting === "true" ? "false" : "true")} 
            />
          </SettingRow>

          {/* Greeting Language */}
          <SettingRow
            icon={Globe}
            iconColor="#007AFF"
            title="Karşılama Dili"
            description="Otomatik karşılama mesajının dili"
          >
            <select
              value={botConfig.greeting_language}
              onChange={(e) => saveBotConfig("greeting_language", e.target.value)}
              className="px-3 py-1.5 text-sm font-semibold text-[#1D1D1F] bg-black/[0.04] border-0 rounded-lg outline-none cursor-pointer"
            >
              <option value="auto">Otomatik (Numara bazlı)</option>
              <option value="tr">Türkçe</option>
              <option value="en">İngilizce</option>
            </select>
          </SettingRow>

          {/* Max Messages */}
          <SettingRow
            icon={MessageSquare}
            iconColor="#5856D6"
            title="Maksimum Bot Mesaj Sayısı"
            description="Bot kaç mesaj sonra otomatik insana devretsin"
          >
            <select
              value={botConfig.max_messages}
              onChange={(e) => saveBotConfig("max_messages", e.target.value)}
              className="px-3 py-1.5 text-sm font-semibold text-[#1D1D1F] bg-black/[0.04] border-0 rounded-lg outline-none cursor-pointer"
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
            iconColor="#34C759"
            title="Çalışma Saatleri"
            description="Botun aktif olacağı zaman dilimi"
          >
            <select
              value={botConfig.working_hours}
              onChange={(e) => saveBotConfig("working_hours", e.target.value)}
              className="px-3 py-1.5 text-sm font-semibold text-[#1D1D1F] bg-black/[0.04] border-0 rounded-lg outline-none cursor-pointer"
            >
              <option value="24/7">7/24 Aktif</option>
              <option value="business">Mesai Saatleri (09:00-18:00)</option>
              <option value="after_hours">Mesai Dışı (18:00-09:00)</option>
            </select>
          </SettingRow>

          {/* Aggression Level */}
          <SettingRow
            icon={Shield}
            iconColor="#FF3B30"
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
                  onClick={() => saveBotConfig("aggression_level", opt.value)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                    botConfig.aggression_level === opt.value
                      ? "bg-white text-[#1D1D1F] shadow-sm"
                      : "text-[#86868B]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </SettingRow>
        </div>
      </div>

      {/* AI Model Selection */}
      <div className="mt-8">
        <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-[#86868B]" />
          Yapay Zeka Modeli
        </h2>
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { id: 'gemini-2.5-flash-lite', name: 'Flash Lite', desc: 'Hızlı & Ekonomik', speed: 95, cost: 20, iq: 60, color: '#34C759' },
              { id: 'gemini-2.5-flash', name: 'Flash', desc: 'Dengeli (Önerilen)', speed: 85, cost: 40, iq: 85, color: '#007AFF' },
              { id: 'gemini-2.5-pro', name: 'Pro', desc: 'Güçlü & Pahalı', speed: 50, cost: 90, iq: 98, color: '#5856D6' }
            ].map(m => {
              const currentModel = settings['ai_model']?.value || 'gemini-2.5-flash';
              const isActive = currentModel === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setSettings((prev: any) => ({...prev, ai_model: {value: m.id}}));
                    saveBotSetting('ai_model', m.id);
                  }}
                  className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                    isActive ? 'border-[' + m.color + '] bg-[' + m.color + ']/5' : 'border-black/5 hover:border-black/10'
                  }`}
                >
                  {isActive && <div className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center" style={{backgroundColor: m.color}}><Check className="w-3 h-3 text-white" /></div>}
                  <p className="text-sm font-bold text-[#1D1D1F] mb-0.5">{m.name}</p>
                  <p className="text-[11px] text-[#86868B] mb-3">{m.desc}</p>
                  <div className="space-y-1.5">
                    {[{label: 'Hız', val: m.speed}, {label: 'Zeka', val: m.iq}, {label: 'Maliyet', val: m.cost}].map(bar => (
                      <div key={bar.label} className="flex items-center gap-2">
                        <span className="text-[10px] text-[#86868B] w-10">{bar.label}</span>
                        <div className="flex-1 h-1.5 bg-black/5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{width: `${bar.val}%`, backgroundColor: m.color}} />
                        </div>
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* AI Model Usage & Cost */}
      {modelUsage && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[#86868B]" />
            AI Kullanım & Maliyet
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Model Breakdown */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
              <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-3">Model Dağılımı</p>
              {Object.entries(modelUsage.models).length > 0 ? Object.entries(modelUsage.models).map(([key, val]: [string, any]) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-black/5 last:border-0">
                  <div>
                    <p className="text-sm font-bold text-[#1D1D1F]">{val.label || key}</p>
                    <p className="text-[11px] text-[#86868B]">{val.count} mesaj</p>
                  </div>
                  <p className="text-sm font-bold text-[#34C759]">${val.cost.toFixed(3)}</p>
                </div>
              )) : <p className="text-sm text-[#86868B]">Henüz veri yok</p>}
              <div className="mt-3 pt-3 border-t border-black/5 flex justify-between">
                <p className="text-sm font-bold text-[#1D1D1F]">Toplam</p>
                <p className="text-lg font-bold text-[#007AFF]">${modelUsage.totalCost}</p>
              </div>
            </div>
            {/* Channel Breakdown */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
              <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-3">Kanal Dağılımı</p>
              {Object.entries(modelUsage.channels).length > 0 ? Object.entries(modelUsage.channels).map(([ch, count]: [string, any]) => {
                const pct = modelUsage.totalMessages > 0 ? Math.round((count / modelUsage.totalMessages) * 100) : 0;
                const colors: Record<string, string> = {whatsapp: '#25D366', instagram: '#E1306C', messenger: '#007AFF'};
                return (
                  <div key={ch} className="mb-3 last:mb-0">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-semibold text-[#1D1D1F] capitalize">{ch}</span>
                      <span className="text-xs font-bold text-[#86868B]">{count} (%{pct})</span>
                    </div>
                    <div className="h-2 bg-black/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{width: `${pct}%`, backgroundColor: colors[ch] || '#86868B'}} />
                    </div>
                  </div>
                );
              }) : <p className="text-sm text-[#86868B]">Henüz veri yok</p>}
              <div className="mt-3 pt-3 border-t border-black/5">
                <p className="text-xs text-[#86868B]">Toplam: <span className="font-bold text-[#1D1D1F]">{modelUsage.totalMessages} mesaj</span></p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Banned Words */}
      <div className="mt-8">
        <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-[#86868B]" />
          Yasaklı Kelimeler
        </h2>
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <p className="text-xs text-[#86868B] mb-3">Bot bu kelimeleri ASLA kullanmayacak. Prompt'a otomatik enjekte edilir.</p>
          <div className="flex items-center gap-2 mb-4">
            <input
              type="text" value={newBannedWord}
              onChange={e => setNewBannedWord(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newBannedWord.trim()) {
                const updated = [...bannedWords, newBannedWord.trim()];
                setBannedWords(updated); setNewBannedWord('');
                saveBotSetting('bot_banned_words', JSON.stringify(updated));
              }}}
              placeholder="Kelime ekle..."
              className="flex-1 px-3 py-2 text-sm bg-black/[0.03] border-0 rounded-lg outline-none placeholder:text-[#C7C7CC]"
            />
            <button onClick={() => { if (newBannedWord.trim()) {
              const updated = [...bannedWords, newBannedWord.trim()];
              setBannedWords(updated); setNewBannedWord('');
              saveBotSetting('bot_banned_words', JSON.stringify(updated));
            }}} className="px-3 py-2 bg-[#FF3B30] text-white rounded-lg text-sm font-bold"><Plus className="w-4 h-4" /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            {bannedWords.map((w, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#FF3B30]/10 text-[#FF3B30] rounded-lg text-xs font-bold">
                {w}
                <button onClick={() => {
                  const updated = bannedWords.filter((_, idx) => idx !== i);
                  setBannedWords(updated);
                  saveBotSetting('bot_banned_words', JSON.stringify(updated));
                }}><X className="w-3 h-3" /></button>
              </span>
            ))}
            {bannedWords.length === 0 && <p className="text-xs text-[#C7C7CC]">Henüz yasaklı kelime eklenmedi</p>}
          </div>
        </div>
      </div>

      {/* Recent Bot Conversations */}
      {recentConvs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
            <MessagesSquare className="w-5 h-5 text-[#86868B]" />
            Son Bot Konuşmaları
          </h2>
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm divide-y divide-black/5">
            {recentConvs.map((c, i) => {
              const channelColors: Record<string, string> = {whatsapp: '#25D366', instagram: '#E1306C', messenger: '#007AFF'};
              const phaseLabels: Record<string, string> = {greeting:'Karşılama', discovery:'Keşif', trust:'Güven', time_confirm:'Zaman', handover:'Devir'};
              const tempColors: Record<string, string> = {cold:'#007AFF', warm:'#FF9500', hot:'#FF3B30'};
              return (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{backgroundColor: (channelColors[c.channel] || '#86868B') + '15'}}>
                      <MessageSquare className="w-3.5 h-3.5" style={{color: channelColors[c.channel] || '#86868B'}} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[#1D1D1F] truncate">{c.name}</p>
                        {c.department && <span className="text-[10px] px-1.5 py-0.5 bg-[#5856D6]/10 text-[#5856D6] rounded font-semibold shrink-0">{c.department}</span>}
                      </div>
                      <p className="text-[11px] text-[#86868B] truncate">{c.lastMessage || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{backgroundColor: (tempColors[c.temperature] || '#86868B') + '15', color: tempColors[c.temperature] || '#86868B'}}>
                      {phaseLabels[c.phase] || c.phase || '—'}
                    </span>
                    <span className="text-[11px] text-[#86868B] font-medium">{c.botMsgCount} bot</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bot Test Playground */}
      <div className="mt-8 mb-8">
        <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-[#86868B]" />
          Bot Test
        </h2>
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          {/* Active channel indicator */}
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{backgroundColor: `${activeChannel.color}15`}}>
              <activeChannel.icon className="w-3 h-3" style={{color: activeChannel.color}} />
            </div>
            <p className="text-xs text-[#86868B]">
              <span className="font-bold text-[#1D1D1F]">{activeChannel.label}</span> prompt'unu test ediyorsunuz. Yukarıdaki sekmelerden kanal değiştirin.
            </p>
          </div>
          
          <div className="flex items-center gap-2 mb-4">
            <input
              type="text" value={testMsg}
              onChange={e => setTestMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && testMsg.trim() && !testing) {
                setTesting(true); setTestReply('');
                testBotPrompt(prompts[activeTab] || '', testMsg, activeTab).then(r => { setTestReply(r.reply); setTesting(false); });
              }}}
              placeholder="Test mesajı yazın... (örn: Bel fıtığım var)"
              className="flex-1 px-4 py-2.5 text-sm bg-black/[0.03] border-0 rounded-xl outline-none placeholder:text-[#C7C7CC]"
            />
            <button
              onClick={() => {
                if (!testMsg.trim() || testing) return;
                setTesting(true); setTestReply('');
                testBotPrompt(prompts[activeTab] || '', testMsg, activeTab).then(r => { setTestReply(r.reply); setTesting(false); });
              }}
              disabled={testing || !testMsg.trim()}
              className="px-4 py-2.5 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"
              style={{backgroundColor: activeChannel.color}}
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Test Et
            </button>
          </div>
          {testReply && (
            <div className="p-4 bg-[#F5F5F7] rounded-xl border border-black/5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#5856D6] to-[#007AFF] flex items-center justify-center">
                  <Bot className="w-3 h-3 text-white" />
                </div>
                <p className="text-[11px] font-bold text-[#86868B]">Bot Yanıtı ({activeChannel.label})</p>
              </div>
              <p className="text-sm text-[#1D1D1F] leading-relaxed whitespace-pre-wrap">{testReply}</p>
            </div>
          )}
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={() => setShowResetConfirm(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full pointer-events-auto animate-in zoom-in-95">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-[#FF9500]/10 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-[#FF9500]" />
                </div>
                <div>
                  <h3 className="font-bold text-[#1D1D1F]">Varsayılana Dön</h3>
                  <p className="text-xs text-[#86868B]">Mevcut prompt silinecek</p>
                </div>
              </div>
              <p className="text-sm text-[#3C3C43] mb-6">
                Başkent Hastanesi varsayılan prompt'u yüklenecek. Mevcut düzenlemeleriniz kaybolacak. 
                <strong> Kalıcı olması için ayrıca "Kaydet" butonuna basmanız gerekiyor.</strong>
              </p>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowResetConfirm(null)}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold text-[#1D1D1F] bg-black/5 rounded-xl hover:bg-black/10 transition-colors"
                >
                  Vazgeç
                </button>
                <button 
                  onClick={() => resetToDefault(showResetConfirm)}
                  className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-[#FF9500] rounded-xl hover:bg-[#E08600] transition-colors"
                >
                  Varsayılanı Yükle
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ==========================================
// SUB COMPONENTS
// ==========================================

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: any; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
        <span className="text-[11px] font-semibold text-[#86868B] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-[#1D1D1F] tracking-tight">{value}</p>
    </div>
  );
}

function SettingRow({ icon: Icon, iconColor, title, description, children }: { icon: any; iconColor: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${iconColor}15` }}>
          <Icon className="w-4 h-4" style={{ color: iconColor }} />
        </div>
        <div>
          <p className="text-sm font-bold text-[#1D1D1F]">{title}</p>
          <p className="text-[11px] text-[#86868B] font-medium">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ToggleSwitch({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-[51px] h-[31px] rounded-full transition-colors duration-300 shrink-0 ${
        active ? "bg-[#34C759]" : "bg-[#E5E5EA]"
      }`}
    >
      <div className={`absolute top-[2px] w-[27px] h-[27px] bg-white rounded-full shadow-md transition-transform duration-300 ${
        active ? "translate-x-[22px]" : "translate-x-[2px]"
      }`} />
    </button>
  );
}
