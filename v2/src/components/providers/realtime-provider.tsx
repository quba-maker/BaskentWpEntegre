"use client";

import { useRealtimeReconciliation } from "@/hooks/use-realtime-reconciliation";
export function RealtimeProvider({ children, tenantId }: { children: React.ReactNode, tenantId?: string }) {
  // Only subscribe if we are within a tenant context
  if (tenantId) {
    // We use a separate component to isolate the hook
    return <RealtimeSubscriber tenantId={tenantId}>{children}</RealtimeSubscriber>;
  }

  return <>{children}</>;
}

function RealtimeSubscriber({ tenantId, children }: { tenantId: string, children: React.ReactNode }) {
  useRealtimeReconciliation(tenantId);
  return <>{children}</>;
}
