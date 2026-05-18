"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { Flag, ToggleLeft, ToggleRight, Clock, User } from "lucide-react";
import { getFeatureFlags, toggleFeatureFlag } from "@/app/actions/ai-control";

const FLAG_DESCRIPTIONS: Record<string, string> = {
  'ai_memory_enabled': 'AI conversation summarization and memory persistence across sessions.',
  'tool_calling_enabled': 'Allow AI to execute tools (CRM lookups, calendar scheduling, etc.)',
  'live_debug_enabled': 'Show live debugging panel for real-time AI pipeline monitoring.',
  'auto_crm_sync': 'Automatically extract and sync CRM data from conversations.',
  'autonomous_mode': 'Full autonomous AI mode — no human fallback required.',
  'ai_sandbox_enabled': 'Enable AI Sandbox Lab for prompt testing without live impact.',
};

export function FeatureFlagsPanel() {
  const { data: flags, mutate } = useSWR('feature-flags', getFeatureFlags);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const handleToggle = async (key: string, currentState: boolean) => {
    setLoadingKey(key);
    const result = await toggleFeatureFlag(key, !currentState);
    setLoadingKey(null);
    if (result.success) {
      mutate();
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flag className="w-5 h-5" style={{ color: 'var(--q-blue)' }} />
          <h3 className="text-base font-bold" style={{ color: 'var(--q-text-primary)' }}>Feature Flags</h3>
        </div>
        <span className="text-[10px] font-medium px-2.5 py-1 rounded-full"
              style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-secondary)' }}>
          Tenant-Level Control
        </span>
      </div>

      {/* Flag List */}
      <div className="space-y-2">
        {(!flags || flags.length === 0) && (
          <div className="p-8 text-center rounded-xl" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
            <Flag className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm" style={{ color: 'var(--q-text-secondary)' }}>Loading feature flags...</p>
          </div>
        )}

        {flags?.map((flag: any) => {
          const isLoading = loadingKey === flag.key;
          const desc = FLAG_DESCRIPTIONS[flag.key] || '';

          return (
            <div 
              key={flag.key}
              className="flex items-center gap-4 px-4 py-4 rounded-xl transition-all"
              style={{ 
                background: 'var(--q-bg-primary)', 
                border: `1px solid ${flag.enabled ? 'color-mix(in srgb, var(--q-green) 20%, var(--q-border-default))' : 'var(--q-border-default)'}`,
              }}
            >
              {/* Toggle */}
              <button
                onClick={() => handleToggle(flag.key, flag.enabled)}
                disabled={isLoading}
                className="flex-shrink-0 transition-all cursor-pointer disabled:opacity-50"
              >
                {flag.enabled ? (
                  <ToggleRight className="w-8 h-8" style={{ color: 'var(--q-green)' }} />
                ) : (
                  <ToggleLeft className="w-8 h-8" style={{ color: 'var(--q-text-secondary)' }} />
                )}
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold" style={{ color: 'var(--q-text-primary)' }}>
                    {flag.label}
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-secondary)' }}>
                    {flag.key}
                  </span>
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--q-text-secondary)' }}>{desc}</p>
                {flag.updatedAt && (
                  <div className="flex items-center gap-3 text-[10px] mt-1.5" style={{ color: 'var(--q-text-secondary)' }}>
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{flag.updatedBy}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(flag.updatedAt).toLocaleString('tr-TR')}</span>
                  </div>
                )}
              </div>

              {/* Status */}
              <div className="flex-shrink-0">
                <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full"
                      style={{
                        color: flag.enabled ? 'var(--q-green)' : 'var(--q-text-secondary)',
                        background: flag.enabled ? 'color-mix(in srgb, var(--q-green) 8%, transparent)' : 'var(--q-bg-secondary)',
                      }}>
                  {flag.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
