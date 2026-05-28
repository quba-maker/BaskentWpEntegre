"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Zap, Activity, Plus, X, Play, RotateCcw, AlertTriangle, Eye, Check, Loader2, FileText, Trash2, Sliders, Layers, Send } from "lucide-react";
import { PageShell, PageHeader } from "@/components/governance";
import { PageLoader } from "@/components/ui/shared-states";
import {
  getAutomationRules,
  getAutomationRuns,
  getAutomationTestEntities,
  createAutomationRule,
  updateAutomationRule,
  setAutomationRuleActive,
  deleteOrArchiveAutomationRule,
  runAutomationRuleDryRun
} from "@/app/actions/automation-rules";
import { getAutomationSystemHealth, type SystemHealthResponse } from "@/app/actions/hygiene";
import type { RuleCondition, RuleAction } from "@/lib/services/automation/rule-evaluator.service";

// ==========================================
// CONSTANTS & META
// ==========================================
const TRIGGER_OPTIONS = [
  { value: "form_submission", label: "Form Gönderimi (Yeni Lead)", active: true },
  { value: "opportunity_stage_changed", label: "Fırsat Aşaması Değişti (Yakında)", active: false },
  { value: "task_overdue", label: "Görev Gecikti (Yakında)", active: false }
];

const FIELD_OPTIONS = [
  { value: "patient.country", label: "Hasta Ülkesi" },
  { value: "patient.name", label: "Hasta Adı" },
  { value: "patient.phone", label: "Hasta Telefonu" },
  { value: "lead.form_name", label: "Form Adı" },
  { value: "lead.source", label: "Form Kaynağı" },
  { value: "opportunity.stage", label: "Fırsat Aşaması" },
  { value: "opportunity.department", label: "Tıbbi Departman" },
  { value: "opportunity.priority", label: "Fırsat Önceliği" }
];

const OPERATOR_OPTIONS = [
  { value: "equals", label: "Eşittir (=)" },
  { value: "not_equals", label: "Eşit Değildir (!=)" },
  { value: "contains", label: "İçerir" },
  { value: "is_empty", label: "Boştur" },
  { value: "is_not_empty", label: "Boş Değildir" }
];

const ACTION_OPTIONS = [
  { value: "create_task", label: "Görev Oluştur (create_task)" },
  { value: "send_notification", label: "Bildirim Gönder (send_notification)" },
  { value: "audit_log", label: "Sadece Günlüğe Kaydet (audit_log)" }
];

const TASK_TYPE_OPTIONS = [
  { value: "coordinator_review", label: "Koordinatör İncelemesi" },
  { value: "follow_up_no_response", label: "Arama / İletişim Takibi" },
  { value: "doctor_review_pending", label: "Doktor İncelemesi Bekliyor" }
];

const NOTIFICATION_CATEGORY_OPTIONS = [
  { value: "hot_lead", label: "Sıcak Fırsat (hot_lead)" },
  { value: "appointment_request", label: "Randevu Talebi" },
  { value: "overdue_task", label: "Geciken Görev" },
  { value: "system_alert", label: "Sistem Uyarısı" }
];

