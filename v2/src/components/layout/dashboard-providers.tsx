"use client";

import { ConfirmProvider } from "@/components/ui/confirm-dialog";

import { RealtimeProvider } from "@/components/providers/realtime-provider";

// ==========================================
// Client-side providers wrapper for dashboard
// Houses all context providers that require "use client"
// ==========================================

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      <RealtimeProvider>
        {children}
      </RealtimeProvider>
    </ConfirmProvider>
  );
}
