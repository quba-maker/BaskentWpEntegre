import { Power } from "lucide-react";
import { type BotChannel } from "./shared";
import { ToggleSwitch } from "@/components/governance";

// ==========================================
// CHANNEL STATUS PANEL
// Authority: Channel activation/deactivation
// Data owner: channel_*_enabled bot settings
// ==========================================

interface ChannelStatusPanelProps {
  channels: BotChannel[];
  isChannelActive: (id: string) => boolean;
  onToggleChannel: (id: string) => void;
  onSelectChannel: (id: string) => void;
}

export function ChannelStatusPanel({ channels, isChannelActive, onToggleChannel, onSelectChannel }: ChannelStatusPanelProps) {
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
