"use client";

import { FIRST_CONTACT_UI_LABELS } from "./first-contact-ui";

interface FormStatsTabsProps {
  firstContactFilter: string;
  setFirstContactFilter: (val: string) => void;
  statusCounts?: Record<string, number> | null;
}

export function FormStatsTabs({ firstContactFilter, setFirstContactFilter, statusCounts }: FormStatsTabsProps) {
  const tabs = [
    { value: 'all', label: FIRST_CONTACT_UI_LABELS.all, icon: '📁' },
    { value: 'needs_greeting', label: FIRST_CONTACT_UI_LABELS.needs_greeting, icon: '👋' },
    { value: 'needs_reply', label: FIRST_CONTACT_UI_LABELS.needs_reply, icon: '💬' },
    { value: 'no_reply_waiting', label: FIRST_CONTACT_UI_LABELS.no_reply_waiting, icon: '⏳' },
    { value: 'waiting_patient', label: FIRST_CONTACT_UI_LABELS.waiting_patient, icon: '✅' },
    { value: 'blocked_or_invalid', label: FIRST_CONTACT_UI_LABELS.blocked_or_invalid, icon: '⚠️' }
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 p-1 bg-black/[0.03] rounded-xl border border-black/5 self-start shadow-sm">
      {tabs.map((tab) => {
        const isActive = firstContactFilter === tab.value;
        const count = statusCounts
          ? tab.value === 'blocked_or_invalid'
            ? ((statusCounts as any).blocked_or_invalid || 0) + ((statusCounts as any).control_required || 0) + ((statusCounts as any).whatsapp_opened || 0)
            : tab.value === 'needs_reply'
              ? ((statusCounts as any).waiting_inbox_reply || 0) + ((statusCounts as any).patient_replied || 0)
            : tab.value === 'waiting_patient'
              ? (statusCounts as any).sent
            : (statusCounts as any)[tab.value]
          : null;

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
