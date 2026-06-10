"use client";
import { X, MessageCircle, Send } from "lucide-react";

interface BulkQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  queueItems: any[];
  currentQueueIndex: number;
  isPreparingQueue: boolean;
  onOpenNext: (action: 'open' | 'skip') => void;
  onComplete: () => void;
  templates?: any[];
  onUpdateDraftText?: (index: number, text: string, source?: string) => void;
}

export function BulkQueueModal({
  isOpen,
  onClose,
  queueItems,
  currentQueueIndex,
  isPreparingQueue,
  onOpenNext,
  onComplete,
  templates,
  onUpdateDraftText
}: BulkQueueModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between bg-[#F5F5F7]">
          <h3 className="font-semibold text-[#1D1D1F]">
            {isPreparingQueue ? (
              "Kuyruk Hazırlanıyor..."
            ) : queueItems.length === 0 ? (
              "Kuyruk Boş"
            ) : (
              `Manuel Karşılama Kuyruğu (${
                currentQueueIndex < queueItems.length ? currentQueueIndex + 1 : queueItems.length
              }/${queueItems.length})`
            )}
          </h3>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-black/5 rounded-lg text-[#86868B] transition-colors cursor-pointer"
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
                    <div className="flex items-center justify-between text-left">
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
                      <div className="mt-1 w-full bg-white/50 p-2.5 rounded-lg border border-black/5 space-y-2 text-left">
                        <div className="flex items-center justify-between">
                          <label className="text-[9px] font-bold text-[#86868B] uppercase tracking-wider block">
                            Gönderilecek Taslak Mesaj
                          </label>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            item.source === 'AI taslak' ? 'bg-[#0F9D58]/10 text-[#0F9D58]' :
                            item.source === 'Hazır şablon' ? 'bg-[#007AFF]/10 text-[#007AFF]' :
                            'bg-[#FF9500]/10 text-[#FF9500]'
                          }`}>
                            {item.source || 'AI taslak'}
                          </span>
                        </div>
                        <textarea
                          value={item.draftText}
                          onChange={(e) => {
                            if (onUpdateDraftText) {
                              onUpdateDraftText(index, e.target.value, "Manuel düzenlenmiş taslak");
                            }
                          }}
                          className="w-full h-20 text-xs p-2 rounded-md border border-black/10 bg-white text-[#1D1D1F] resize-none focus:outline-none focus:ring-1 focus:ring-[#007AFF] font-medium"
                        />

                        {templates && templates.length > 0 && (
                          <div className="flex items-center gap-1.5 pt-1.5 border-t border-black/5">
                            <span className="text-[10px] font-semibold text-[#86868B] shrink-0">Şablon Uygula:</span>
                            <select
                              value=""
                              onChange={(e) => {
                                const tplId = e.target.value;
                                const tpl = templates.find(t => t.id === tplId);
                                if (tpl && onUpdateDraftText) {
                                  let body = tpl.body;
                                  const name = item.patient_name || "Hasta";
                                  body = body.replace(/\{\{patient_name\}\}/g, name);
                                  body = body.replace(/\{\{name\}\}/g, name);
                                  onUpdateDraftText(index, body, "Hazır şablon");
                                }
                              }}
                              className="flex-1 text-[11px] font-medium bg-[#F5F5F7] border border-black/10 rounded px-1.5 py-1 outline-none cursor-pointer"
                            >
                              <option value="" disabled>Şablon seçin…</option>
                              {templates.map((tpl: any) => (
                                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {!isPreparingQueue && currentQueueIndex < queueItems.length && (
          <div className="p-4 border-t border-black/5 bg-white flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => onOpenNext('skip')}
                className="px-4 py-2 text-sm font-semibold text-[#86868B] hover:bg-black/5 rounded-lg transition-colors cursor-pointer"
              >
                Atla
              </button>
              
              <button
                disabled
                className="px-4 py-2 bg-gray-100 text-gray-400 text-sm font-semibold rounded-lg cursor-not-allowed opacity-60 flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                Panelden Gönder
              </button>

              <button
                onClick={() => onOpenNext('open')}
                disabled={queueItems[currentQueueIndex].status !== 'Hazır'}
                className="px-6 py-2 bg-[#25D366] text-white text-sm font-semibold rounded-lg hover:bg-[#1DA851] transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4" />
                Sıradakini WhatsApp'ta Aç
              </button>
            </div>
            <p className="text-[10px] text-[#86868B] font-medium text-center">
              Panelden toplu şablon gönderimi bu sürümde aktif değildir. Sıradakini WhatsApp ile manuel açabilirsiniz.
            </p>
          </div>
        )}
        {!isPreparingQueue && currentQueueIndex >= queueItems.length && (
          <div className="p-4 border-t border-black/5 bg-white flex justify-center shrink-0">
            <button
              onClick={onComplete}
              className="px-6 py-2 bg-[#1D1D1F] text-white text-sm font-semibold rounded-lg hover:bg-black transition-colors cursor-pointer"
            >
              Tamamla ve Kapat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
