"use client";

import { createContext, useContext } from "react";
import { useRealtimeReconciliation } from "@/hooks/use-realtime-reconciliation";

const RealtimeContext = createContext<{ tenantId?: string }>({});

export const useRealtimeTenant = () => useContext(RealtimeContext).tenantId;

export function RealtimeProvider({ children, tenantId }: { children: React.ReactNode, tenantId?: string }) {
  // Only subscribe if we are within a tenant context
  if (tenantId) {
    // We use a separate component to isolate the hook
    return (
      <RealtimeContext.Provider value={{ tenantId }}>
        <RealtimeSubscriber tenantId={tenantId}>{children}</RealtimeSubscriber>
      </RealtimeContext.Provider>
    );
  }

  return <RealtimeContext.Provider value={{}}>{children}</RealtimeContext.Provider>;
}

function RealtimeSubscriber({ tenantId, children }: { tenantId: string, children: React.ReactNode }) {
  useRealtimeReconciliation(tenantId);
  return <>{children}</>;
}
