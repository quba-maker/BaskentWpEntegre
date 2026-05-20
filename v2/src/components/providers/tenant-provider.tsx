"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { TenantBootstrapData } from "@/lib/domain/tenant/bootstrap";
import { getDashboardStats } from "@/app/actions/dashboard"; // just for refresh example if needed

interface TenantContextValue {
  tenant: TenantBootstrapData | null;
  hasFeature: (flag: string) => boolean;
  hasPermission: (action: string) => boolean;
  refresh: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ 
  children, 
  initialData,
  role
}: { 
  children: React.ReactNode;
  initialData: TenantBootstrapData | null;
  role?: string;
}) {
  const [tenantState, setTenantState] = useState<TenantBootstrapData | null>(initialData);

  // Snapshot hydration to eliminate white flash
  useEffect(() => {
    if (initialData) {
      sessionStorage.setItem('tenant_snapshot', JSON.stringify(initialData));
      setTenantState(initialData);
    } else {
      const snap = sessionStorage.getItem('tenant_snapshot');
      if (snap) {
        setTenantState(JSON.parse(snap));
      }
    }
  }, [initialData]);

  const refresh = useCallback(async () => {
    // For runtime refresh, you would fetch a Server Action returning the new bootstrap
    // and call setTenantState. This prepares the architecture.
    console.log("[TENANT] Runtime refresh requested");
  }, []);

  const hasFeature = useCallback((flag: string) => {
    if (!tenantState) return false;
    return !!tenantState.flags[flag];
  }, [tenantState]);

  const hasPermission = useCallback((action: string) => {
    if (!role) return false;
    // Basic Permission Matrix
    const matrix: Record<string, string[]> = {
      'view_analytics': ['platform_admin', 'owner', 'admin', 'manager'],
      'manage_bot': ['platform_admin', 'owner', 'admin', 'manager'],
      'view_inbox': ['platform_admin', 'owner', 'admin', 'manager', 'agent'],
      'edit_forms': ['platform_admin', 'owner', 'admin', 'manager'],
      'manage_settings': ['platform_admin', 'owner', 'admin']
    };
    
    // Super admins can do anything
    if (role === 'platform_admin' || role === 'owner') return true;
    
    const allowedRoles = matrix[action] || [];
    return allowedRoles.includes(role);
  }, [role]);

  return (
    <TenantContext.Provider value={{ tenant: tenantState, hasFeature, hasPermission, refresh }}>
      {/* 
        Inject the tenant primary color into the root style so 
        --q-tenant-color can be used for dynamic branding 
      */}
      <div 
        style={{ 
          display: 'contents', 
          '--q-tenant-color': tenantState?.profile?.primary_color || 'var(--q-blue)' 
        } as React.CSSProperties}
        data-sidebar-theme={tenantState?.theme?.sidebar_theme}
        data-density={tenantState?.theme?.dashboard_density}
        data-ui-mode={tenantState?.theme?.ui_mode}
      >
        {children}
      </div>
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return context;
}

export function PermissionGuard({ requireFeature, requirePermission, children, fallback }: { requireFeature?: string, requirePermission?: string, children: React.ReactNode, fallback?: React.ReactNode }) {
  const { hasFeature, hasPermission } = useTenant();
  
  if (requireFeature && !hasFeature(requireFeature)) {
    return fallback ? <>{fallback}</> : <div className="p-4 text-sm text-gray-500 bg-gray-50 rounded-lg border border-gray-100">Bu özellik şirketiniz için kapalıdır.</div>;
  }
  
  if (requirePermission && !hasPermission(requirePermission)) {
    return fallback ? <>{fallback}</> : <div className="p-4 text-sm text-red-500 bg-red-50 rounded-lg border border-red-100">Bu alanı görüntüleme yetkiniz yok.</div>;
  }
  
  return <>{children}</>;
}
