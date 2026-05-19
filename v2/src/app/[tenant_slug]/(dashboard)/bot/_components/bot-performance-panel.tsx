import { Activity, TrendingUp, Users, Timer } from "lucide-react";
import { StatCard } from "./shared";

// ==========================================
// BOT PERFORMANCE PANEL
// Authority: Bot statistics & analytics display
// Data owner: getBotStats() action
// ==========================================

interface BotPerformancePanelProps {
  stats: any;
  statsPeriod: string;
  onPeriodChange: (period: string) => void;
  modelUsage?: any;
}

const PERIOD_OPTIONS = [
  { value: "7d", label: "7 Gün" },
  { value: "30d", label: "30 Gün" },
  { value: "90d", label: "90 Gün" },
  { value: "all", label: "Tümü" },
];

export function BotPerformancePanel({ stats, statsPeriod, onPeriodChange, modelUsage }: BotPerformancePanelProps) {
  if (!stats) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-[--q-text-primary] flex items-center gap-2">
          <Activity className="w-5 h-5 text-[--q-text-secondary]" />
          Bot Performansı
        </h2>
        {/* Apple-style Segmented Control */}
        <div className="flex items-center gap-0.5 p-[3px] bg-black/[0.06] rounded-lg">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onPeriodChange(opt.value)}
              className={`px-3 py-1 text-[12px] font-semibold rounded-md transition-all duration-200 ${
                statsPeriod === opt.value
                  ? "bg-white text-[--q-text-primary] shadow-sm"
                  : "text-[--q-text-secondary] hover:text-[--q-text-primary]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={Activity} label="Bot Mesajı" value={stats.weeklyMessages} color="var(--q-blue)" />
        <StatCard icon={TrendingUp} label="Bot Başarı Oranı" value={`%${stats.botSuccessRate}`} color="var(--q-green)" />
        <StatCard icon={Users} label="İnsana Devir" value={`%${stats.handoverRate}`} color="var(--q-orange)" />
        <StatCard icon={Timer} label="Ort. Yanıt Süresi" value={stats.avgResponseMin > 0 ? `${stats.avgResponseMin} dk` : "<1 dk"} color="var(--q-purple)" />
        {modelUsage && (
          <StatCard icon={Activity} label="Toplam Maliyet" value={`$${modelUsage.totalCost || 0}`} color="var(--q-pink)" />
        )}
      </div>
    </div>
  );
}
