"use client";

import React from "react";
import useSWR from "swr";
import { Brain, Flame, ThermometerSun, ThermometerSnowflake, Tag, Activity, ListTodo } from "lucide-react";
import { getCustomerAiBrain } from "@/app/actions/ai-observability";

export function CustomerAiBrainPanel({ phoneNumber }: { phoneNumber: string }) {
  const { data: brain, isLoading } = useSWR(
    phoneNumber ? ["ai_brain", phoneNumber] : null,
    () => getCustomerAiBrain(phoneNumber),
    { 
      refreshInterval: 60000,
      refreshWhenHidden: false,
      revalidateOnFocus: true
    }
  );

  if (isLoading) {
    return (
      <div className="w-full p-4 flex flex-col gap-3">
        <div className="h-6 w-32 q-skeleton rounded" />
        <div className="h-20 w-full q-skeleton rounded-lg" />
      </div>
    );
  }

  if (!brain) return null;

  const getTemperatureIcon = (stage: string) => {
    switch(stage) {
      case 'appointed': return <Flame className="w-4 h-4 text-[--q-orange]" />;
      case 'contacted': return <ThermometerSun className="w-4 h-4 text-[--q-orange]" />;
      default: return <ThermometerSnowflake className="w-4 h-4 text-[--q-blue]" />;
    }
  };

  return (
    <div className="flex flex-col w-full text-sm mt-6 pt-6" style={{ borderTop: "1px solid var(--q-border-default)" }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm" style={{ background: "var(--q-purple-bg)", border: "1px solid rgba(175, 82, 222, 0.2)" }}>
          <Brain className="w-4 h-4" style={{ color: "var(--q-purple)" }} />
        </div>
        <div>
          <h3 className="font-bold tracking-tight text-[14px]" style={{ color: "var(--q-text-primary)" }}>AI Brain</h3>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--q-text-secondary)" }}>Tenant Memory System</p>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        
        {/* Status Badges */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[--q-text-secondary]">Current State</span>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[--q-bg-primary] border border-[--q-border-default] shadow-sm font-medium text-[12px]">
              {getTemperatureIcon(brain.lead_stage)}
              <span className="capitalize">{brain.lead_stage || 'New'}</span>
            </div>
            {brain.buying_intent && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[--q-green-bg] border border-[--q-green-bg] text-[--q-green] font-bold text-[12px]">
                <Activity className="w-3.5 h-3.5" />
                <span>{brain.buying_intent}</span>
              </div>
            )}
            {brain.department && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[--q-bg-primary] border border-[--q-border-default] shadow-sm font-medium text-[12px]">
                <Tag className="w-3.5 h-3.5 text-[--q-text-secondary]" />
                <span>{brain.department}</span>
              </div>
            )}
          </div>
        </div>

        {/* AI Summary */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[--q-text-secondary] flex items-center gap-1">
            <ListTodo className="w-3 h-3" />
            AI Summary
          </span>
          {brain.summary_text ? (
            <div className="p-3 rounded-lg bg-[--q-purple-bg] border border-purple-500/20">
              <p className="text-[13px] leading-relaxed text-[--q-text-primary] font-medium">
                {brain.summary_text}
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-[--q-bg-primary] border border-[--q-border-default] border-dashed">
              <p className="text-[12px] text-[--q-text-secondary] text-center italic">
                AI has not generated a summary yet.
              </p>
            </div>
          )}
        </div>

        {/* Total Tools Used */}
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[--q-text-secondary]">Metrics</span>
          <div className="p-3 rounded-lg bg-[--q-bg-primary] border border-[--q-border-default] shadow-sm flex items-center justify-between">
            <span className="text-[13px] font-medium text-[--q-text-primary]">Total Tool Calls</span>
            <span className="font-mono text-[13px] font-bold text-[--q-text-secondary]">{brain.total_tool_calls || 0}</span>
          </div>
        </div>
        
      </div>
    </div>
  );
}
