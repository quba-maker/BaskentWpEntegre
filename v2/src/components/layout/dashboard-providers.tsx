"use client";

import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { RealtimeProvider } from "@/components/providers/realtime-provider";
import { RealtimeDiagnosticsOverlay } from "@/components/features/realtime/diagnostics-overlay";
import { TenantProvider } from "@/components/providers/tenant-provider";
import type { TenantBootstrapData } from "@/lib/domain/tenant/bootstrap";

// ==========================================
// Client-side providers wrapper for dashboard
// Houses all context providers that require "use client"
// ==========================================

const IS_DEV = process.env.NODE_ENV === "development";

export function DashboardProviders({ 
  children, 
  tenantId,
  tenantData,
  role
}: { 
  children: React.ReactNode; 
  tenantId?: string;
  tenantData: TenantBootstrapData | null;
  role?: string;
}) {
  return (
    <TenantProvider initialData={tenantData} role={role}>
      <ConfirmProvider>
        <RealtimeProvider tenantId={tenantId}>
          {children}
          {IS_DEV && <RealtimeDiagnosticsOverlay />}
        </RealtimeProvider>
      </ConfirmProvider>
    </TenantProvider>
  );
}
