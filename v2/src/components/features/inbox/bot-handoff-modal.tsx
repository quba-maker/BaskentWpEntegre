"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles, AlertCircle, Check, Loader2 } from "lucide-react";
import { toggleBotStatus } from "@/app/actions/inbox";
import { useInboxStore } from "@/store/inbox-store";
import { useQueryClient } from "@tanstack/react-query";

interface BotHandoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  patientName: string;
  targetState: boolean;
}

export function BotHandoffModal({ isOpen, onClose, conversationId, patientName, targetState }: BotHandoffModalProps) {
  const [mounted, setMounted] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!isOpen || !mounted) return null;

  const handleConfirm = async () => {
    setIsToggling(true);
    setErrorMsg(null);
    setStatus("idle");

    try {
      const res = await toggleBotStatus(conversationId, targetState);

      if (res.success) {
        setStatus("success");

        // 1. Instantly reconcile Zustand activeContact store state
        const store = useInboxStore.getState();
        const isCurrentActive = 
          store.activePhone === conversationId || 
          store.activeContact?.conversation_id === conversationId || 
          store.activeContact?.conversationId === conversationId;

        if (isCurrentActive && store.activeContact) {
          store.setActiveContact(store.activePhone || conversationId, {
            ...store.activeContact,
            isBotActive: targetState
          });
        }

        // 2. Instantly reconcile React Query conversations list row
        queryClient.setQueriesData({ queryKey: ["conversations"] }, (oldData: any) => {
          if (!oldData || !oldData.pages) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page: any[]) =>
              page.map(conv => {
                const isMatch = conv.conversation_id === conversationId || conv.conversationId === conversationId || conv.id === conversationId;
                if (isMatch) {
                  return { 
                    ...conv, 
                    isBotActive: targetState, 
                    autopilot_enabled: targetState,
                    status: targetState ? 'bot' : 'human'
                  };
                }
                return conv;
              })
            )
          };
        });

        // 3. Trigger cache invalidation for background sync
        queryClient.invalidateQueries({ queryKey: ["conversations"] });

        // 4. Dispatch unread count refresh event
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent('inbox-unread-refresh'));
        }

        // Close modal after success animation
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setStatus("error");
        setErrorMsg(res.error || "İşlem gerçekleştirilemedi.");
      }
    } catch (err: any) {
      console.error("Error toggling bot status:", err);
      setStatus("error");
      setErrorMsg(err.message || "İşlem sırasında beklenmedik bir sistem hatası oluştu.");
    } finally {
      setIsToggling(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-sm overflow-hidden flex flex-col mx-4 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[0.05] flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-500">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-[#1D1D1F]">
                {targetState ? "Autopilot'u Aktif Et" : "Autopilot'u Devre Dışı Bırak"}
              </h3>
              <p className="text-[11px] font-semibold text-[#86868B]">
                {patientName}
              </p>
            </div>
          </div>
          <button 
            disabled={isToggling}
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F5F5F7] hover:bg-[#E8E8ED] flex items-center justify-center text-gray-500 hover:text-black transition-all cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-center">
          {status === "success" ? (
            <div className="space-y-3 py-2">
              <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                <Check className="w-6 h-6 animate-bounce" />
              </div>
              <h4 className="text-xs font-bold text-[#1D1D1F]">
                {targetState ? "Autopilot Başarıyla Aktif Edildi" : "Autopilot Başarıyla Kapatıldı"}
              </h4>
            </div>
          ) : (
            <>
              {status === "error" && errorMsg && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-700 text-xs font-semibold leading-relaxed text-left">
                  ⚠️ {errorMsg}
                </div>
              )}

              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-medium text-left">
                {targetState ? (
                  "Autopilot'u aktif hale getirmek istediğinize emin misiniz? Yapay zeka bu konuşmada gelen mesajlara otomatik yanıt verecektir."
                ) : (
                  "Autopilot'u kapatarak konuşmayı manuel yönetime almak istediğinize emin misiniz? Yapay zeka artık otomatik yanıt vermeyecektir."
                )}
              </p>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  disabled={isToggling}
                  onClick={onClose}
                  className="w-1/3 py-2.5 border border-black/5 hover:bg-black/[0.02] text-[#86868B] hover:text-[#1D1D1F] text-[12px] font-bold rounded-xl cursor-pointer transition-all"
                >
                  İptal
                </button>
                <button
                  type="button"
                  disabled={isToggling}
                  onClick={handleConfirm}
                  className={`w-2/3 py-2.5 text-white text-[12px] font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-md ${
                    targetState 
                      ? "bg-red-500 hover:bg-red-600" 
                      : "bg-[#1D1D1F] hover:bg-zinc-800"
                  }`}
                >
                  {isToggling ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Güncelleniyor...</>
                  ) : targetState ? (
                    "Aktif Et"
                  ) : (
                    "Kapat"
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
