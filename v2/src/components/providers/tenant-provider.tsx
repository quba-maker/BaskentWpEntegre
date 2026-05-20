"use client";

import React, { createContext, useContext } from "react";
import type { TenantBootstrapData } from "@/lib/domain/tenant/bootstrap";

interface TenantContextValue {
  tenant: TenantBootstrapData | null;
  hasFeature: (moduleName: string) => boolean;
}

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({ 
  children, 
  initialData 
}: { 
  children: React.ReactNode;
  initialData: TenantBootstrapData | null;
}) {
  const hasFeature = (moduleName: string) => {
    if (!initialData) return false;
    return initialData.modules.includes(moduleName);
  };

  return (
    <TenantContext.Provider value={{ tenant: initialData, hasFeature }}>
      {/* 
        Inject the tenant primary color into the root style so 
        --q-tenant-color can be used for dynamic branding 
      */}
      <div 
        style={{ 
          display: 'contents', 
          '--q-tenant-color': initialData?.profile?.primary_color || 'var(--q-blue)' 
        } as React.CSSProperties}
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
