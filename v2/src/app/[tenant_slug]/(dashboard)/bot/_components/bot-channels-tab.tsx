"use client";

import { useState, useEffect } from "react";
import {
  Link2, AlertTriangle, ArrowRightLeft, Archive, Loader2, X
} from "lucide-react";
import {
  assignChannelToBot, archiveBot, getUnassignedChannels,
  type BotData,
} from "@/app/actions/bot";
import { useConfirm } from "@/components/ui/confirm-dialog";

// ==========================================
// BOT CHANNELS TAB
// Authority: Channel binding visibility, channel assignment, bot archiving
// Data owner: channels, channel_groups, channel_prompt_bindings
// RBAC: assignChannelToBot / archiveBot require owner/admin (backend guard)
// ==========================================

const PROVIDER_LABELS: Record<string, { label: string; color: string }> = {
  whatsapp: { label: "WhatsApp", color: "var(--q-whatsapp, #25D366)" },
  meta_instagram: { label: "Instagram", color: "var(--q-instagram, #E1306C)" },
  instagram: { label: "Instagram", color: "var(--q-instagram, #E1306C)" },
  messenger: { label: "Messenger", color: "var(--q-messenger, #0084FF)" },
};

interface BotChannelsTabProps {
  bot: BotData;
  allBots: BotData[];
  onRefresh: () => Promise<void>;
  onBotArchived: () => void;
}

