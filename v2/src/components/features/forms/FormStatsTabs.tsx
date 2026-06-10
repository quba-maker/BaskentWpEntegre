"use client";

interface FormStatsTabsProps {
  firstContactFilter: string;
  setFirstContactFilter: (val: string) => void;
  statusCounts?: Record<string, number> | null;
}

export function FormStatsTabs({ firstContactFilter, setFirstContactFilter, statusCounts }: FormStatsTabsProps) {
  const tabs = [
    { value: 'all', label: 'Tümü', icon: '📁' },
    { value: 'needs_greeting', label: 'Karşılama Bekliyor', icon: '👋' },
    { value: 'waiting_inbox_reply', label: 'Panelden Cevap Bekliyor', icon: '💬' },
    { value: 'whatsapp_opened', label: 'WhatsApp’ta Açıldı', icon: '📲' },
    { value: 'no_reply_waiting', label: 'Cevap Bekleniyor', icon: '⏳' },
    { value: 'sent', label: 'Gönderildi', icon: '✅' },
    { value: 'patient_replied', label: 'Cevap Geldi', icon: '↩️' },
    { value: 'blocked_or_invalid', label: 'Sorunlu', icon: '⚠️' },
    { value: 'control_required', label: 'Sync Kontrol', icon: '🔍' }
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 p-1 bg-black/[0.03] rounded-xl border border-black/5 self-start shadow-sm">
      {tabs.map((tab) => {
        const isActive = firstContactFilter === tab.value;
        const count = statusCounts ? (statusCounts as any)[tab.value] : null;

        return (
          <button
            key={tab.value}
            onClick={() => setFirstContactFilter(tab.value)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer select-none border border-transparent ${
              isActive 
                ? 'bg-white text-[#1D1D1F] shadow-sm border-black/5' 
                : 'text-[#86868B] hover:text-[#1D1D1F] hover:bg-white/40'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {typeof count === 'number' && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                isActive ? 'bg-black/5 text-[#1D1D1F]' : 'bg-black/[0.04] text-[#86868B]'
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
