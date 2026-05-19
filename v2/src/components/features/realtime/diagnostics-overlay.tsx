"use client";

import { useEffect, useState } from "react";
import { useDiagnosticsStore } from "@/lib/realtime/diagnostics-store";
import { getSharedAblyClient } from "@/hooks/use-realtime-subscription";
import { useRealtimeTenant } from "@/components/providers/realtime-provider";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Wifi, WifiOff, Radio, Database, Users, BarChart3, X } from "lucide-react";

/**
 * Realtime Diagnostics Overlay (Dev-Only)
 * 
 * Internal panel for troubleshooting realtime pipeline.
 * Shows connection state, channel info, event metrics, and cache diagnostics.
 * Activated via keyboard shortcut: Ctrl+Shift+D
 */

function MetricRow({ label, value, unit, warn }: { label: string; value: string | number; unit?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 px-2 text-[11px] font-mono" 
         style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
      <span style={{ color: warn ? "#ff6b6b" : "#7bed9f", fontWeight: 600 }}>
        {value}{unit && <span style={{ color: "rgba(255,255,255,0.3)", marginLeft: 2 }}>{unit}</span>}
      </span>
    </div>
  );
}

export function RealtimeDiagnosticsOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const tenantId = useRealtimeTenant();
  const queryClient = useQueryClient();
  
  // Store selectors
  const metrics = useDiagnosticsStore((s) => s.metrics);
  const activeSubscriptions = useDiagnosticsStore((s) => s.activeSubscriptions);
  const isRealtimeDown = useDiagnosticsStore((s) => s.isRealtimeDown);
  
  // Connection state
  const [connectionState, setConnectionState] = useState("unknown");
  const [cacheSize, setCacheSize] = useState(0);

  // Keyboard shortcut: Ctrl+Shift+D
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "D") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Poll connection state and cache metrics
  useEffect(() => {
    if (!isOpen) return;
    
    const interval = setInterval(() => {
      if (tenantId) {
        const client = getSharedAblyClient(tenantId);
        if (client) {
          setConnectionState(client.connection.state);
        }
      }
      
      const cache = queryClient.getQueryCache();
      setCacheSize(cache.getAll().length);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isOpen, tenantId, queryClient]);

  if (!isOpen) return null;

  const subscriptionCount = activeSubscriptions.size;
  const mode = isRealtimeDown ? "POLLING" : "REALTIME";

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] rounded-xl overflow-hidden shadow-2xl"
      style={{
        width: 320,
        background: "rgba(15, 15, 20, 0.95)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(20px)",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2" 
           style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5" style={{ color: "#7bed9f" }} />
          <span className="text-[11px] font-bold tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.7)" }}>
            Realtime Diagnostics
          </span>
        </div>
        <button onClick={() => setIsOpen(false)} className="p-1 rounded hover:bg-white/10 transition-colors">
          <X className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
        </button>
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        {isRealtimeDown ? (
          <WifiOff className="w-3.5 h-3.5" style={{ color: "#ff6b6b" }} />
        ) : (
          <Wifi className="w-3.5 h-3.5" style={{ color: "#7bed9f" }} />
        )}
        <span className="text-[10px] font-bold uppercase tracking-widest" 
              style={{ color: isRealtimeDown ? "#ff6b6b" : "#7bed9f" }}>
          {mode}
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded" 
              style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }}>
          {connectionState}
        </span>
      </div>

      {/* Metrics */}
      <div className="py-1">
        <div className="px-2 py-1">
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>
            <Radio className="w-3 h-3 inline mr-1" />Connection
          </span>
        </div>
        <MetricRow label="State" value={connectionState} />
        <MetricRow label="Reconnects" value={metrics["realtime.socket.reconnects"]} />
        <MetricRow label="Active Channels" value={subscriptionCount} />
        
        <div className="px-2 py-1 mt-1">
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>
            <BarChart3 className="w-3 h-3 inline mr-1" />Performance
          </span>
        </div>
        <MetricRow label="Event Latency" value={metrics["realtime.event.latency"]} unit="ms" 
                   warn={metrics["realtime.event.latency"] > 2000} />
        <MetricRow label="Reconcile Time" value={metrics["realtime.projection.reconcile_ms"]} unit="ms"
                   warn={metrics["realtime.projection.reconcile_ms"] > 50} />
        <MetricRow label="Events Dropped" value={metrics["realtime.event.dropped"]} 
                   warn={metrics["realtime.event.dropped"] > 0} />
        
        <div className="px-2 py-1 mt-1">
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>
            <Users className="w-3 h-3 inline mr-1" />Presence
          </span>
        </div>
        <MetricRow label="TTL Expired" value={metrics["realtime.presence.ttl_expired"]} 
                   warn={metrics["realtime.presence.ttl_expired"] > 5} />
        
        <div className="px-2 py-1 mt-1">
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>
            <Database className="w-3 h-3 inline mr-1" />Cache
          </span>
        </div>
        <MetricRow label="Query Cache Entries" value={cacheSize} warn={cacheSize > 100} />
        <MetricRow label="Mode" value={mode} />
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 text-center" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.2)" }}>
          Ctrl+Shift+D to toggle | Internal use only
        </span>
      </div>
    </div>
  );
}
