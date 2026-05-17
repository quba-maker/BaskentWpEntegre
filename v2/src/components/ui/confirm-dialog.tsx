"use client";

import { useState, useCallback, createContext, useContext } from "react";
import { AlertTriangle } from "lucide-react";

// ==========================================
// QUBA AI — Shared Confirmation Dialog
// Replaces browser confirm() across all pages
// Apple-style destructive action confirmation
// ==========================================

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning";
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx.confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    open: boolean;
    options: ConfirmOptions;
    resolve: ((value: boolean) => void) | null;
  }>({
    open: false,
    options: { title: "", message: "" },
    resolve: null,
  });

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ open: true, options, resolve });
    });
  }, []);

  const handleConfirm = () => {
    state.resolve?.(true);
    setState((s) => ({ ...s, open: false, resolve: null }));
  };

  const handleCancel = () => {
    state.resolve?.(false);
    setState((s) => ({ ...s, open: false, resolve: null }));
  };

  const { open, options } = state;
  const isDanger = options.variant === "danger";

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}

      {/* Backdrop + Modal */}
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
            onClick={handleCancel}
          />

          {/* Dialog */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-[90%] max-w-[340px] overflow-hidden animate-[scaleIn_200ms_ease-out]">
            {/* Icon */}
            <div className="flex justify-center pt-6 pb-2">
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  isDanger
                    ? "bg-[#FF3B30]/10 text-[#FF3B30]"
                    : "bg-[#FF9500]/10 text-[#FF9500]"
                }`}
              >
                <AlertTriangle className="w-6 h-6" />
              </div>
            </div>

            {/* Content */}
            <div className="px-6 pb-4 text-center">
              <h3 className="text-[15px] font-bold text-[#1D1D1F]">
                {options.title}
              </h3>
              <p className="text-[13px] text-[#86868B] mt-1.5 leading-relaxed">
                {options.message}
              </p>
            </div>

            {/* Actions — iOS style stacked buttons */}
            <div className="border-t border-black/5">
              <button
                onClick={handleCancel}
                className="w-full py-3 text-[15px] font-medium text-[#007AFF] hover:bg-black/[0.03] transition-colors border-b border-black/5"
              >
                {options.cancelLabel || "İptal"}
              </button>
              <button
                onClick={handleConfirm}
                className={`w-full py-3 text-[15px] font-semibold transition-colors hover:bg-black/[0.03] ${
                  isDanger ? "text-[#FF3B30]" : "text-[#FF9500]"
                }`}
              >
                {options.confirmLabel || "Onayla"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </ConfirmContext.Provider>
  );
}
