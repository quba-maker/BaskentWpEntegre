"use client";

interface AnswerItem {
  key: string;
  label: string;
  value: string;
}

interface FormAnswersSectionProps {
  answers: AnswerItem[];
}

export function FormAnswersSection({ answers }: FormAnswersSectionProps) {
  return (
    <div className="space-y-3 text-left">
      <h4 className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider border-b border-black/[0.04] pb-1.5">
        📋 Form Yanıtları
      </h4>
      {answers && answers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {answers.map((entry, idx) => (
            <div key={idx} className="p-3 bg-slate-50/50 rounded-xl border border-black/[0.02]">
              <span className="block text-[10px] font-bold text-[#86868B] uppercase tracking-wider mb-1">
                {entry.label || entry.key}
              </span>
              <span className="text-xs font-semibold text-[#1D1D1F] leading-relaxed whitespace-pre-wrap break-words block">
                {entry.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs italic text-[#86868B] py-2">Detaylı form yanıtı bulunamadı.</p>
      )}
    </div>
  );
}
