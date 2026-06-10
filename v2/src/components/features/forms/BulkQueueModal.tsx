"use client";

import { useState } from "react";
import { X, MessageCircle } from "lucide-react";

interface BulkQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  queueItems: any[];
  currentQueueIndex: number;
  isPreparingQueue: boolean;
  onOpenNext: (action: 'open' | 'skip') => void;
  onComplete: () => void;
}

export function BulkQueueModal({
  isOpen,
  onClose,
  queueItems,
  currentQueueIndex,
  isPreparingQueue,
  onOpenNext,
  onComplete
}: BulkQueueModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between bg-[#F5F5F7]">
          <h3 className="font-semibold text-[#1D1D1F]">
            Manuel Karşılama Kuyruğu ({currentQueueIndex}/{queueItems.length})
          </h3>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-black/5 rounded-lg text-[#86868B] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-5 flex-1 overflow-y-auto">
          {isPreparingQueue ? (
            <div className="py-8 flex flex-col items-center justify-center text-center">
              <div className="w-8 h-8 border-2 border-[#007AFF] border-t-transparent rounded-full animate-spin mb-3"></div>
              <p className="text-sm text-[#86868B]">Kuyruk hazırlanıyor, lütfen bekleyin...</p>
            </div>
          ) : (
            <div className="space-y-3">
              {queueItems.map((item, index) => {
                const isCurrent = index === currentQueueIndex;
                const isPast = index < currentQueueIndex;
                
                return (
                  <div 
                    key={item.id}
                    className={`p-3 rounded-xl border flex flex-col gap-2 transition-all ${
                      isCurrent ? 'bg-[#007AFF]/5 border-[#007AFF]/20 shadow-sm' : 
                      isPast ? 'bg-black/5 border-transparent opacity-70' : 
                      'bg-white border-black/10'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className={`text-sm font-semibold ${isCurrent ? 'text-[#007AFF]' : 'text-[#1D1D1F]'}`}>
                          {item.patient_name}
                        </span>
                        <span className="text-xs text-[#86868B] mt-0.5">{item.phone}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${
                          item.status === 'Hazır' ? 'bg-emerald-100 text-emerald-700' :
                          item.status === "WhatsApp'ta açıldı" ? 'bg-[#007AFF]/10 text-[#007AFF]' :
                          item.status === 'Atlandı' ? 'bg-gray-100 text-gray-600' :
                          'bg-red-100 text-red-600'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                    </div>

                    {isCurrent && item.draftText && (
                      <div className="mt-1 w-full bg-white/50 p-2.5 rounded-lg border border-black/5">
                        <label className="text-[9px] font-bold text-[#86868B] uppercase tracking-wider block mb-1">
                          Gönderilecek Taslak Mesaj
                        </label>
                        <textarea
                          readOnly
                          value={item.draftText}
                          className="w-full h-20 text-xs p-2 rounded-md border border-black/10 bg-white text-[#1D1D1F] resize-none focus:outline-none focus:ring-1 focus:ring-[#007AFF]"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {!isPreparingQueue && currentQueueIndex < queueItems.length && (
          <div className="p-4 border-t border-black/5 bg-white flex items-center justify-end gap-3 shrink-0">
            <button
              onClick={() => onOpenNext('skip')}
              className="px-4 py-2 text-sm font-semibold text-[#86868B] hover:bg-black/5 rounded-lg transition-colors"
            >
              Atla
            </button>
            <button
              onClick={() => onOpenNext('open')}
              disabled={queueItems[currentQueueIndex].status !== 'Hazır'}
              className="px-6 py-2 bg-[#007AFF] text-white text-sm font-semibold rounded-lg hover:bg-[#0056b3] transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              Sıradakini WhatsApp'ta Aç
            </button>
          </div>
        )}
        {!isPreparingQueue && currentQueueIndex >= queueItems.length && (
          <div className="p-4 border-t border-black/5 bg-white flex justify-center shrink-0">
            <button
              onClick={onComplete}
              className="px-6 py-2 bg-[#1D1D1F] text-white text-sm font-semibold rounded-lg hover:bg-black transition-colors"
            >
              Tamamla ve Kapat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
