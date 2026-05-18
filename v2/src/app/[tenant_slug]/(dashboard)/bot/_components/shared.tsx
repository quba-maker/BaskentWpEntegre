// ==========================================
// BOT PAGE — SHARED DOMAIN COMPONENTS
// Bot-specific display components.
// 
// GOVERNANCE RULE:
// SaveButton → @/components/governance
// ToggleSwitch → @/components/governance
// These domain components stay here because they're
// specific to bot panel layout patterns.
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

// ---- Domain-Specific Display Components ----

export function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: any; color: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4" style={{ border: "1px solid var(--q-border-default)" }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15` }}>
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--q-text-secondary)" }}>{label}</span>
      </div>
      <p className="text-2xl font-bold tracking-tight" style={{ color: "var(--q-text-primary)" }}>{value}</p>
    </div>
  );
}

export function SettingRow({ icon: Icon, iconColor, title, description, children }: { icon: any; iconColor: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${iconColor}15` }}>
          <Icon className="w-4 h-4" style={{ color: iconColor }} />
        </div>
        <div>
          <p className="text-sm font-bold leading-tight" style={{ color: "var(--q-text-primary)" }}>{title}</p>
          <p className="text-[11px] font-medium leading-tight mt-0.5" style={{ color: "var(--q-text-secondary)" }}>{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
