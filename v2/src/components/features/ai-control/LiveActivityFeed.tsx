"use client";

import React from "react";
import useSWR from "swr";
import { Activity, AlertTriangle, AlertCircle, CheckCircle2, Brain, User, Wrench, Shield, MessageSquare, Database, Clock } from "lucide-react";
import { getLiveActivityFeed, getActivityStats } from "@/app/actions/ai-control";

const EVENT_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  'brain_resolved':           { icon: Brain, color: 'var(--q-blue)', label: 'Brain Resolved' },
  'identity_resolved':        { icon: User, color: 'var(--q-green)', label: 'Identity Resolved' },
  'ai_response_generated':    { icon: MessageSquare, color: 'var(--q-green)', label: 'AI Response' },
  'ai_timeout':               { icon: Clock, color: 'var(--q-red)', label: 'AI Timeout' },
  'tool_executed':             { icon: Wrench, color: 'var(--q-blue)', label: 'Tool Executed' },
  'tool_failed':               { icon: Wrench, color: 'var(--q-red)', label: 'Tool Failed' },
  'policy_blocked':            { icon: Shield, color: 'var(--q-red)', label: 'Policy Blocked' },
  'human_escalation':          { icon: AlertTriangle, color: 'var(--q-orange)', label: 'Escalation' },
  'crm_extraction_completed':  { icon: Database, color: 'var(--q-green)', label: 'CRM Updated' },
  'crm_extraction_failed':     { icon: Database, color: 'var(--q-red)', label: 'CRM Failed' },
  'memory_updated':            { icon: Brain, color: 'var(--q-purple-alt)', label: 'Memory Updated' },
  'memory_failed':             { icon: Brain, color: 'var(--q-red)', label: 'Memory Failed' },
  'working_hours_blocked':     { icon: Clock, color: 'var(--q-orange)', label: 'Off-Hours' },
  'max_messages_reached':      { icon: AlertCircle, color: 'var(--q-orange)', label: 'Max Messages' },
  'duplicate_message_dropped': { icon: CheckCircle2, color: 'var(--q-text-secondary)', label: 'Duplicate Dropped' },
  'prompt_version_created':    { icon: Brain, color: 'var(--q-blue)', label: 'Prompt Versioned' },
};

function relativeTime(dateStr: string) {
  const diff = Math.round((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
      <p className="text-[11px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--q-text-secondary)' }}>{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ color: color || 'var(--q-text-primary)' }}>{value}</p>
    </div>
  );
}

export function LiveActivityFeed() {
  const { data: feedData } = useSWR('ai-activity-feed', () => getLiveActivityFeed(80), { refreshInterval: 5000 });
  const { data: stats } = useSWR('ai-activity-stats', getActivityStats, { refreshInterval: 10000 });

  const events = feedData?.events || [];

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Last Hour" value={parseInt(stats.last_hour) || 0} />
          <StatCard label="24h Events" value={parseInt(stats.last_24h) || 0} />
          <StatCard label="Errors (24h)" value={parseInt(stats.errors_24h) || 0} color={parseInt(stats.errors_24h) > 0 ? 'var(--q-red)' : undefined} />
          <StatCard label="Escalations" value={parseInt(stats.escalations_24h) || 0} color={parseInt(stats.escalations_24h) > 0 ? 'var(--q-orange)' : undefined} />
        </div>
      )}

      {/* Event Stream */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--q-border-default)' }}>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" style={{ color: 'var(--q-blue)' }} />
            <h3 className="text-sm font-bold" style={{ color: 'var(--q-text-primary)' }}>Live Event Stream</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-medium" style={{ color: 'var(--q-text-secondary)' }}>Auto-refresh 5s</span>
          </div>
        </div>

        <div className="max-h-[600px] overflow-y-auto divide-y" style={{ borderColor: 'var(--q-border-default)' }}>
          {events.length === 0 && (
            <div className="p-8 text-center">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm" style={{ color: 'var(--q-text-secondary)' }}>No events yet. AI activity will appear here in real-time.</p>
            </div>
          )}
          {events.map((event: any) => {
            const config = EVENT_CONFIG[event.event_type] || { icon: Activity, color: 'var(--q-text-secondary)', label: event.event_type };
            const Icon = config.icon;
            const severityBg = event.severity === 'error' ? 'rgba(255,59,48,0.04)' : event.severity === 'warning' ? 'rgba(255,149,0,0.04)' : 'transparent';

            return (
              <div 
                key={event.id} 
                className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02] transition-colors"
                style={{ background: severityBg }}
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                     style={{ background: `color-mix(in srgb, ${config.color} 10%, transparent)` }}>
                  <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--q-text-primary)' }}>{config.label}</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" 
                          style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-secondary)' }}>
                      {event.event_category}
                    </span>
                    {event.severity !== 'info' && (
                      <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded"
                            style={{ 
                              color: event.severity === 'error' ? 'var(--q-red)' : 'var(--q-orange)',
                              background: event.severity === 'error' ? 'rgba(255,59,48,0.08)' : 'rgba(255,149,0,0.08)'
                            }}>
                        {event.severity}
                      </span>
                    )}
                    <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: 'var(--q-text-secondary)' }}>
                      {relativeTime(event.created_at)}
                    </span>
                  </div>
                  {event.payload && Object.keys(event.payload).length > 0 && (
                    <p className="text-[11px] mt-0.5 font-mono truncate" style={{ color: 'var(--q-text-secondary)' }}>
                      {Object.entries(event.payload).slice(0, 3).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
