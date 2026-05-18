"use client";

import React, { useState } from "react";
import { Activity, Brain, Flag, Wrench, Route, FlaskConical } from "lucide-react";
import { LiveActivityFeed } from "./LiveActivityFeed";
import { PromptVersionManager } from "./PromptVersionManager";
import { FeatureFlagsPanel } from "./FeatureFlagsPanel";
import { ToolActivityMonitor } from "./ToolActivityMonitor";
import { DecisionTraceViewer } from "./DecisionTraceViewer";
import { AiSandboxLab } from "./AiSandboxLab";

/**
 * 🏗️ AI Kontrol Merkezi — Phase 7
 * Kurumsal AI Orkestrasyon Paneli
 */

const TABS = [
  { id: 'activity', label: 'Canlı Aktivite', icon: Activity },
  { id: 'prompt', label: 'Prompt Yönetimi', icon: Brain },
  { id: 'flags', label: 'Özellik Anahtarları', icon: Flag },
  { id: 'tools', label: 'Araç İzleme', icon: Wrench },
  { id: 'trace', label: 'Karar İzleme', icon: Route },
  { id: 'sandbox', label: 'AI Test Lab', icon: FlaskConical },
] as const;

type TabId = typeof TABS[number]['id'];

export function AiControlTower() {
  const [activeTab, setActiveTab] = useState<TabId>('activity');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--q-text-primary)' }}>
            AI Kontrol Merkezi
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--q-text-secondary)' }}>
            AI Orkestrasyon & Yönetim Paneli
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium" style={{ color: 'var(--q-text-secondary)' }}>Sistem Aktif</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div 
        className="flex items-center gap-1 p-1 rounded-xl overflow-x-auto"
        style={{ background: 'var(--q-bg-secondary)', border: '1px solid var(--q-border-default)' }}
      >
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium transition-all whitespace-nowrap cursor-pointer"
              style={{
                background: isActive ? 'var(--q-bg-primary)' : 'transparent',
                color: isActive ? 'var(--q-blue)' : 'var(--q-text-secondary)',
                boxShadow: isActive ? 'var(--q-shadow-sm)' : 'none',
              }}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active Panel */}
      <div className="min-h-[500px]">
        {activeTab === 'activity' && <LiveActivityFeed />}
        {activeTab === 'prompt' && <PromptVersionManager />}
        {activeTab === 'flags' && <FeatureFlagsPanel />}
        {activeTab === 'tools' && <ToolActivityMonitor />}
        {activeTab === 'trace' && <DecisionTraceViewer />}
        {activeTab === 'sandbox' && <AiSandboxLab />}
      </div>
    </div>
  );
}
