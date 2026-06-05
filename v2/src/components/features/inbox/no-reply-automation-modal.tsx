"use client";

import React, { useState, useEffect } from 'react';
import { 
  X, Sliders, Zap, Check, Loader2, AlertCircle, Play, Clock, 
  ShieldAlert, CheckCircle, Info, ChevronRight, HelpCircle
} from 'lucide-react';
import { 
  getNoReplySettingsAction, 
  saveNoReplySettingsAction, 
  runNoReplyDryRunAction 
} from '@/app/actions/no-reply-automation';
import { type NoReplyAutomationSettings } from '@/lib/services/automation/no-reply-automation.service';

interface NoReplyAutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NoReplyAutomationModal({ isOpen, onClose }: NoReplyAutomationModalProps) {
  const [activeTab, setActiveTab] = useState<'settings' | 'simulation'>('settings');
  const [settings, setSettings] = useState<NoReplyAutomationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Simulation states
  const [simLoading, setSimLoading] = useState(false);
  const [simResults, setSimResults] = useState<any | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await getNoReplySettingsAction();
      if (res.success && res.data) {
        setSettings(res.data);
      } else {
        setErrorMsg(res.error || 'Ayarlar yüklenemedi.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Bir bağlantı hatası oluştu.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;
    setIsSaving(true);
    setErrorMsg(null);
    setSaveSuccess(false);
    try {
      const res = await saveNoReplySettingsAction(settings);
      if (res.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setErrorMsg(res.error || 'Ayarlar kaydedilemedi.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Kaydetme hatası oluştu.');
    } finally {
      setIsSaving(false);
    }
  };

  const runSimulation = async () => {
    setSimLoading(true);
    setSimError(null);
    setSimResults(null);
    try {
      const res = await runNoReplyDryRunAction();
      if (res.success && res.data) {
        setSimResults(res.data);
      } else {
        setSimError(res.error || 'Simülasyon çalıştırılamadı.');
      }
    } catch (err: any) {
      setSimError(err?.message || 'Simülasyon bağlantı hatası.');
    } finally {
      setSimLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-fade-in">
      <div 
        className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] shadow-2xl flex flex-col border overflow-hidden"
        style={{ borderColor: 'var(--q-border-default)' }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50/50" style={{ borderColor: 'var(--q-border-default)' }}>
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-base font-bold text-gray-900">Otomasyon Ayarları</h3>
              <p className="text-xs text-gray-500">Cevapsız hasta takipleri için güvenli otomasyon kuralları</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b text-xs font-semibold" style={{ borderColor: 'var(--q-border-default)' }}>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-6 py-3 border-b-2 transition-all ${
              activeTab === 'settings' 
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/20' 
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            ⚙️ Kural Tanımları & Parametreler
          </button>
          <button
            onClick={() => {
              setActiveTab('simulation');
              runSimulation();
            }}
            className={`px-6 py-3 border-b-2 transition-all ${
              activeTab === 'simulation' 
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/20' 
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            🔍 Simülasyon / Dry-Run Testi
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-sm text-gray-500">Ayarlar yükleniyor...</p>
            </div>
          ) : errorMsg ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Bir Hata Oluştu</p>
                <p className="mt-0.5">{errorMsg}</p>
                <button 
                  onClick={loadSettings}
                  className="mt-2 text-indigo-600 font-semibold hover:underline"
                >
                  Yeniden Dene
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Safety Shield Notice Banner */}
              <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800">
                  <p className="font-bold text-amber-950">Güvenli Çalışma Modu Etkin (Draft-First)</p>
                  <p className="mt-0.5 leading-relaxed">
                    Bu sistem hastalara **hiçbir şekilde otomatik WhatsApp mesajı göndermez**. Koşullar eşleştiğinde otomasyon, sadece koordinatör onayına sunulmak üzere Inbox içinde hatırlatma taslakları (draft görevler) hazırlar.
                  </p>
                </div>
              </div>

              {activeTab === 'settings' && settings && (
                <div className="space-y-6">
                  {/* Master Toggle */}
                  <div className="flex justify-between items-center p-4 bg-gray-50 rounded-xl border border-gray-100">
                    <div>
                      <h4 className="text-xs font-bold text-gray-900">Hatırlatma Otomasyonunu Etkinleştir</h4>
                      <p className="text-[10px] text-gray-500 mt-0.5">Cevap bekleyen hastalar için arka planda takip taslakları üretilmeye başlar</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={settings.enabled} 
                        onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>

                  {/* Mode Selector (Hardcoded / Disabled auto-send) */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 border-2 border-indigo-600 bg-indigo-50/10 rounded-xl flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">Aktif Çalışma Modu</span>
                        <h5 className="text-xs font-bold text-gray-900 mt-2">Sadece Taslak Hazırla (Draft Only)</h5>
                        <p className="text-[10px] text-gray-500 mt-1">Takip mesajları hazırlanır ve onay bekleyen görev olarak CRM paneline eklenir.</p>
                      </div>
                      <span className="text-[9px] font-semibold text-emerald-600 mt-3 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Güvenli Mod Etkin
                      </span>
                    </div>

                    <div className="p-3 border border-gray-100 bg-gray-50 rounded-xl flex flex-col justify-between opacity-60">
                      <div>
                        <span className="text-[10px] font-bold text-gray-600 bg-gray-200 px-2 py-0.5 rounded">Otomatik Gönderim (Auto-Send)</span>
                        <h5 className="text-xs font-bold text-gray-400 mt-2 flex items-center gap-1.5">
                          Doğrudan Gönder 🔒 <span className="text-[8px] bg-red-100 text-red-600 px-1 py-0.5 rounded font-mono">YAKINDA</span>
                        </h5>
                        <p className="text-[10px] text-gray-400 mt-1">Mesajlar 24 saatlik WhatsApp penceresi veya şablon kurallarıyla hastaya direkt gönderilir.</p>
                      </div>
                      <span className="text-[9px] text-gray-400 mt-3 font-semibold">
                        Güvenlik Modunda Devre Dışı
                      </span>
                    </div>
                  </div>

                  {/* Attempt Hour Sequence Limits */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-900 mb-3">Tetikleyici Zaman Eşikleri (Outbound Mesaj Sonrası Geçen Saat)</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">1. Takip (Saat)</label>
                        <input 
                          type="number"
                          min="1"
                          max="168"
                          value={settings.firstReminderAfterHours}
                          onChange={(e) => setSettings({ ...settings, firstReminderAfterHours: parseInt(e.target.value, 10) || 3 })}
                          className="w-full text-xs font-semibold px-3 py-2 rounded-lg border focus:ring-1 focus:ring-indigo-500 outline-none"
                          style={{ borderColor: 'var(--q-border-default)' }}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 font-sans">2. Takip (Saat veya Boş)</label>
                        <input 
                          type="number"
                          min="1"
                          max="168"
                          placeholder="Devre Dışı"
                          value={settings.secondReminderAfterHours || ''}
                          onChange={(e) => setSettings({ ...settings, secondReminderAfterHours: e.target.value ? parseInt(e.target.value, 10) : null })}
                          className="w-full text-xs font-semibold px-3 py-2 rounded-lg border focus:ring-1 focus:ring-indigo-500 outline-none"
                          style={{ borderColor: 'var(--q-border-default)' }}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">3. Takip (Saat veya Boş)</label>
                        <input 
                          type="number"
                          min="1"
                          max="168"
                          placeholder="Devre Dışı"
                          value={settings.thirdReminderAfterHours || ''}
                          onChange={(e) => setSettings({ ...settings, thirdReminderAfterHours: e.target.value ? parseInt(e.target.value, 10) : null })}
                          className="w-full text-xs font-semibold px-3 py-2 rounded-lg border focus:ring-1 focus:ring-indigo-500 outline-none"
                          style={{ borderColor: 'var(--q-border-default)' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Quiet Hours Configurations */}
                  <div className="border-t pt-5" style={{ borderColor: 'var(--q-border-default)' }}>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <h4 className="text-xs font-bold text-gray-900">Sessiz Saatler (Quiet Hours Guard)</h4>
                        <p className="text-[10px] text-gray-500 mt-0.5">Gece saatlerinde hatırlatma taslağının teslim zamanını ertesi gün sabahına erteleyin</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer select-none">
                        <input 
                          type="checkbox" 
                          checked={settings.quietHoursEnabled} 
                          onChange={(e) => setSettings({ ...settings, quietHoursEnabled: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>

                    {settings.quietHoursEnabled && (
                      <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100 animate-slide-down">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">Başlangıç Zamanı</label>
                          <input 
                            type="time" 
                            value={settings.quietHoursStart}
                            onChange={(e) => setSettings({ ...settings, quietHoursStart: e.target.value })}
                            className="w-full text-xs px-3 py-2 rounded-lg border bg-white outline-none"
                            style={{ borderColor: 'var(--q-border-default)' }}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1">Bitiş Zamanı (Ertesi Gün Sabah)</label>
                          <input 
                            type="time" 
                            value={settings.quietHoursEnd}
                            onChange={(e) => setSettings({ ...settings, quietHoursEnd: e.target.value })}
                            className="w-full text-xs px-3 py-2 rounded-lg border bg-white outline-none"
                            style={{ borderColor: 'var(--q-border-default)' }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Operational Settings Toggles */}
                  <div className="border-t pt-5 space-y-4" style={{ borderColor: 'var(--q-border-default)' }}>
                    <h4 className="text-xs font-bold text-gray-900">Operasyonel Kurallar</h4>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <label className="flex items-start gap-3 p-3 bg-gray-50/50 hover:bg-gray-50 border rounded-xl cursor-pointer transition-colors">
                        <input 
                          type="checkbox" 
                          checked={settings.usePatientLocalTime}
                          onChange={(e) => setSettings({ ...settings, usePatientLocalTime: e.target.checked })}
                          className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div>
                          <span className="font-bold text-gray-900 block">Hasta Yerel Saatini Kullan</span>
                          <span className="text-[10px] text-gray-500 mt-0.5 block leading-normal">Hastanın yerel saati güvenilirse oraya göre, yoksa Türkiye saatine göre çalışır.</span>
                        </div>
                      </label>

                      <label className="flex items-start gap-3 p-3 bg-gray-50/50 hover:bg-gray-50 border rounded-xl cursor-pointer transition-colors">
                        <input 
                          type="checkbox" 
                          checked={settings.templateFallbackEnabled}
                          onChange={(e) => setSettings({ ...settings, templateFallbackEnabled: e.target.checked })}
                          className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div>
                          <span className="font-bold text-gray-900 block">24 Saat Sonrası Şablon Desteği</span>
                          <span className="text-[10px] text-gray-500 mt-0.5 block leading-normal">24 saatlik serbest mesaj süresi kapandıysa onaylı şablonları (templates) taslağa ekler.</span>
                        </div>
                      </label>

                      <label className="flex items-start gap-3 p-3 bg-gray-50/50 hover:bg-gray-50 border rounded-xl cursor-pointer transition-colors">
                        <input 
                          type="checkbox" 
                          checked={settings.secondaryFallbackEnabled}
                          onChange={(e) => setSettings({ ...settings, secondaryFallbackEnabled: e.target.checked })}
                          className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div>
                          <span className="font-bold text-gray-900 block">İkincil Telefon Fallback Taslakları</span>
                          <span className="text-[10px] text-gray-500 mt-0.5 block leading-normal">Birincil numaraya ulaşılamadığında ikincil numara için review görevi hazırlar.</span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'simulation' && (
                <div className="space-y-6">
                  {simLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                      <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                      <p className="text-sm font-semibold text-gray-600">Simülasyon çalıştırılıyor, aktif adaylar analiz ediliyor...</p>
                    </div>
                  ) : simError ? (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Simülasyon Hatası</p>
                        <p className="mt-0.5">{simError}</p>
                        <button 
                          onClick={runSimulation}
                          className="mt-2 text-indigo-600 font-semibold hover:underline"
                        >
                          Yeniden Dene
                        </button>
                      </div>
                    </div>
                  ) : simResults ? (
                    <div className="space-y-6">
                      {/* Metric Summaries */}
                      <div className="grid grid-cols-4 gap-3">
                        <div className="p-3 bg-indigo-50/40 border border-indigo-100 rounded-xl">
                          <span className="text-[9px] font-bold text-indigo-700 uppercase tracking-wider block">Cevap Bekleyen</span>
                          <span className="text-xl font-extrabold text-indigo-900 mt-1 block">{simResults.summary.totalEligible}</span>
                        </div>
                        <div className="p-3 bg-emerald-50/40 border border-emerald-100 rounded-xl">
                          <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-wider block">Oluşacak Taslak</span>
                          <span className="text-xl font-extrabold text-emerald-900 mt-1 block">{simResults.summary.estimatedTasksToCreate}</span>
                        </div>
                        <div className="p-3 bg-amber-50/40 border border-amber-100 rounded-xl">
                          <span className="text-[9px] font-bold text-amber-700 uppercase tracking-wider block">Gece Engeli</span>
                          <span className="text-xl font-extrabold text-amber-900 mt-1 block">{simResults.summary.blockedQuietHours}</span>
                        </div>
                        <div className="p-3 bg-red-50/40 border border-red-100 rounded-xl">
                          <span className="text-[9px] font-bold text-red-700 uppercase tracking-wider block">Şablon Eksik</span>
                          <span className="text-xl font-extrabold text-red-900 mt-1 block">{simResults.summary.blockedTemplateMissing}</span>
                        </div>
                      </div>

                      {/* Diagnostic splits info */}
                      <div className="bg-gray-50 border p-3 rounded-xl text-[10px] text-gray-600 flex justify-between">
                        <span><strong>1. Takip:</strong> {simResults.summary.attempt1Count} aday</span>
                        <span><strong>2. Takip:</strong> {simResults.summary.attempt2Count} aday</span>
                        <span><strong>3. Takip:</strong> {simResults.summary.attempt3Count} aday</span>
                        <span><strong>Opt-out Blok:</strong> {simResults.summary.blockedOptOut}</span>
                        <span><strong>İkincil Telefon Aday:</strong> {simResults.summary.secondaryFallbackCount}</span>
                      </div>

                      {/* Interactive Candidates Table */}
                      <div>
                        <h4 className="text-xs font-bold text-gray-900 mb-3">Örnek Simülasyon Aday Listesi (Maksimum 10)</h4>
                        {simResults.samples.length === 0 ? (
                          <div className="text-center py-8 border rounded-xl text-xs text-gray-400">
                            Şu an otomasyon kurallarına uyan hiçbir cevap bekleyen hasta bulunmamaktadır.
                          </div>
                        ) : (
                          <div className="border rounded-xl overflow-hidden overflow-x-auto">
                            <table className="w-full text-left text-[11px] border-collapse">
                              <thead>
                                <tr className="bg-gray-50 border-b text-gray-500 font-bold uppercase tracking-wider">
                                  <th className="p-2.5">Hasta Adı</th>
                                  <th className="p-2.5">Bekleme (Saat)</th>
                                  <th className="p-2.5">Hedef Deneme</th>
                                  <th className="p-2.5">24s Penceresi</th>
                                  <th className="p-2.5">Önerilen Eylem</th>
                                  <th className="p-2.5">Açıklama / Risk Nedeni</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y text-gray-700">
                                {simResults.samples.map((s: any, idx: number) => (
                                  <tr key={idx} className="hover:bg-gray-50/50">
                                    <td className="p-2.5 font-semibold text-gray-900">{s.patient_name}</td>
                                    <td className="p-2.5">{s.no_reply_hours}s</td>
                                    <td className="p-2.5 font-mono">Attempt {s.attempt_number}</td>
                                    <td className="p-2.5">
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                        s.window_open ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                                      }`}>
                                        {s.window_open ? 'Açık' : 'Kapalı'}
                                      </span>
                                    </td>
                                    <td className="p-2.5">
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                                        s.recommended_action.startsWith('create') 
                                          ? 'bg-indigo-100 text-indigo-700' 
                                          : s.recommended_action === 'template_required_task' 
                                            ? 'bg-amber-100 text-amber-700' 
                                            : 'bg-gray-100 text-gray-600'
                                      }`}>
                                        {s.recommended_action}
                                      </span>
                                    </td>
                                    <td className="p-2.5 text-gray-500 font-sans italic">{s.risk_reason || 'Sorun yok'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Play className="w-10 h-10 text-indigo-500" />
                      <button 
                        onClick={runSimulation}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold shadow hover:bg-indigo-700 active:scale-95 transition-all"
                      >
                        Simülasyon Testini Başlat
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-between items-center bg-gray-50/50" style={{ borderColor: 'var(--q-border-default)' }}>
          <div className="flex items-center gap-2">
            {saveSuccess && (
              <span className="text-emerald-600 text-xs font-semibold flex items-center gap-1 animate-fade-in">
                <Check className="w-3.5 h-3.5" /> Ayarlar Başarıyla Kaydedildi
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={onClose}
              className="px-4 py-2 border rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors"
              style={{ borderColor: 'var(--q-border-default)' }}
            >
              Kapat
            </button>
            {activeTab === 'settings' && (
              <button 
                onClick={() => {
                  setActiveTab('simulation');
                  runSimulation();
                }}
                className="px-4 py-2 border border-indigo-200 text-indigo-700 rounded-xl text-xs font-bold hover:bg-indigo-50/40 transition-colors"
              >
                Önce Simülasyon Çalıştır
              </button>
            )}
            <button 
              onClick={handleSave}
              disabled={isSaving || !settings}
              className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Değişiklikleri Kaydet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
