"use client";

import { ConfirmProvider } from "@/components/ui/confirm-dialog";

import { RealtimeProvider } from "@/components/providers/realtime-provider";
import { RealtimeDiagnosticsOverlay } from "@/components/features/realtime/diagnostics-overlay";

// ==========================================
// Client-side providers wrapper for dashboard
// Houses all context providers that require "use client"
// ==========================================

const IS_DEV = process.env.NODE_ENV === "development";

export function DashboardProviders({ children, tenantId }: { children: React.ReactNode, tenantId?: string }) {
  return (
    <ConfirmProvider>
      <RealtimeProvider tenantId={tenantId}>
        {children}
        {IS_DEV && <RealtimeDiagnosticsOverlay />}
      </RealtimeProvider>
    </ConfirmProvider>
  );
}
