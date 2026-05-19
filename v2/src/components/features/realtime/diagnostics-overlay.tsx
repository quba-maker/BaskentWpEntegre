"use client";

import { useState, useEffect } from "react";
import { useDiagnosticsStore } from "@/lib/realtime/diagnostics-store";

export function DiagnosticsOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const state = useDiagnosticsStore();

  // Keyboard shortcut (Cmd+K / Ctrl+K + Shift + C for Chaos)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "C") {
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!isOpen) {
    return null; // Hidden by default, toggled via keyboard shortcut
  }

  return (
    <div className="fixed bottom-4 left-4 z-[9999] w-96 bg-black/90 text-green-400 font-mono text-xs rounded-lg shadow-2xl overflow-hidden border border-green-500/30 backdrop-blur-md">
      {/* Header */}
      <div className="flex justify-between items-center p-3 border-b border-green-500/30 bg-green-500/10">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${state.chaosModeEnabled ? "bg-red-500 animate-pulse" : "bg-green-500"}`} />
          <h3 className="font-bold tracking-wider text-green-300">RUNTIME DIAGNOSTICS</h3>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">&times;</button>
      </div>

      {/* Metrics Grid */}
      <div className="p-3 grid grid-cols-2 gap-2 border-b border-green-500/30 bg-black/50">
        <MetricCard label="Latency (ms)" value={`${state.metrics["realtime.event.latency"]}ms`} />
        <MetricCard label="Reconcile Time" value={`${state.metrics["realtime.projection.reconcile_ms"]}ms`} />
        <MetricCard label="Reconnects" value={state.metrics["realtime.socket.reconnects"]} />
        <MetricCard label="Dropped Events" value={state.metrics["realtime.event.dropped"]} />
        <MetricCard label="Coalesced Evts" value={state.metrics["realtime.event.coalesced"]} />
        <MetricCard label="Active Subs" value={state.activeSubscriptions.size} warning={state.activeSubscriptions.size > 2} />
      </div>

      {/* Chaos Control Panel */}
      <div className="p-3 border-b border-green-500/30">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-red-400 font-bold">CHAOS CONTROL PANEL</h4>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              className="sr-only peer"
              checked={state.chaosModeEnabled}
              onChange={(e) => state.setChaosMode(e.target.checked)}
            />
            <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-500"></div>
          </label>
        </div>

        <div className="space-y-2 opacity-90">
          <div className="flex justify-between items-center">
            <label>Delay (ms):</label>
            <input 
              type="range" min="0" max="5000" step="100" 
              value={state.chaosSettings.delayMs}
              onChange={(e) => state.updateChaosSettings({ delayMs: parseInt(e.target.value) })}
              className="w-24 accent-red-500"
            />
            <span>{state.chaosSettings.delayMs}</span>
          </div>
          <div className="flex justify-between items-center">
            <label>Drop Rate (%):</label>
            <input 
              type="range" min="0" max="1" step="0.1" 
              value={state.chaosSettings.dropRate}
              onChange={(e) => state.updateChaosSettings({ dropRate: parseFloat(e.target.value) })}
              className="w-24 accent-red-500"
            />
            <span>{Math.round(state.chaosSettings.dropRate * 100)}%</span>
          </div>
          <div className="flex justify-between items-center">
            <label>Duplicate Burst (x3):</label>
            <input 
              type="checkbox" 
              checked={state.chaosSettings.duplicateBurst}
              onChange={(e) => state.updateChaosSettings({ duplicateBurst: e.target.checked })}
              className="accent-red-500"
            />
          </div>
        </div>
      </div>

      {/* Logs Window */}
      <div className="p-3 h-32 overflow-y-auto space-y-1 bg-[#0a0a0a]">
        {state.logs.length === 0 ? (
          <div className="text-gray-600 italic">Waiting for events...</div>
        ) : (
          state.logs.map((log) => (
            <div key={log.id} className="text-[10px] break-all">
              <span className="text-gray-500">[{new Date(log.timestamp).toISOString().split('T')[1]}]</span>{" "}
              <span className={log.message.includes("Chaos") ? "text-red-400" : "text-green-400"}>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, warning }: { label: string; value: string | number; warning?: boolean }) {
  return (
    <div className={`p-2 rounded bg-black/50 border ${warning ? 'border-yellow-500/50 text-yellow-500' : 'border-green-500/20'}`}>
      <div className="text-[10px] text-gray-500 mb-1">{label}</div>
      <div className="font-bold text-sm">{value}</div>
    </div>
  );
}
