"use client";

import React from "react";
import useSWR from "swr";
import { Wrench, Clock, CheckCircle2, XCircle, Gauge, Ghost } from "lucide-react";
import { getToolActivityStats } from "@/app/actions/ai-control";

export function ToolActivityMonitor() {
  const { data: toolsRes } = useSWR('tool-activity', getToolActivityStats, { refreshInterval: 15000 });
  const tools = toolsRes?.success ? (toolsRes.data as any[]) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wrench className="w-5 h-5" style={{ color: 'var(--q-blue)' }} />
        <h3 className="text-base font-bold" style={{ color: 'var(--q-text-primary)' }}>Araç Aktivite İzleme</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-secondary)' }}>
          Son 7 gün
        </span>
      </div>

      {/* Tool Cards */}
      {(!tools || tools.length === 0) ? (
        <div className="p-8 text-center rounded-xl" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
          <Wrench className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p className="text-sm font-medium" style={{ color: 'var(--q-text-primary)' }}>Araç aktivitesi bulunamadı</p>
          <p className="text-xs mt-1" style={{ color: 'var(--q-text-secondary)' }}>AI araçları çalıştığında burada istatistikler görünecek.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tools.map((tool: any) => {
            const successRate = parseInt(tool.total_calls) > 0 
              ? Math.round((parseInt(tool.success_count) / parseInt(tool.total_calls)) * 100) 
              : 0;
            const avgLatency = Math.round(parseFloat(tool.avg_latency_ms) || 0);
            const isHealthy = successRate >= 95 && parseInt(tool.timeout_count || 0) === 0;

            return (
              <div 
                key={tool.tool_name || 'unknown'}
                className="rounded-xl p-4 space-y-3"
                style={{ 
                  background: 'var(--q-bg-primary)', 
                  border: `1px solid ${isHealthy ? 'var(--q-border-default)' : 'color-mix(in srgb, var(--q-orange) 30%, var(--q-border-default))'}` 
                }}
              >
                {/* Tool Name & Health */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                         style={{ background: isHealthy ? 'color-mix(in srgb, var(--q-green) 10%, transparent)' : 'color-mix(in srgb, var(--q-orange) 10%, transparent)' }}>
                      <Wrench className="w-4 h-4" style={{ color: isHealthy ? 'var(--q-green)' : 'var(--q-orange)' }} />
                    </div>
                    <span className="text-[13px] font-bold" style={{ color: 'var(--q-text-primary)' }}>
                      {tool.tool_name || 'Bilinmeyen'}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                        style={{
                          color: isHealthy ? 'var(--q-green)' : 'var(--q-orange)',
                          background: isHealthy ? 'color-mix(in srgb, var(--q-green) 8%, transparent)' : 'color-mix(in srgb, var(--q-orange) 8%, transparent)',
                        }}>
                    {isHealthy ? 'Sağlıklı' : 'Uyarı'}
                  </span>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-4 gap-2">
                  <MetricItem icon={CheckCircle2} label="Başarılı" value={tool.success_count} color="var(--q-green)" />
                  <MetricItem icon={XCircle} label="Başarısız" value={tool.failure_count || 0} color="var(--q-red)" />
                  <MetricItem icon={Clock} label="Zaman Aşımı" value={tool.timeout_count || 0} color="var(--q-orange)" />
                  <MetricItem icon={Ghost} label="Halüsinasyon" value={tool.hallucination_count || 0} color="var(--q-purple-alt)" />
                </div>

                {/* Performance Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium" style={{ color: 'var(--q-text-secondary)' }}>Başarı Oranı</span>
                    <span className="text-[11px] font-bold tabular-nums" style={{ color: successRate >= 95 ? 'var(--q-green)' : successRate >= 80 ? 'var(--q-orange)' : 'var(--q-red)' }}>
                      {successRate}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--q-bg-secondary)' }}>
                    <div 
                      className="h-full rounded-full transition-all"
                      style={{ 
                        width: `${successRate}%`,
                        background: successRate >= 95 ? 'var(--q-green)' : successRate >= 80 ? 'var(--q-orange)' : 'var(--q-red)',
                      }} 
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--q-text-secondary)' }}>
                  <div className="flex items-center gap-1">
                    <Gauge className="w-3 h-3" />
                    <span className="font-mono">{avgLatency}ms ort.</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span>{tool.total_calls} toplam çağrı</span>
                  </div>
                  {tool.last_execution && (
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(tool.last_execution).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricItem({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  const num = parseInt(String(value)) || 0;
  return (
    <div className="text-center space-y-0.5">
      <Icon className="w-3.5 h-3.5 mx-auto" style={{ color: num > 0 ? color : 'var(--q-text-secondary)', opacity: num > 0 ? 1 : 0.3 }} />
      <p className="text-sm font-bold tabular-nums" style={{ color: num > 0 ? color : 'var(--q-text-secondary)' }}>{num}</p>
      <p className="text-[8px] uppercase tracking-wider" style={{ color: 'var(--q-text-secondary)' }}>{label}</p>
    </div>
  );
}
