"use client";

import { useState, useEffect } from "react";
import { BarChart3, Activity, TrendingUp, Users, Timer, CircleDollarSign, Zap, MessageSquare } from "lucide-react";
import { getBotStats, getModelUsage } from "@/app/actions/bot";
import { PageLoader } from "@/components/ui/shared-states";
import { PageShell, PageHeader } from "@/components/governance";

const PERIOD_OPTIONS = [
  { value: "7d", label: "7 Gün" },
  { value: "30d", label: "30 Gün" },
  { value: "90d", label: "90 Gün" },
  { value: "all", label: "Tümü" },
];

function StatCard({ icon: Icon, label, value, color, description }: { icon: any, label: string, value: string | number, color: string, description?: string }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-black/5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-all duration-300 hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-black/5" style={{ color }}>
          <Icon className="w-5 h-5" />
        </div>
        <p className="text-[13px] font-semibold text-[--q-text-secondary]">{label}</p>
      </div>
      <p className="text-3xl font-bold text-[--q-text-primary] mb-1">{value}</p>
      {description && <p className="text-[11px] font-medium text-[--q-text-secondary]">{description}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [statsPeriod, setStatsPeriod] = useState("30d");
  const [stats, setStats] = useState<any>(null);
  const [modelUsage, setModelUsage] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const [statsRes, usageRes] = await Promise.all([
          getBotStats(statsPeriod),
          getModelUsage(statsPeriod)
        ]);
        setStats(statsRes);
        setModelUsage(usageRes);
      } catch (error) {
        console.error("Failed to load analytics data:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [statsPeriod]);

  if (isLoading && !stats) return <PageLoader />;

  return (
    <PageShell>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <PageHeader
          icon={BarChart3}
          title="AI Performans & Maliyet"
          subtitle="Bot kullanım metrikleri, dönüşüm oranları ve gerçek zamanlı token maliyetleri."
        />
        
        {/* Apple-style Segmented Control for Period Selection */}
        <div className="flex items-center gap-0.5 p-[3px] bg-black/[0.04] rounded-lg border border-black/5 self-start md:self-auto">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatsPeriod(opt.value)}
              className={`px-4 py-1.5 text-[13px] font-semibold rounded-md transition-all duration-200 ${
                statsPeriod === opt.value
                  ? "bg-white text-[--q-text-primary] shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
                  : "text-[--q-text-secondary] hover:text-[--q-text-primary]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-8">
        {/* ROW 1: Bot Conversion & Speed (Operational Performance) */}
        <section>
          <h2 className="text-sm font-bold text-[--q-text-primary] mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[--q-text-secondary]" />
            Operasyonel Performans
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard 
              icon={MessageSquare} 
              label="Bot Yanıtı" 
              value={stats?.weeklyMessages || 0} 
              color="var(--q-blue)" 
              description="Bu dönemde gönderilen toplam mesaj"
            />
            <StatCard 
              icon={TrendingUp} 
              label="Bot Başarı Oranı" 
              value={`%${stats?.botSuccessRate || 0}`} 
              color="var(--q-green)" 
              description="İnsana devretmeden çözülen görüşmeler"
            />
            <StatCard 
              icon={Users} 
              label="İnsana Devir" 
              value={`%${stats?.handoverRate || 0}`} 
              color="var(--q-orange)" 
              description="Temsilciye yönlendirilen görüşmeler"
            />
            <StatCard 
              icon={Timer} 
              label="Ortalama Yanıt Hızı" 
              value={(stats?.avgResponseMin || 0) > 0 ? `${stats?.avgResponseMin} dk` : "<1 dk"} 
              color="var(--q-purple)" 
              description="Müşteriye dönüş süresi"
            />
          </div>
        </section>

        {/* ROW 2: Financial Metrics (Exact Token Based) */}
        {modelUsage && (
          <section>
            <h2 className="text-sm font-bold text-[--q-text-primary] mb-4 flex items-center gap-2 mt-8">
              <CircleDollarSign className="w-4 h-4 text-[--q-text-secondary]" />
              Gerçek Zamanlı Maliyet (Token Bazlı)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard 
                icon={CircleDollarSign} 
                label="Toplam Maliyet (USD)" 
                value={`$${modelUsage.totalCostUsd?.toFixed(3) || "0.000"}`} 
                color="var(--q-pink)" 
                description="Token bazlı net fatura"
              />
              <StatCard 
                icon={CircleDollarSign} 
                label="Toplam Maliyet (TRY)" 
                value={`₺${modelUsage.totalCostTry?.toFixed(2) || "0.00"}`} 
                color="var(--q-pink)" 
                description={`Tahmini Kur: ${modelUsage.exchangeRate}₺`}
              />
              <StatCard 
                icon={Zap} 
                label="Ort. Mesaj Maliyeti" 
                value={`₺${modelUsage.avgCostPerMessageTry?.toFixed(4) || "0.0000"}`} 
                color="var(--q-blue)" 
                description={`Mesaj başına: $${modelUsage.avgCostPerMessageUsd?.toFixed(4) || "0.0000"}`}
              />
              <StatCard 
                icon={Activity} 
                label="İşlenen Token" 
                value={`${((modelUsage.totalPromptTokens + modelUsage.totalCompletionTokens) / 1000).toFixed(1)}k`} 
                color="var(--q-green)" 
                description={`Girdi: ${modelUsage.totalPromptTokens} | Çıktı: ${modelUsage.totalCompletionTokens}`}
              />
            </div>

            {/* Model Breakdown Table */}
            {Object.keys(modelUsage.models || {}).length > 0 && (
              <div className="mt-6 bg-white rounded-xl border border-black/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-black/5">
                  <h3 className="text-[13px] font-bold text-[--q-text-primary]">Model Kırılımı</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead className="bg-black/[0.02] text-[--q-text-secondary]">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Model Adı</th>
                        <th className="px-5 py-3 font-semibold">Gönderilen Mesaj</th>
                        <th className="px-5 py-3 font-semibold text-right">Maliyet (USD)</th>
                        <th className="px-5 py-3 font-semibold text-right">Maliyet (TRY)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {Object.values(modelUsage.models).map((m: any, i) => (
                        <tr key={i} className="hover:bg-black/[0.01] transition-colors">
                          <td className="px-5 py-3 font-medium text-[--q-text-primary]">{m.label}</td>
                          <td className="px-5 py-3 text-[--q-text-secondary]">{m.count}</td>
                          <td className="px-5 py-3 text-right font-medium text-[--q-text-primary]">${m.costUsd?.toFixed(4)}</td>
                          <td className="px-5 py-3 text-right text-[--q-text-secondary]">₺{m.costTry?.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </PageShell>
  );
}
