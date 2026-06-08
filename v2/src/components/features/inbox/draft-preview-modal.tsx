"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles, AlertCircle, Check, Loader2, Send } from "lucide-react";
import { useInboxStore } from "@/store/inbox-store";
import { 
  resolveInboxDraftAction, 
  sendFormGreetingFromInboxAction, 
  sendApprovedFollowUp, 
  sendNoReplyReminderAction 
} from "@/app/actions/inbox";
import { useQueryClient } from "@tanstack/react-query";

interface DraftPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  patientName: string;
}

const DRAFT_TITLES: Record<string, string> = {
  secondary_fallback: "İkincil Hat Takip Taslağı",
  form_greeting_reply: "Karşılama Cevabı Taslağı",
  first_greeting: "İlk Karşılama Taslağı",
  no_reply_reminder: "Hatırlatma Taslağı",
  follow_up: "Takip Taslağı",
  none: "Taslak Durumu"
};

export function DraftPreviewModal({ isOpen, onClose, conversationId, patientName }: DraftPreviewModalProps) {
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [draftType, setDraftType] = useState<string>("none");
  const [draftText, setDraftText] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [sendAction, setSendAction] = useState<string>("none");
  const [canSend, setCanSend] = useState<boolean>(false);
  const [secondaryPhone, setSecondaryPhone] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showConfirmSend, setShowConfirmSend] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Fetch the resolved draft text
  useEffect(() => {
    if (!isOpen || !conversationId) return;

    const loadDraft = async () => {
      setIsLoading(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      setDraftText("");
      setDraftType("none");
      setReason("");
      setSendAction("none");
      setCanSend(false);
      setSecondaryPhone("");
      setShowConfirmSend(false);

      try {
        const res: any = await resolveInboxDraftAction(conversationId);

        // Stale Guard: Check if the user has switched active patient during the async network request
        const currentActive = useInboxStore.getState().activeContact;
        const currentActiveId = currentActive?.conversation_id || currentActive?.conversationId || useInboxStore.getState().activePhone;
        if (currentActiveId !== conversationId) {
          console.log("[STALE_GUARD] Dropping resolveInboxDraftAction async results because patient switched.");
          return;
        }

        if (res?.success) {
          setDraftType(res.draftType);
          setDraftText(res.draftText);
          setSendAction(res.sendAction);
          setCanSend(res.canSend);
          if (res.secondaryPhone) setSecondaryPhone(res.secondaryPhone);
          if (res.reason) setReason(res.reason);
        } else {
          setDraftType("none");
          setReason(res.reason || "Uygun taslak bulunmuyor.");
          setCanSend(false);
        }
      } catch (err: any) {
        console.error("Error resolving draft:", err);
        setErrorMsg(err.message || "Taslak hazırlanırken bir sistem hatası oluştu.");
      } finally {
        setIsLoading(false);
      }
    };

    loadDraft();
  }, [isOpen, conversationId]);

  if (!isOpen || !mounted) return null;

  const handleSend = async () => {
    setIsSending(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      let res: any;
      if (sendAction === "greeting") {
        res = await sendFormGreetingFromInboxAction(conversationId, draftText);
      } else if (sendAction === "follow_up") {
        res = await sendApprovedFollowUp(conversationId, draftText);
      } else if (sendAction === "no_reply") {
        res = await sendNoReplyReminderAction(conversationId, draftText);
      } else {
        throw new Error("Geçersiz gönderim eylemi.");
      }

      if (res.success) {
        setSuccessMsg("Mesaj başarıyla hastaya gönderildi!");
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("inbox-unread-refresh"));
        }
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setErrorMsg(res.error || "Mesaj gönderilirken hata oluştu.");
      }
    } catch (err: any) {
      console.error("Error sending draft:", err);
      setErrorMsg(err.message || "Mesaj gönderilirken hata oluştu.");
    } finally {
      setIsSending(false);
      setShowConfirmSend(false);
    }
  };

  const resolvedTitle = DRAFT_TITLES[draftType] || "Taslak Önizleme";

  return createPortal(
    <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-md overflow-hidden flex flex-col mx-4 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[0.05] flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-600">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-[#1D1D1F]">
                {resolvedTitle}
              </h3>
              <p className="text-[11px] font-semibold text-[#86868B]">
                {patientName}
              </p>
            </div>
          </div>
          <button 
            disabled={isSending}
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8ED] flex items-center justify-center text-gray-500 hover:text-black transition-all cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-left">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
              <span className="text-xs font-semibold text-zinc-500">Uygun taslak tipi analiz ediliyor ve hazırlanıyor...</span>
            </div>
          ) : successMsg ? (
            <div className="space-y-4 text-center py-4">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                <Check className="w-6 h-6 animate-bounce" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-[#1D1D1F]">{successMsg}</h4>
                <p className="text-[11px] text-[#86868B]">Sohbet geçmişi güncellendi.</p>
              </div>
            </div>
          ) : draftType === "none" ? (
            <div className="space-y-4 py-2">
              <div className="p-4 bg-gray-50 border rounded-2xl flex flex-col gap-2">
                <div className="flex items-center gap-2 text-zinc-500 font-bold text-xs uppercase tracking-wider">
                  <AlertCircle className="w-4 h-4" />
                  Bu görüşme için uygun taslak bulunmuyor
                </div>
                <p className="text-[12px] text-zinc-600 font-medium leading-relaxed">
                  Neden: {reason || "Mevcut sohbet durumu taslak oluşturmak için uygun kriterleri sağlamamaktadır."}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white text-[12px] font-bold rounded-xl cursor-pointer transition-all"
              >
                Kapat
              </button>
            </div>
          ) : (
            <>
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-700 text-xs font-semibold leading-relaxed">
                  ⚠️ {errorMsg}
                </div>
              )}

              {draftType === "secondary_fallback" && (
                <div className="text-[11px] font-semibold text-amber-800 bg-amber-50/50 border border-amber-200 rounded-xl p-3 leading-normal">
                  💡 İkincil telefon numarası: <strong>{secondaryPhone}</strong>.<br />
                  {canSend ? (
                    "Birincil telefondan cevap alınamadığı için ikincil telefon üzerinden serbest mesaj gönderilecektir."
                  ) : (
                    "İkincil numara için 24 saatlik WhatsApp penceresi kapalı. Şablon gönderimi devre dışıdır. Taslağı kopyalayarak manuel kullanabilirsiniz."
                  )}
                </div>
              )}

              {draftType === "form_greeting_reply" && (
                <div className="text-[11px] font-semibold text-indigo-800 bg-indigo-50/40 border border-indigo-150 rounded-xl p-3 leading-normal">
                  👋 Hasta form doldurdu ve ilk mesajı attı. Bu mesaj hastanın form başvurusuna karşılık selamlama cevabı olarak gönderilecektir.
                </div>
              )}

              {draftType === "no_reply_reminder" && (
                <div className="text-[11px] font-semibold text-zinc-800 bg-zinc-50 border rounded-xl p-3 leading-normal">
                  ⏰ Son mesajımız cevap beklemiyordu. Bu mesaj hastaya durumunu hatırlatmak amacıyla gönderilecektir.
                </div>
              )}

              {draftType === "follow_up" && (
                <div className="text-[11px] font-semibold text-green-800 bg-green-50/40 border border-green-150 rounded-xl p-3 leading-normal">
                  💬 Son mesajımız cevap bekleyen bir soru içeriyordu. Bu mesaj hastadan dönüş almak için takip amacıyla gönderilecektir.
                </div>
              )}

              {/* Textarea */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#86868B] ml-1">
                  Mesaj Metni
                </label>
                <textarea
                  disabled={isSending || !canSend}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={5}
                  className="w-full px-4 py-3 bg-white border border-[#E8E8ED] rounded-2xl text-[12px] font-medium leading-relaxed text-[#1D1D1F] focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500/40 outline-none resize-none transition-all shadow-sm disabled:opacity-75 disabled:bg-slate-50/50"
                  placeholder="Mesaj içeriğini buraya girin..."
                />
              </div>

              {/* Send Confirmation */}
              {showConfirmSend && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl space-y-2.5 animate-in slide-in-from-top-2 duration-200">
                  <p className="text-[11px] font-bold text-amber-800 leading-normal">
                    ⚠️ Bu mesaj hastanın WhatsApp numarasına doğrudan gönderilecektir. Onaylıyor musunuz?
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => setShowConfirmSend(false)}
                      className="py-1 px-3 bg-white hover:bg-gray-50 border text-[10px] font-bold rounded-lg cursor-pointer"
                    >
                      Vazgeç
                    </button>
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={handleSend}
                      className="py-1 px-3 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold rounded-lg cursor-pointer flex items-center gap-1"
                    >
                      {isSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Evet, Gönder
                    </button>
                  </div>
                </div>
              )}

              {/* Buttons */}
              {!showConfirmSend && (
                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={isSending}
                    onClick={onClose}
                    className="w-1/3 py-3 border border-black/5 hover:bg-black/[0.02] text-[#86868B] hover:text-[#1D1D1F] text-[13px] font-bold rounded-xl cursor-pointer transition-all"
                  >
                    Kapat
                  </button>
                  <button
                    type="button"
                    disabled={isSending || !canSend}
                    onClick={() => setShowConfirmSend(true)}
                    className="w-2/3 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-md disabled:opacity-50 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    title={!canSend ? "WhatsApp gönderim penceresi kapalı" : "Mesajı gönder"}
                  >
                    {isSending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Gönderiliyor...</>
                    ) : (
                      <>Onayla ve Gönder</>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
