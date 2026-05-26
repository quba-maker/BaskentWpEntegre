"use client";

import { useState, useEffect, useCallback } from "react";
import { Link2, MessageCircle, FileSpreadsheet, Instagram, Facebook, Webhook, Activity, AlertTriangle, Plus, X, Bot, ChevronRight, RotateCcw, Archive, Trash2, Bell, Send, Check, Loader2 } from "lucide-react";
import {
  getTelegramChannelConfig,
  saveTelegramChannel,
  testTelegramChannel,
} from "@/app/actions/notification-channels";
import { PageShell, PageHeader } from "@/components/governance";
import { GoogleSheetsWizard } from "@/components/features/integrations/GoogleSheetsWizard";
import {
  getIntegrationHealth,
  connectWhatsAppChannel,
  connectInstagramChannel,
  connectMessengerPage,
  archiveChannel,
  getBotListForDropdown,
} from "@/app/actions/integrations";
import { assignChannelToBot } from "@/app/actions/bot";
import { PageLoader } from "@/components/ui/shared-states";

// ==========================================
// PROVIDER CONFIG
// ==========================================
const PROVIDER_META: Record<string, { label: string; icon: any; color: string }> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: "#25D366" },
  instagram: { label: "Instagram", icon: Instagram, color: "#E1306C" },
  meta_instagram: { label: "Instagram", icon: Instagram, color: "#E1306C" },
  messenger: { label: "Messenger", icon: Facebook, color: "#0084FF" },
  google_sheets: { label: "Google Sheets", icon: FileSpreadsheet, color: "#0F9D58" },
  custom_webhook: { label: "Custom Webhook", icon: Webhook, color: "#8B5CF6" },
};

function getProviderMeta(provider: string) {
  return PROVIDER_META[provider] || { label: provider, icon: Webhook, color: "#6366f1" };
}

