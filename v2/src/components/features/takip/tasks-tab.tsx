"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { 
  ClipboardList, CheckCircle2, Clock, AlertTriangle, Calendar,
  Phone, X, FileText, ChevronDown, RotateCcw
} from "lucide-react";
import { getFollowUpTasks, getTaskStats, completeTask, cancelTask, rescheduleTask } from "@/app/actions/tasks";

// ═══════════════════════════════════════════════════════════
// TASK TYPE CONFIG
// ═══════════════════════════════════════════════════════════

const TASK_TYPE_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  call_patient: { label: 'Hasta Ara', icon: '📞', color: '#007AFF' },
  callback_scheduled: { label: 'Geri Arama', icon: '📞', color: '#5856D6' },
  send_report_reminder: { label: 'Rapor Hatırlatma', icon: '📄', color: '#FF9500' },
  follow_up_no_response: { label: 'Cevapsız Takip', icon: '📋', color: '#8E8E93' },
  appointment_reminder: { label: 'Randevu Hatırlatma', icon: '📅', color: '#34C759' },
  coordinator_review: { label: 'Koordinatör İnceleme', icon: '🔍', color: '#AF52DE' },
  doctor_review_pending: { label: 'Doktor İnceleme', icon: '🩺', color: '#FF6482' },
  travel_planning: { label: 'Seyahat Planlama', icon: '✈️', color: '#30B0C7' },
  payment_follow_up: { label: 'Ödeme Takibi', icon: '💰', color: '#FF3B30' },
  custom: { label: 'Özel', icon: '📌', color: '#1D1D1F' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Bekliyor', color: '#FF9500', bg: '#FF950012' },
  in_progress: { label: 'Devam Ediyor', color: '#007AFF', bg: '#007AFF12' },
  completed: { label: 'Tamamlandı', color: '#34C759', bg: '#34C75912' },
  cancelled: { label: 'İptal', color: '#8E8E93', bg: '#8E8E9312' },
  skipped: { label: 'Atlandı', color: '#C7C7CC', bg: '#C7C7CC12' },
};

// ═══════════════════════════════════════════════════════════
// TIME HELPERS
// ═══════════════════════════════════════════════════════════

const timeAgo = (dateString: string) => {
  if (!dateString) return "";
  const target = new Date(dateString);
  const diff = Math.round((Date.now() - target.getTime()) / 1000);
  
  if (diff < 0) {
    const abs = Math.abs(diff);
    if (abs < 60) return "Birkaç saniye sonra";
    if (abs < 3600) return `${Math.floor(abs / 60)} dk sonra`;
    if (abs < 86400) return `${Math.floor(abs / 3600)} saat sonra`;
    if (abs < 172800) {
      const time = target.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
      return `Yarın ${time}`;
    }
    return target.toLocaleDateString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
  }
  
  if (diff < 60) return "Az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} saat önce`;
  return `${Math.floor(diff / 86400)} gün önce`;
};

const isOverdue = (dateString: string) => {
  if (!dateString) return false;
  return new Date(dateString) < new Date();
};

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

type DateRange = 'overdue' | 'today' | 'tomorrow' | 'week' | 'all';

