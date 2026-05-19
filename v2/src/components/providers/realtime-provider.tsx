"use client";

import { useRealtimeReconciliation } from "@/hooks/use-realtime-reconciliation";
import { useParams } from "next/navigation";

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const tenantSlug = params?.tenant_slug as string;

  // Only subscribe if we are within a tenant context
  if (tenantSlug) {
    // We use a separate component to isolate the hook
    return <RealtimeSubscriber tenantSlug={tenantSlug}>{children}</RealtimeSubscriber>;
  }

  return <>{children}</>;
}

function RealtimeSubscriber({ tenantSlug, children }: { tenantSlug: string, children: React.ReactNode }) {
  useRealtimeReconciliation(tenantSlug);
  return <>{children}</>;
}
