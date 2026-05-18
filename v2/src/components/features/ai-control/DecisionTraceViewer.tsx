"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { Route, Search, ChevronRight, CheckCircle2, XCircle, AlertTriangle, MessageSquare, Brain, User, Wrench, Shield, Database, Clock } from "lucide-react";
import { getDecisionTrace } from "@/app/actions/ai-control";

const STAGE_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  'brain_resolved':           { icon: Brain, color: 'var(--q-blue)', label: 'Brain Resolved' },
  'identity_resolved':        { icon: User, color: 'var(--q-green)', label: 'Identity Resolved' },
  'duplicate_message_dropped': { icon: XCircle, color: 'var(--q-text-secondary)', label: 'Duplicate Dropped' },
  'working_hours_blocked':    { icon: Clock, color: 'var(--q-orange)', label: 'Working Hours Block' },
  'max_messages_reached':     { icon: AlertTriangle, color: 'var(--q-orange)', label: 'Max Messages' },
  'ai_response_generated':    { icon: MessageSquare, color: 'var(--q-green)', label: 'AI Response' },
  'ai_timeout':               { icon: Clock, color: 'var(--q-red)', label: 'AI Timeout' },
  'tool_executed':             { icon: Wrench, color: 'var(--q-blue)', label: 'Tool Executed' },
  'tool_failed':               { icon: Wrench, color: 'var(--q-red)', label: 'Tool Failed' },
  'policy_blocked':            { icon: Shield, color: 'var(--q-red)', label: 'Policy Blocked' },
  'human_escalation':          { icon: AlertTriangle, color: 'var(--q-orange)', label: 'Human Escalation' },
  'crm_extraction_completed':  { icon: Database, color: 'var(--q-green)', label: 'CRM Updated' },
  'crm_extraction_failed':     { icon: Database, color: 'var(--q-red)', label: 'CRM Failed' },
  'memory_updated':            { icon: Brain, color: 'var(--q-purple-alt)', label: 'Memory Updated' },
  'memory_failed':             { icon: Brain, color: 'var(--q-red)', label: 'Memory Failed' },
};

export function DecisionTraceViewer() {
  const [conversationId, setConversationId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  
  const { data: trace, isLoading } = useSWR(
    conversationId ? ['decision-trace', conversationId] : null,
    () => getDecisionTrace(conversationId)
  );

  const handleSearch = () => {
    if (searchInput.trim()) {
      setConversationId(searchInput.trim());
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Route className="w-5 h-5" style={{ color: 'var(--q-blue)' }} />
        <h3 className="text-base font-bold" style={{ color: 'var(--q-text-primary)' }}>AI Decision Trace</h3>
      </div>

      {/* Search */}
      <div 
        className="flex items-center gap-2 p-3 rounded-xl"
        style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}
      >
        <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--q-text-secondary)' }} />
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Enter Conversation ID..."
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: 'var(--q-text-primary)' }}
        />
        <button 
          onClick={handleSearch}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          style={{ background: 'var(--q-blue)', color: '#fff' }}
        >
          Trace
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="p-8 text-center">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-2" style={{ borderColor: 'var(--q-blue)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--q-text-secondary)' }}>Analyzing pipeline...</p>
        </div>
      )}

      {/* Empty State */}
      {!conversationId && !isLoading && (
        <div className="p-12 text-center rounded-xl" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
          <Route className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium" style={{ color: 'var(--q-text-primary)' }}>AI Decision Pipeline Tracer</p>
          <p className="text-xs mt-1" style={{ color: 'var(--q-text-secondary)' }}>
            Enter a Conversation ID to see exactly why the AI made each decision.
          </p>
        </div>
      )}

      {/* Conversation Context */}
      {trace?.conversation && (
        <div className="rounded-xl p-4" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
          <h4 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--q-text-secondary)' }}>
            Conversation Context
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ContextItem label="Phone" value={trace.conversation.phone_number} />
            <ContextItem label="Customer" value={[trace.conversation.first_name, trace.conversation.last_name].filter(Boolean).join(' ') || '—'} />
            <ContextItem label="Stage" value={trace.conversation.lead_stage || '—'} />
            <ContextItem label="Sentiment" value={trace.conversation.sentiment || '—'} />
          </div>
        </div>
      )}

      {/* Pipeline Visualization */}
      {trace?.pipelineStages && trace.pipelineStages.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--q-border-default)' }}>
            <h4 className="text-sm font-bold" style={{ color: 'var(--q-text-primary)' }}>Pipeline Execution</h4>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--q-text-secondary)' }}>
              {trace.pipelineStages.length} stages executed · {trace.events?.length || 0} total events
            </p>
          </div>

          <div className="px-4 py-3 space-y-1">
            {trace.pipelineStages.map((stage: any, i: number) => {
              const config = STAGE_CONFIG[stage.stage] || { icon: CheckCircle2, color: 'var(--q-text-secondary)', label: stage.stage };
              const Icon = config.icon;
              const isLast = i === trace.pipelineStages.length - 1;

              return (
                <div key={stage.stage} className="flex items-start gap-3">
                  {/* Timeline Line */}
                  <div className="flex flex-col items-center">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                         style={{ background: `color-mix(in srgb, ${config.color} 12%, transparent)` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                    </div>
                    {!isLast && (
                      <div className="w-px h-6 my-1" style={{ background: 'var(--q-border-default)' }} />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold" style={{ color: 'var(--q-text-primary)' }}>{config.label}</span>
                      {stage.count > 1 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-secondary)' }}>
                          ×{stage.count}
                        </span>
                      )}
                      {stage.lastEvent?.created_at && (
                        <span className="text-[10px] ml-auto font-mono" style={{ color: 'var(--q-text-secondary)' }}>
                          {new Date(stage.lastEvent.created_at).toLocaleTimeString('tr-TR')}
                        </span>
                      )}
                    </div>
                    {stage.lastEvent?.payload && Object.keys(stage.lastEvent.payload).length > 0 && (
                      <p className="text-[10px] font-mono mt-0.5 truncate" style={{ color: 'var(--q-text-secondary)' }}>
                        {Object.entries(stage.lastEvent.payload).slice(0, 4).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No Results */}
      {conversationId && !isLoading && trace?.pipelineStages?.length === 0 && (
        <div className="p-8 text-center rounded-xl" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
          <XCircle className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p className="text-sm" style={{ color: 'var(--q-text-secondary)' }}>
            No AI events found for this conversation.
          </p>
        </div>
      )}
    </div>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--q-text-secondary)' }}>{label}</p>
      <p className="text-[13px] font-semibold mt-0.5 truncate" style={{ color: 'var(--q-text-primary)' }}>{value}</p>
    </div>
  );
}
