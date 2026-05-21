"use client";

import { useEffect, useState } from "react";
import { getDashboardStats } from "@/app/actions/dashboard";
import { MessageSquare, Bot, TrendingUp, Activity, ClipboardList } from "lucide-react";
import { PageLoader, EmptyState } from "@/components/ui/shared-states";
import { SectionCard } from "@/components/governance";
import { useTenant } from "@/components/providers/tenant-provider";
import { useWorkspacePlugins } from "@/lib/plugins/registry";

// ==========================================
// QUBA AI — Dashboard Ana Sayfa (Hydrated)
// ==========================================

export default function DashboardPage() {
  const { tenant, hasFeature } = useTenant();
  const { activePlugins } = useWorkspacePlugins();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardStats().then((res) => {
      if (res.success && res.data) {
        setStats(res.data);
      }
      setLoading(false);
    });
  }, []);

  if (loading) return <PageLoader />;

  if (!stats) {
    return <EmptyState title="Veri yüklenemedi" description="Lütfen sayfayı yenileyin." />;
  }

  const cards = [
    { label: "Toplam Konuşma", value: stats.totalConversations, icon: <MessageSquare className="w-5 h-5" />, color: "var(--q-blue)" },
    { label: "Toplam Mesaj", value: stats.totalMessages, icon: <TrendingUp className="w-5 h-5" />, color: "var(--q-purple)" },
    { label: "Form Başvurusu", value: stats.totalLeads, icon: <ClipboardList className="w-5 h-5" />, color: "var(--q-orange)" },
    { label: "Bot Mesajları", value: stats.botMessages, icon: <Bot className="w-5 h-5" />, color: "var(--q-green)" },
    { label: "Bugün Aktif", value: stats.activeToday, icon: <Activity className="w-5 h-5" />, color: "var(--q-red)" },
  ];

  // 7 günlük mesaj grafiği
  const maxMsg = Math.max(...stats.dailyMessages.map((d: any) => d.count), 1);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-6 pb-20 space-y-6">
        {/* Header (Hydrated via Tenant Context) */}
        <div>
          <h1 className="text-[22px] font-bold text-[--q-text-primary] flex items-center gap-2">
            {tenant?.profile.logo_url && (
              <img src={tenant.profile.logo_url} alt="Logo" className="w-8 h-8 rounded-lg shadow-sm object-cover" />
            )}
            Hoş geldiniz, {tenant?.profile.name || stats.tenantName} 👋
          </h1>
          <p className="text-[13px] text-[--q-text-secondary] mt-1">
            {tenant?.profile.industry === 'health' ? 'Sağlık CRM Operasyon Merkezi' : 'Çok Kanallı İletişim Platformu'}
          </p>
        </div>

        {/* Phase 1: Metrikler */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {cards.map((c, i) => (
            <div key={i} className="bg-white p-4 rounded-2xl border border-black/5 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
              <div className="flex items-center gap-2 text-[--q-text-secondary] mb-2">
                <div style={{ color: c.color }}>{c.icon}</div>
                <span className="text-[12px] font-medium">{c.label}</span>
              </div>
              <div className="text-xl font-bold text-[--q-text-primary]">{c.value.toLocaleString()}</div>
            </div>
          ))}
        </div>

        {/* Dynamic Workspace Plugins */}
        <div className="space-y-6">
          {activePlugins.map(plugin => {
            const PluginComponent = plugin.component;
            return <PluginComponent key={plugin.id} />;
          })}
        </div>

        {/* 7 Gün Mesaj Grafiği */}
        {stats.dailyMessages.length > 0 && (
          <SectionCard>
            <h2 className="text-[15px] font-semibold mb-4" style={{ color: "var(--q-text-primary)" }}>Son 7 Gün</h2>
            <div className="flex items-end gap-2 h-32">
              {stats.dailyMessages.map((d: any, i: number) => {
                const height = (d.count / maxMsg) * 100;
                const dayLabel = new Date(d.day).toLocaleDateString('tr-TR', { weekday: 'short' });
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-medium" style={{ color: "var(--q-text-secondary)" }}>{d.count}</span>
                    <div
                      className="w-full rounded-t-lg transition-all"
                      style={{ height: `${Math.max(height, 4)}%`, background: "linear-gradient(to top, var(--q-blue), var(--q-purple))" }}
                    />
                    <span className="text-[10px]" style={{ color: "var(--q-text-secondary)" }}>{dayLabel}</span>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        {/* Son Başvurular */}
        {stats.recentLeads.length > 0 && (
          <SectionCard noPadding>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--q-border-default)" }}>
              <h2 className="text-[15px] font-semibold" style={{ color: "var(--q-text-primary)" }}>Son Başvurular</h2>
            </div>
            <div className="divide-y divide-black/5">
              {stats.recentLeads.map((lead: any, i: number) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-medium" style={{ color: "var(--q-text-primary)" }}>{lead.patient_name || 'İsimsiz'}</p>
                    <p className="text-[12px]" style={{ color: "var(--q-text-secondary)" }}>{lead.form_name || 'Form'}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-[11px] px-2 py-1 rounded-full font-medium`}
                      style={{
                        backgroundColor: lead.stage === 'appointed' ? 'var(--q-green-bg)' : lead.stage === 'contacted' ? 'var(--q-blue-bg)' : 'var(--q-orange-bg)',
                        color: lead.stage === 'appointed' ? 'var(--q-green)' : lead.stage === 'contacted' ? 'var(--q-blue)' : 'var(--q-orange)'
                      }}
                    >
                      {lead.stage === 'appointed' ? 'Randevu' : lead.stage === 'contacted' ? 'İletişimde' : 'Yeni'}
                    </span>
                    <p className="text-[11px] mt-1" style={{ color: "var(--q-text-secondary)" }}>
                      {new Date(lead.created_at).toLocaleDateString('tr-TR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
