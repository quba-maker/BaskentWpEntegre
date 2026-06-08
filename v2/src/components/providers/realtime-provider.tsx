"use client";

import { createContext, useContext } from "react";
import { useRealtimeReconciliation } from "@/hooks/use-realtime-reconciliation";
import { RealtimeErrorBoundary } from "./realtime-error-boundary";

const RealtimeContext = createContext<{ tenantId?: string }>({});

export const useRealtimeTenant = () => useContext(RealtimeContext).tenantId;

export function RealtimeProvider({ children, tenantId, userId }: { children: React.ReactNode, tenantId?: string, userId?: string }) {
  // Only subscribe if we are within a tenant context
  if (tenantId) {
    // Error boundary prevents Ably crashes from killing the entire inbox
    return (
      <RealtimeContext.Provider value={{ tenantId }}>
        <RealtimeErrorBoundary>
          <RealtimeSubscriber tenantId={tenantId} userId={userId} />
        </RealtimeErrorBoundary>
        {children}
      </RealtimeContext.Provider>
    );
  }

  return <RealtimeContext.Provider value={{}}>{children}</RealtimeContext.Provider>;
}

function RealtimeSubscriber({ tenantId, userId }: { tenantId: string, userId?: string }) {
  useRealtimeReconciliation(tenantId, userId);
  return null;
}
