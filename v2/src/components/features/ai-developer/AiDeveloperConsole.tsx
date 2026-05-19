"use client";

import React, { useState } from "react";
import { Activity, Wrench, Route, Flag, Terminal } from "lucide-react";
import { LiveActivityFeed } from "./LiveActivityFeed";
import { ToolActivityMonitor } from "./ToolActivityMonitor";
import { DecisionTraceViewer } from "./DecisionTraceViewer";
import { FeatureFlagsPanel } from "./FeatureFlagsPanel";

const TABS = [
  { id: 'logs', label: 'Birleştirilmiş Loglar', icon: Activity },
  { id: 'trace', label: 'Karar & Aksiyon İzleme', icon: Route },
  { id: 'tools', label: 'Araç İzleme (Tools)', icon: Wrench },
  { id: 'flags', label: 'Sistem Durumu (Health)', icon: Flag },
] as const;

type TabId = typeof TABS[number]['id'];

export function AiDeveloperConsole() {
  const [activeTab, setActiveTab] = useState<TabId>('logs');

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex-shrink-0 rounded-xl bg-[--q-blue-bg] flex items-center justify-center">
            <Terminal className="w-5 h-5 text-[--q-blue]" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight truncate" style={{ color: 'var(--q-text-primary)' }}>
              AI Geliştirici Konsolu
            </h1>
            <p className="text-sm mt-1 truncate" style={{ color: 'var(--q-text-secondary)' }}>
              Unified Logs, Runtime Traces ve Sistem Sağlığı
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 w-fit">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Sistem Stabil</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div 
        className="flex lg:grid lg:grid-cols-4 items-center gap-2 p-1.5 rounded-xl overflow-x-auto w-full no-scrollbar snap-x"
        style={{ background: 'var(--q-bg-secondary)', border: '1px solid var(--q-border-default)' }}
      >
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-shrink-0 lg:flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium transition-all whitespace-nowrap cursor-pointer snap-center"
              style={{
                background: isActive ? 'var(--q-bg-primary)' : 'transparent',
                color: isActive ? 'var(--q-blue)' : 'var(--q-text-secondary)',
                boxShadow: isActive ? 'var(--q-shadow-sm)' : 'none',
              }}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Panel */}
      <div className="min-h-[500px]">
        {activeTab === 'logs' && <LiveActivityFeed />}
        {activeTab === 'trace' && <DecisionTraceViewer />}
        {activeTab === 'tools' && <ToolActivityMonitor />}
        {activeTab === 'flags' && <FeatureFlagsPanel />}
      </div>
    </div>
  );
}
