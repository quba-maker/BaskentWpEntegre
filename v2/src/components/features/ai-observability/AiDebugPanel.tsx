"use client";

import { useState, useEffect } from "react";
import { getAiDebugData, getBrainVersions, rollbackBrainVersion, getToolPermissions, toggleToolPermission } from "@/app/actions/ai-os";
import { 
  Terminal, Activity, Wrench, Brain, Shield, Clock, ChevronDown, ChevronRight,
  AlertTriangle, Check, X, RotateCcw, ToggleLeft, ToggleRight, Eye, EyeOff,
  Loader2, Zap, Timer, BarChart3
} from "lucide-react";

// =============================================
// AI Debug Panel — Phase 6 Enterprise Debug
// Stripe Dashboard / OpenAI Playground style
// =============================================

function formatMs(ms: number) {
  if (!ms) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatCost(cost: number) {
  if (!cost) return '$0';
  return `$${cost.toFixed(4)}`;
}

/**
 * Production Security: Mask secrets, API keys, tokens in prompt text.
 * Detects patterns like API_KEY=..., Bearer ..., sk-..., key-...
 */
function maskSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(/(api[_-]?key|token|secret|password|bearer)\s*[:=]\s*['"]?([a-zA-Z0-9_\-\.]{8,})['"]?/gi, 
      (_, key) => `${key}: ***MASKED***`)
    .replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***MASKED***')
    .replace(/key-[a-zA-Z0-9]{20,}/g, 'key-***MASKED***')
    .replace(/AIza[a-zA-Z0-9_\-]{30,}/g, 'AIza***MASKED***')
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]{20,}/g, 'Bearer ***MASKED***');
}

