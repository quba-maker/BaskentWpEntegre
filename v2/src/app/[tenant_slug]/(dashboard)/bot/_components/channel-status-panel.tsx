import { Power } from "lucide-react";
import { type BotChannel } from "./shared";

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
      <h2 className="text-lg font-bold text-[--q-text-primary] mb-4 flex items-center gap-2">
        <Power className="w-5 h-5 text-[--q-text-secondary]" />
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
                  ? "bg-white border-[--q-border-default] shadow-sm" 
                  : "bg-black/[0.02] border-[--q-border-default] opacity-60"
              }`}
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
                    <p className="text-sm font-bold text-[--q-text-primary]">{ch.label}</p>
                    <p className="text-[11px] text-[--q-text-secondary] font-medium">{ch.description}</p>
                  </div>
                </div>
                
                {/* Toggle Switch */}
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleChannel(ch.id); }}
                  className={`relative w-[51px] h-[31px] rounded-full transition-colors duration-300 shrink-0 ${
                    active ? "bg-[--q-green]" : "bg-[--q-bg-tertiary]"
                  }`}
                >
                  <div className={`absolute top-[2px] w-[27px] h-[27px] bg-white rounded-full shadow-md transition-transform duration-300 ${
                    active ? "translate-x-[22px]" : "translate-x-[2px]"
                  }`} />
                </button>
              </div>
              
              {/* Status Badge */}
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${active ? "bg-[--q-green] animate-pulse" : "bg-[--q-text-secondary]"}`} />
                <span className={`text-[11px] font-semibold uppercase tracking-wider ${active ? "text-[--q-green]" : "text-[--q-text-secondary]"}`}>
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
