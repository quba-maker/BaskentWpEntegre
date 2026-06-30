"use client";

import { FileText, RefreshCw, Send, X } from "lucide-react";

interface BulkTemplateSendModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedForms: any[];
  templates: any[];
  selectedTemplateId: string;
  onTemplateSelect: (templateId: string) => void;
  onSend: () => void;
  isLoadingTemplates: boolean;
  isSending: boolean;
  results: Record<string, { status: "pending" | "sent" | "failed" | "skipped"; message?: string }>;
}

export function BulkTemplateSendModal({
  isOpen,
  onClose,
  selectedForms,
  templates,
  selectedTemplateId,
  onTemplateSelect,
  onSend,
  isLoadingTemplates,
  isSending,
  results
}: BulkTemplateSendModalProps) {
  if (!isOpen) return null;

  const selectedTemplate = templates.find((tpl: any) => tpl.id === selectedTemplateId);
  const sentCount = Object.values(results).filter((r) => r.status === "sent").length;
  const failedCount = Object.values(results).filter((r) => r.status === "failed").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[86vh]">
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between bg-[#F5F5F7]">
          <div>
            <h3 className="font-semibold text-[#1D1D1F]">Hazır Şablonla Toplu Karşılama</h3>
            <p className="text-xs text-[#86868B] mt-1">
              Onaylı Meta/360dialog şablonu seçili formlara sırayla gönderilir.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSending}
            className="p-1.5 hover:bg-black/5 rounded-lg text-[#86868B] transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Bu yol manuel taslak üretmez. Hastaya yalnızca panelde tanımlı ve onaylı WhatsApp şablonu gider.
            Hasta zaten yazdıysa veya karşılama daha önce gönderildiyse sistem o kişiyi engeller.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider">Gönderilecek Şablon</span>
              <select
                value={selectedTemplateId}
                onChange={(e) => onTemplateSelect(e.target.value)}
                disabled={isLoadingTemplates || isSending}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#34C759]/20 disabled:opacity-60"
              >
                <option value="">Şablon seçin…</option>
                {templates.map((tpl: any) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} · {tpl.language || "tr"}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={onSend}
              disabled={!selectedTemplateId || selectedForms.length === 0 || isSending || isLoadingTemplates}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#34C759] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#248A3D] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Toplu Gönder
            </button>
          </div>

          {selectedTemplate && (
            <div className="rounded-xl border border-black/10 bg-[#F5F5F7] p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#1D1D1F] mb-2">
                <FileText className="w-4 h-4 text-[#34C759]" />
                Şablon Önizleme
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#3A3A3C]">
                {selectedTemplate.body}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider">
                Seçili Kayıtlar ({selectedForms.length})
              </span>
              {(sentCount > 0 || failedCount > 0) && (
                <span className="text-[11px] font-bold text-[#86868B]">
                  Gönderildi: {sentCount} · Hata: {failedCount}
                </span>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-black/10 divide-y divide-black/5">
              {selectedForms.map((form: any) => {
                const result = results[form.id];
                return (
                  <div key={form.id} className="flex items-center justify-between gap-3 bg-white px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[#1D1D1F]">
                        {form.current_display_name || form.patient_name || form.raw_data?.full_name || "Bilinmiyor"}
                      </div>
                      <div className="truncate text-xs text-[#86868B]">{form.phone_number || "Telefon yok"}</div>
                    </div>
                    <span className={`rounded-lg px-2 py-1 text-[10px] font-bold ${
                      result?.status === "failed" ? "max-w-[360px] whitespace-normal break-words text-left leading-snug" : "shrink-0"
                    } ${
                      result?.status === "sent"
                        ? "bg-emerald-100 text-emerald-700 uppercase"
                        : result?.status === "failed"
                          ? "bg-red-100 text-red-700"
                          : result?.status === "skipped"
                            ? "bg-gray-100 text-gray-600 uppercase"
                            : "bg-blue-50 text-blue-700 uppercase"
                    }`}>
                      {result?.status === "sent"
                        ? "Gönderildi"
                        : result?.status === "failed"
                          ? result.message || "Hata"
                          : result?.status === "skipped"
                            ? "Atlandı"
                            : "Bekliyor"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-black/5 bg-white p-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#86868B]">
            Gönderim sırayla yapılır; her kayıt kendi güvenlik kontrolünden geçer.
          </p>
          <button
            onClick={onClose}
            disabled={isSending}
            className="rounded-xl bg-[#1D1D1F] px-4 py-2 text-sm font-bold text-white transition hover:bg-black disabled:opacity-50"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
