"use client";

import { useState, useEffect } from "react";
import { Link2, MessageCircle, FileSpreadsheet, Instagram, Webhook, Activity } from "lucide-react";
import { PageShell, PageHeader } from "@/components/governance";
import { IntegrationCard } from "@/components/features/integrations/IntegrationCard";
import { OAuthModal } from "@/components/features/integrations/OAuthModal";
import { ProviderConfigModal } from "@/components/features/integrations/ProviderConfigModal";

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
  
  // Simulated State Machine for Sprint 1
  const [connections, setConnections] = useState<Record<string, ConnectionState>>({
    google_sheets: "disconnected",
    meta_whatsapp: "disconnected",
    meta_instagram: "disconnected",
    custom_webhook: "disconnected"
  });

  // Modal States
  const [authModal, setAuthModal] = useState<{ isOpen: boolean; providerId: string | null }>({ isOpen: false, providerId: null });
  const [configModal, setConfigModal] = useState<{ isOpen: boolean; providerId: string | null }>({ isOpen: false, providerId: null });

  // Simulate network load
  useEffect(() => {
    const timer = setTimeout(() => {
      // Simulate that Google Sheets is already connected
      setConnections(prev => ({ ...prev, google_sheets: "connected" }));
      setIsPageLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const handleConnectClick = (id: string) => {
    if (id === 'custom_webhook') {
      // Webhook doesn't need OAuth, goes straight to config
      setConfigModal({ isOpen: true, providerId: id });
    } else {
      setAuthModal({ isOpen: true, providerId: id });
    }
  };

  const handleConfigureClick = (id: string) => {
    setConfigModal({ isOpen: true, providerId: id });
  };

  const handleOAuthSuccess = (id: string) => {
    setConnections(prev => ({ ...prev, [id]: "connected" }));
    // Automatically open config after success
    setTimeout(() => {
      setConfigModal({ isOpen: true, providerId: id });
    }, 500);
  };

  const handleDisconnect = (id: string) => {
    setConnections(prev => ({ ...prev, [id]: "disconnected" }));
  };

  const handleSaveConfig = (id: string, config: any) => {
    console.log(`Saved config for ${id}:`, config);
    // In Sprint 2, this will save to DB
  };

  const activeProvider = PROVIDERS.find(p => p.id === authModal.providerId) || PROVIDERS.find(p => p.id === configModal.providerId);

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
            <div key={i} className="bg-white rounded-2xl border border-[var(--q-border-default)] h-[240px]"></div>
          ))}
        </div>
      ) : (
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
      )}

      {/* Modals */}
      {activeProvider && (
        <>
          <OAuthModal
            isOpen={authModal.isOpen}
            onClose={() => setAuthModal({ isOpen: false, providerId: null })}
            providerId={activeProvider.id}
            providerName={activeProvider.name}
            providerIcon={activeProvider.icon}
            onSuccess={handleOAuthSuccess}
          />
          
          <ProviderConfigModal
            isOpen={configModal.isOpen}
            onClose={() => setConfigModal({ isOpen: false, providerId: null })}
            providerId={activeProvider.id}
            providerName={activeProvider.name}
            onDisconnect={handleDisconnect}
            onSave={handleSaveConfig}
          />
        </>
      )}

    </PageShell>
  );
}