// ==========================================
// TABS & STYLING
// ==========================================
function RunStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    skipped: "bg-amber-50 text-amber-700 border-amber-200",
    failed: "bg-rose-50 text-rose-700 border-rose-200",
    dry_run: "bg-indigo-50 text-indigo-700 border-indigo-200"
  };
  const labels: Record<string, string> = {
    success: "Başarılı",
    skipped: "Atlandı (Skip)",
    failed: "Hata / Başarısız",
    dry_run: "Simülasyon"
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${colors[status] || colors.skipped}`}>
      {labels[status] || status}
    </span>
  );
}

export default function AutomationPage() {
  const [activeTab, setActiveTab] = useState<"rules" | "history">("rules");
  const [rules, setRules] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [testLeads, setTestLeads] = useState<any[]>([]);
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Modals state
  const [editModal, setEditModal] = useState<any | null>(null); // null = kapalı, {} = yeni kural
  const [simulatorModal, setSimulatorModal] = useState<any | null>(null); // kural objesi
  const [confirmModal, setConfirmModal] = useState<{ id: string; name: string; targetActive: boolean } | null>(null);
  const [runDetailsModal, setRunDetailsModal] = useState<any | null>(null); // run objesi

  // Simulator state
  const [simLeadId, setSimLeadId] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<any | null>(null);

  const loadData = useCallback(async () => {
    setErrorMessage("");
    try {
      const [rulesRes, runsRes, leadsRes, healthRes] = await Promise.all([
        getAutomationRules(),
        getAutomationRuns(),
        getAutomationTestEntities(),
        getAutomationSystemHealth()
      ]);
      setRules(rulesRes);
      setRuns(runsRes);
      setTestLeads(leadsRes);
      setHealth(healthRes);
      if (leadsRes.length > 0) setSimLeadId(leadsRes[0].id);
    } catch (err: any) {
      setErrorMessage(err.message || "Otomasyon verileri yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await loadData();
      setIsLoading(false);
    })();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Archive (Soft Delete)
  const handleArchiveRule = async (id: string) => {
    if (!confirm("Bu kuralı arşivlemek istediğinize emin misiniz? Otomasyon log geçmişi saklanmaya devam edecektir.")) return;
    const res = await deleteOrArchiveAutomationRule(id);
    if (res.success) {
      await loadData();
    } else {
      alert(res.error || "Arşivleme başarısız.");
    }
  };

  // Safe Activation switch
  const triggerActivationChange = (rule: any) => {
    const isActivating = !rule.is_active;

    if (isActivating && (!rule.conditions || rule.conditions.length === 0)) {
      alert("Koşulu bulunmayan kuralları aktif edemezsiniz.");
      return;
    }
    if (isActivating && (!rule.actions || rule.actions.length === 0)) {
      alert("Aksiyonu bulunmayan kuralları aktif edemezsiniz.");
      return;
    }

    setConfirmModal({
      id: rule.id,
      name: rule.name,
      targetActive: isActivating
    });
  };

  const confirmActivation = async () => {
    if (!confirmModal) return;
    const { id, targetActive } = confirmModal;
    setConfirmModal(null);

    const res = await setAutomationRuleActive(id, targetActive);
    if (res.success) {
      await loadData();
    } else {
      alert(res.error || "Aktiflik durumu güncellenemedi.");
    }
  };

  // Run Dry-Run Simulation
  const handleRunSimulation = async () => {
    if (!simulatorModal || !simLeadId) return;
    setSimulating(true);
    setSimResult(null);

    const res = await runAutomationRuleDryRun(simulatorModal.id, simLeadId);
    setSimulating(false);
    setSimResult(res);
  };

  if (isLoading) return <PageLoader />;

  return (
    <PageShell>
      <PageHeader
        icon={Zap}
        title="Otomasyon Kuralları Merkezi"
        subtitle="İç süreçlerinizi otomatize etmek için kural tabanlı görev ve panel bildirim zincirleri kurgulayın."
        iconGradient={{ from: "var(--q-orange, #f97316)", to: "var(--q-amber, #f59e0b)" }}
      />

      {/* Summary Bar */}
      <div className="flex items-center justify-between mb-6 px-4 py-3 rounded-2xl border bg-white" style={{ borderColor: "var(--q-border-default)" }}>
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-amber-500 animate-pulse" />
          <span className="text-[13px] font-medium" style={{ color: "var(--q-text-primary)" }}>
            Toplam {rules.length} otomasyon kuralı • {rules.filter(r => r.is_active).length} aktif
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-[12px] font-semibold transition-colors hover:opacity-80"
            style={{ color: "var(--q-primary, #6366f1)" }}
          >
            <RotateCcw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>
      {/* Entegrasyon Sağlık Durumları (Health Indicators) */}
      {health && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* QStash */}
          <div className="bg-white p-4 rounded-2xl border flex items-center justify-between transition-all hover:shadow-sm" style={{ borderColor: "var(--q-border-default)" }}>
            <div className="min-w-0">
              <span className="text-[10px] text-gray-400 font-bold block mb-1">QSTASH ZAMANLAYICI SAĞLIĞI</span>
              <span className="text-[12px] font-bold text-gray-800 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  health.qstash.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'
                }`} />
                {health.qstash.message}
              </span>
              {health.qstash.scheduleIdMasked && (
                <span className="text-[9px] font-mono text-gray-400 block mt-1">Schedule ID: {health.qstash.scheduleIdMasked}</span>
              )}
            </div>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
              health.qstash.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}>
              <Zap className={`w-4 h-4 ${health.qstash.status === 'active' ? 'animate-pulse' : ''}`} />
            </div>
          </div>

          {/* Telegram */}
          <div className="bg-white p-4 rounded-2xl border flex items-center justify-between transition-all hover:shadow-sm" style={{ borderColor: "var(--q-border-default)" }}>
            <div className="min-w-0">
              <span className="text-[10px] text-gray-400 font-bold block mb-1">TELEGRAM BİLDİRİM SAĞLIĞI</span>
              <span className="text-[12px] font-bold text-gray-800 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  health.telegram.status === 'active' ? 'bg-emerald-500' : 
                  health.telegram.status === 'disabled' ? 'bg-amber-500' : 'bg-orange-500'
                }`} />
                {health.telegram.message}
              </span>
              <span className="text-[9px] text-gray-400 block mt-1">Öncelik: Yüksek / Kritik Görevler</span>
            </div>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
              health.telegram.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
            }`}>
              <Send className={`w-4 h-4 ${health.telegram.status === 'active' ? 'animate-pulse' : ''}`} />
            </div>
          </div>

          {/* Runs & Engine */}
          <div className="bg-white p-4 rounded-2xl border flex items-center justify-between transition-all hover:shadow-sm" style={{ borderColor: "var(--q-border-default)" }}>
            <div className="min-w-0">
              <span className="text-[10px] text-gray-400 font-bold block mb-1">GÜNLÜK OTOMASYON AKIŞI</span>
              <span className="text-[12px] font-bold text-gray-800 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  health.automation.failedRuns24h > 0 ? 'bg-rose-500' : 'bg-emerald-500'
                }`} />
                {health.automation.failedRuns24h > 0 ? (
                  <span className="text-rose-600 font-bold">{health.automation.failedRuns24h} Hatalı Çalışma</span>
                ) : (
                  <span>Tüm Sistem Kararlı 🟢</span>
                )}
              </span>
              <span className="text-[9px] text-gray-400 block mt-1">
                Atlanan (Dedupe): {health.automation.skippedRuns24h} • Aktif Kural: {health.automation.activeRuleCount}
              </span>
            </div>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <Sliders className="w-4 h-4" />
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center justify-between border-b mb-6" style={{ borderColor: "var(--q-border-default)" }}>
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab("rules")}
            className={`pb-2.5 text-[13px] font-semibold border-b-2 transition-all ${
              activeTab === "rules"
                ? "border-amber-500 text-amber-600"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            <Sliders className="w-4 h-4 inline-block mr-1.5" />
            Otomasyon Kuralları
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`pb-2.5 text-[13px] font-semibold border-b-2 transition-all ${
              activeTab === "history"
                ? "border-amber-500 text-amber-600"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            <Layers className="w-4 h-4 inline-block mr-1.5" />
            Otomasyon Geçmişi
          </button>
        </div>

        {activeTab === "rules" && (
          <button
            onClick={() => setEditModal({})}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg text-white bg-amber-500 hover:bg-amber-600 transition-all mb-2"
          >
            <Plus className="w-3.5 h-3.5" />
            Kural Ekle
          </button>
        )}
      </div>

      {/* Main Tab Area */}
      {activeTab === "rules" ? (
        <div className="space-y-4">
          {rules.length > 0 ? (
            <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: "var(--q-border-default)" }}>
              {rules.map((rule) => {
                const actCount = Array.isArray(rule.actions) ? rule.actions.length : 0;
                const condCount = Array.isArray(rule.conditions) ? rule.conditions.length : 0;

                return (
                  <div key={rule.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0 hover:bg-gray-50/50 transition-colors" style={{ borderColor: "var(--q-border-default)" }}>
                    <div className="min-w-0 flex-1 mr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px] font-bold truncate" style={{ color: "var(--q-text-primary)" }}>{rule.name}</span>
                        <span className="text-[9px] font-semibold px-2 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                          {rule.trigger_event === "form_submission" ? "Form Gönderimi" : rule.trigger_event}
                        </span>
                      </div>
                      <p className="text-[11px] truncate" style={{ color: "var(--q-text-secondary)" }}>
                        {rule.description || "Açıklama belirtilmemiş."}
                      </p>
                      <p className="text-[9px] font-medium mt-1" style={{ color: "var(--q-text-secondary)" }}>
                        {condCount} Koşul • {actCount} Whitelist Aksiyon
                      </p>
                    </div>

                    <div className="flex items-center gap-4 flex-shrink-0">
                      {/* Active Toggle */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => triggerActivationChange(rule)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${rule.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${rule.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                        <span className="text-[10px] font-semibold min-w-[36px]" style={{ color: rule.is_active ? "#10b981" : "var(--q-text-secondary)" }}>
                          {rule.is_active ? "Aktif" : "Pasif"}
                        </span>
                      </div>

                      {/* Simulation Button */}
                      <button
                        onClick={() => {
                          setSimulatorModal(rule);
                          setSimResult(null);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-lg border hover:bg-amber-50 hover:border-amber-200 transition-colors"
                        style={{ color: "var(--q-text-primary)", borderColor: "var(--q-border-default)" }}
                      >
                        <Play className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
                        Simüle Et
                      </button>

                      {/* Edit & Delete */}
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setEditModal(rule)}
                          className="text-[11px] font-semibold px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
                          style={{ color: "var(--q-primary, #6366f1)" }}
                        >
                          Düzenle
                        </button>
                        <button
                          onClick={() => handleArchiveRule(rule.id)}
                          className="p-1.5 rounded-lg hover:bg-rose-50 transition-colors group"
                          title="Arşivle"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-gray-400 group-hover:text-rose-500" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border p-8 text-center" style={{ borderColor: "var(--q-border-default)" }}>
              <Zap className="w-8 h-8 mx-auto text-gray-300 mb-3" />
              <p className="text-[13px] font-semibold text-gray-700">Henüz kural kurgulanmamış</p>
              <p className="text-[11px] text-gray-500 mt-1 max-w-sm mx-auto">
                Yeni bir kural ekleyerek form ingestion veya durum değişiklikleri için iç görev ve Telegram süreçlerini otomatize edebilirsiniz.
              </p>
            </div>
          )}
        </div>
      ) : (
        /* Runs History Tab */
        <div className="space-y-4">
          {runs.length > 0 ? (
            <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: "var(--q-border-default)" }}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50/70 border-b" style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-secondary)" }}>
                      <th className="px-4 py-2.5 font-bold">Kural Adı</th>
                      <th className="px-4 py-2.5 font-bold">Tetikleyici</th>
                      <th className="px-4 py-2.5 font-bold">Lokal Kayıt (Dedupe)</th>
                      <th className="px-4 py-2.5 font-bold">Durum</th>
                      <th className="px-4 py-2.5 font-bold">Süre</th>
                      <th className="px-4 py-2.5 font-bold">Tarih</th>
                      <th className="px-4 py-2.5 font-bold text-right">Detaylar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id} className="border-b last:border-b-0 hover:bg-gray-50/30 transition-colors" style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-primary)" }}>
                        <td className="px-4 py-3 font-semibold truncate max-w-[150px]">{run.rule_name}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-[10px] bg-gray-50 px-1.5 py-0.5 rounded border">
                            {run.trigger_event}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[10px] text-gray-500 max-w-[180px] truncate" title={run.dedupe_key}>
                          {run.dedupe_key}
                        </td>
                        <td className="px-4 py-3">
                          <RunStatusBadge status={run.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 font-medium">{run.duration_ms ? `${run.duration_ms}ms` : "-"}</td>
                        <td className="px-4 py-3 text-gray-500">
                          {new Date(run.created_at).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setRunDetailsModal(run)}
                            className="p-1 rounded hover:bg-gray-100 transition-colors text-amber-600 hover:text-amber-700 font-semibold text-[11px]"
                          >
                            İncele
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border p-8 text-center" style={{ borderColor: "var(--q-border-default)" }}>
              <Layers className="w-8 h-8 mx-auto text-gray-300 mb-3" />
              <p className="text-[13px] font-semibold text-gray-700">Otomasyon geçmişi temiz</p>
              <p className="text-[11px] text-gray-500 mt-1 max-w-sm mx-auto">
                Tetiklenen otomasyonların başarı, skip ve hata durumları bu alanda kronolojik olarak listelenecektir.
              </p>
            </div>
          )}
        </div>
      )}

      {/* =======================================================
          MODAL 1: KURAL CREATOR & EDITOR
          ======================================================= */}
      {editModal && (
        <RuleEditorModal
          rule={editModal}
          onClose={() => setEditModal(null)}
          onSuccess={async () => {
            setEditModal(null);
            await loadData();
          }}
        />
      )}

      {/* =======================================================
          MODAL 2: DRY-RUN SIMULATOR
          ======================================================= */}
      {simulatorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSimulatorModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" style={{ border: "1px solid var(--q-border-default)" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Play className="w-5 h-5 text-amber-500 fill-amber-500" />
                <h3 className="text-base font-bold" style={{ color: "var(--q-text-primary)" }}>Otomasyon Kuralı Simülatörü</h3>
              </div>
              <button onClick={() => setSimulatorModal(null)} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" style={{ color: "var(--q-text-secondary)" }} />
              </button>
            </div>

            <p className="text-[11px] mb-4 text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-2 rounded-xl">
              ℹ️ **Güvenlik Uyarısı:** Simülasyon modunda görev oluşturulmaz, panel bildirimi oluşturulmaz, Telegram gönderilmez, hastaya mesaj gönderilmez.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-semibold mb-1.5 block" style={{ color: "var(--q-text-secondary)" }}>Kural Adı</label>
                <p className="text-xs font-bold text-gray-800 bg-gray-50 border px-3 py-1.5 rounded-lg">{simulatorModal.name}</p>
              </div>

              <div>
                <label className="text-[11px] font-semibold mb-1.5 block" style={{ color: "var(--q-text-secondary)" }}>Test Kaydı Seç (Son gelen form leadleri)</label>
                {testLeads.length > 0 ? (
                  <select
                    value={simLeadId}
                    onChange={e => setSimLeadId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border text-sm bg-white"
                    style={{ borderColor: "var(--q-border-default)", color: "var(--q-text-primary)" }}
                  >
                    {testLeads.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.country || "Ülke Belirtilmemiş"} - {l.form_name})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-rose-500 font-medium">Sistemde simülasyon için uygun form lead kaydı bulunamadı.</p>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleRunSimulation}
                  disabled={simulating || !simLeadId}
                  className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold rounded-xl text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 transition-all"
                >
                  {simulating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  {simulating ? "Simüle ediliyor..." : "Dry-Run Simüle Et"}
                </button>
              </div>

              {simResult && (
                <div className="mt-4 p-4 rounded-xl border" style={{ borderColor: simResult.matched ? "#a7f3d0" : "#fca5a5", backgroundColor: simResult.matched ? "#f0fdf4" : "#fef2f2" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${simResult.matched ? "bg-emerald-500" : "bg-rose-500"}`} />
                    <h4 className="text-[13px] font-bold" style={{ color: simResult.matched ? "#065f46" : "#991b1b" }}>
                      {simResult.matched ? "Koşullar Uyuştu (Success)" : "Koşullar Uyuşmadı (Mismatch)"}
                    </h4>
                  </div>
                  {simResult.error_message && (
                    <p className="text-[11px] font-medium text-rose-700 mb-2">Sebep: {simResult.error_message}</p>
                  )}
                  {simResult.executed_actions && simResult.executed_actions.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[10px] font-semibold text-gray-500 mb-1.5 block">Simüle Edilen Aksiyonlar (Dry-Run Preview):</p>
                      <div className="space-y-1.5">
                        {simResult.executed_actions.map((act: any, idx: number) => (
                          <div key={idx} className="bg-white/80 p-2.5 rounded-lg border text-[11px]" style={{ borderColor: "var(--q-border-default)" }}>
                            <p className="font-bold text-gray-800">Aksiyon: <span className="font-mono">{act.action}</span></p>
                            <p className="text-[10px] text-gray-600 mt-0.5">Durum: {act.status}</p>
                            {act.title && <p className="text-[10px] text-gray-700 mt-0.5">Başlık: {act.title}</p>}
                            {act.dueAt && <p className="text-[10px] text-gray-500 mt-0.5">Due At: {new Date(act.dueAt).toLocaleString()}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =======================================================
          MODAL 3: RUN DETAILS VIEWER (Audit Telemetry)
          ======================================================= */}
      {runDetailsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRunDetailsModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 border-b pb-3">
              <h3 className="text-base font-bold text-gray-900">Otomasyon Çalışma Günlüğü (Audit Log)</h3>
              <button onClick={() => setRunDetailsModal(null)} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-gray-400 block font-semibold">TETİKLENEN KURAL</span>
                  <span className="font-bold text-gray-800">{runDetailsModal.rule_name}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block font-semibold">DURUM</span>
                  <RunStatusBadge status={runDetailsModal.status} />
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block font-semibold">DEDUPE ANAHTARI</span>
                  <span className="font-mono text-gray-600 bg-gray-50 px-1 py-0.5 rounded border border-gray-100 block truncate">{runDetailsModal.dedupe_key}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block font-semibold">ÇALIŞMA TARİHİ</span>
                  <span className="text-gray-700">{new Date(runDetailsModal.created_at).toLocaleString()}</span>
                </div>
              </div>

              {runDetailsModal.error_message && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-medium">
                  Hata/Atlama Detayı: {runDetailsModal.error_message}
                </div>
              )}

              {/* Idempotency Visibility Alerts */}
              {runDetailsModal.status === 'skipped' && runDetailsModal.error_message?.includes('idempotency') && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                  ℹ️ **İdempotensi Atlaması:** Bu kural daha önce bu entity için başarıyla çalıştırıldığından mükerrer görev/bildirim üretilmemiştir.
                </div>
              )}

              {runDetailsModal.executed_actions && runDetailsModal.executed_actions.length > 0 && (
                <div>
                  <span className="text-[10px] text-gray-400 block font-semibold mb-1.5">GERÇEKLEŞTİRİLEN AKSİYONLAR TELEMETRİSİ:</span>
                  <div className="space-y-2">
                    {runDetailsModal.executed_actions.map((act: any, idx: number) => (
                      <div key={idx} className="bg-gray-50/50 p-2.5 rounded-xl border text-[11px]">
                        <p className="font-bold text-gray-800">Aksiyon: <span className="font-mono">{act.action}</span></p>
                        <p className="mt-0.5">Durum: <span className="font-semibold text-emerald-700">{act.status}</span></p>
                        {act.status === 'skipped_existing_task' && (
                          <p className="text-[10px] text-amber-700 font-medium mt-0.5">
                            ℹ️ **Dedupe Atlaması:** Zaten bekleyen aktif bir görev mevcut olduğundan görev oluşturma atlanmıştır.
                          </p>
                        )}
                        {act.title && <p className="text-[10px] text-gray-700 mt-0.5">Başlık: {act.title}</p>}
                        {act.task_id && <p className="text-[10px] text-gray-500 font-mono mt-0.5">Task ID: {act.task_id}</p>}
                        {act.notification_id && <p className="text-[10px] text-gray-500 font-mono mt-0.5">Notification ID: {act.notification_id}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =======================================================
          MODAL 4: CONFIRM SAFE ACTIVATION FLOW
          ======================================================= */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center" style={{ border: "1px solid var(--q-border-default)" }}>
            <AlertTriangle className="w-10 h-10 mx-auto text-amber-500 mb-3" />
            <h3 className="text-base font-bold text-gray-900 mb-2">⚠️ Otomasyon Kuralı Onayı</h3>
            <p className="text-xs text-gray-600 mb-5 leading-relaxed">
              **"{confirmModal.name}"** kuralı aktif hale getirilecek. Kural yalnızca iç görev ve bildirim oluşturabilir; **hastaya otomatik mesaj gönderemez.** Emin misiniz?
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 text-sm font-semibold rounded-xl hover:bg-gray-100 text-gray-500"
              >
                İptal
              </button>
              <button
                onClick={confirmActivation}
                className="px-5 py-2 text-sm font-bold rounded-xl text-white bg-amber-500 hover:bg-amber-600"
              >
                Evet, Eminim
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

// =======================================================
// MODAL SUBCOMPONENT: RULE EDITOR MODAL
// =======================================================
function RuleEditorModal({
  rule,
  onClose,
  onSuccess
}: {
  rule: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isNew = !rule.id;
  const [name, setName] = useState(rule.name || "");
  const [description, setDescription] = useState(rule.description || "");
  const [triggerEvent, setTriggerEvent] = useState(rule.trigger_event || "form_submission");

  // Conditions & Actions
  const [conditions, setConditions] = useState<RuleCondition[]>(
    Array.isArray(rule.conditions) ? rule.conditions : [{ field: "patient.country", operator: "equals", value: "" }]
  );
  const [actions, setActions] = useState<RuleAction[]>(
    Array.isArray(rule.actions) ? rule.actions : [{ type: "create_task", task_type: "coordinator_review", title: "📋 Yeni Görev — {{patient_name}}", description: "Lütfen hastayı arayın." }]
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const addCondition = () => {
    setConditions([...conditions, { field: "patient.country", operator: "equals", value: "" }]);
  };

  const removeCondition = (idx: number) => {
    setConditions(conditions.filter((_, i) => i !== idx));
  };

  const updateCondition = (idx: number, key: keyof RuleCondition, val: any) => {
    const next = [...conditions];
    next[idx] = { ...next[idx], [key]: val };
    setConditions(next);
  };

  const addAction = () => {
    setActions([...actions, { type: "create_task", task_type: "coordinator_review", title: "📋 Yeni Görev — {{patient_name}}", description: "Otomasyon ataması." }]);
  };

  const removeAction = (idx: number) => {
    setActions(actions.filter((_, i) => i !== idx));
  };

  const updateAction = (idx: number, key: keyof RuleAction, val: any) => {
    const next = [...actions];
    next[idx] = { ...next[idx], [key]: val };
    setActions(next);
  };

  const handleSave = async () => {
    setError("");
    if (!name.trim()) {
      setError("Kural adı zorunludur.");
      return;
    }
    if (conditions.length === 0) {
      setError("En az bir koşul tanımlanmalıdır.");
      return;
    }
    if (actions.length === 0) {
      setError("En az bir aksiyon tanımlanmalıdır.");
      return;
    }

    setSaving(true);
    let res: any;
    if (isNew) {
      res = await createAutomationRule({ name, description, triggerEvent, conditions, actions });
    } else {
      res = await updateAutomationRule(rule.id, { name, description, triggerEvent, conditions, actions });
    }
    setSaving(false);

    if (res?.success) {
      onSuccess();
    } else {
      setError(res?.error || "Kayıt hatası.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto" style={{ border: "1px solid var(--q-border-default)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4 border-b pb-3">
          <h3 className="text-base font-bold text-gray-900">{isNew ? "Yeni Otomasyon Kuralı Ekle" : "Kuralı Düzenle"}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Kural Adı</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Örn: Almanya Form Arama Görevi" autoComplete="off" className="w-full px-3 py-2 rounded-xl border text-xs" style={{ borderColor: "var(--q-border-default)" }} />
            </div>
            <div>
              <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Tetikleyici Olay (Trigger)</label>
              <select value={triggerEvent} onChange={e => setTriggerEvent(e.target.value)} className="w-full px-3 py-2 rounded-xl border text-xs bg-white" style={{ borderColor: "var(--q-border-default)" }}>
                {TRIGGER_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} disabled={!opt.active}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold mb-1 block" style={{ color: "var(--q-text-secondary)" }}>Açıklama</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Bu kuralın amacını kısaca belirtin..." autoComplete="off" className="w-full px-3 py-2 rounded-xl border text-xs" style={{ borderColor: "var(--q-border-default)" }} />
          </div>

          {/* Condition Builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold block" style={{ color: "var(--q-text-secondary)" }}>1. Koşullar (Tümü sağlanmalıdır - AND)</label>
              <button onClick={addCondition} className="text-[10px] font-bold text-amber-600 hover:text-amber-700">+ Ekle</button>
            </div>
            <div className="space-y-2">
              {conditions.map((cond, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-gray-50/50 p-2.5 rounded-xl border" style={{ borderColor: "var(--q-border-default)" }}>
                  <select
                    value={cond.field}
                    onChange={e => updateCondition(idx, "field", e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border text-[11px] bg-white w-[140px]"
                    style={{ borderColor: "var(--q-border-default)" }}
                  >
                    {FIELD_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>

                  <select
                    value={cond.operator}
                    onChange={e => updateCondition(idx, "operator", e.target.value as any)}
                    className="px-2.5 py-1.5 rounded-lg border text-[11px] bg-white w-[130px]"
                    style={{ borderColor: "var(--q-border-default)" }}
                  >
                    {OPERATOR_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>

                  {!['is_empty', 'is_not_empty'].includes(cond.operator) && (
                    <input
                      value={cond.value || ""}
                      onChange={e => updateCondition(idx, "value", e.target.value)}
                      placeholder="Değer..."
                      autoComplete="off"
                      className="px-2.5 py-1.5 rounded-lg border text-[11px] flex-1 min-w-0"
                      style={{ borderColor: "var(--q-border-default)" }}
                    />
                  )}

                  <button onClick={() => removeCondition(idx)} className="p-1 rounded hover:bg-rose-50 text-gray-400 hover:text-rose-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Action Builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold block" style={{ color: "var(--q-text-secondary)" }}>2. Aksiyonlar (Whitelist Zinciri)</label>
              <button onClick={addAction} className="text-[10px] font-bold text-amber-600 hover:text-amber-700">+ Ekle</button>
            </div>
            <div className="space-y-3">
              {actions.map((act, idx) => (
                <div key={idx} className="bg-gray-50/50 p-3 rounded-xl border relative" style={{ borderColor: "var(--q-border-default)" }}>
                  <button onClick={() => removeAction(idx)} className="absolute top-2 right-2 p-1 rounded hover:bg-rose-50 text-gray-400 hover:text-rose-500">
                    <X className="w-3.5 h-3.5" />
                  </button>

                  <div className="grid grid-cols-2 gap-3 mb-2 max-w-[90%]">
                    <div>
                      <label className="text-[9px] font-semibold text-gray-400 block mb-1">AKSİYON TİPİ</label>
                      <select
                        value={act.type}
                        onChange={e => updateAction(idx, "type", e.target.value as any)}
                        className="w-full px-2 py-1.5 rounded-lg border text-[11px] bg-white font-semibold"
                        style={{ borderColor: "var(--q-border-default)" }}
                      >
                        {ACTION_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>

                    {act.type === 'create_task' && (
                      <div>
                        <label className="text-[9px] font-semibold text-gray-400 block mb-1">GÖREV TİPİ</label>
                        <select
                          value={act.task_type || "coordinator_review"}
                          onChange={e => updateAction(idx, "task_type", e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg border text-[11px] bg-white"
                          style={{ borderColor: "var(--q-border-default)" }}
                        >
                          {TASK_TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                    )}

                    {act.type === 'send_notification' && (
                      <div>
                        <label className="text-[9px] font-semibold text-gray-400 block mb-1">BİLDİRİM KATEGORİSİ</label>
                        <select
                          value={act.category || "hot_lead"}
                          onChange={e => updateAction(idx, "category", e.target.value)}
                          className="w-full px-2 py-1.5 rounded-lg border text-[11px] bg-white"
                          style={{ borderColor: "var(--q-border-default)" }}
                        >
                          {NOTIFICATION_CATEGORY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* create_task input details */}
                  {act.type === 'create_task' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="text-[9px] text-gray-400 block mb-0.5">Görev Başlığı (Mustache şablonu destekler)</label>
                          <input value={act.title || ""} onChange={e => updateAction(idx, "title", e.target.value)} placeholder="Örn: 📋 Almanya Görevi — {{patient_name}}" className="w-full px-2.5 py-1 rounded-lg border text-[11px]" style={{ borderColor: "var(--q-border-default)" }} />
                        </div>
                        <div>
                          <label className="text-[9px] text-gray-400 block mb-0.5">Vade (Dakika)</label>
                          <input value={act.due_in_minutes || 15} type="number" onChange={e => updateAction(idx, "due_in_minutes", parseInt(e.target.value))} className="w-full px-2.5 py-1 rounded-lg border text-[11px]" style={{ borderColor: "var(--q-border-default)" }} />
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-400 block mb-0.5">Görev Açıklaması</label>
                        <input value={act.description || ""} onChange={e => updateAction(idx, "description", e.target.value)} placeholder="Görev detay açıklaması..." className="w-full px-2.5 py-1 rounded-lg border text-[11px]" style={{ borderColor: "var(--q-border-default)" }} />
                      </div>
                    </div>
                  )}

                  {/* send_notification input details */}
                  {act.type === 'send_notification' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="text-[9px] text-gray-400 block mb-0.5">Bildirim Başlığı</label>
                          <input value={act.title || ""} onChange={e => updateAction(idx, "title", e.target.value)} placeholder="Örn: 🔥 Sıcak Almanya Leadi — {{patient_name}}" className="w-full px-2.5 py-1 rounded-lg border text-[11px]" style={{ borderColor: "var(--q-border-default)" }} />
                        </div>
                        <div>
                          <label className="text-[9px] text-gray-400 block mb-0.5">Öncelik</label>
                          <select value={act.priority || "normal"} onChange={e => updateAction(idx, "priority", e.target.value)} className="w-full px-2.5 py-1 rounded-lg border text-[11px] bg-white" style={{ borderColor: "var(--q-border-default)" }}>
                            <option value="normal">Normal</option>
                            <option value="high">Yüksek</option>
                            <option value="critical">Kritik</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] text-gray-400 block mb-0.5">Bildirim Gövdesi (Açıklama)</label>
                        <input value={act.body || ""} onChange={e => updateAction(idx, "body", e.target.value)} placeholder="Kanal aktifse Telegram'a da post edilir..." className="w-full px-2.5 py-1 rounded-lg border text-[11px]" style={{ borderColor: "var(--q-border-default)" }} />
                        <span className="text-[9px] text-indigo-600 font-medium block mt-0.5">
                          ℹ️ Panel bildirimi oluşturur. Telegram kanalınız açıksa NotificationService üzerinden Telegram'a da gider. Hastaya mesaj göndermez.
                        </span>
                      </div>
                    </div>
                  )}

                  {/* audit_log input details */}
                  {act.type === 'audit_log' && (
                    <p className="text-[10px] text-gray-500 font-medium">
                      Bu kural uyuştuğunda herhangi bir DB yazımı tetiklenmeden sadece otomasyon loglarında çalışma kaydı tutulacaktır.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-[11px] text-rose-600 mt-3 font-medium">{error}</p>}

        <div className="flex justify-end gap-2 mt-5 border-t pt-3">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold rounded-xl text-gray-500 hover:bg-gray-100">İptal</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-xs font-bold rounded-xl text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50">
            {saving ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
      </div>
    </div>
  );
}
