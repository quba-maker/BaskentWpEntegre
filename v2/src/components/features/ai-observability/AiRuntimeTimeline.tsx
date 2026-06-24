"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronRight, Activity, CheckCircle2, XCircle, Clock, Shield } from "lucide-react";
import { getConversationTraces } from "@/app/actions/ai-observability";

export function AiRuntimeTimeline({ conversationId }: { conversationId: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const { data: traces, isLoading } = useSWR(
    conversationId ? ["traces", conversationId] : null,
    () => getConversationTraces(conversationId),
    { 
      refreshInterval: isExpanded ? 30000 : 0,
      refreshWhenHidden: false,
      revalidateOnFocus: true
    }
  );

  if (!traces || traces.length === 0) return null;

  return (
    <div className="w-full my-4 flex flex-col items-center group/timeline">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all bg-[--q-bg-primary] border border-[--q-border-default] text-[--q-text-secondary] hover:border-[--q-blue] hover:text-[--q-blue] shadow-sm cursor-pointer"
      >
        <Activity className="w-3.5 h-3.5" />
        <span>⚡ AI {traces.length} araç çalıştırdı</span>
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {isExpanded && (
        <div className="w-full max-w-[85%] mt-3 bg-[--q-bg-primary] border border-[--q-border-default] rounded-xl overflow-hidden shadow-sm text-left font-mono text-[11px]">
          <div className="px-3 py-2 bg-[--q-bg-secondary] border-b border-[--q-border-default] flex justify-between items-center">
            <span className="font-bold text-[--q-text-primary]">AI çalışma detayı</span>
            <span className="text-[--q-text-secondary] flex items-center gap-1">
              <Shield className="w-3 h-3" />
              İzlenebilir
            </span>
          </div>
          
          <div className="p-3 flex flex-col gap-3 max-h-[300px] overflow-y-auto">
            {traces.map((trace: any) => (
              <div key={trace.id} className="flex flex-col gap-1.5 pl-3 border-l-2 border-[--q-border-strong] relative">
                <div className="absolute -left-[5px] top-1 w-2 h-2 rounded-full bg-[--q-bg-primary] border-2" 
                     style={{ borderColor: trace.validation_passed ? 'var(--q-green)' : 'var(--q-red)' }} />
                
                <div className="flex items-center gap-2">
                  <span className="text-[--q-text-primary] font-bold">{trace.tool_name}</span>
                  {trace.validation_passed ? (
                    <span className="flex items-center gap-1 text-[--q-green] bg-[--q-green-bg] px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider">
                      <CheckCircle2 className="w-3 h-3" /> Geçti
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[--q-red] bg-[--q-red-bg] px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider">
                      <XCircle className="w-3 h-3" /> Hata
                    </span>
                  )}
                  {trace.execution_duration_ms && (
                    <span className="flex items-center gap-1 text-[--q-text-secondary]">
                      <Clock className="w-3 h-3" /> {trace.execution_duration_ms}ms
                    </span>
                  )}
                  {(trace.input_tokens || trace.output_tokens) && (
                    <span className="flex items-center gap-1 text-[--q-text-secondary] ml-auto">
                      <span className="text-[9px] font-mono border border-[--q-border-default] px-1 rounded">
                        IN: {trace.input_tokens || 0}
                      </span>
                      <span className="text-[9px] font-mono border border-[--q-border-default] px-1 rounded">
                        OUT: {trace.output_tokens || 0}
                      </span>
                    </span>
                  )}
                  {trace.cost_usd !== null && trace.cost_usd !== undefined && (
                    <span className="flex items-center gap-1 text-[--q-text-secondary] font-mono text-[9px] bg-[--q-bg-secondary] px-1 rounded border border-[--q-border-default]">
                      ${Number(trace.cost_usd).toFixed(6)}
                    </span>
                  )}
                </div>

                {trace.tool_arguments && Object.keys(trace.tool_arguments).length > 0 && (
                  <div className="bg-[--q-bg-tertiary] p-2 rounded border border-[--q-border-default] overflow-x-auto">
                    <pre className="text-[10px] text-[--q-text-secondary]">
                      {JSON.stringify(trace.tool_arguments, null, 2)}
                    </pre>
                  </div>
                )}

                {trace.error_message && (
                  <div className="text-[--q-red] text-[10px] mt-1">{trace.error_message}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