export function BotChannelsTab({ bot, allBots, onRefresh, onBotArchived }: BotChannelsTabProps) {
  const confirm = useConfirm();
  const [assigning, setAssigning] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [unassignedChannels, setUnassignedChannels] = useState<any[]>([]);
  const [loadingUnassigned, setLoadingUnassigned] = useState(false);

  const channels = bot.channels || [];
  const otherBots = allBots.filter((b) => b.id !== bot.id);

  // ── Channel Assignment ──
  async function handleAssignChannel(channelId: string) {
    setAssigning(true);
    try {
      const res = await assignChannelToBot(channelId, bot.id);
      if (res.success) {
        await onRefresh();
        setShowAssignModal(false);
      }
    } finally {
      setAssigning(false);
    }
  }

  async function handleMoveChannel(channelId: string, targetBotId: string) {
    const ok = await confirm({
      title: "Kanalı Taşı",
      message: "Bu kanal seçilen bota taşınacak. Mevcut prompt bağlantısı güncellenecek.",
      confirmLabel: "Taşı",
      variant: "warning",
    });
    if (!ok) return;

    setAssigning(true);
    try {
      const res = await assignChannelToBot(channelId, targetBotId);
      if (res.success) {
        await onRefresh();
      }
    } finally {
      setAssigning(false);
    }
  }

  // ── Bot Archiving ──
  async function handleArchive() {
    const hasWhatsApp = channels.some((c) => c.provider === "whatsapp");

    const ok = await confirm({
      title: "Botu Arşivle",
      message: hasWhatsApp
        ? "⚠️ Bu bot aktif WhatsApp kanalları içeriyor. Önce kanalları başka bir bota atayın. WhatsApp kanalı olan botlar arşivlenemez."
        : `"${bot.displayName}" arşivlenecek. Bağlı kanallar atanmamış duruma geçecek ve prompt bağlantıları devre dışı kalacak. Bu işlem geri alınamaz.`,
      confirmLabel: hasWhatsApp ? "Anladım" : "Arşivle",
      variant: "danger",
    });

    if (!ok || hasWhatsApp) return;

    setArchiving(true);
    try {
      const res = await archiveBot(bot.id);
      if (res.success) {
        onBotArchived();
      }
    } finally {
      setArchiving(false);
    }
  }

  // ── Load unassigned channels ──
  async function loadUnassigned() {
    setLoadingUnassigned(true);
    try {
      const res = await getUnassignedChannels();
      if (res.success && res.channels) {
        setUnassignedChannels(res.channels);
      }
    } finally {
      setLoadingUnassigned(false);
    }
  }

  useEffect(() => {
    if (showAssignModal) {
      loadUnassigned();
    }
  }, [showAssignModal]);

  return (
    <div className="space-y-6">
      {/* Connected Channels */}
      <div className="rounded-2xl border" style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--q-border-default)" }}>
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
            <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>
              Bağlı Kanallar ({channels.length})
            </h3>
          </div>
          <button
            onClick={() => setShowAssignModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg border transition-all hover:bg-black/[0.02]"
            style={{ color: "var(--q-primary, #6366f1)", borderColor: "var(--q-border-default)" }}
          >
            <ArrowRightLeft className="w-3 h-3" />
            Kanal Ata
          </button>
        </div>

        {channels.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Link2 className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--q-text-placeholder)" }} />
            <p className="text-xs font-medium" style={{ color: "var(--q-text-secondary)" }}>
              Bu bota henüz kanal atanmadı
            </p>
            <p className="text-[10px] mt-1" style={{ color: "var(--q-text-placeholder)" }}>
              Yukarıdaki &quot;Kanal Ata&quot; butonunu kullanarak kanal ekleyebilirsiniz
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--q-border-default)" }}>
            {channels.map((ch) => {
              const providerInfo = PROVIDER_LABELS[ch.provider] || { label: ch.provider, color: "var(--q-text-secondary)" };
              const warnings: string[] = [];
              if (!ch.hasPromptBinding) warnings.push("Prompt bağlı değil");
              if (!ch.hasCredentials) warnings.push("Kimlik bilgisi eksik");

              return (
                <div key={ch.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: warnings.length === 0 ? "var(--q-green)" : "var(--q-yellow, #f59e0b)",
                      }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate" style={{ color: "var(--q-text-primary)" }}>
                          {ch.name}
                        </span>
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-md flex-shrink-0"
                          style={{ backgroundColor: `${providerInfo.color}15`, color: providerInfo.color }}
                        >
                          {providerInfo.label}
                        </span>
                      </div>
                      {warnings.length > 0 && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: "var(--q-yellow, #f59e0b)" }} />
                          <span className="text-[10px]" style={{ color: "var(--q-yellow, #f59e0b)" }}>
                            {warnings.join(" · ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Move to other bot */}
                  {otherBots.length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleMoveChannel(ch.id, e.target.value);
                      }}
                      className="text-[10px] font-medium px-2 py-1 rounded-lg border outline-none cursor-pointer"
                      style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-secondary)" }}
                      disabled={assigning}
                    >
                      <option value="">Taşı →</option>
                      {otherBots.map((ob) => (
                        <option key={ob.id} value={ob.id}>
                          {ob.displayName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Archive Bot */}
      <div
        className="rounded-2xl border p-5"
        style={{ borderColor: "var(--q-border-default)", backgroundColor: "#fff" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Archive className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />
            <div>
              <h3 className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>Botu Arşivle</h3>
              <p className="text-[10px]" style={{ color: "var(--q-text-secondary)" }}>
                Bot arşivlenirse bağlı kanallar atanmamış duruma geçer
              </p>
            </div>
          </div>
          <button
            onClick={handleArchive}
            disabled={archiving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all hover:bg-red-50 disabled:opacity-50"
            style={{ color: "var(--q-red, #ef4444)", borderColor: "var(--q-red, #ef4444)" }}
          >
            {archiving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Archive className="w-3.5 h-3.5" />
            )}
            Arşivle
          </button>
        </div>
      </div>

      {/* Assign Channel Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAssignModal(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            style={{ border: "1px solid var(--q-border-default)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold" style={{ color: "var(--q-text-primary)" }}>
                Kanal Ata
              </h3>
              <button onClick={() => setShowAssignModal(false)} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
              </button>
            </div>

            <p className="text-xs mb-4" style={{ color: "var(--q-text-secondary)" }}>
              Atanmamış veya diğer botlardaki kanalları &quot;{bot.displayName}&quot; botuna atayabilirsiniz.
            </p>

            {loadingUnassigned ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--q-text-secondary)" }} />
              </div>
            ) : (
              <div className="space-y-4 max-h-[300px] overflow-y-auto">
                {/* Unassigned Channels */}
                {unassignedChannels.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--q-text-secondary)" }}>
                      Atanmamış Kanallar
                    </p>
                    {unassignedChannels.map((ch) => (
                      <div key={ch.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-black/[0.02]">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium" style={{ color: "var(--q-text-primary)" }}>{ch.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(0,0,0,0.04)", color: "var(--q-text-secondary)" }}>
                            {ch.provider}
                          </span>
                        </div>
                        <button
                          onClick={() => handleAssignChannel(ch.id)}
                          disabled={assigning}
                          className="text-[10px] font-bold px-2 py-1 rounded-md text-white disabled:opacity-50"
                          style={{ backgroundColor: "var(--q-primary, #6366f1)" }}
                        >
                          Ata
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Channels from other bots */}
                {otherBots.map((ob) => {
                  if (ob.channels.length === 0) return null;
                  return (
                    <div key={ob.id}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--q-text-secondary)" }}>
                        {ob.displayName}
                      </p>
                      {ob.channels.map((ch) => (
                        <div key={ch.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-black/[0.02]">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium" style={{ color: "var(--q-text-primary)" }}>{ch.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(0,0,0,0.04)", color: "var(--q-text-secondary)" }}>
                              {ch.provider}
                            </span>
                          </div>
                          <button
                            onClick={() => handleAssignChannel(ch.id)}
                            disabled={assigning}
                            className="text-[10px] font-bold px-2 py-1 rounded-md border disabled:opacity-50"
                            style={{ color: "var(--q-primary, #6366f1)", borderColor: "var(--q-border-default)" }}
                          >
                            Buraya Taşı
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {unassignedChannels.length === 0 && otherBots.every((ob) => ob.channels.length === 0) && (
                  <p className="text-center text-xs py-4" style={{ color: "var(--q-text-secondary)" }}>
                    Atanabilecek kanal bulunamadı
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
