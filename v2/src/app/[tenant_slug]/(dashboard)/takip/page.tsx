"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { Radar, Users, CalendarClock, Phone, CheckSquare } from "lucide-react";
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
  
  // Navigation states
  const [activeMainTab, setActiveMainTab] = useState<'is_listesi' | 'advanced'>('is_listesi');
  const [activeAdvancedTab, setActiveAdvancedTab] = useState<'telefon' | 'randevu' | 'hasta_takibi'>('telefon');
  
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
    const tabParam = searchParams.get('tab');
    const drawerTabParam = searchParams.get('drawerTab');

    if (tabParam === 'telefon' || tabParam === 'randevu' || tabParam === 'hasta_takibi') {
      setActiveMainTab('advanced');
      setActiveAdvancedTab(tabParam as any);
    } else if (tabParam === 'is_listesi') {
      setActiveMainTab('is_listesi');
    }

    if (deepLinkOppId) {
      setDrawerOppId(deepLinkOppId);
      setDrawerTaskId(null);
      setDrawerInitialTab(drawerTabParam === 'appointment' ? 'appointment' : 'profile');
    }

    if (deepLinkOppId || tabParam) {
      // Clean up URL parameters dynamically without full-page reloads
      router.replace(`/${tenantSlug}/takip`, { scroll: false });
    }
  }, [deepLinkOppId, searchParams, router, tenantSlug]);

  const handleGoToInbox = (opp: any) => {
    const contactId = opp.phone_number;
    setActiveContact(contactId, {
      id: contactId,
      name: opp.display_name || opp.requester_name || opp.patient_name || opp.phone_number,
      channel: opp.source || 'whatsapp',
      unread: 0
    });
    
    // Deep-link: prioritize conversation_id, fallback to contact
    const queryParams = new URLSearchParams();
    if (opp.conversation_id || opp.conversationId) {
      queryParams.set('conversation_id', opp.conversation_id || opp.conversationId);
    } else if (opp.phone_number) {
      queryParams.set('contact', opp.phone_number);
    }
    
    router.push(`/${tenantSlug}/inbox?${queryParams.toString()}`);
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
          
          {/* Main Segmented Control */}
          <div className="flex flex-col gap-2.5 mt-3">
            <div className="flex items-center gap-1.5 bg-black/[0.04] p-0.5 rounded-xl w-fit border border-black/5 shadow-inner">
              <button
                onClick={() => setActiveMainTab('is_listesi')}
                className={`px-4 py-1.5 rounded-lg text-[13px] font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  activeMainTab === 'is_listesi'
                    ? 'bg-white text-[#1D1D1F] shadow-sm border border-black/5'
                    : 'text-[#86868B] hover:text-[#1D1D1F]'
                }`}
              >
                <CheckSquare className="w-4 h-4 text-[#5856D6]" />
                İş Listesi
              </button>
              <button
                onClick={() => setActiveMainTab('advanced')}
                className={`px-4 py-1.5 rounded-lg text-[13px] font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  activeMainTab === 'advanced'
                    ? 'bg-white text-[#1D1D1F] shadow-sm border border-black/5'
                    : 'text-[#86868B] hover:text-[#1D1D1F]'
                }`}
              >
                Gelişmiş Görünüm
              </button>
            </div>

            {/* Secondary Advanced Tab bar when Gelişmiş Görünüm is active */}
            {activeMainTab === 'advanced' && (
              <div className="flex items-center gap-1.5 bg-black/[0.02] p-0.5 rounded-lg w-fit border border-black/[0.02] ml-1 animate-in slide-in-from-left-2 duration-150">
                <button
                  onClick={() => setActiveAdvancedTab('telefon')}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeAdvancedTab === 'telefon'
                      ? 'bg-white text-indigo-700 shadow-sm border border-black/5'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  Telefon Takibi
                </button>
                <button
                  onClick={() => setActiveAdvancedTab('randevu')}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeAdvancedTab === 'randevu'
                      ? 'bg-white text-indigo-700 shadow-sm border border-black/5'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  <CalendarClock className="w-3.5 h-3.5" />
                  Randevu Yönetimi
                </button>
                <button
                  onClick={() => setActiveAdvancedTab('hasta_takibi')}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    activeAdvancedTab === 'hasta_takibi'
                      ? 'bg-white text-indigo-700 shadow-sm border border-black/5'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  Hasta Takibi
                </button>
              </div>
            )}
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
                <StatBadge label="Gecikti" value={stats.overdue} color="#FF3B30" pulse />
              )}
            </>
          )}
        </div>
      </div>

      {/* Main Content Render */}
      <div className="flex-1 bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-200">
        {activeMainTab === 'is_listesi' ? (
          <AppointmentsTab 
            viewType={undefined} // Undefined = All tasks (Unified Todo List)
            onGoToInbox={handleGoToInbox} 
            onOpenDrawer={(id, taskId) => {
              setDrawerOppId(id);
              setDrawerTaskId(taskId || null);
              setDrawerInitialTab('appointment');
            }} 
            onSwitchTab={(tab) => {
              setActiveMainTab('advanced');
              setActiveAdvancedTab(tab);
            }}
          />
        ) : (
          <>
            {activeAdvancedTab === 'hasta_takibi' && (
              <PatientTrackingTab 
                onGoToInbox={handleGoToInbox} 
                onOpenDrawer={(id, tab = 'profile', targetPageTab) => {
                  setDrawerOppId(id);
                  setDrawerTaskId(null);
                  setDrawerInitialTab(tab);
                  if (targetPageTab) {
                    setActiveMainTab('advanced');
                    setActiveAdvancedTab(targetPageTab);
                  }
                }} 
              />
            )}

            {activeAdvancedTab === 'telefon' && (
              <AppointmentsTab 
                viewType="phone"
                onGoToInbox={handleGoToInbox} 
                onOpenDrawer={(id, taskId) => {
                  setDrawerOppId(id);
                  setDrawerTaskId(taskId || null);
                  setDrawerInitialTab('appointment');
                }} 
                onSwitchTab={(tab) => {
                  setActiveMainTab('advanced');
                  setActiveAdvancedTab(tab);
                }}
              />
            )}

            {activeAdvancedTab === 'randevu' && (
              <AppointmentsTab 
                viewType="clinic"
                onGoToInbox={handleGoToInbox} 
                onOpenDrawer={(id, taskId) => {
                  setDrawerOppId(id);
                  setDrawerTaskId(taskId || null);
                  setDrawerInitialTab('appointment');
                }} 
                onSwitchTab={(tab) => {
                  setActiveMainTab('advanced');
                  setActiveAdvancedTab(tab);
                }}
              />
            )}
          </>
        )}
      </div>

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
