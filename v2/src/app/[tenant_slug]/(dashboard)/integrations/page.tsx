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
          if (ch.provider === 'messenger' || ch.provider === 'instagram') newConnections.meta_instagram = ch.status === 'connected' ? 'connected' : 'error';
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

          {/* Diagnostics Panel */}
          <div className="bg-white dark:bg-[#111] border border-black/5 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-black/5 dark:border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-black dark:text-white">Channel Diagnostics</h3>
                  <p className="text-[13px] text-gray-500">
                    {diagnostics.summary || "Gerçek zamanlı bağlantı durumu"}
                  </p>
                </div>
              </div>
              <button 
                onClick={fetchHealth}
                className="text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Yenile
              </button>
            </div>
            
            <div className="p-0">
              {diagnostics.channels.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-[13px]">
                  Henüz aktif bir kanal bulunmuyor.
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/50 dark:bg-white/[0.02]">
                      <th className="px-5 py-3 text-[12px] font-medium text-gray-500">PROVIDER</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-gray-500">GROUP (TARGET)</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-gray-500">STATUS</th>
                      <th className="px-5 py-3 text-[12px] font-medium text-gray-500">LAST EVENT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/10">
                    {diagnostics.channels.map((ch, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <div className="text-[13px] font-medium text-black dark:text-white capitalize">
                              {ch.provider}
                            </div>
                            <span className="text-[11px] text-gray-400 font-mono">({ch.id.slice(0, 8)})</span>
                          </div>
                          <div className="text-[12px] text-gray-500 mt-0.5">{ch.name}</div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 dark:bg-white/5 text-[12px] font-medium text-gray-600 dark:text-gray-300">
                            {ch.group || "Varsayılan"}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            {ch.status === 'connected' ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            ) : ch.status === 'warning' ? (
                              <Clock className="w-4 h-4 text-orange-500" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-red-500" />
                            )}
                            <span className="text-[13px] text-gray-700 dark:text-gray-300">{ch.detail}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-[13px] text-gray-500">
                          {ch.lastMessage ? new Date(ch.lastMessage).toLocaleString('tr-TR') : 'Hiç olay yok'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
