"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stopImpersonationAction } from "@/app/actions/impersonation";

export function ImpersonationBanner({
  tenantName,
}: {
  tenantName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleStop = () => {
    startTransition(async () => {
      const res = await stopImpersonationAction();
      if (res.success && res.redirectUrl) {
        router.push(res.redirectUrl);
        router.refresh();
      }
    });
  };

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between sticky top-0 z-50 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">
          <span className="font-bold">Platform Admin Mode:</span> You are currently impersonating <strong>{tenantName}</strong>. All actions are strictly audited.
        </p>
      </div>
      <Button
        variant="destructive"
        size="sm"
        onClick={handleStop}
        disabled={isPending}
        className="h-8 gap-2 bg-amber-600 hover:bg-amber-700 text-white border-0"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
        Exit Impersonation
      </Button>
    </div>
  );
}
