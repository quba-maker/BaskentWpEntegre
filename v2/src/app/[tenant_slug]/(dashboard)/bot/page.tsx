"use client";

import { useState, useEffect, useCallback } from "react";
import { Bot, MessageSquare, Globe, Hash, Plus, Link2, AlertTriangle, X, FileText, Settings2, Cpu, RotateCcw } from "lucide-react";
import {
  getBots, createBot, updateBot,
  testBotPrompt, type BotData
} from "@/app/actions/bot";
import { PageLoader } from "@/components/ui/shared-states";
import { PageShell, PageHeader } from "@/components/governance";
import { BotTestPlayground, BotPromptTab, BotAISettingsTab, BotChannelsTab } from "./_components";

// ==========================================
// ICON RESOLVER
// ==========================================
function resolveIcon(iconName: string) {
  const map: Record<string, any> = {
    'message-square': MessageSquare,
    'hash': Hash,
    'globe': Globe,
    'bot': Bot,
  };
  return map[iconName] || Bot;
}

// ==========================================
// BOT CARD
// ==========================================
function BotCard({ bot, isSelected, onClick }: { bot: BotData; isSelected: boolean; onClick: () => void }) {
  const channelCount = bot.channels.length;
  const hasWarnings = bot.channels.some(c => !c.hasPromptBinding || !c.hasCredentials);
  const iconName = bot.icon;

  return (
    <div
      className="relative rounded-2xl border p-5 transition-all duration-300 cursor-pointer group"
      style={{
        backgroundColor: isSelected ? "#fff" : "rgba(0,0,0,0.01)",
        borderColor: isSelected ? (bot.color || "var(--q-primary)") : "var(--q-border-default)",
        boxShadow: isSelected ? `0 0 0 1px ${bot.color || 'var(--q-primary)'}20, 0 2px 8px rgba(0,0,0,0.06)` : "0 1px 3px rgba(0,0,0,0.04)",
      }}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${bot.color || '#6366f1'}15` }}
          >
            {iconName === 'message-square' && <MessageSquare className="w-5 h-5" style={{ color: bot.color || '#6366f1' }} />}
            {iconName === 'hash' && <Hash className="w-5 h-5" style={{ color: bot.color || '#6366f1' }} />}
            {iconName === 'globe' && <Globe className="w-5 h-5" style={{ color: bot.color || '#6366f1' }} />}
            {iconName !== 'message-square' && iconName !== 'hash' && iconName !== 'globe' && <Bot className="w-5 h-5" style={{ color: bot.color || '#6366f1' }} />}
          </div>
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>{bot.displayName}</p>
            {bot.description && (
              <p className="text-[11px] font-medium" style={{ color: "var(--q-text-secondary)" }}>{bot.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {bot.profile?.aiModel && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
              style={{
                backgroundColor: bot.profile.aiModel.includes('pro') ? 'var(--q-purple-bg, rgba(99,102,241,0.1))' : bot.profile.aiModel.includes('lite') ? 'var(--q-green-bg, rgba(34,197,94,0.1))' : 'var(--q-blue-bg, rgba(59,130,246,0.1))',
                color: bot.profile.aiModel.includes('pro') ? 'var(--q-purple, #6366f1)' : bot.profile.aiModel.includes('lite') ? 'var(--q-green, #22c55e)' : 'var(--q-blue, #3b82f6)',
              }}
            >
              <Cpu className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" />
              {bot.profile.aiModel.includes('pro') ? 'Pro' : bot.profile.aiModel.includes('lite') ? 'Lite' : 'Flash'}
            </span>
          )}
          <div className="flex items-center gap-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: "var(--q-green)", animation: "pulse 2s infinite" }}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--q-green)" }}>
              Aktif
            </span>
          </div>
        </div>
      </div>

      {/* Channels */}
      <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--q-border-default)" }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Link2 className="w-3 h-3" style={{ color: "var(--q-text-secondary)" }} />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--q-text-secondary)" }}>
            {channelCount} Kanal
          </span>
          {hasWarnings && <AlertTriangle className="w-3 h-3" style={{ color: "var(--q-yellow, #f59e0b)" }} />}
        </div>
        {bot.channels.map(c => (
          <div key={c.id} className="flex items-center gap-2 py-0.5">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: c.hasCredentials && c.hasPromptBinding ? "var(--q-green)" : "var(--q-yellow, #f59e0b)" }}
            />
            <span className="text-[11px] truncate" style={{ color: "var(--q-text-primary)" }}>{c.name}</span>
          </div>
        ))}
        {channelCount === 0 && (
          <p className="text-[10px]" style={{ color: "var(--q-text-secondary)" }}>Henüz kanal atanmadı</p>
        )}
      </div>

      {/* Prompt version */}
      {bot.prompt && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ backgroundColor: "rgba(0,0,0,0.04)", color: "var(--q-text-secondary)" }}>
            v{bot.prompt.version}
          </span>
          <span className="text-[10px]" style={{ color: "var(--q-text-secondary)" }}>
            {(bot.prompt.text?.length || 0).toLocaleString()} karakter
          </span>
        </div>
      )}
    </div>
  );
}

// ==========================================
// CREATE BOT MODAL
// ==========================================
function CreateBotModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [botType, setBotType] = useState("custom");
  const [saving, setSaving] = useState(false);

  const templates: { value: string; label: string; icon: string; color: string }[] = [
    { value: "whatsapp_sales", label: "WhatsApp Satış Botu", icon: "message-square", color: "#25D366" },
    { value: "social_tr", label: "Türkçe Sosyal Medya", icon: "hash", color: "#E1306C" },
    { value: "social_foreign", label: "Uluslararası Bot", icon: "globe", color: "#4A90D9" },
    { value: "custom", label: "Boş Template", icon: "bot", color: "#6366f1" },
  ];

  const selected = templates.find(t => t.value === botType) || templates[3];

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    const res = await createBot({
      displayName: name.trim(),
      description: desc.trim() || undefined,
      botType,
      icon: selected.icon,
      color: selected.color,
    });
    setSaving(false);
    if (res.success) {
      onCreated();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
        style={{ border: "1px solid var(--q-border-default)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold" style={{ color: "var(--q-text-primary)" }}>Yeni Bot Oluştur</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Bot Adı</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Örn: Gece Nöbet Botu"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--q-border-default)" }}
            />
          </div>

          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Açıklama</label>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Kısa açıklama"
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ borderColor: "var(--q-border-default)" }}
            />
          </div>

          <div>
            <label className="text-xs font-semibold mb-2 block" style={{ color: "var(--q-text-secondary)" }}>Template</label>
            <div className="grid grid-cols-2 gap-2">
              {templates.map(t => {
                const iconName = t.icon;
                return (
                  <button
                    key={t.value}
                    onClick={() => setBotType(t.value)}
                    className="flex items-center gap-2 p-3 rounded-xl border transition-all text-left"
                    style={{
                      borderColor: botType === t.value ? t.color : "var(--q-border-default)",
                      backgroundColor: botType === t.value ? `${t.color}08` : "transparent",
                    }}
                  >
                    {iconName === 'message-square' && <MessageSquare className="w-4 h-4" style={{ color: t.color }} />}
                    {iconName === 'hash' && <Hash className="w-4 h-4" style={{ color: t.color }} />}
                    {iconName === 'globe' && <Globe className="w-4 h-4" style={{ color: t.color }} />}
                    {iconName !== 'message-square' && iconName !== 'hash' && iconName !== 'globe' && <Bot className="w-4 h-4" style={{ color: t.color }} />}
                    <span className="text-xs font-medium" style={{ color: "var(--q-text-primary)" }}>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-xl" style={{ color: "var(--q-text-secondary)" }}>
            İptal
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || saving}
            className="px-5 py-2 text-sm font-bold rounded-xl text-white transition-all disabled:opacity-50"
            style={{ backgroundColor: "var(--q-primary, #6366f1)" }}
          >
            {saving ? "Oluşturuluyor..." : "Oluştur"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// BOT DETAIL TABS — Tab Container
// Provides 3-tab navigation: Prompt, AI Settings, Channels
// ==========================================
const DETAIL_TABS = [
  { id: 'prompt' as const, label: 'Prompt & Bilgi', icon: FileText },
  { id: 'settings' as const, label: 'AI Ayarları', icon: Settings2 },
  { id: 'channels' as const, label: 'Kanallar', icon: Link2 },
];
type DetailTab = typeof DETAIL_TABS[number]['id'];

// ==========================================
// PAGE ORCHESTRATOR — DYNAMIC BOT MANAGEMENT
// ==========================================
export default function BotManagementPage() {
  const [bots, setBots] = useState<BotData[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('prompt');

  const selectedBot = bots.find(b => b.id === selectedBotId) || bots[0] || null;

  // ---- Data Loading ----
  const loadBots = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await getBots();
      if (res.success && res.bots) {
        setBots(res.bots);
        // Auto-select first if none selected
        if (!selectedBotId && res.bots.length > 0) {
          setSelectedBotId(res.bots[0].id);
        }
      } else {
        console.error('[BOT_PAGE] getBots failed:', res.error);
        setLoadError(res.error || 'Botlar yüklenemedi');
      }
    } catch (err) {
      console.error('[BOT_PAGE] getBots exception:', err);
      setLoadError('Bağlantı hatası — lütfen tekrar deneyin');
    }
  }, [selectedBotId]);

  useEffect(() => {
    async function init() {
      setIsLoading(true);
      await loadBots();
      setIsLoading(false);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset tab when switching bots
  useEffect(() => {
    setActiveTab('prompt');
  }, [selectedBotId]);

  // ---- Handlers ----
  async function handleSavePrompt(promptText: string, prices: string, rules: string) {
    if (!selectedBot) return;
    await updateBot(selectedBot.id, {
      promptText,
      knowledgePrices: prices,
      knowledgeRules: rules,
    });
    await loadBots();
  }

  function handleBotArchived() {
    setSelectedBotId(null);
    loadBots();
  }

  if (isLoading) return <PageLoader />;

  return (
    <PageShell>
      <PageHeader
        icon={Bot}
        title="Bot Yönetimi"
        subtitle="AI asistanlarınızı dinamik olarak yapılandırın ve yönetin"
      />

      {/* BOT GRID */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
            <Bot className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
            Botlar ({bots.length})
          </h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-xl text-white transition-all hover:opacity-90"
            style={{ backgroundColor: "var(--q-primary, #6366f1)" }}
          >
            <Plus className="w-4 h-4" />
            Yeni Bot
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {bots.map(bot => (
            <BotCard
              key={bot.id}
              bot={bot}
              isSelected={selectedBot?.id === bot.id}
              onClick={() => setSelectedBotId(bot.id)}
            />
          ))}

          {bots.length === 0 && (
            <div className="col-span-full text-center py-12 rounded-2xl border" style={{ borderColor: loadError ? "var(--q-red, #ef4444)" : "var(--q-border-default)" }}>
              {loadError ? (
                <>
                  <AlertTriangle className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--q-red, #ef4444)" }} />
                  <p className="text-sm font-medium" style={{ color: "var(--q-text-primary)" }}>Botlar yüklenemedi</p>
                  <p className="text-xs mt-1 mb-3" style={{ color: "var(--q-text-secondary)" }}>{loadError}</p>
                  <button
                    onClick={async () => { setIsLoading(true); await loadBots(); setIsLoading(false); }}
                    className="px-4 py-2 text-sm font-bold rounded-xl text-white flex items-center gap-1.5 mx-auto"
                    style={{ backgroundColor: "var(--q-primary, #6366f1)" }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Tekrar Dene
                  </button>
                </>
              ) : (
                <>
                  <Bot className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--q-text-secondary)" }} />
                  <p className="text-sm font-medium" style={{ color: "var(--q-text-secondary)" }}>Henüz bot oluşturmadınız</p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="mt-3 px-4 py-2 text-sm font-bold rounded-xl text-white"
                    style={{ backgroundColor: "var(--q-primary, #6366f1)" }}
                  >
                    İlk Botu Oluştur
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SELECTED BOT DETAIL — 3 Tab System */}
      {selectedBot && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <div className="xl:col-span-2">
            {/* Tab Navigation */}
            <div className="flex items-center gap-1 p-1 rounded-xl mb-5 w-fit" style={{ backgroundColor: 'rgba(0,0,0,0.04)' }}>
              {DETAIL_TABS.map(tab => {
                const TabIcon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
                    style={{
                      backgroundColor: isActive ? 'white' : 'transparent',
                      color: isActive ? 'var(--q-text-primary)' : 'var(--q-text-secondary)',
                      boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    }}
                  >
                    <TabIcon className="w-4 h-4" />
                    <span className="hidden md:inline">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab Content */}
            {activeTab === 'prompt' && (
              <BotPromptTab bot={selectedBot} onSavePrompt={handleSavePrompt} />
            )}
            {activeTab === 'settings' && (
              <BotAISettingsTab bot={selectedBot} onRefresh={loadBots} />
            )}
            {activeTab === 'channels' && (
              <BotChannelsTab
                bot={selectedBot}
                allBots={bots}
                onRefresh={loadBots}
                onBotArchived={handleBotArchived}
              />
            )}
          </div>
          <div className="xl:col-span-1 sticky top-6">
            <BotTestPlayground
              activeChannel={{ id: selectedBot.id, label: selectedBot.displayName, icon: resolveIcon(selectedBot.icon), promptKey: '', activeKey: '', color: selectedBot.color || '#6366f1', description: '' }}
              botGroupId={selectedBot.id}
              onTestPrompt={testBotPrompt}
            />
          </div>
        </div>
      )}

      {/* CREATE MODAL */}
      {showCreateModal && (
        <CreateBotModal
          onClose={() => setShowCreateModal(false)}
          onCreated={loadBots}
        />
      )}
    </PageShell>
  );
}
