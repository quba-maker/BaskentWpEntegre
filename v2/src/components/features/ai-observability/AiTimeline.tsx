"use client";

import { useState, useEffect } from "react";
import { getAiTimeline, getAiSummary } from "@/app/actions/ai-os";
import { 
  Link, ClipboardList, Brain, Wrench, BarChart3, AlertTriangle, 
  Shield, MessageSquare, Clock, ChevronDown, ChevronRight, 
  Zap, Timer, XCircle, Copy, Check
} from "lucide-react";

// =============================================
// AI Activity Timeline — Phase 6 OS Visibility
// Apple Activity Timeline style: vertical line + event cards
// =============================================

type TimelineEvent = {
  id: string;
  event_type: string;
  event_category: string;
  payload: Record<string, any>;
  severity: string;
  created_at: string;
};

const EVENT_CONFIG: Record<string, { icon: typeof Link; color: string; label: string }> = {
  identity_resolved:       { icon: Link, color: 'var(--q-blue)', label: 'Kimlik Çözümlendi' },
  identity_merge:          { icon: Link, color: 'var(--q-blue)', label: 'Profil Birleştirildi' },
  form_matched:            { icon: ClipboardList, color: 'var(--q-green)', label: 'Form Eşleşti' },
  conversation_linked:     { icon: Link, color: 'var(--q-blue)', label: 'Konuşma Bağlandı' },
  memory_updated:          { icon: Brain, color: '#AF52DE', label: 'Hafıza Güncellendi' },
  memory_failed:           { icon: Brain, color: 'var(--q-red)', label: 'Hafıza Hatası' },
  tool_executed:           { icon: Wrench, color: 'var(--q-orange)', label: 'Tool Çalıştı' },
  tool_failed:             { icon: Wrench, color: 'var(--q-red)', label: 'Tool Hatası' },
  crm_extraction_completed:{ icon: BarChart3, color: '#5AC8FA', label: 'CRM Güncellendi' },
  crm_extraction_failed:   { icon: BarChart3, color: 'var(--q-red)', label: 'CRM Hatası' },
  human_escalation:        { icon: AlertTriangle, color: 'var(--q-red)', label: 'İnsan Yönlendirme' },
  policy_blocked:          { icon: Shield, color: 'var(--q-red)', label: 'Politika Engeli' },
  sentiment_updated:       { icon: MessageSquare, color: 'var(--q-text-secondary)', label: 'Duygu Güncellendi' },
  ai_response_generated:   { icon: Zap, color: 'var(--q-green)', label: 'AI Yanıt Üretti' },
  ai_response_failed:      { icon: XCircle, color: 'var(--q-red)', label: 'AI Yanıt Başarısız' },
  ai_timeout:              { icon: Timer, color: 'var(--q-red)', label: 'AI Zaman Aşımı' },
  working_hours_blocked:   { icon: Clock, color: 'var(--q-orange)', label: 'Mesai Dışı' },
  max_messages_reached:    { icon: AlertTriangle, color: 'var(--q-orange)', label: 'Maks Mesaj Aşıldı' },
  duplicate_message_dropped: { icon: Copy, color: 'var(--q-text-secondary)', label: 'Duplike Mesaj' },
  brain_resolved:          { icon: Brain, color: 'var(--q-blue)', label: 'Brain Yüklendi' },
  prompt_version_created:  { icon: Check, color: 'var(--q-green)', label: 'Prompt Versiyonu' },
};

function formatEventTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Az önce';
  if (diffMin < 60) return `${diffMin}dk önce`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}sa önce`;
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function getSeverityBg(severity: string) {
  if (severity === 'error') return 'rgba(255,59,48,0.06)';
  if (severity === 'warning') return 'rgba(255,149,0,0.06)';
  return 'transparent';
}

export function AiTimelinePanel({ phoneNumber }: { phoneNumber: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!phoneNumber) return;
    setLoading(true);
    getAiTimeline(phoneNumber, 30).then((data) => {
      setEvents(data as TimelineEvent[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [phoneNumber]);

  return (
    <div className="pt-5" style={{ borderTop: '1px solid var(--q-border-default)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full mb-3 cursor-pointer group"
      >
        <label className="text-[10px] font-bold uppercase tracking-widest ml-1 flex items-center gap-1.5 cursor-pointer" style={{ color: 'var(--q-text-secondary)' }}>
          <Zap className="w-3 h-3" style={{ color: 'var(--q-blue)' }} />
          AI Aktivite Zaman Çizelgesi
          <span className="text-[8px] px-1.5 py-0.5 rounded" style={{ color: 'var(--q-blue)', background: 'var(--q-blue-bg)' }}>OS</span>
        </label>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--q-text-secondary)' }} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--q-text-secondary)' }} />
        )}
      </button>

      {open && (
        <div className="relative max-h-[320px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
          {loading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full q-skeleton shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 w-28 q-skeleton rounded" />
                    <div className="h-2 w-16 q-skeleton rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <p className="text-xs text-center py-4 italic" style={{ color: 'var(--q-text-secondary)' }}>
              Henüz AI aktivitesi yok
            </p>
          ) : (
            /* Vertical timeline */
            <div className="relative ml-3">
              {/* Timeline line */}
              <div 
                className="absolute left-[11px] top-3 bottom-3 w-[1.5px]"
                style={{ background: 'var(--q-border-default)' }}
              />
              
              <div className="space-y-1">
                {events.map((ev) => {
                  const config = EVENT_CONFIG[ev.event_type] || { icon: Zap, color: 'var(--q-text-secondary)', label: ev.event_type };
                  const Icon = config.icon;
                  
                  return (
                    <div 
                      key={ev.id} 
                      className="relative flex items-start gap-3 py-1.5 pl-0 pr-1 rounded-lg transition-colors"
                      style={{ background: getSeverityBg(ev.severity) }}
                    >
                      {/* Dot */}
                      <div 
                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 relative z-10 shadow-sm"
                        style={{ 
                          background: 'var(--q-bg-primary)', 
                          border: `2px solid ${config.color}` 
                        }}
                      >
                        <Icon className="w-3 h-3" style={{ color: config.color }} />
                      </div>
                      
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-bold block leading-tight" style={{ color: 'var(--q-text-primary)' }}>
                          {config.label}
                        </span>
                        <span className="text-[9px] font-medium" style={{ color: 'var(--q-text-secondary)' }}>
                          {formatEventTime(ev.created_at)}
                        </span>
                      </div>
                      
                      {/* Severity badge */}
                      {ev.severity === 'error' && (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ color: 'var(--q-red)', background: 'rgba(255,59,48,0.1)' }}>
                          HATA
                        </span>
                      )}
                      {ev.severity === 'warning' && (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ color: 'var(--q-orange)', background: 'rgba(255,149,0,0.1)' }}>
                          UYARI
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================
// AI Auto Summary Panel — For Forms Page
// =============================================

export function AiSummaryBadge({ phoneNumber }: { phoneNumber: string }) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!phoneNumber) { setLoading(false); return; }
    getAiSummary(phoneNumber).then(data => {
      setSummary(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [phoneNumber]);

  if (loading) {
    return (
      <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--q-bg-hover)', border: '1px solid var(--q-border-default)' }}>
        <div className="h-3 w-24 q-skeleton rounded" />
        <div className="h-2 w-full q-skeleton rounded" />
        <div className="h-2 w-3/4 q-skeleton rounded" />
      </div>
    );
  }

  if (!summary) return null;

  const intentColors: Record<string, string> = {
    HOT: 'var(--q-red)',
    WARM: 'var(--q-orange)',
    COLD: 'var(--q-blue)',
    LOST: 'var(--q-text-secondary)',
  };
  const sentimentColors: Record<string, string> = {
    POSITIVE: 'var(--q-green)',
    NEUTRAL: 'var(--q-text-secondary)',
    NEGATIVE: 'var(--q-red)',
    FRUSTRATED: 'var(--q-orange)',
  };

  return (
    <div 
      className="rounded-xl p-4 relative overflow-hidden"
      style={{ 
        background: 'rgba(255,255,255,0.6)', 
        border: '1px solid var(--q-border-default)',
        boxShadow: 'var(--q-shadow-sm)' 
      }}
    >
      <div className="absolute top-0 left-0 w-full h-0.5 opacity-40" style={{ background: 'linear-gradient(to right, #AF52DE, var(--q-blue))' }} />
      
      <div className="flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4" style={{ color: '#AF52DE' }} />
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--q-text-secondary)' }}>
          AI Görüşme Özeti
        </span>
        <span className="text-[8px] px-1.5 py-0.5 rounded ml-auto" style={{ color: '#AF52DE', background: 'rgba(175,82,222,0.1)' }}>
          AUTO
        </span>
      </div>

      <p className="text-[12px] leading-relaxed whitespace-pre-line mb-3" style={{ color: 'var(--q-text-primary)' }}>
        {summary.summary}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {summary.intent && (
          <span 
            className="text-[9px] font-bold px-2 py-0.5 rounded-full"
            style={{ color: intentColors[summary.intent] || 'var(--q-text-secondary)', background: 'var(--q-bg-hover)' }}
          >
            Intent: {summary.intent}
          </span>
        )}
        {summary.sentiment && (
          <span 
            className="text-[9px] font-bold px-2 py-0.5 rounded-full"
            style={{ color: sentimentColors[summary.sentiment] || 'var(--q-text-secondary)', background: 'var(--q-bg-hover)' }}
          >
            Sentiment: {summary.sentiment}
          </span>
        )}
        {summary.updatedAt && (
          <span className="text-[8px] ml-auto" style={{ color: 'var(--q-text-secondary)' }}>
            {formatEventTime(summary.updatedAt)}
          </span>
        )}
      </div>
    </div>
  );
}
