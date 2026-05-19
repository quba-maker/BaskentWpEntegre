"use client";

import { ConfirmProvider } from "@/components/ui/confirm-dialog";

import { RealtimeProvider } from "@/components/providers/realtime-provider";
import { RealtimeDiagnosticsOverlay } from "@/components/features/realtime/diagnostics-overlay";

// ==========================================
// Client-side providers wrapper for dashboard
// Houses all context providers that require "use client"
// ==========================================

export function DashboardProviders({ children, tenantId }: { children: React.ReactNode, tenantId?: string }) {
  return (
    <ConfirmProvider>
      <RealtimeProvider tenantId={tenantId}>
        {children}
        <RealtimeDiagnosticsOverlay />
      </RealtimeProvider>
    </ConfirmProvider>
  );
}
