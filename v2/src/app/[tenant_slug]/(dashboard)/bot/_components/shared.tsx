import { Check, Save, Loader2 } from "lucide-react";

// ==========================================
// BOT PAGE — SHARED SUB-COMPONENTS
// Reusable primitives used across all bot panels
// ==========================================

// ---- Types ----

export interface BotChannel {
  id: string;
  label: string;
  icon: any;
  promptKey: string;
  activeKey: string;
  color: string;
  description: string;
}

// ---- Components ----

export function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: any; color: string }) {
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

export function SettingRow({ icon: Icon, iconColor, title, description, children }: { icon: any; iconColor: string; title: string; description: string; children: React.ReactNode }) {
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

export function ToggleSwitch({ active, onToggle }: { active: boolean; onToggle: () => void }) {
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

/**
 * Standardized save button — used across all panels that persist data.
 * Single source of truth for save UX behavior.
 */
export function SaveButton({ 
  saving, 
  saved, 
  onClick, 
  label = "Kaydet",
  savedLabel = "Kaydedildi!",
  color = "#007AFF"
}: { 
  saving: boolean; 
  saved: boolean; 
  onClick: () => void; 
  label?: string;
  savedLabel?: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
        saved
          ? "bg-[#34C759] text-white"
          : `text-white hover:opacity-90 shadow-sm`
      }`}
      style={saved ? undefined : { backgroundColor: color }}
    >
      {saving ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : saved ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <Save className="w-3.5 h-3.5" />
      )}
      {saved ? savedLabel : label}
    </button>
  );
}