// -- Health Card --
function HealthCard({ label, value, suffix, icon: Icon, color, alert }: {
  label: string; value: number | string; suffix?: string;
  icon: typeof Activity; color: string; alert?: boolean;
}) {
  return (
    <div 
      className="rounded-xl p-4 relative overflow-hidden"
      style={{ 
        background: alert ? 'rgba(255,59,48,0.04)' : 'rgba(255,255,255,0.6)',
        border: `1px solid ${alert ? 'rgba(255,59,48,0.2)' : 'var(--q-border-default)'}`,
        boxShadow: 'var(--q-shadow-sm)'
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color }} />
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--q-text-secondary)' }}>
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-black" style={{ color: 'var(--q-text-primary)' }}>
          {value}
        </span>
        {suffix && (
          <span className="text-xs font-semibold" style={{ color: 'var(--q-text-secondary)' }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

// -- Collapsible Section --
function DebugSection({ title, icon: Icon, children, defaultOpen = false }: {
  title: string; icon: typeof Terminal; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div 
      className="rounded-2xl overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid var(--q-border-default)', boxShadow: 'var(--q-shadow-sm)' }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center gap-3 cursor-pointer transition-colors q-list-item"
      >
        <Icon className="w-5 h-5" style={{ color: 'var(--q-blue)' }} />
        <span className="text-[14px] font-bold flex-1 text-left" style={{ color: 'var(--q-text-primary)' }}>
          {title}
        </span>
        {open ? <ChevronDown className="w-4 h-4" style={{ color: 'var(--q-text-secondary)' }} /> : <ChevronRight className="w-4 h-4" style={{ color: 'var(--q-text-secondary)' }} />}
      </button>
      {open && (
        <div className="px-5 pb-5" style={{ borderTop: '1px solid var(--q-border-default)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// -- Main Debug Panel --
export function AiDebugPanel() {
  const [data, setData] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [promptVisible, setPromptVisible] = useState(false);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [togglingTool, setTogglingTool] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getAiDebugData(),
      getBrainVersions(),
      getToolPermissions(),
    ]).then(([d, v, t]) => {
      setData(d);
      setVersions(v);
      setTools(t);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleRollback = async (versionNumber: number) => {
    if (!confirm(`v${versionNumber} versiyonuna geri dönülsün mü? Aktif prompt bu versiyonla değiştirilecek.`)) return;
    setRollingBack(versionNumber);
    const res = await rollbackBrainVersion(versionNumber);
    if (res.success) {
      const [d, v] = await Promise.all([getAiDebugData(), getBrainVersions()]);
      setData(d);
      setVersions(v);
    }
    setRollingBack(null);
  };

  const handleToggleTool = async (toolName: string, currentEnabled: boolean) => {
    setTogglingTool(toolName);
    await toggleToolPermission(toolName, !currentEnabled);
    const t = await getToolPermissions();
    setTools(t);
    setTogglingTool(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--q-blue)' }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <Terminal className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-semibold" style={{ color: 'var(--q-text-secondary)' }}>Debug verisi yüklenemedi</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Terminal className="w-6 h-6" style={{ color: 'var(--q-blue)' }} />
        <div>
          <h2 className="text-xl font-black tracking-tight" style={{ color: 'var(--q-text-primary)' }}>AI Debug Panel</h2>
          <p className="text-xs" style={{ color: 'var(--q-text-secondary)' }}>Neden bu yanıt verildi? — Enterprise AI Observability</p>
        </div>
      </div>

      {/* Health Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <HealthCard label="Başarı Oranı" value={`${data.health.totalEvents > 0 ? Math.round(((data.health.totalEvents - data.health.errorCount) / data.health.totalEvents) * 100) : 100}`} suffix="%" icon={Activity} color="var(--q-green)" />
        <HealthCard label="Ort. Yanıt" value={formatMs(data.performance.avgResponseMs)} icon={Timer} color="var(--q-blue)" />
        <HealthCard label="Toplam Çağrı" value={data.performance.totalCalls} icon={Zap} color="var(--q-orange)" />
        <HealthCard label="Yavaş Çağrı" value={data.performance.slowCalls} icon={AlertTriangle} color="var(--q-red)" alert={data.performance.slowCalls > 3} />
        <HealthCard label="Hata" value={data.health.errorCount} icon={X} color="var(--q-red)" alert={data.health.errorCount > 0} />
      </div>

      {/* System Prompt Viewer */}
      <DebugSection title="Aktif Sistem Promptu" icon={Brain} defaultOpen={false}>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--q-text-secondary)' }}>Final Prompt</span>
            <button 
              onClick={() => setPromptVisible(!promptVisible)} 
              className="flex items-center gap-1 text-[11px] font-bold cursor-pointer q-press"
              style={{ color: 'var(--q-blue)' }}
            >
              {promptVisible ? <><EyeOff className="w-3 h-3" /> Gizle</> : <><Eye className="w-3 h-3" /> Göster</>}
            </button>
          </div>
          {promptVisible && data.currentPrompt && (
            <>
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ color: 'var(--q-orange)', background: 'rgba(255,149,0,0.08)' }}>
                  🔒 Secrets Masked
                </span>
                <span className="text-[9px]" style={{ color: 'var(--q-text-secondary)' }}>
                  {data.currentPrompt.length.toLocaleString()} karakter
                </span>
              </div>
              <pre 
                className="text-[11px] leading-relaxed p-4 rounded-xl overflow-auto max-h-[400px] whitespace-pre-wrap"
                style={{ 
                  background: 'var(--q-bg-primary)', 
                  border: '1px solid var(--q-border-default)',
                  color: 'var(--q-text-primary)',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace'
                }}
              >
                {maskSecrets(data.currentPrompt)}
              </pre>
            </>
          )}
          {promptVisible && !data.currentPrompt && (
            <p className="text-xs italic py-4" style={{ color: 'var(--q-text-secondary)' }}>Prompt bulunamadı</p>
          )}
        </div>
      </DebugSection>

      {/* Tool Execution Logs */}
      <DebugSection title="Tool Yürütme Kayıtları" icon={Wrench} defaultOpen={true}>
        <div className="mt-4 space-y-2 max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {data.toolLogs?.length > 0 ? data.toolLogs.map((log: any, i: number) => (
            <div 
              key={i}
              className="flex items-start gap-3 p-3 rounded-xl"
              style={{ 
                background: log.validation_passed ? 'rgba(52,199,89,0.04)' : 'rgba(255,59,48,0.04)',
                border: `1px solid ${log.validation_passed ? 'rgba(52,199,89,0.15)' : 'rgba(255,59,48,0.15)'}`
              }}
            >
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ 
                background: log.validation_passed ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)' 
              }}>
                {log.validation_passed ? 
                  <Check className="w-3 h-3" style={{ color: 'var(--q-green)' }} /> : 
                  <X className="w-3 h-3" style={{ color: 'var(--q-red)' }} />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-bold" style={{ color: 'var(--q-text-primary)' }}>{log.tool_name}</span>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--q-bg-hover)', color: 'var(--q-text-secondary)' }}>
                    {log.execution_mode}
                  </span>
                  {log.execution_duration_ms && (
                    <span className="text-[9px] font-semibold ml-auto" style={{ color: log.execution_duration_ms > 5000 ? 'var(--q-red)' : 'var(--q-text-secondary)' }}>
                      ⏱ {formatMs(log.execution_duration_ms)}
                    </span>
                  )}
                  {(log.input_tokens || log.output_tokens) && (
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--q-bg-hover)', color: 'var(--q-text-secondary)' }}>
                      {log.input_tokens || 0}→{log.output_tokens || 0} tok
                    </span>
                  )}
                </div>
                {log.result_summary && (
                  <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--q-text-secondary)' }}>{log.result_summary}</p>
                )}
                {log.error_message && (
                  <p className="text-[10px] mt-1" style={{ color: 'var(--q-red)' }}>{log.error_message}</p>
                )}
                <span className="text-[8px]" style={{ color: 'var(--q-text-secondary)' }}>{formatDate(log.created_at)}</span>
              </div>
            </div>
          )) : (
            <p className="text-xs text-center py-4 italic" style={{ color: 'var(--q-text-secondary)' }}>Son 24 saatte tool çağrısı yok</p>
          )}
        </div>
      </DebugSection>

      {/* Runtime Metrics */}
      <DebugSection title="AI Performans Metrikleri" icon={BarChart3} defaultOpen={false}>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--q-border-default)' }}>
                <th className="text-left py-2 font-bold uppercase tracking-widest text-[9px]" style={{ color: 'var(--q-text-secondary)' }}>Model</th>
                <th className="text-right py-2 font-bold uppercase tracking-widest text-[9px]" style={{ color: 'var(--q-text-secondary)' }}>Yanıt</th>
                <th className="text-right py-2 font-bold uppercase tracking-widest text-[9px]" style={{ color: 'var(--q-text-secondary)' }}>Tools</th>
                <th className="text-right py-2 font-bold uppercase tracking-widest text-[9px]" style={{ color: 'var(--q-text-secondary)' }}>Token</th>
                <th className="text-right py-2 font-bold uppercase tracking-widest text-[9px]" style={{ color: 'var(--q-text-secondary)' }}>Maliyet</th>
                <th className="text-right py-2 font-bold uppercase tracking-widest text-[9px]" style={{ color: 'var(--q-text-secondary)' }}>Tarih</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics?.map((m: any, i: number) => (
                <tr key={i} className="hover:bg-[var(--q-bg-hover)] transition-colors" style={{ borderBottom: '1px solid var(--q-border-default)' }}>
                  <td className="py-2 font-semibold" style={{ color: 'var(--q-text-primary)' }}>{m.model_name || '—'}</td>
                  <td className="py-2 text-right font-semibold" style={{ color: m.response_time_ms > 15000 ? 'var(--q-red)' : 'var(--q-text-primary)' }}>
                    {formatMs(m.response_time_ms)}
                  </td>
                  <td className="py-2 text-right" style={{ color: 'var(--q-text-secondary)' }}>{m.tool_calls_count || 0}</td>
                  <td className="py-2 text-right" style={{ color: 'var(--q-text-secondary)' }}>{m.total_tokens?.toLocaleString() || '—'}</td>
                  <td className="py-2 text-right font-semibold" style={{ color: 'var(--q-orange)' }}>{formatCost(m.estimated_cost_usd)}</td>
                  <td className="py-2 text-right text-[9px]" style={{ color: 'var(--q-text-secondary)' }}>{formatDate(m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!data.metrics || data.metrics.length === 0) && (
            <p className="text-xs text-center py-4 italic" style={{ color: 'var(--q-text-secondary)' }}>Metrik verisi yok</p>
          )}
        </div>
      </DebugSection>

      {/* Brain Versioning */}
      <DebugSection title="Prompt Geçmişi & Versiyonlama" icon={Shield} defaultOpen={false}>
        <div className="mt-4 space-y-2 max-h-[350px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {versions.length > 0 ? versions.map((v: any) => (
            <div 
              key={v.id}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ 
                background: v.is_active ? 'rgba(0,122,255,0.04)' : 'rgba(255,255,255,0.4)',
                border: `1px solid ${v.is_active ? 'rgba(0,122,255,0.2)' : 'var(--q-border-default)'}`
              }}
            >
              <div 
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-black"
                style={{ 
                  background: v.is_active ? 'var(--q-blue-bg)' : 'var(--q-bg-hover)', 
                  color: v.is_active ? 'var(--q-blue)' : 'var(--q-text-secondary)' 
                }}
              >
                v{v.version_number}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[12px] font-bold block" style={{ color: 'var(--q-text-primary)' }}>
                  {v.change_summary || `Version ${v.version_number}`}
                </span>
                <span className="text-[9px]" style={{ color: 'var(--q-text-secondary)' }}>
                  {v.changed_by} · {formatDate(v.created_at)} · {v.prompt_hash?.substring(0, 8)}
                </span>
              </div>
              {v.is_active ? (
                <span className="text-[9px] font-bold px-2 py-1 rounded-full shrink-0" style={{ color: 'var(--q-green)', background: 'rgba(52,199,89,0.1)' }}>
                  AKTİF
                </span>
              ) : (
                <button
                  onClick={() => handleRollback(v.version_number)}
                  disabled={rollingBack === v.version_number}
                  className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full cursor-pointer transition-all q-press"
                  style={{ color: 'var(--q-orange)', background: 'rgba(255,149,0,0.08)' }}
                >
                  {rollingBack === v.version_number ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Geri Al
                </button>
              )}
            </div>
          )) : (
            <p className="text-xs text-center py-4 italic" style={{ color: 'var(--q-text-secondary)' }}>
              Henüz prompt versiyonu kaydedilmemiş. Prompt kaydettiğinizde otomatik olarak versiyonlanacak.
            </p>
          )}
        </div>
      </DebugSection>

      {/* Tool Permissions */}
      <DebugSection title="Tool Yetkilendirme" icon={ToggleLeft} defaultOpen={false}>
        <div className="mt-4 space-y-2">
          {tools.length > 0 ? tools.map((tool: any) => (
            <div 
              key={tool.tool_name}
              className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.4)', border: '1px solid var(--q-border-default)' }}
            >
              <div className="flex items-center gap-3">
                <Wrench className="w-4 h-4" style={{ color: tool.is_enabled ? 'var(--q-green)' : 'var(--q-text-secondary)' }} />
                <span className="text-[13px] font-bold" style={{ color: 'var(--q-text-primary)' }}>{tool.tool_name}</span>
              </div>
              <button
                onClick={() => handleToggleTool(tool.tool_name, tool.is_enabled)}
                disabled={togglingTool === tool.tool_name}
                className="cursor-pointer transition-transform q-press"
              >
                {togglingTool === tool.tool_name ? (
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--q-blue)' }} />
                ) : tool.is_enabled ? (
                  <ToggleRight className="w-7 h-7" style={{ color: 'var(--q-green)' }} />
                ) : (
                  <ToggleLeft className="w-7 h-7" style={{ color: 'var(--q-text-secondary)' }} />
                )}
              </button>
            </div>
          )) : (
            <p className="text-xs text-center py-4 italic" style={{ color: 'var(--q-text-secondary)' }}>
              Tool permission kayıtları oluşturulacak. Botun ilk tool çalıştırmasından sonra burada görünecek.
            </p>
          )}
        </div>
      </DebugSection>

      {/* Recent Events Feed */}
      <DebugSection title="Son AI Event Akışı (50)" icon={Activity} defaultOpen={false}>
        <div className="mt-4 space-y-1 max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
          {data.recentEvents?.map((ev: any, i: number) => (
            <div 
              key={i}
              className="flex items-center gap-2 py-1.5 px-2 rounded text-[10px] font-mono"
              style={{ 
                background: ev.severity === 'error' ? 'rgba(255,59,48,0.04)' : 'transparent',
                color: ev.severity === 'error' ? 'var(--q-red)' : 'var(--q-text-secondary)',
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace'
              }}
            >
              <span style={{ color: 'var(--q-text-secondary)' }}>{formatDate(ev.created_at)}</span>
              <span style={{ color: ev.severity === 'error' ? 'var(--q-red)' : 'var(--q-blue)' }}>
                [{ev.event_category}]
              </span>
              <span className="font-semibold" style={{ color: 'var(--q-text-primary)' }}>
                {ev.event_type}
              </span>
            </div>
          ))}
          {(!data.recentEvents || data.recentEvents.length === 0) && (
            <p className="text-xs text-center py-4 italic" style={{ color: 'var(--q-text-secondary)' }}>Event yok</p>
          )}
        </div>
      </DebugSection>
    </div>
  );
}
