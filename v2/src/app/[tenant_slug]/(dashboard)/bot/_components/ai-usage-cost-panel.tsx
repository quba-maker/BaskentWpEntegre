import { DollarSign, MessageSquare } from "lucide-react";

// ==========================================
// AI USAGE COST PANEL
// Authority: AI usage analytics & cost display
// Data owner: getModelUsage() action (read-only)
// ==========================================

interface AIUsageCostPanelProps {
  modelUsage: any;
}

export function AIUsageCostPanel({ modelUsage }: AIUsageCostPanelProps) {
  if (!modelUsage) return null;

  return (
    <div className="mt-8">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
        <DollarSign className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
        AI Kullanım & Maliyet
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Model Breakdown */}
        <div className="bg-white rounded-2xl shadow-sm p-5" style={{ border: "1px solid var(--q-border-default)" }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--q-text-secondary)" }}>Model Dağılımı</p>
          {Object.entries(modelUsage.models).length > 0 ? Object.entries(modelUsage.models).map(([key, val]: [string, any]) => (
            <div key={key} className="flex items-center justify-between py-2 last:border-0" style={{ borderBottom: "1px solid var(--q-border-default)" }}>
              <div>
                <p className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>{val.label || key}</p>
                <p className="text-[11px]" style={{ color: "var(--q-text-secondary)" }}>{val.count} mesaj</p>
              </div>
              <p className="text-sm font-bold" style={{ color: "var(--q-green)" }}>${val.cost.toFixed(3)}</p>
            </div>
          )) : <p className="text-sm" style={{ color: "var(--q-text-secondary)" }}>Henüz veri yok</p>}
          <div className="mt-3 pt-3 flex justify-between" style={{ borderTop: "1px solid var(--q-border-default)" }}>
            <p className="text-sm font-bold" style={{ color: "var(--q-text-primary)" }}>Toplam</p>
            <p className="text-lg font-bold" style={{ color: "var(--q-blue)" }}>${modelUsage.totalCost}</p>
          </div>
        </div>
        
        {/* Channel Breakdown */}
        <div className="bg-white rounded-2xl shadow-sm p-5" style={{ border: "1px solid var(--q-border-default)" }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--q-text-secondary)" }}>Kanal Dağılımı</p>
          {Object.entries(modelUsage.channels).length > 0 ? Object.entries(modelUsage.channels).map(([ch, count]: [string, any]) => {
            const pct = modelUsage.totalMessages > 0 ? Math.round((count / modelUsage.totalMessages) * 100) : 0;
            const colors: Record<string, string> = {whatsapp: 'var(--q-whatsapp)', instagram: 'var(--q-instagram)', messenger: 'var(--q-messenger)'};
            return (
              <div key={ch} className="mb-3 last:mb-0">
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-semibold capitalize" style={{ color: "var(--q-text-primary)" }}>{ch}</span>
                  <span className="text-xs font-bold" style={{ color: "var(--q-text-secondary)" }}>{count} (%{pct})</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--q-border-default)" }}>
                  <div className="h-full rounded-full" style={{width: `${pct}%`, backgroundColor: colors[ch] || 'var(--q-text-secondary)'}} />
                </div>
              </div>
            );
          }) : <p className="text-sm" style={{ color: "var(--q-text-secondary)" }}>Henüz veri yok</p>}
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--q-border-default)" }}>
            <p className="text-xs" style={{ color: "var(--q-text-secondary)" }}>Toplam: <span className="font-bold" style={{ color: "var(--q-text-primary)" }}>{modelUsage.totalMessages} mesaj</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
