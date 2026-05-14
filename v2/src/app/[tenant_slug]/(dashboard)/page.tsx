"use client";

import { useEffect, useState } from "react";
import { getDashboardStats } from "@/app/actions/dashboard";
import { MessageSquare, Users, Bot, TrendingUp, Activity, ClipboardList, Loader2 } from "lucide-react";

// ==========================================
// QUBA AI — Dashboard Ana Sayfa
// ==========================================

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboardStats().then((data) => {
      setStats(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#86868B]" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="h-full flex items-center justify-center text-[#86868B]">
        Veri yüklenemedi.
      </div>
    );
  }

  const cards = [
    { label: "Toplam Konuşma", value: stats.totalConversations, icon: <MessageSquare className="w-5 h-5" />, color: "#007AFF" },
    { label: "Toplam Mesaj", value: stats.totalMessages, icon: <TrendingUp className="w-5 h-5" />, color: "#5856D6" },
    { label: "Form Başvurusu", value: stats.totalLeads, icon: <ClipboardList className="w-5 h-5" />, color: "#FF9500" },
    { label: "Bot Mesajları", value: stats.botMessages, icon: <Bot className="w-5 h-5" />, color: "#34C759" },
    { label: "Bugün Aktif", value: stats.activeToday, icon: <Activity className="w-5 h-5" />, color: "#FF3B30" },
  ];

  // 7 günlük mesaj grafiği
  const maxMsg = Math.max(...stats.dailyMessages.map((d: any) => d.count), 1);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto p-6 pb-20 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-[22px] font-bold text-[#1D1D1F]">
            Hoş geldiniz 👋
          </h1>
          <p className="text-[13px] text-[#86868B] mt-1">
            {stats.tenantName} — Genel Bakış
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {cards.map((card, i) => (
            <div key={i} className="bg-white rounded-2xl border border-black/5 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <span style={{ color: card.color }}>{card.icon}</span>
              </div>
              <p className="text-[24px] font-bold text-[#1D1D1F]">{card.value.toLocaleString('tr-TR')}</p>
              <p className="text-[11px] text-[#86868B] mt-0.5">{card.label}</p>
            </div>
          ))}
        </div>

        {/* 7 Gün Mesaj Grafiği */}
        {stats.dailyMessages.length > 0 && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
            <h2 className="text-[15px] font-semibold text-[#1D1D1F] mb-4">Son 7 Gün</h2>
            <div className="flex items-end gap-2 h-32">
              {stats.dailyMessages.map((d: any, i: number) => {
                const height = (d.count / maxMsg) * 100;
                const dayLabel = new Date(d.day).toLocaleDateString('tr-TR', { weekday: 'short' });
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] text-[#86868B] font-medium">{d.count}</span>
                    <div
                      className="w-full bg-gradient-to-t from-[#007AFF] to-[#5856D6] rounded-t-lg transition-all"
                      style={{ height: `${Math.max(height, 4)}%` }}
                    />
                    <span className="text-[10px] text-[#86868B]">{dayLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Son Başvurular */}
        {stats.recentLeads.length > 0 && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-black/5">
              <h2 className="text-[15px] font-semibold text-[#1D1D1F]">Son Başvurular</h2>
            </div>
            <div className="divide-y divide-black/5">
              {stats.recentLeads.map((lead: any, i: number) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-medium text-[#1D1D1F]">{lead.patient_name || 'İsimsiz'}</p>
                    <p className="text-[12px] text-[#86868B]">{lead.form_name || 'Form'}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${
                      lead.stage === 'appointed' ? 'bg-[#34C759]/10 text-[#34C759]' :
                      lead.stage === 'contacted' ? 'bg-[#007AFF]/10 text-[#007AFF]' :
                      'bg-[#FF9500]/10 text-[#FF9500]'
                    }`}>
                      {lead.stage === 'appointed' ? 'Randevu' : lead.stage === 'contacted' ? 'İletişimde' : 'Yeni'}
                    </span>
                    <p className="text-[11px] text-[#86868B] mt-1">
                      {new Date(lead.created_at).toLocaleDateString('tr-TR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
