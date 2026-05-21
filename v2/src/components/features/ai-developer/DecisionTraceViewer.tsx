"use client";

import React, { useState } from "react";
import useSWR from "swr";
import { Route, Search, CheckCircle2, XCircle, AlertTriangle, MessageSquare, Brain, User, Wrench, Shield, Database, Clock, Phone } from "lucide-react";
import { getDecisionTrace, getRecentConversationsForTrace } from "@/app/actions/ai-control";

const STAGE_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  'brain_resolved':           { icon: Brain, color: 'var(--q-blue)', label: 'Brain Çözümlendi' },
  'identity_resolved':        { icon: User, color: 'var(--q-green)', label: 'Kimlik Eşleşti' },
  'duplicate_message_dropped': { icon: XCircle, color: 'var(--q-text-secondary)', label: 'Tekrar Mesaj Atıldı' },
  'working_hours_blocked':    { icon: Clock, color: 'var(--q-orange)', label: 'Mesai Dışı Engeli' },
  'max_messages_reached':     { icon: AlertTriangle, color: 'var(--q-orange)', label: 'Mesaj Limiti' },
  'ai_response_generated':    { icon: MessageSquare, color: 'var(--q-green)', label: 'AI Yanıt Oluşturuldu' },
  'ai_timeout':               { icon: Clock, color: 'var(--q-red)', label: 'AI Zaman Aşımı' },
  'tool_executed':             { icon: Wrench, color: 'var(--q-blue)', label: 'Araç Çalıştırıldı' },
  'tool_failed':               { icon: Wrench, color: 'var(--q-red)', label: 'Araç Başarısız' },
  'policy_blocked':            { icon: Shield, color: 'var(--q-red)', label: 'Politika Engeli' },
  'human_escalation':          { icon: AlertTriangle, color: 'var(--q-orange)', label: 'İnsan Devralma' },
  'crm_extraction_completed':  { icon: Database, color: 'var(--q-green)', label: 'CRM Güncellendi' },
  'crm_extraction_failed':     { icon: Database, color: 'var(--q-red)', label: 'CRM Başarısız' },
  'memory_updated':            { icon: Brain, color: 'var(--q-purple-alt)', label: 'Hafıza Güncellendi' },
  'memory_failed':             { icon: Brain, color: 'var(--q-red)', label: 'Hafıza Başarısız' },
};

export function DecisionTraceViewer() {
  const [conversationId, setConversationId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  
  const { data: recentConvsRes } = useSWR('recent-convs-trace', () => getRecentConversationsForTrace(10));
  const recentConvs = recentConvsRes?.success ? (recentConvsRes.data as any[]) : [];

  const { data: traceRes, isLoading } = useSWR(
    conversationId ? ['decision-trace', conversationId] : null,
    () => getDecisionTrace(conversationId)
  );
  const trace = traceRes?.success ? (traceRes.data as any) : null;

  const handleSearch = () => {
    if (searchInput.trim()) {
      setConversationId(searchInput.trim());
    }
  };

  const selectConversation = (id: string) => {
    setSearchInput(id);
    setConversationId(id);
  };

  const formatTime = (d: string) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} dk önce`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} sa önce`;
    return `${Math.floor(hrs / 24)} gün önce`;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Route className="w-5 h-5" style={{ color: 'var(--q-blue)' }} />
        <h3 className="text-base font-bold" style={{ color: 'var(--q-text-primary)' }}>AI Karar İzleme</h3>
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
          placeholder="Konuşma ID'si girin veya aşağıdan seçin..."
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: 'var(--q-text-primary)' }}
        />
        <button 
          onClick={handleSearch}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          style={{ background: 'var(--q-blue)', color: '#fff' }}
        >
          İzle
        </button>
      </div>

      {/* Recent Conversations Picker */}
      {!conversationId && !isLoading && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--q-border-default)' }}>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--q-text-secondary)' }}>
              Son Konuşmalar — Hızlı Seçim
            </p>
          </div>
          {recentConvs && recentConvs.length > 0 ? (
            <div>
              {recentConvs.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => selectConversation(c.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--q-bg-hover)] transition-colors cursor-pointer"
                  style={{ borderBottom: '1px solid var(--q-border-default)' }}
                >
                  <Phone className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--q-blue)' }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold block truncate" style={{ color: 'var(--q-text-primary)' }}>
                      {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone_number || 'İsimsiz'}
                    </span>
                    <span className="text-[10px] block" style={{ color: 'var(--q-text-secondary)' }}>
                      {c.phone_number} · {c.lead_stage || 'Bilinmiyor'} · {formatTime(c.updated_at)}
                    </span>
                  </div>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded" style={{ color: 'var(--q-text-secondary)', background: 'var(--q-bg-hover)' }}>
                    {String(c.id || '').substring(0, 8)}...
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center">
              <Route className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium" style={{ color: 'var(--q-text-primary)' }}>Henüz konuşma kaydı yok</p>
              <p className="text-xs mt-1" style={{ color: 'var(--q-text-secondary)' }}>
                Bot aktif olduktan sonra burada konuşmalar listelenecek.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="p-8 text-center">
          <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-2" style={{ borderColor: 'var(--q-blue)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--q-text-secondary)' }}>Pipeline analiz ediliyor...</p>
        </div>
      )}

      {/* Conversation Context */}
      {trace?.conversation && (
        <div className="rounded-xl p-4" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--q-text-secondary)' }}>
              Konuşma Bilgileri
            </h4>
            <button 
              onClick={() => { setConversationId(''); setSearchInput(''); }}
              className="text-[10px] font-medium px-2 py-1 rounded cursor-pointer"
              style={{ color: 'var(--q-blue)', background: 'rgba(0,122,255,0.06)' }}
            >
              ← Listeye Dön
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ContextItem label="Telefon" value={trace.conversation.phone_number} />
            <ContextItem label="Müşteri" value={[trace.conversation.first_name, trace.conversation.last_name].filter(Boolean).join(' ') || '—'} />
            <ContextItem label="Aşama" value={trace.conversation.lead_stage || '—'} />
            <ContextItem label="Duygu" value={trace.conversation.sentiment || '—'} />
          </div>
        </div>
      )}

      {/* Pipeline Visualization */}
      {trace?.pipelineStages && trace.pipelineStages.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'var(--q-bg-primary)', border: '1px solid var(--q-border-default)' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--q-border-default)' }}>
            <h4 className="text-sm font-bold" style={{ color: 'var(--q-text-primary)' }}>Pipeline Yürütme</h4>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--q-text-secondary)' }}>
              {trace.pipelineStages.length} aşama tamamlandı · {trace.events?.length || 0} toplam olay
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
            Bu konuşma için AI olayı bulunamadı.
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
