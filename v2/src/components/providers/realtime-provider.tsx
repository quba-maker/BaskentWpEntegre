"use client";

import { createContext, useContext } from "react";
import { useRealtimeReconciliation } from "@/hooks/use-realtime-reconciliation";
import { RealtimeErrorBoundary } from "./realtime-error-boundary";

const RealtimeContext = createContext<{ tenantId?: string }>({});

export const useRealtimeTenant = () => useContext(RealtimeContext).tenantId;

export function RealtimeProvider({ children, tenantId }: { children: React.ReactNode, tenantId?: string }) {
  // Only subscribe if we are within a tenant context
  if (tenantId) {
    // Error boundary prevents Ably crashes from killing the entire inbox
    return (
      <RealtimeContext.Provider value={{ tenantId }}>
        <RealtimeErrorBoundary>
          <RealtimeSubscriber tenantId={tenantId}>{children}</RealtimeSubscriber>
        </RealtimeErrorBoundary>
      </RealtimeContext.Provider>
    );
  }

  return <RealtimeContext.Provider value={{}}>{children}</RealtimeContext.Provider>;
}

function RealtimeSubscriber({ tenantId, children }: { tenantId: string, children: React.ReactNode }) {
  useRealtimeReconciliation(tenantId);
  return <>{children}</>;
}
