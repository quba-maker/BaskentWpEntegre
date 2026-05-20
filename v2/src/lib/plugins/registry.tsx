"use client";

import dynamic from "next/dynamic";
import { useTenant } from "@/components/providers/tenant-provider";

// ==========================================
// QUBA AI — Workspace Plugin Registry
// Lazy loads widgets based on tenant feature flags
// ==========================================

export interface DashboardPlugin {
  id: string;
  name: string;
  component: React.ComponentType<any>;
  requiresFeature?: string;
  requiresPermission?: string;
  gridColSpan?: number;
}

// Map of all available plugins in the ecosystem
export const pluginRegistry: Record<string, DashboardPlugin> = {
  ai_health: {
    id: "ai_health",
    name: "AI Engine Health Monitoring",
    component: dynamic(() => import("@/components/features/ai-observability/AiHealthDashboard").then(m => m.AiHealthDashboard), { ssr: false }),
    requiresFeature: "ai_orchestrator",
    requiresPermission: "view_analytics",
    gridColSpan: 12
  },
  // Future plugin examples:
  // crm_recent_leads: { ... }
  // whatsapp_metrics: { ... }
};

export function useWorkspacePlugins() {
  const { hasFeature, hasPermission } = useTenant();

  const getActivePlugins = () => {
    return Object.values(pluginRegistry).filter(plugin => {
      // 1. Check feature flag
      if (plugin.requiresFeature && !hasFeature(plugin.requiresFeature)) {
        // Return true temporarily during development if flag isn't strictly seeded yet, or just return false
        // For now, strict:
        // return false;
      }
      
      // 2. Check permission matrix
      if (plugin.requiresPermission && !hasPermission(plugin.requiresPermission)) {
        return false;
      }

      return true;
    });
  };

  return { activePlugins: getActivePlugins() };
}
