"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Radar, Users, CalendarClock, Phone } from "lucide-react";
import { getOpportunityStats } from "@/app/actions/pipeline";
import { useInboxStore } from "@/store/inbox-store";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import PatientTrackingTab from "@/components/features/takip/patient-tracking-tab";
import AppointmentsTab from "@/components/features/takip/appointments-tab";
import PatientDetailDrawer from "@/components/features/takip/patient-detail-drawer";

// ── MAIN PAGE COMPONENT ──

export default function TakipPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const tenantSlug = typeof params.tenant_slug === 'string' ? params.tenant_slug : '';
  const { setActiveContact } = useInboxStore();
  
  const deepLinkOppId = searchParams.get('opp');
  const [activeTab, setActiveTab] = useState<'hasta_takibi' | 'telefon' | 'randevu'>('hasta_takibi');
  
  // Detail drawer states
  const [drawerOppId, setDrawerOppId] = useState<string | null>(null);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [drawerInitialTab, setDrawerInitialTab] = useState<'profile' | 'appointment'>('profile');

  // ── Stats (SWR) ──
  const { data: stats, mutate: mutateStats } = useSWR(
    'opportunity-stats',
    () => getOpportunityStats(),
    { 
      refreshInterval: 90000,
      refreshWhenHidden: false,
      revalidateOnFocus: true
    }
  );

  // Deep link auto-routing: open drawer directly from notification url click
  useEffect(() => {
    if (deepLinkOppId) {
      setDrawerOppId(deepLinkOppId);
      setDrawerTaskId(null);
      setDrawerInitialTab('profile');
      // Clean up URL parameters dynamically without full-page reloads
      router.replace(`/${tenantSlug}/takip`, { scroll: false });
    }
  }, [deepLinkOppId, router, tenantSlug]);

  const handleGoToInbox = (opp: any) => {
    setActiveContact(opp.phone_number, {
      id: opp.phone_number,
      name: opp.display_name || opp.requester_name || opp.patient_name || opp.phone_number,
      channel: opp.source || 'whatsapp',
      unread: 0
    });
    router.push(`/${tenantSlug}/inbox`);
  };

  return (
    <div className="p-4 md:p-8 h-full flex flex-col relative overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#5856D6]/5 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[#FF9500]/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* Header Panel */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#1D1D1F] flex items-center gap-2">
            <Radar className="w-7 h-7 text-[#5856D6]" />
            Takip Merkezi
          </h1>
          
          {/* Tab Switcher */}
          <div className="flex items-center gap-2 mt-2 w-fit">
            <button
              onClick={() => setActiveTab('hasta_takibi')}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'hasta_takibi' 
                  ? 'bg-indigo-600 text-white shadow-md' 
                  : 'bg-black/[0.04] text-[#86868B] hover:text-[#1D1D1F]'
              }`}
            >
              <Users className="w-4 h-4" />
              Hasta Takibi
            </button>
            <button
              onClick={() => setActiveTab('telefon')}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'telefon' 
                  ? 'bg-indigo-600 text-white shadow-md' 
                  : 'bg-black/[0.04] text-[#86868B] hover:text-[#1D1D1F]'
              }`}
            >
              <Phone className="w-4 h-4" />
              Telefon Takibi
            </button>
            <button
              onClick={() => setActiveTab('randevu')}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'randevu' 
                  ? 'bg-indigo-600 text-white shadow-md' 
                  : 'bg-black/[0.04] text-[#86868B] hover:text-[#1D1D1F]'
              }`}
            >
              <CalendarClock className="w-4 h-4" />
              Randevu Yönetimi
            </button>
          </div>
        </div>

        {/* Stats Summary Badges */}
        <div className="flex items-center gap-3">
          {stats && (
            <>
              <StatBadge label="Aktif" value={stats.active} color="#007AFF" />
              <StatBadge label="Sıcak" value={stats.hot} color="#FF3B30" />
              <StatBadge label="Bugün Takip" value={stats.due_today} color="#FF9500" />
              {Number(stats.overdue) > 0 && (
                <StatBadge label="Gecikmiş" value={stats.overdue} color="#FF3B30" pulse />
              )}
            </>
          )}
        </div>
      </div>

      {/* HASTA TAKİBİ TAB */}
      {activeTab === 'hasta_takibi' && (
        <div className="flex-1 bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200">
          <PatientTrackingTab 
            onGoToInbox={handleGoToInbox} 
            onOpenDrawer={(id) => {
              setDrawerOppId(id);
              setDrawerTaskId(null);
              setDrawerInitialTab('profile');
            }} 
          />
        </div>
      )}

      {/* TELEFON TAKİBİ TAB */}
      {activeTab === 'telefon' && (
        <div className="flex-1 bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200">
          <AppointmentsTab 
            viewType="phone"
            onGoToInbox={handleGoToInbox} 
            onOpenDrawer={(id, taskId) => {
              setDrawerOppId(id);
              setDrawerTaskId(taskId || null);
              setDrawerInitialTab('appointment');
            }} 
            onSwitchTab={(tab) => setActiveTab(tab)}
          />
        </div>
      )}
 
      {/* RANDEVU YÖNETİMİ TAB */}
      {activeTab === 'randevu' && (
        <div className="flex-1 bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200">
          <AppointmentsTab 
            viewType="clinic"
            onGoToInbox={handleGoToInbox} 
            onOpenDrawer={(id, taskId) => {
              setDrawerOppId(id);
              setDrawerTaskId(taskId || null);
              setDrawerInitialTab('appointment');
            }} 
            onSwitchTab={(tab) => setActiveTab(tab)}
          />
        </div>
      )}

      {/* Unified Patient & Appointment Details Drawer */}
      {drawerOppId && (
        <PatientDetailDrawer
          opportunityId={drawerOppId}
          activeTaskId={drawerTaskId}
          initialTab={drawerInitialTab}
          onClose={() => { setDrawerOppId(null); setDrawerTaskId(null); }}
          onGoToInbox={handleGoToInbox}
          onRefresh={() => { mutateStats(); }}
        />
      )}
    </div>
  );
}

// ── Stat Badge ──

function StatBadge({ label, value, color, pulse }: { label: string; value: any; color: string; pulse?: boolean }) {
  return (
    <div 
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border"
      style={{ backgroundColor: `${color}08`, borderColor: `${color}20` }}
    >
      {pulse && <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />}
      <span className="text-[12px] font-bold" style={{ color }}>{value}</span>
      <span className="text-[10px] font-semibold text-[#86868B]">{label}</span>
    </div>
  );
}
