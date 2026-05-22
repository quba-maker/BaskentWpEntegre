import { Power, Link2, AlertTriangle } from "lucide-react";
import { type BotChannel } from "./shared";
import { ToggleSwitch } from "@/components/governance";

// ==========================================
// CHANNEL STATUS PANEL
// Authority: Channel activation/deactivation + V2 binding visibility
// Data owner: channel_*_enabled bot settings + channel_prompt_bindings
// ==========================================

interface ChannelBinding {
  id: string;
  provider: string;
  identifier: string;
  name: string;
  group: string;
  promptName: string | null;
  hasCredentials: boolean;
  healthStatus: string | null;
  warnings: string[];
}

interface ChannelStatusPanelProps {
  channels: BotChannel[];
  isChannelActive: (id: string) => boolean;
  onToggleChannel: (id: string) => void;
  onSelectChannel: (id: string) => void;
  channelBindings?: Record<string, { channels: ChannelBinding[] }>;
}

export function ChannelStatusPanel({ channels, isChannelActive, onToggleChannel, onSelectChannel, channelBindings }: ChannelStatusPanelProps) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
        <Power className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
        Kanal Durumları
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {channels.map(ch => {
          const active = isChannelActive(ch.id);
          const Icon = ch.icon;
          const bindings = channelBindings?.[ch.id]?.channels || [];
          return (
            <div 
              key={ch.id} 
              className="relative rounded-2xl border p-5 transition-all duration-300 cursor-pointer group"
              style={{
                backgroundColor: active ? "#fff" : "rgba(0,0,0,0.02)",
                borderColor: active ? "var(--q-border-default)" : "var(--q-border-default)",
                opacity: active ? 1 : 0.6,
                boxShadow: active ? "0 1px 3px rgba(0,0,0,0.06)" : "none"
              }}
              onClick={() => onSelectChannel(ch.id)}
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
                    <p className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>{ch.label}</p>
                    <p className="text-[11px] font-medium" style={{ color: "var(--q-text-secondary)" }}>{ch.description}</p>
                  </div>
                </div>
                
                {/* Toggle Switch — Governance component */}
                <div onClick={e => e.stopPropagation()}>
                  <ToggleSwitch active={active} onToggle={() => onToggleChannel(ch.id)} />
                </div>
              </div>
              
              {/* Status Badge */}
              <div className="flex items-center gap-1.5">
                <div 
                  className="w-2 h-2 rounded-full" 
                  style={{ 
                    backgroundColor: active ? "var(--q-green)" : "var(--q-text-secondary)",
                    animation: active ? "pulse 2s infinite" : "none"
                  }} 
                />
                <span 
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: active ? "var(--q-green)" : "var(--q-text-secondary)" }}
                >
                  {active ? "Aktif" : "Devre Dışı"}
                </span>
              </div>

              {/* V2 Channel Bindings — Read-only visibility */}
              {bindings.length > 0 && (
                <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--q-border-default)" }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Link2 className="w-3 h-3" style={{ color: "var(--q-text-secondary)" }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--q-text-secondary)" }}>
                      Bağlı Kanallar
                    </span>
                  </div>
                  {bindings.map(b => (
                    <div key={b.id} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div 
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ 
                            backgroundColor: b.warnings.length === 0 
                              ? "var(--q-green)" 
                              : "var(--q-yellow, #f59e0b)" 
                          }}
                        />
                        <span className="text-[11px] truncate" style={{ color: "var(--q-text-primary)" }}>
                          {b.name}
                        </span>
                        {b.promptName && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ backgroundColor: "rgba(0,0,0,0.04)", color: "var(--q-text-secondary)" }}>
                            {b.promptName}
                          </span>
                        )}
                      </div>
                      {b.warnings.length > 0 && (
                        <div className="flex items-center gap-1 flex-shrink-0" title={b.warnings.join(', ')}>
                          <AlertTriangle className="w-3 h-3" style={{ color: "var(--q-yellow, #f59e0b)" }} />
                        </div>
                      )}
                    </div>
                  ))}
                  {bindings.some(b => b.warnings.length > 0) && (
                    <div className="mt-1.5">
                      {bindings.flatMap(b => b.warnings).filter((v, i, a) => a.indexOf(v) === i).map((w, i) => (
                        <p key={i} className="text-[10px] leading-tight" style={{ color: "var(--q-yellow, #f59e0b)" }}>
                          ⚠ {w}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {bindings.length === 0 && channelBindings && (
                <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--q-border-default)" }}>
                  <p className="text-[10px]" style={{ color: "var(--q-text-secondary)" }}>
                    Henüz kanal bağlanmadı
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
