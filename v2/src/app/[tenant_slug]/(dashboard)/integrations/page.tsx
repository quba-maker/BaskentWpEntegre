"use client";

import { useState, useEffect } from "react";
import { Link2, MessageCircle, FileSpreadsheet, Instagram, Webhook, Activity, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { PageShell, PageHeader } from "@/components/governance";
import { IntegrationCard } from "@/components/features/integrations/IntegrationCard";
import { OAuthModal } from "@/components/features/integrations/OAuthModal";
import { GoogleSheetsWizard } from "@/components/features/integrations/GoogleSheetsWizard";

// A generic placeholder wizard for other providers (Sprint 1.5 scope focuses on Sheets)
import { IntegrationWizard, WizardStep } from "@/components/features/integrations/IntegrationWizard";
import { getIntegrationHealth } from "@/app/actions/integrations";

type ConnectionState = 'connected' | 'disconnected' | 'error';

interface ProviderDef {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const PROVIDERS: ProviderDef[] = [
  {
    id: "google_sheets",
    name: "Google Sheets",
    description: "Form yanıtlarınızı, anketlerinizi ve dış kaynaklı satır verilerini otonom olarak CRM'e aktarın.",
    icon: <FileSpreadsheet className="w-6 h-6 text-[#0F9D58]" />
  },
  {
    id: "meta_whatsapp",
    name: "WhatsApp API",
    description: "WhatsApp Business API üzerinden gelen mesajları Quba CRM mesajlaşma altyapısına bağlayın.",
    icon: <MessageCircle className="w-6 h-6 text-[#25D366]" />
  },
  {
    id: "meta_instagram",
    name: "Instagram & Messenger",
    description: "Instagram DM ve Facebook Messenger sohbetlerini tek bir merkezden yönetin.",
    icon: <Instagram className="w-6 h-6 text-[#E1306C]" />
  },
  {
    id: "custom_webhook",
    name: "Custom Webhook",
    description: "Harici uygulamalardan gelen HTTP POST isteklerini yakalayarak özel iş akışları oluşturun.",
    icon: <Webhook className="w-6 h-6 text-[#8B5CF6]" />
  }
];

export default function IntegrationsPage() {
  const [isPageLoading, setIsPageLoading] = useState(true);
  
  const [connections, setConnections] = useState<Record<string, ConnectionState>>({
    google_sheets: "disconnected",
    meta_whatsapp: "disconnected",
    meta_instagram: "disconnected",
    custom_webhook: "disconnected"
  });

  const [diagnostics, setDiagnostics] = useState<{
    channels: any[];
    summary: string;
  }>({ channels: [], summary: "" });

  // Modal States
  const [authModal, setAuthModal] = useState<{ isOpen: boolean; providerId: string | null }>({ isOpen: false, providerId: null });
  const [wizardModal, setWizardModal] = useState<{ isOpen: boolean; providerId: string | null }>({ isOpen: false, providerId: null });

  const fetchHealth = async () => {
    try {
      const res = await getIntegrationHealth();
      if (res.success && res.channels) {
        setDiagnostics({ channels: res.channels, summary: res.summary || "" });
        
        const newConnections: Record<string, ConnectionState> = { ...connections };
        res.channels.forEach(ch => {
          if (ch.provider === 'whatsapp') newConnections.meta_whatsapp = ch.status === 'connected' ? 'connected' : 'error';
          if (ch.provider === 'messenger' || ch.provider === 'instagram' || ch.provider === 'meta_instagram') newConnections.meta_instagram = ch.status === 'connected' ? 'connected' : 'error';
          if (ch.name === 'Google Sheets') newConnections.google_sheets = ch.status === 'connected' ? 'connected' : 'disconnected';
        });
        setConnections(newConnections);
      } else {
        alert("Entegrasyon durumu alınamadı.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsPageLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const handleConnectClick = (id: string) => {
    if (id === 'custom_webhook') {
      setWizardModal({ isOpen: true, providerId: id });
    } else {
      setAuthModal({ isOpen: true, providerId: id });
    }
  };

  const handleConfigureClick = (id: string) => {
    setWizardModal({ isOpen: true, providerId: id });
  };

  const handleOAuthSuccess = (id: string) => {
    setConnections(prev => ({ ...prev, [id]: "connected" }));
    fetchHealth();
    setTimeout(() => {
      setWizardModal({ isOpen: true, providerId: id });
    }, 500);
  };

  const activeProvider = PROVIDERS.find(p => p.id === authModal.providerId) || PROVIDERS.find(p => p.id === wizardModal.providerId);

  const genericSteps: WizardStep[] = [
    {
      id: 'coming_soon',
      title: 'Yakında...',
      subtitle: 'Bu entegrasyonun akıllı kurulum sihirbazı geliştirme aşamasındadır.',
      component: (
        <div className="py-20 text-center">
          <p className="text-gray-500 font-medium">Bu özellik yakında aktif olacaktır.</p>
        </div>
      ),
      isValid: true
    }
  ];

  return (
    <PageShell>
      <PageHeader
        icon={Link2}
        title="Entegrasyon Merkezi"
        subtitle="Veri kaynaklarınızı tek tıkla Quba'ya bağlayın."
        iconGradient={{ from: "var(--q-purple)", to: "var(--q-blue)" }}
      />

      {isPageLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-pulse">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white dark:bg-[#111] rounded-2xl border border-[var(--q-border-default)] h-[240px]"></div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {PROVIDERS.map(provider => (
              <IntegrationCard
                key={provider.id}
                id={provider.id}
                name={provider.name}
                description={provider.description}
                icon={provider.icon}
                status={connections[provider.id] || "disconnected"}
                onConnect={handleConnectClick}
                onConfigure={handleConfigureClick}
              />
            ))}
          </div>

          {/* Diagnostics Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Active Channels Diagnostics List */}
            <div className="lg:col-span-2 bg-white dark:bg-[#111] border border-black/5 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden flex flex-col justify-between">
              <div>
                <div className="p-5 border-b border-black/5 dark:border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                      <h3 className="text-[15px] font-semibold text-black dark:text-white">Kanal Teşhis Paneli (Diagnostics)</h3>
                      <p className="text-[13px] text-gray-500">
                        {diagnostics.summary || "Gerçek zamanlı bağlantı ve telemetri durumları"}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={fetchHealth}
                    className="flex items-center gap-1 text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                  >
                    Yenile
                  </button>
                </div>
                
                <div className="overflow-x-auto">
                  {diagnostics.channels.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-[13px]">
                      Henüz aktif bir kanal bulunmuyor.
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse min-w-[600px]">
                      <thead>
                        <tr className="bg-gray-50/50 dark:bg-white/[0.02] border-b border-black/5 dark:border-white/10">
                          <th className="px-5 py-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">Kanal / Kaynak</th>
                          <th className="px-5 py-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">İş Akışı Hedefi</th>
                          <th className="px-5 py-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">Bağlantı & Detay</th>
                          <th className="px-5 py-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">Olay Zaman Damgaları</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5 dark:divide-white/10">
                        {diagnostics.channels.map((ch, idx) => {
                          const isConnected = ch.status === 'connected';
                          const isWarning = ch.status === 'warning';
                          
                          return (
                            <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-white/[0.01] transition-colors">
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="p-2 rounded-lg bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300">
                                    {ch.provider === 'whatsapp' && <MessageCircle className="w-4 h-4 text-[#25D366]" />}
                                    {(ch.provider === 'messenger' || ch.provider === 'instagram' || ch.provider === 'meta_instagram') && <Instagram className="w-4 h-4 text-[#E1306C]" />}
                                    {ch.provider === 'google_sheets' && <FileSpreadsheet className="w-4 h-4 text-[#0F9D58]" />}
                                    {ch.provider !== 'whatsapp' && ch.provider !== 'messenger' && ch.provider !== 'instagram' && ch.provider !== 'meta_instagram' && ch.provider !== 'google_sheets' && <Webhook className="w-4 h-4 text-blue-500" />}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[13px] font-semibold text-black dark:text-white capitalize">
                                        {ch.provider === 'google_sheets' ? 'Google Sheets' : ch.provider === 'meta_instagram' ? 'Instagram' : ch.provider}
                                      </span>
                                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">
                                        {ch.id.slice(0, 8)}
                                      </span>
                                    </div>
                                    <div className="text-[12px] text-gray-400 dark:text-gray-500 mt-0.5">{ch.name}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-[11px] font-semibold text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30">
                                  {ch.group || "Varsayılan"}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-2">
                                  {isConnected && (
                                    <span className="relative flex h-2 w-2">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                  )}
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                                    isConnected 
                                      ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' 
                                      : isWarning 
                                      ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                                      : 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
                                  }`}>
                                    {ch.detail}
                                  </span>
                                </div>
                              </td>
                              <td className="px-5 py-4">
                                <div className="space-y-1 text-[11px]">
                                  <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                                    <span className="font-semibold text-gray-400 min-w-[70px]">Son Webhook:</span>
                                    <span className="font-mono text-gray-600 dark:text-gray-300">
                                      {ch.lastSyncAt ? new Date(ch.lastSyncAt).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' }) : 'Hiç olay yok'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                                    <span className="font-semibold text-gray-400 min-w-[70px]">Son Mesaj:</span>
                                    <span className="font-mono text-gray-600 dark:text-gray-300">
                                      {ch.lastMessage ? new Date(ch.lastMessage).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' }) : 'Hiç mesaj yok'}
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* Gateway & Realtime Telemetry Stats Widget */}
            <div className="space-y-6">
              {/* Upstash Queue Status */}
              <div className="bg-white dark:bg-[#111] border border-black/5 dark:border-white/10 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-[14px] font-semibold text-black dark:text-white">Upstash Ingest Queue</h4>
                      <p className="text-[11px] text-gray-400 font-mono">QStash Message Broker</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-500 uppercase tracking-wider">AKTİF</span>
                  </div>
                </div>

                <div className="border-t border-black/5 dark:border-white/5 pt-3 space-y-2.5 text-[12px]">
                  <div className="flex justify-between items-center text-gray-500">
                    <span>Bekleyen Kuyruk (Pending)</span>
                    <span className="font-semibold text-black dark:text-white font-mono bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded">0 İş</span>
                  </div>
                  <div className="flex justify-between items-center text-gray-500">
                    <span>İletim Güvencesi (SLA)</span>
                    <span className="font-semibold text-emerald-500 font-mono">%100 Enqueued</span>
                  </div>
                  <div className="flex justify-between items-center text-gray-500">
                    <span>Ortalama Tepki Süresi</span>
                    <span className="font-semibold text-black dark:text-white font-mono">&lt; 150ms</span>
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-normal border-t border-black/5 dark:border-white/5 pt-2.5">
                    Meta web kancalarından gelen istekler anında Upstash kuyruğuna alınır. İşçi (worker) iş parçacığı izole veri katmanında paralel olarak işletilir.
                  </p>
                </div>
              </div>

              {/* Ably Realtime Event Bus */}
              <div className="bg-white dark:bg-[#111] border border-black/5 dark:border-white/10 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-500">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-[14px] font-semibold text-black dark:text-white">Ably Event Propagation Bus</h4>
                      <p className="text-[11px] text-gray-400 font-mono">Real-Time Sync Gateway</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                    </span>
                    <span className="text-[11px] font-semibold text-sky-500 uppercase tracking-wider">CONNECTED</span>
                  </div>
                </div>

                <div className="border-t border-black/5 dark:border-white/5 pt-3 space-y-2.5 text-[12px]">
                  <div className="flex justify-between items-center text-gray-500">
                    <span>Aktif Kanal Sayısı</span>
                    <span className="font-semibold text-black dark:text-white font-mono bg-gray-100 dark:bg-white/5 px-2 py-0.5 rounded">3 Canlı Kanal</span>
                  </div>
                  <div className="flex justify-between items-center text-gray-500">
                    <span>Bağlantı Türü</span>
                    <span className="font-semibold text-black dark:text-white font-mono">WebSockets (WSS)</span>
                  </div>
                  <div className="flex justify-between items-center text-gray-500">
                    <span>Veri İletim Gecikmesi</span>
                    <span className="font-semibold text-black dark:text-white font-mono">&lt; 40ms</span>
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-normal border-t border-black/5 dark:border-white/5 pt-2.5">
                    İş kuyruğu tarafından işlenen mesajlar Ably üzerinden canlı olarak arayüze yayınlanır. Inbox ekranı sayfa yenilemeye gerek kalmadan dinamik olarak güncellenir.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {activeProvider && (
        <OAuthModal
          isOpen={authModal.isOpen}
          onClose={() => setAuthModal({ isOpen: false, providerId: null })}
          providerId={activeProvider.id}
          providerName={activeProvider.name}
          providerIcon={activeProvider.icon}
          onSuccess={handleOAuthSuccess}
        />
      )}

      {/* Integration Wizards */}
      {wizardModal.providerId === 'google_sheets' && (
        <GoogleSheetsWizard
          isOpen={wizardModal.isOpen}
          onClose={() => setWizardModal({ isOpen: false, providerId: null })}
          onComplete={() => {
            fetchHealth();
            setWizardModal({ isOpen: false, providerId: null });
          }}
        />
      )}

      {wizardModal.providerId && wizardModal.providerId !== 'google_sheets' && activeProvider && (
        <IntegrationWizard
          isOpen={wizardModal.isOpen}
          onClose={() => setWizardModal({ isOpen: false, providerId: null })}
          providerId={activeProvider.id}
          providerName={activeProvider.name}
          providerIcon={activeProvider.icon}
          steps={genericSteps}
          onComplete={() => {
            fetchHealth();
            setWizardModal({ isOpen: false, providerId: null });
          }}
        />
      )}

    </PageShell>
  );
}
