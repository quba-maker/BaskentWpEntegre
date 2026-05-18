"use client";

import React, { useState } from "react";
import { FlaskConical, Play, Loader2, MessageSquare, Cpu, Clock, FileText, Zap } from "lucide-react";
import { runSandboxTest } from "@/app/actions/ai-control";

export function AiSandboxLab() {
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    incomingMessage: '',
    mockMemory: '',
    mockCrmStage: 'new',
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleRun = async () => {
    if (!form.incomingMessage.trim()) return;
    setLoading(true);
    setResult(null);
    const res = await runSandboxTest(form);
    setResult(res);
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <FlaskConical className="w-5 h-5" style={{ color: 'var(--q-purple-alt)' }} />
        <h3 className="text-base font-bold" style={{ color: 'var(--q-text-primary)' }}>AI Sandbox Lab</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--q-purple-alt) 8%, transparent)', color: 'var(--q-purple-alt)' }}>
          No Side Effects
        </span>
      </div>

      {/* Input Form */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left — Configuration */}
        <div className="space-y-3">
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
            <h4 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--q-text-secondary)' }}>
              Mock Customer
            </h4>
            <SandboxInput label="Customer Name" value={form.customerName} placeholder="Ahmet Yılmaz"
                          onChange={v => setForm(f => ({ ...f, customerName: v }))} />
            <SandboxInput label="Phone" value={form.customerPhone} placeholder="+905001234567"
                          onChange={v => setForm(f => ({ ...f, customerPhone: v }))} />
            <div>
              <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--q-text-secondary)' }}>CRM Stage</label>
              <select 
                value={form.mockCrmStage}
                onChange={e => setForm(f => ({ ...f, mockCrmStage: e.target.value }))}
                className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-primary)', border: '1px solid var(--q-border-default)' }}
              >
                <option value="new">New Lead</option>
                <option value="interested">Interested</option>
                <option value="pricing_discussed">Pricing Discussed</option>
                <option value="qualified">Qualified</option>
                <option value="won">Won</option>
              </select>
            </div>
          </div>

          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
            <h4 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--q-text-secondary)' }}>
              Mock Memory
            </h4>
            <textarea
              value={form.mockMemory}
              onChange={e => setForm(f => ({ ...f, mockMemory: e.target.value }))}
              placeholder="Previous context the AI should remember..."
              rows={3}
              className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-none"
              style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-primary)', border: '1px solid var(--q-border-default)' }}
            />
          </div>
        </div>

        {/* Right — Message + Run */}
        <div className="space-y-3">
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
            <h4 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--q-text-secondary)' }}>
              Incoming Message
            </h4>
            <textarea
              value={form.incomingMessage}
              onChange={e => setForm(f => ({ ...f, incomingMessage: e.target.value }))}
              placeholder="Type the customer message to test..."
              rows={5}
              className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-none"
              style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-primary)', border: '1px solid var(--q-border-default)' }}
            />
            <button
              onClick={handleRun}
              disabled={loading || !form.incomingMessage.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--q-purple-alt)', color: '#fff' }}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Running Test...</>
              ) : (
                <><Play className="w-4 h-4" /> Run Sandbox Test</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-3">
          {result.success ? (
            <>
              {/* AI Response */}
              <div className="rounded-xl p-4" style={{ background: 'var(--q-bg-primary)', border: '2px solid var(--q-green)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare className="w-4 h-4" style={{ color: 'var(--q-green)' }} />
                  <h4 className="text-sm font-bold" style={{ color: 'var(--q-text-primary)' }}>AI Response</h4>
                </div>
                <div className="p-3 rounded-lg" style={{ background: 'var(--q-bg-secondary)' }}>
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--q-text-primary)' }}>
                    {result.response}
                  </p>
                </div>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard icon={Cpu} label="Model" value={result.model || '—'} />
                <MetricCard icon={Clock} label="Latency" value={result.latencyMs ? `${result.latencyMs}ms` : '—'} />
                <MetricCard icon={Zap} label="Tokens" value={result.tokenEstimate?.total || '—'} />
                <MetricCard icon={FileText} label="Prompt Length" value={result.promptLength ? `${result.promptLength} chars` : '—'} />
              </div>

              {/* Generated Prompt Preview */}
              {result.generatedPrompt && (
                <details className="rounded-xl overflow-hidden" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
                  <summary className="px-4 py-3 text-[13px] font-medium cursor-pointer" style={{ color: 'var(--q-text-primary)' }}>
                    📋 View Generated System Prompt
                  </summary>
                  <div className="px-4 pb-4">
                    <pre className="text-[11px] font-mono p-3 rounded-lg max-h-[300px] overflow-y-auto whitespace-pre-wrap"
                         style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-secondary)' }}>
                      {result.generatedPrompt}
                    </pre>
                  </div>
                </details>
              )}
            </>
          ) : (
            <div className="rounded-xl p-4" style={{ background: 'rgba(255,59,48,0.04)', border: '1px solid rgba(255,59,48,0.2)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--q-red)' }}>❌ Test Failed</p>
              <p className="text-xs mt-1" style={{ color: 'var(--q-text-secondary)' }}>{result.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SandboxInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--q-text-secondary)' }}>{label}</label>
      <input
        type="text" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full text-sm px-3 py-2 rounded-lg outline-none"
        style={{ background: 'var(--q-bg-secondary)', color: 'var(--q-text-primary)', border: '1px solid var(--q-border-default)' }}
      />
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <div className="p-3 rounded-xl text-center" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
      <Icon className="w-4 h-4 mx-auto mb-1" style={{ color: 'var(--q-text-secondary)' }} />
      <p className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--q-text-primary)' }}>{value}</p>
      <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--q-text-secondary)' }}>{label}</p>
    </div>
  );
}