// ==========================================
// STATUS BADGE
// ==========================================
function StatusBadge({ status, detail }: { status: string; detail: string }) {
  const colors: Record<string, string> = {
    connected: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    disconnected: "bg-gray-50 text-gray-500 border-gray-200",
    error: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${colors[status] || colors.warning}`}>
      {status === "connected" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
      {detail}
    </span>
  );
}

// ==========================================
// CHANNEL ROW
// ==========================================
function ChannelRow({
  channel,
  bots,
  onAssignBot,
  onArchive,
  onRefresh,
}: {
  channel: any;
  bots: { id: string; displayName: string; color: string }[];
  onAssignBot: (channelId: string, botId: string) => Promise<void>;
  onArchive: (channelId: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const meta = getProviderMeta(channel.provider);
  const Icon = meta.icon;
  const [assigning, setAssigning] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);

  async function handleBotChange(botId: string) {
    setAssigning(true);
    await onAssignBot(channel.id, botId);
    setAssigning(false);
    onRefresh();
  }

  async function handleArchive() {
    setArchiving(true);
    await onArchive(channel.id);
    setArchiving(false);
    setConfirmArchive(false);
    onRefresh();
  }

  // Don't show archive for synthetic cards (google sheets)
  const isSynthetic = channel.id?.startsWith('google-sheets');

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-50/50 transition-colors border-b last:border-b-0" style={{ borderColor: "var(--q-border-default)" }}>
      {/* Left: icon + name + identifier */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${meta.color}10` }}>
          <Icon className="w-4 h-4" style={{ color: meta.color }} />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold truncate" style={{ color: "var(--q-text-primary)" }}>{channel.name}</p>
          <p className="text-[10px] font-mono truncate" style={{ color: "var(--q-text-secondary)" }}>{channel.id.slice(0, 8)} • {channel.provider}</p>
        </div>
      </div>

      {/* Bot assignment */}
      <div className="flex items-center gap-2 flex-shrink-0 mx-3">
        <Bot className="w-3 h-3" style={{ color: "var(--q-text-secondary)" }} />
        <select
          className="text-[11px] font-medium rounded-lg border px-2 py-1 bg-white appearance-none cursor-pointer"
          style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-primary)", minWidth: 130 }}
          value={channel.botId || ""}
          onChange={e => handleBotChange(e.target.value)}
          disabled={assigning}
        >
          {bots.map(b => (
            <option key={b.id} value={b.id}>{b.displayName}</option>
          ))}
        </select>
      </div>

      {/* Status */}
      <div className="flex-shrink-0 mx-2">
        <StatusBadge status={channel.status} detail={channel.detail} />
      </div>

      {/* Timestamps */}
      <div className="hidden lg:flex flex-col items-end flex-shrink-0 ml-2 min-w-[120px]">
        <span className="text-[10px]" style={{ color: "var(--q-text-secondary)" }}>
          {channel.lastSyncAt
            ? `Son: ${new Date(channel.lastSyncAt).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
            : "Webhook yok"}
        </span>
        {channel.lastMessage && (
          <span className="text-[10px]" style={{ color: "var(--q-text-secondary)" }}>
            Msg: {new Date(channel.lastMessage).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {/* Archive button */}
      {!isSynthetic && (
        <div className="flex-shrink-0 ml-2">
          {confirmArchive ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="px-2 py-1 text-[10px] font-bold rounded-lg text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-50"
              >
                {archiving ? '...' : 'Evet'}
              </button>
              <button
                onClick={() => setConfirmArchive(false)}
                className="px-2 py-1 text-[10px] font-bold rounded-lg hover:bg-gray-100"
                style={{ color: "var(--q-text-secondary)" }}
              >
                İptal
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmArchive(true)}
              className="p-1.5 rounded-lg hover:bg-rose-50 transition-colors group"
              title="Arşivle"
            >
              <Archive className="w-3.5 h-3.5 text-gray-400 group-hover:text-rose-500" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// PROVIDER SECTION
// ==========================================
function ProviderSection({
  provider,
  channels,
  bots,
  onAddChannel,
  onAssignBot,
  onArchive,
  onRefresh,
}: {
  provider: string;
  channels: any[];
  bots: any[];
  onAddChannel: (provider: string) => void;
  onAssignBot: (channelId: string, botId: string) => Promise<void>;
  onArchive: (channelId: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const meta = getProviderMeta(provider);
  const Icon = meta.icon;
  const activeCount = channels.filter(c => c.status === "connected").length;

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}>
      {/* Section Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid var(--q-border-default)` }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${meta.color}12` }}>
            <Icon className="w-5 h-5" style={{ color: meta.color }} />
          </div>
          <div>
            <h3 className="text-[14px] font-bold" style={{ color: "var(--q-text-primary)" }}>{meta.label}</h3>
            <p className="text-[10px] font-medium" style={{ color: "var(--q-text-secondary)" }}>
              {channels.length} kanal • {activeCount} aktif
            </p>
          </div>
        </div>
        <button
          onClick={() => onAddChannel(provider)}
          className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all hover:opacity-80 text-white"
          style={{ backgroundColor: meta.color }}
        >
          <Plus className="w-3 h-3" />
          Ekle
        </button>
      </div>

      {/* Channel Rows */}
      {channels.length > 0 ? (
        channels.map(ch => (
          <ChannelRow key={ch.id} channel={ch} bots={bots} onAssignBot={onAssignBot} onArchive={onArchive} onRefresh={onRefresh} />
        ))
      ) : (
        <div className="px-4 py-6 text-center">
          <p className="text-[12px]" style={{ color: "var(--q-text-secondary)" }}>Henüz {meta.label} kanalı eklenmedi</p>
        </div>
      )}
    </div>
  );
}

// ==========================================
// ADD CHANNEL MODAL
// ==========================================
function AddChannelModal({
  provider,
  bots,
  onClose,
  onSuccess,
}: {
  provider: string;
  bots: { id: string; displayName: string; color: string }[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const meta = getProviderMeta(provider);
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [token, setToken] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [botId, setBotId] = useState(bots[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    if (!name.trim() || !identifier.trim() || !token.trim()) {
      setError("Tüm alanları doldurun");
      return;
    }
    setSaving(true);
    let res: any;
    if (provider === "whatsapp") {
      res = await connectWhatsAppChannel({ name, phoneNumberId: identifier, wabaId, accessToken: token, botGroupId: botId });
    } else if (provider === "instagram" || provider === "meta_instagram") {
      res = await connectInstagramChannel({ name, instagramBusinessAccountId: identifier, accessToken: token, botGroupId: botId });
    } else if (provider === "messenger") {
      res = await connectMessengerPage({ name, pageId: identifier, pageAccessToken: token, botGroupId: botId });
    }
    setSaving(false);
    if (res?.success) {
      onSuccess();
      onClose();
    } else {
      setError(res?.error || "Bağlantı hatası");
    }
  }

  const fields: Record<string, { id: string; label: string; placeholder: string }> = {
    whatsapp: { id: "Phone Number ID", label: "Phone Number ID", placeholder: "Örn: 1072536945944841" },
    instagram: { id: "IG Business Account ID", label: "Instagram Business Account ID", placeholder: "Örn: 103094588239235" },
    meta_instagram: { id: "IG Business Account ID", label: "Instagram Business Account ID", placeholder: "Örn: 103094588239235" },
    messenger: { id: "Facebook Page ID", label: "Facebook Page ID (numerik)", placeholder: "Örn: 123456789012345" },
  };
  const f = fields[provider] || { id: "Identifier", label: "Identifier", placeholder: "" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" style={{ border: "1px solid var(--q-border-default)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${meta.color}12` }}>
              {(() => { const I = meta.icon; return <I className="w-4 h-4" style={{ color: meta.color }} />; })()}
            </div>
            <h3 className="text-base font-bold" style={{ color: "var(--q-text-primary)" }}>{meta.label} Kanalı Ekle</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Kanal Adı</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Örn: WhatsApp Primary" autoComplete="off" name="quba_channel_name" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ borderColor: "var(--q-border-default)" }} />
          </div>
          <div>
            <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>{f.label}</label>
            <input value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder={f.placeholder} autoComplete="off" name="quba_channel_identifier" className="w-full px-3 py-2 rounded-xl border text-sm font-mono" style={{ borderColor: "var(--q-border-default)" }} />
          </div>
          {provider === "whatsapp" && (
            <div>
              <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>WABA ID (opsiyonel)</label>
              <input value={wabaId} onChange={e => setWabaId(e.target.value)} placeholder="WhatsApp Business Account ID" autoComplete="off" name="quba_waba_id" className="w-full px-3 py-2 rounded-xl border text-sm font-mono" style={{ borderColor: "var(--q-border-default)" }} />
            </div>
          )}
          <div>
            <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Access Token</label>
            <input value={token} onChange={e => setToken(e.target.value)} type="password" placeholder="Meta Graph API Token" autoComplete="new-password" name="quba_access_token" className="w-full px-3 py-2 rounded-xl border text-sm font-mono" style={{ borderColor: "var(--q-border-default)" }} />
          </div>
          <div>
            <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Yöneten Bot</label>
            <select value={botId} onChange={e => setBotId(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-sm bg-white" style={{ borderColor: "var(--q-border-default)" }}>
              {bots.map(b => <option key={b.id} value={b.id}>{b.displayName}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="text-[11px] text-rose-600 mt-2 font-medium">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-xl" style={{ color: "var(--q-text-secondary)" }}>İptal</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm font-bold rounded-xl text-white disabled:opacity-50" style={{ backgroundColor: meta.color }}>
            {saving ? "Bağlanıyor..." : "Bağla"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// NOTIFICATION CATEGORIES
// ==========================================
const NOTIFICATION_CATEGORIES = [
  { value: 'hot_lead', label: 'Sıcak Fırsat', emoji: '🔥' },
  { value: 'appointment_request', label: 'Randevu Talebi', emoji: '📅' },
  { value: 'callback_requested', label: 'Geri Arama', emoji: '📞' },
  { value: 'report_received', label: 'Rapor/Belge', emoji: '📄' },
  { value: 'appointment_approaching', label: 'Randevu Yaklaşıyor', emoji: '⏰' },
  { value: 'overdue_task', label: 'Geciken Görev', emoji: '🔴' },
  { value: 'no_response', label: 'Cevap Yok', emoji: '⏳' },
  { value: 'human_escalation', label: 'İnsan Müdahalesi', emoji: '🚨' },
  { value: 'system_alert', label: 'Sistem Uyarısı', emoji: '⚙️' },
];

// ==========================================
// TELEGRAM NOTIFICATION CHANNEL SECTION
// ==========================================
function TelegramChannelSection() {
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);

  // Form state
  const [isEnabled, setIsEnabled] = useState(false);
  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [tokenMask, setTokenMask] = useState("");
  const [newToken, setNewToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [enabledCategories, setEnabledCategories] = useState<string[]>([]);
  const [minPriority, setMinPriority] = useState("high");

  // Load existing config
  useEffect(() => {
    (async () => {
      try {
        const res = await getTelegramChannelConfig();
        if (res.success && res.config) {
          setIsEnabled(res.config.isEnabled);
          setHasExistingToken(res.config.hasToken);
          setTokenMask(res.config.tokenMask || "");
          setChatId(res.config.chatId || "");
          setEnabledCategories(res.config.enabledCategories || []);
          setMinPriority(res.config.minPriority || "high");
        }
      } catch {}
      setIsLoading(false);
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    setTestResult(null);
    const res = await saveTelegramChannel({
      botToken: newToken || undefined,
      chatId,
      isEnabled,
      enabledCategories,
      minPriority,
    });
    setSaving(false);
    if (res.success) {
      setSaveResult("success");
      setHasExistingToken(true);
      if (newToken) {
        const masked = newToken.length > 10 
          ? `${newToken.substring(0, 5)}...${newToken.substring(newToken.length - 5)}`
          : "***configured***";
        setTokenMask(masked);
        setNewToken("");
      }
      setTimeout(() => setSaveResult(null), 3000);
    } else {
      setSaveResult(res.error || "Kayıt hatası");
      setTimeout(() => setSaveResult(null), 5000);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const res = await testTelegramChannel();
    setTesting(false);
    setTestResult(res);
    setTimeout(() => setTestResult(null), 8000);
  }

  function toggleCategory(cat: string) {
    setEnabledCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl border overflow-hidden mb-8" style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#0088cc12" }}>
            <Send className="w-5 h-5" style={{ color: "#0088cc" }} />
          </div>
          <div>
            <h3 className="text-[14px] font-bold" style={{ color: "var(--q-text-primary)" }}>Telegram Bildirimleri</h3>
            <p className="text-[10px] font-medium" style={{ color: "var(--q-text-secondary)" }}>Yükleniyor...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border overflow-hidden mb-8" style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}>
      {/* Section Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid var(--q-border-default)` }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#0088cc12" }}>
            <Send className="w-5 h-5" style={{ color: "#0088cc" }} />
          </div>
          <div>
            <h3 className="text-[14px] font-bold" style={{ color: "var(--q-text-primary)" }}>Telegram Bildirimleri</h3>
            <p className="text-[10px] font-medium" style={{ color: "var(--q-text-secondary)" }}>
              Panel bildirimlerini Telegram grubunuza gönderin
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEnabled(!isEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <span className="text-[11px] font-semibold" style={{ color: isEnabled ? "#10b981" : "var(--q-text-secondary)" }}>
            {isEnabled ? "Aktif" : "Kapalı"}
          </span>
        </div>
      </div>

      {/* Config Form */}
      <div className="px-4 py-4 space-y-4">
        {/* Bot Token */}
        <div>
          <label className="text-[11px] font-semibold mb-1.5 block" style={{ color: "var(--q-text-secondary)" }}>
            Bot Token {hasExistingToken && <span className="text-emerald-600 ml-1">✓ Kayıtlı</span>}
          </label>
          {hasExistingToken && !newToken && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-mono px-2 py-1 rounded-lg bg-gray-50" style={{ color: "var(--q-text-secondary)" }}>
                {tokenMask}
              </span>
              <button
                onClick={() => setNewToken(" ")}
                className="text-[10px] font-semibold px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
                style={{ color: "var(--q-primary, #6366f1)" }}
              >
                Değiştir
              </button>
            </div>
          )}
          {(!hasExistingToken || newToken) && (
            <input
              value={newToken.trim() === "" && newToken ? "" : newToken}
              onChange={e => setNewToken(e.target.value)}
              type="password"
              placeholder="123456789:ABCdef..."
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-xl border text-sm font-mono"
              style={{ borderColor: "var(--q-border-default)" }}
            />
          )}
          <p className="text-[10px] mt-1" style={{ color: "var(--q-text-secondary)" }}>
            🔒 Token şifrelenerek saklanır. @BotFather ile oluşturun.
          </p>
        </div>

        {/* Chat ID */}
        <div>
          <label className="text-[11px] font-semibold mb-1.5 block" style={{ color: "var(--q-text-secondary)" }}>
            Telegram Chat / Group ID
          </label>
          <input
            value={chatId}
            onChange={e => setChatId(e.target.value)}
            placeholder="-1001234567890"
            autoComplete="off"
            className="w-full px-3 py-2 rounded-xl border text-sm font-mono"
            style={{ borderColor: "var(--q-border-default)" }}
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--q-text-secondary)" }}>
            Grup ID negatif sayıyla başlar. @userinfobot ile bulabilirsiniz.
          </p>
        </div>

        {/* Category Selection */}
        <div>
          <label className="text-[11px] font-semibold mb-1.5 block" style={{ color: "var(--q-text-secondary)" }}>
            Hangi bildirimler Telegram'a gitsin?
            <span className="text-[9px] ml-1 font-normal">(Boş = tümü)</span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            {NOTIFICATION_CATEGORIES.map(cat => {
              const active = enabledCategories.includes(cat.value);
              return (
                <button
                  key={cat.value}
                  onClick={() => toggleCategory(cat.value)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                    active 
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700' 
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                  style={!active ? { color: "var(--q-text-secondary)" } : {}}
                >
                  {cat.emoji} {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Min Priority */}
        <div>
          <label className="text-[11px] font-semibold mb-1.5 block" style={{ color: "var(--q-text-secondary)" }}>
            Minimum Öncelik
          </label>
          <select
            value={minPriority}
            onChange={e => setMinPriority(e.target.value)}
            className="px-3 py-2 rounded-xl border text-sm bg-white"
            style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-primary)" }}
          >
            <option value="normal">Normal ve üzeri (tümü)</option>
            <option value="high">Yüksek ve üzeri (önerilen)</option>
            <option value="critical">Sadece kritik</option>
          </select>
        </div>

        {/* Quiet Hours — Yakında */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50">
          <Bell className="w-3.5 h-3.5" style={{ color: "var(--q-text-secondary)" }} />
          <span className="text-[11px]" style={{ color: "var(--q-text-secondary)" }}>Sessiz Saatler</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">YAKINDA</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || !chatId.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold rounded-xl text-white disabled:opacity-50 transition-all"
            style={{ backgroundColor: "var(--q-primary, #6366f1)" }}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {saving ? "Kaydediliyor..." : "Kaydet"}
          </button>

          <button
            onClick={handleTest}
            disabled={testing || !chatId.trim() || (!hasExistingToken && !newToken.trim())}
            className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold rounded-xl border disabled:opacity-50 transition-all hover:bg-gray-50"
            style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-primary)" }}
          >
            {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            {testing ? "Gönderiliyor..." : "Test Bildirimi Gönder"}
          </button>
        </div>

        {/* Feedback */}
        {saveResult && (
          <div className={`px-3 py-2 rounded-xl text-[11px] font-medium ${
            saveResult === "success" 
              ? "bg-emerald-50 text-emerald-700" 
              : "bg-rose-50 text-rose-700"
          }`}>
            {saveResult === "success" ? "✅ Telegram kanal ayarları kaydedildi." : `❌ ${saveResult}`}
          </div>
        )}

        {testResult && (
          <div className={`px-3 py-2 rounded-xl text-[11px] font-medium ${
            testResult.success 
              ? "bg-emerald-50 text-emerald-700" 
              : "bg-rose-50 text-rose-700"
          }`}>
            {testResult.success 
              ? "✅ Test mesajı Telegram'a başarıyla gönderildi!" 
              : `❌ Test başarısız: ${testResult.error || "Bilinmeyen hata"}`}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// PAGE ORCHESTRATOR
// ==========================================
export default function IntegrationsPage() {
  const [channels, setChannels] = useState<any[]>([]);
  const [bots, setBots] = useState<{ id: string; displayName: string; color: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addModal, setAddModal] = useState<string | null>(null);
  const [sheetsWizard, setSheetsWizard] = useState(false);
  const [summary, setSummary] = useState("");

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const [healthRes, botRes] = await Promise.all([
        getIntegrationHealth(),
        getBotListForDropdown(),
      ]);
      if (healthRes.success && healthRes.channels) {
        setChannels(healthRes.channels);
        setSummary(healthRes.summary || "");
      } else {
        console.error('[INTEGRATIONS_PAGE] getIntegrationHealth failed:', healthRes.error);
        setLoadError(healthRes.error || 'Entegrasyon verileri yüklenemedi');
      }
      if (botRes.success && botRes.bots) {
        setBots(botRes.bots);
      }
    } catch (err) {
      console.error('[INTEGRATIONS_PAGE] loadData exception:', err);
      setLoadError('Bağlantı hatası — lütfen tekrar deneyin');
    }
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await loadData();
      setIsLoading(false);
    })();
  }, [loadData]);

  async function handleAssignBot(channelId: string, botId: string) {
    await assignChannelToBot(channelId, botId);
    await loadData();
  }

  async function handleArchive(channelId: string) {
    await archiveChannel(channelId);
    await loadData();
  }

  function handleAddChannel(provider: string) {
    if (provider === "google_sheets") {
      setSheetsWizard(true);
    } else {
      setAddModal(provider);
    }
  }

  // Group channels by canonical provider
  const grouped: Record<string, any[]> = {};
  const providerOrder = ["whatsapp", "instagram", "messenger", "google_sheets"];
  for (const p of providerOrder) grouped[p] = [];
  for (const ch of channels) {
    const key = ch.provider === "meta_instagram" ? "instagram" : ch.provider;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(ch);
  }

  if (isLoading) return <PageLoader />;

  return (
    <PageShell>
      <PageHeader
        icon={Link2}
        title="Entegrasyon Merkezi"
        subtitle="Kanallarınızı yönetin, botlara atayın ve bağlantı durumlarını izleyin."
        iconGradient={{ from: "var(--q-purple)", to: "var(--q-blue)" }}
      />

      {/* Summary Bar */}
      <div className="flex items-center justify-between mb-6 px-4 py-3 rounded-2xl border" style={{ borderColor: loadError ? "var(--q-red, #ef4444)" : "var(--q-border-default)", backgroundColor: "#fff" }}>
        <div className="flex items-center gap-3">
          {loadError ? (
            <>
              <AlertTriangle className="w-4 h-4" style={{ color: "var(--q-red, #ef4444)" }} />
              <span className="text-[13px] font-medium" style={{ color: "var(--q-red, #ef4444)" }}>{loadError}</span>
            </>
          ) : (
            <>
              <Activity className="w-4 h-4" style={{ color: "var(--q-primary, #6366f1)" }} />
              <span className="text-[13px] font-medium" style={{ color: "var(--q-text-primary)" }}>{summary}</span>
            </>
          )}
        </div>
        <button onClick={async () => { setIsLoading(true); await loadData(); setIsLoading(false); }} className="flex items-center gap-1 text-[12px] font-semibold transition-colors" style={{ color: "var(--q-primary, #6366f1)" }}>
          <RotateCcw className="w-3 h-3" /> {loadError ? 'Tekrar Dene' : 'Yenile'}
        </button>
      </div>

      {/* Provider Sections */}
      <div className="space-y-4 mb-8">
        {providerOrder.map(provider => (
          <ProviderSection
            key={provider}
            provider={provider}
            channels={grouped[provider] || []}
            bots={bots}
            onAddChannel={handleAddChannel}
            onAssignBot={handleAssignBot}
            onArchive={handleArchive}
            onRefresh={loadData}
          />
        ))}
      </div>

      {/* Telegram Notification Channel */}
      <TelegramChannelSection />

      {/* Telemetry Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border p-5" style={{ borderColor: "var(--q-border-default)" }}>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Activity className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <h4 className="text-[13px] font-semibold" style={{ color: "var(--q-text-primary)" }}>Upstash Ingest Queue</h4>
              <p className="text-[10px] font-mono" style={{ color: "var(--q-text-secondary)" }}>QStash Message Broker</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase text-emerald-600">AKTİF</span>
            </div>
          </div>
          <div className="space-y-1.5 text-[11px]" style={{ color: "var(--q-text-secondary)" }}>
            <div className="flex justify-between"><span>İletim Güvencesi</span><span className="font-semibold text-emerald-600">%100</span></div>
            <div className="flex justify-between"><span>Ortalama Tepki</span><span className="font-semibold" style={{ color: "var(--q-text-primary)" }}>&lt; 150ms</span></div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border p-5" style={{ borderColor: "var(--q-border-default)" }}>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
              <Activity className="w-4 h-4 text-sky-500" />
            </div>
            <div>
              <h4 className="text-[13px] font-semibold" style={{ color: "var(--q-text-primary)" }}>Ably Event Bus</h4>
              <p className="text-[10px] font-mono" style={{ color: "var(--q-text-secondary)" }}>Real-Time Sync</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
              <span className="text-[10px] font-bold uppercase text-sky-600">CONNECTED</span>
            </div>
          </div>
          <div className="space-y-1.5 text-[11px]" style={{ color: "var(--q-text-secondary)" }}>
            <div className="flex justify-between"><span>Aktif Kanallar</span><span className="font-semibold" style={{ color: "var(--q-text-primary)" }}>{channels.filter(c => c.status === "connected").length} Canlı</span></div>
            <div className="flex justify-between"><span>Gecikme</span><span className="font-semibold" style={{ color: "var(--q-text-primary)" }}>&lt; 40ms</span></div>
          </div>
        </div>
      </div>

      {/* Add Channel Modal */}
      {addModal && addModal !== "google_sheets" && (
        <AddChannelModal
          provider={addModal}
          bots={bots}
          onClose={() => setAddModal(null)}
          onSuccess={loadData}
        />
      )}

      {/* Google Sheets Wizard */}
      {sheetsWizard && (
        <GoogleSheetsWizard
          isOpen={sheetsWizard}
          onClose={() => setSheetsWizard(false)}
          onComplete={() => { loadData(); setSheetsWizard(false); }}
        />
      )}
    </PageShell>
  );
}