export default function TasksTab() {
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completionNote, setCompletionNote] = useState("");

  // ── Data ──
  const statusFilterValue = statusFilter === 'active' 
    ? ['pending', 'in_progress'] 
    : statusFilter === 'all' ? undefined : [statusFilter];

  const { data, isLoading, mutate } = useSWR(
    ['follow-up-tasks', dateRange, statusFilter],
    () => getFollowUpTasks({
      status: statusFilterValue as any,
      dateRange: dateRange !== 'all' ? dateRange : undefined,
      limit: 100,
    }),
    { refreshInterval: 15000 }
  );

  const { data: stats } = useSWR(
    'task-stats',
    () => getTaskStats(),
    { refreshInterval: 15000 }
  );

  const tasks = data?.items || [];
  const total = data?.total || 0;

  // ── Actions ──
  const handleComplete = useCallback(async (taskId: string) => {
    await completeTask(taskId, completionNote || undefined);
    setCompletingId(null);
    setCompletionNote("");
    mutate();
  }, [completionNote, mutate]);

  const handleCancel = useCallback(async (taskId: string) => {
    await cancelTask(taskId, 'manual_cancel');
    mutate();
  }, [mutate]);

  const handleReschedule = useCallback(async (taskId: string, hours: number) => {
    const newDue = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    await rescheduleTask(taskId, newDue);
    mutate();
  }, [mutate]);

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatBadge label="Toplam" value={stats?.total || 0} color="#1D1D1F" />
        <StatBadge label="Bekliyor" value={stats?.pending || 0} color="#FF9500" />
        {(stats?.overdue || 0) > 0 && (
          <StatBadge label="Gecikmiş" value={stats?.overdue || 0} color="#FF3B30" pulse />
        )}
        <StatBadge label="Bugün" value={stats?.dueToday || 0} color="#007AFF" />
        <StatBadge label="Tamamlanan" value={stats?.completed || 0} color="#34C759" />
      </div>

      {/* Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Date Range Pills */}
        {([
          { value: 'all', label: 'Tümü' },
          { value: 'overdue', label: '⚠️ Gecikmiş' },
          { value: 'today', label: 'Bugün' },
          { value: 'tomorrow', label: 'Yarın' },
          { value: 'week', label: 'Bu Hafta' },
        ] as { value: DateRange; label: string }[]).map(f => (
          <button
            key={f.value}
            onClick={() => setDateRange(f.value)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              dateRange === f.value
                ? 'bg-[#5856D6] text-white shadow-md'
                : 'bg-white/60 text-[#86868B] hover:bg-white hover:text-[#1D1D1F] border border-white/60'
            }`}
          >
            {f.label}
          </button>
        ))}

        <div className="w-px h-6 bg-black/10 mx-1" />

        {/* Status filter */}
        {([
          { value: 'active', label: 'Aktif' },
          { value: 'completed', label: 'Tamamlanan' },
          { value: 'all', label: 'Hepsi' },
        ]).map(f => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              statusFilter === f.value
                ? 'bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/20'
                : 'bg-white/60 text-[#86868B] hover:bg-white hover:text-[#1D1D1F] border border-white/60'
            }`}
          >
            {f.label}
          </button>
        ))}

        <span className="text-[11px] text-[#86868B] font-medium ml-auto">{total} görev</span>
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {tasks.map((task: any) => {
          const typeConfig = TASK_TYPE_CONFIG[task.task_type] || TASK_TYPE_CONFIG.custom;
          const statusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
          const overdue = task.status === 'pending' && isOverdue(task.due_at);
          const isCompleting = completingId === task.id;

          return (
            <div 
              key={task.id} 
              className={`bg-white/80 backdrop-blur-sm rounded-xl border p-4 transition-all hover:shadow-md ${
                overdue ? 'border-[#FF3B30]/30 bg-[#FF3B30]/[0.02]' : 'border-white/60'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div 
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                  style={{ backgroundColor: `${typeConfig.color}12` }}
                >
                  {typeConfig.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-[13px] font-bold text-[#1D1D1F] truncate">{task.title}</h4>
                    <span 
                      className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}
                    >
                      {statusCfg.label}
                    </span>
                    {overdue && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FF3B30]/10 text-[#FF3B30] animate-pulse">
                        GECİKMİŞ
                      </span>
                    )}
                    {task.is_automated && (
                      <span className="text-[10px] font-medium text-[#86868B] bg-black/[0.04] px-1.5 py-0.5 rounded">
                        🤖 Otomatik
                      </span>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-[#86868B] font-medium">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeAgo(task.due_at)}
                    </span>
                    {task.patient_name && (
                      <span>{task.patient_name}</span>
                    )}
                    {task.department && (
                      <span className="text-[#5856D6]">{task.department}</span>
                    )}
                    {task.phone_number && (
                      <span className="font-mono">{task.phone_number}</span>
                    )}
                  </div>

                  {task.description && (
                    <p className="text-[12px] text-[#86868B] mt-1 line-clamp-1">{task.description}</p>
                  )}

                  {/* Skip reason */}
                  {task.skipped_reason && (
                    <p className="text-[11px] text-[#C7C7CC] mt-1 italic">
                      ↳ {task.skipped_reason === 'patient_responded' ? 'Hasta yanıt verdi' 
                        : task.skipped_reason === 'stage_terminal' ? 'Fırsat kapandı'
                        : task.skipped_reason === 'coordinator_took_over' ? 'Koordinatör devraldı'
                        : task.skipped_reason}
                    </p>
                  )}

                  {/* Completion note input */}
                  {isCompleting && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        value={completionNote}
                        onChange={(e) => setCompletionNote(e.target.value)}
                        placeholder="Tamamlama notu (opsiyonel)..."
                        className="flex-1 px-3 py-1.5 bg-[#F5F5F7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-[#34C759]/40"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleComplete(task.id);
                          if (e.key === 'Escape') setCompletingId(null);
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => handleComplete(task.id)}
                        className="px-3 py-1.5 bg-[#34C759] text-white rounded-lg text-sm font-semibold hover:bg-[#2DA048] transition-colors"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => setCompletingId(null)}
                        className="px-3 py-1.5 bg-black/5 rounded-lg text-sm font-semibold hover:bg-black/10 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {task.status === 'pending' && !isCompleting && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setCompletingId(task.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#34C759]/10 text-[#34C759] hover:bg-[#34C759]/20 transition-colors"
                      title="Tamamla"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleReschedule(task.id, 2)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20 transition-colors"
                      title="2 saat ertele"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleCancel(task.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#FF3B30]/10 text-[#FF3B30] hover:bg-[#FF3B30]/20 transition-colors"
                      title="İptal"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Empty state */}
        {tasks.length === 0 && !isLoading && (
          <div className="text-center py-16">
            <ClipboardList className="w-12 h-12 text-[#C7C7CC] mx-auto mb-3" />
            <p className="text-[#86868B] font-semibold text-sm">Görev bulunamadı</p>
            <p className="text-[#C7C7CC] text-xs mt-1">
              {dateRange === 'overdue' ? 'Gecikmiş görev yok — harika!' : 'Bu filtrelere uygun görev yok.'}
            </p>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-16">
            <div className="inline-flex items-center gap-2 text-[#86868B] text-sm font-medium">
              <div className="w-5 h-5 border-2 border-[#5856D6] border-t-transparent rounded-full animate-spin" />
              Yükleniyor...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat Badge ──

function StatBadge({ label, value, color, pulse }: { label: string; value: number; color: string; pulse?: boolean }) {
  return (
    <div 
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border"
      style={{ backgroundColor: `${color}08`, borderColor: `${color}20` }}
    >
      {pulse && <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />}
      <span className="text-[12px] font-bold" style={{ color }}>{value}</span>
      <span className="text-[10px] font-semibold text-[#86868B]">{label}</span>
    </div>
  );
}
