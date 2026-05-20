"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[WORKSPACE ERROR]", error);
  }, [error]);

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-[--q-light-bg] p-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-black/5 p-8 text-center shadow-sm">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-semibold text-[--q-text-primary] mb-2">Çalışma alanı yüklenemedi</h2>
        <p className="text-[14px] text-[--q-text-secondary] mb-8">
          Sisteme bağlanırken bir hata oluştu veya yetkiniz olmayan bir modüle erişmeye çalışıyorsunuz.
        </p>
        <Button 
          onClick={reset}
          className="w-full bg-[--q-blue] text-white rounded-xl py-2.5 font-medium flex items-center justify-center gap-2"
        >
          <RefreshCcw className="w-4 h-4" />
          Yeniden Dene
        </Button>
      </div>
    </div>
  );
}
