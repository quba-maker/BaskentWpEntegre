"use client";

import { useState } from "react";
import { Info, ChevronDown, ChevronRight } from "lucide-react";

interface MetadataItem {
  key: string;
  label: string;
  value: string;
}

interface TechMetadataAccordionProps {
  metadata: MetadataItem[];
}

export function TechMetadataAccordion({ metadata }: TechMetadataAccordionProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!metadata || metadata.length === 0) return null;

  return (
    <div className="border border-black/[0.06] rounded-2xl overflow-hidden transition-all duration-300">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100/80 flex items-center justify-between text-left transition-colors cursor-pointer"
      >
        <span className="text-xs font-bold text-[#86868B] flex items-center gap-1.5 select-none">
          <Info className="w-4 h-4 text-slate-400" /> Teknik Entegrasyon & UTM Detayları
        </span>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-[#86868B]" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[#86868B]" />
        )}
      </button>
      
      {isOpen && (
        <div className="p-4 bg-slate-50/30 border-t border-black/[0.05] grid grid-cols-1 md:grid-cols-2 gap-3 text-left max-h-[220px] overflow-y-auto">
          {metadata.map((entry, idx) => (
            <div key={idx} className="bg-white p-2.5 rounded-lg border border-black/[0.03] shadow-sm">
              <span className="block text-[9px] font-bold text-[#86868B] mb-0.5 break-all uppercase tracking-wider">
                {entry.label || entry.key}
              </span>
              <span className="text-[11px] font-medium text-[#1D1D1F] break-all select-all">
                {entry.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
