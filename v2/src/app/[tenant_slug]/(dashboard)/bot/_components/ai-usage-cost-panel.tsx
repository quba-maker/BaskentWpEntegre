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
      <h2 className="text-lg font-bold text-[#1D1D1F] mb-4 flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-[#86868B]" />
        AI Kullanım & Maliyet
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Model Breakdown */}
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-3">Model Dağılımı</p>
          {Object.entries(modelUsage.models).length > 0 ? Object.entries(modelUsage.models).map(([key, val]: [string, any]) => (
            <div key={key} className="flex items-center justify-between py-2 border-b border-black/5 last:border-0">
              <div>
                <p className="text-sm font-bold text-[#1D1D1F]">{val.label || key}</p>
                <p className="text-[11px] text-[#86868B]">{val.count} mesaj</p>
              </div>
              <p className="text-sm font-bold text-[#34C759]">${val.cost.toFixed(3)}</p>
            </div>
          )) : <p className="text-sm text-[#86868B]">Henüz veri yok</p>}
          <div className="mt-3 pt-3 border-t border-black/5 flex justify-between">
            <p className="text-sm font-bold text-[#1D1D1F]">Toplam</p>
            <p className="text-lg font-bold text-[#007AFF]">${modelUsage.totalCost}</p>
          </div>
        </div>
        
        {/* Channel Breakdown */}
        <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
          <p className="text-xs font-semibold text-[#86868B] uppercase tracking-wider mb-3">Kanal Dağılımı</p>
          {Object.entries(modelUsage.channels).length > 0 ? Object.entries(modelUsage.channels).map(([ch, count]: [string, any]) => {
            const pct = modelUsage.totalMessages > 0 ? Math.round((count / modelUsage.totalMessages) * 100) : 0;
            const colors: Record<string, string> = {whatsapp: '#25D366', instagram: '#E1306C', messenger: '#007AFF'};
            return (
              <div key={ch} className="mb-3 last:mb-0">
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-semibold text-[#1D1D1F] capitalize">{ch}</span>
                  <span className="text-xs font-bold text-[#86868B]">{count} (%{pct})</span>
                </div>
                <div className="h-2 bg-black/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{width: `${pct}%`, backgroundColor: colors[ch] || '#86868B'}} />
                </div>
              </div>
            );
          }) : <p className="text-sm text-[#86868B]">Henüz veri yok</p>}
          <div className="mt-3 pt-3 border-t border-black/5">
            <p className="text-xs text-[#86868B]">Toplam: <span className="font-bold text-[#1D1D1F]">{modelUsage.totalMessages} mesaj</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}
