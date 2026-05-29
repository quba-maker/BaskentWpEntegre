"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Phone, MessageCircle, ClipboardList, Clock, AlertTriangle,
  Calendar, CheckCircle2, XCircle, Search, Filter, Globe,
  FileText, ExternalLink, ChevronDown, Check, Trash2, Bot, Info, Activity, FastForward, StickyNote
} from "lucide-react";
import { getFocusQueueItems, createBotDelegationTask, schedulePhoneCallTask, sendTestBotMessage, type FocusQueueItem } from "@/app/actions/focus-queue";
import { logCallReached, logCallMissed, logCallbackScheduled, logNotInterested } from "@/app/actions/outreach";
import { completeTask, rescheduleTask } from "@/app/actions/tasks";
import { addOpportunityNote, updateOpportunityStage } from "@/app/actions/pipeline";
import { getCountryFlag } from "@/lib/utils/country";

// P0 UI Configurations
const STATUS_COLORS: Record<string, { bg: string, text: string }> = {
  'Yeni Form Geldi': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Bot Karşılıyor': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'Bot Cevap Bekliyor': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'İnsan Devri Gerekli': { bg: 'bg-amber-100', text: 'text-amber-800' },
  'Danışman Arayacak': { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  'Telefon Randevusu Planlandı': { bg: 'bg-purple-100', text: 'text-purple-700' },
  'Ulaşılamadı': { bg: 'bg-gray-100', text: 'text-gray-700' },
  'Bot Takipte': { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  'Rapor Bekleniyor': { bg: 'bg-orange-100', text: 'text-orange-700' },
  'Doktor İncelemesi': { bg: 'bg-rose-100', text: 'text-rose-700' },
};

const NBA_CONFIG: Record<string, { label: string, icon: any, colorClass: string }> = {
  'call_now': { label: 'Hemen Ara', icon: Phone, colorClass: 'text-rose-600 bg-rose-50 border-rose-200' },
  'delegate_unreachable_followup_to_bot': { label: 'Bota Devret (Ulaşılamadı)', icon: Bot, colorClass: 'text-cyan-600 bg-cyan-50 border-cyan-200' },
  'request_report': { label: 'Rapor İste', icon: FileText, colorClass: 'text-orange-600 bg-orange-50 border-orange-200' },
  'doctor_review_needed': { label: 'Doktor Görüşü Bekleniyor', icon: Activity, colorClass: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  'call_today': { label: 'Bugün Ara', icon: Clock, colorClass: 'text-blue-600 bg-blue-50 border-blue-200' },
  'prepare_followup_draft': { label: 'Taslak Hazırla', icon: MessageCircle, colorClass: 'text-purple-600 bg-purple-50 border-purple-200' },
  'no_action': { label: 'İşlem Gerekmiyor', icon: CheckCircle2, colorClass: 'text-gray-600 bg-gray-50 border-gray-200' },
};

interface FocusTabProps {
  onGoToInbox: (opp: any) => void;
  onSelectOpportunity?: (opp: any) => void;
}

export default function FocusTab({ onGoToInbox, onSelectOpportunity }: FocusTabProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  // Action Modals State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [botMode, setBotMode] = useState<string>('unreachable_followup');
  const [showPhoneSchedule, setShowPhoneSchedule] = useState(false);
  const [phoneScheduleDate, setPhoneScheduleDate] = useState("");
  
  // New States for P0A
  const [showFormDrawer, setShowFormDrawer] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [noteText, setNoteText] = useState("");
  const [showActionDropdown, setShowActionDropdown] = useState(false);

  // SWR Fetching
  const { data, isLoading, mutate } = useSWR(
    'focus-queue-items',
    () => getFocusQueueItems(),
    { refreshInterval: 15000 } // Auto-refresh every 15s
  );

  const items = data?.items || [];
  const selectedItem = items.find(i => i.groupId === selectedGroupId) || (items.length > 0 ? items[0] : null);

  // Auto-select first item if none selected and data loaded
  if (!selectedGroupId && items.length > 0 && selectedItem) {
    setSelectedGroupId(selectedItem.groupId);
  }

  const handleGoToInbox = () => {
    if (!selectedItem) return;
    onGoToInbox({
      phone_number: selectedItem.phone_number,
      display_name: selectedItem.patient_name,
      requester_name: selectedItem.patient_name,
      patient_name: selectedItem.patient_name,
      source: selectedItem.metadata.opp_source || 'whatsapp',
    });
  };

  const handleCallReached = async () => {
    if (!selectedItem?.lead_id) return;
    setIsSubmitting(true);
    try {
      await logCallReached(selectedItem.lead_id, "Odak Merkezi üzerinden ulaşıldı işaretlendi.");
      if (selectedItem.task_id) await completeTask(selectedItem.task_id, "Arama ulaşıldı.");
      mutate();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCallMissed = async () => {
    if (!selectedItem?.lead_id) return;
    setIsSubmitting(true);
    try {
      await logCallMissed(selectedItem.lead_id, "Odak Merkezi üzerinden ulaşılamadı işaretlendi.");
      mutate();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBotDelegation = async () => {
    if (!selectedItem?.opportunity_id) return;
    setIsSubmitting(true);
    try {
      await createBotDelegationTask(selectedItem.opportunity_id, {
        mode: botMode as any,
        goal: 'Kullanıcı odak merkezinden bota devretti.',
      });
      mutate();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSchedulePhoneCall = async () => {
    if (!selectedItem?.opportunity_id || !phoneScheduleDate) return;
    setIsSubmitting(true);
    try {
      const utcDate = new Date(phoneScheduleDate).toISOString();
      await schedulePhoneCallTask(selectedItem.opportunity_id, utcDate, "Odak Merkezi üzerinden telefon randevusu planlandı.");
      mutate();
      setShowPhoneSchedule(false);
      setPhoneScheduleDate("");
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestBotMessage = async () => {
    if (!selectedItem?.opportunity_id || !draftMessage) return;
    setIsSubmitting(true);
    try {
      const res = await sendTestBotMessage(selectedItem.opportunity_id, draftMessage);
      if (!res.success) {
        alert(res.error);
      } else {
        alert("Test mesajı başarıyla gönderildi.");
        setDraftMessage("");
        mutate();
      }
    } catch (e) {
      console.error(e);
      alert("Gönderim sırasında hata oluştu.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddNote = async () => {
    if (!selectedItem?.opportunity_id || !noteText.trim()) return;
    setIsSubmitting(true);
    try {
      await addOpportunityNote(selectedItem.opportunity_id, noteText.trim());
      setNoteText("");
      mutate();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkLost = async () => {
    if (!selectedItem?.opportunity_id) return;
    const confirm = window.confirm("Bu hasta ilgilenmiyor/kayıp olarak işaretlenecek ve açık takip görevleri kapatılacak. Emin misiniz?");
    if (!confirm) return;
    
    setIsSubmitting(true);
    try {
      await updateOpportunityStage(selectedItem.opportunity_id, 'lost', 'Odak Merkezi üzerinden manuel kayıp/ilgilenmiyor işaretlendi.');
      mutate();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
      setShowActionDropdown(false);
    }
  };

  const handleOpenDetail = () => {
    if (!selectedItem || !onSelectOpportunity) return;
    onSelectOpportunity({
      id: selectedItem.opportunity_id,
      patient_name: selectedItem.patient_name,
      display_name: selectedItem.patient_name,
      phone_number: selectedItem.phone_number,
      country: selectedItem.country,
      department: selectedItem.department,
      stage: selectedItem.stage,
      priority: selectedItem.priority,
      intent_type: selectedItem.metadata?.intent_type,
      next_follow_up_at: selectedItem.due_at_utc,
      ai_reason: selectedItem.ai_reason,
      summary: selectedItem.summary,
      notes: selectedItem.notes,
      source: selectedItem.metadata?.opp_source,
      language: selectedItem.language,
      created_at: selectedItem.metadata?.opp_created_at,
      updated_at: selectedItem.metadata?.opp_updated_at,
    });
  };

  return (
    <div className="h-full flex bg-gray-50/50">
      {/* LEFT COLUMN: Queue */}
      <div className="w-[380px] border-r border-gray-200 bg-white flex flex-col h-full overflow-hidden shrink-0">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <FastForward className="w-5 h-5 text-indigo-600" />
            Odak Akışı
          </h2>
          <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full">
            {items.length} Hasta
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {isLoading && items.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">Yükleniyor...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-50" />
              Harika! Şu an bekleyen acil aksiyon yok.
            </div>
          ) : (
            items.map(item => {
              const isSelected = item.groupId === selectedGroupId;
              const statusColors = STATUS_COLORS[item.journeyStatus] || { bg: 'bg-gray-100', text: 'text-gray-700' };

              return (
                <div
                  key={item.groupId}
                  onClick={() => setSelectedGroupId(item.groupId)}
                  className={`p-3 rounded-lg cursor-pointer border transition-all ${
            isSelected
              ? 'border-indigo-400 bg-indigo-50/50 shadow-sm ring-1 ring-indigo-400/20'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
                >
          <div className="flex justify-between items-start mb-1.5">
            <div className="font-medium text-gray-900 truncate pr-2">
              {item.patient_name}
            </div>
            <div className="text-xs font-semibold text-gray-500 shrink-0">
              {item.priorityScore > 100 && <span className="text-rose-500 mr-1">🔥</span>}
              {item.priorityScore}P
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
            <span title={item.country}>{getCountryFlag(item.country)}</span>
            <span className="truncate">{item.department}</span>
          </div>

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusColors.bg} ${statusColors.text}`}>
            {item.journeyStatus}
          </span>
          <span className="text-[10px] text-gray-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {item.due_at_turkey?.split(' ')[1] || 'Bugün'}
          </span>
        </div>
      </div>
      );
            })
          )}
    </div>
      </div>

    {/* RIGHT COLUMN: Workspace */ }
    <div className = "flex-1 flex flex-col h-full overflow-hidden bg-gray-50" >
    {selectedItem ? (
          <div className = "flex-1 overflow-y-auto" >
          <div className="max-w-4xl mx-auto p-6 space-y-6">

            {/* Header */}
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-3">
                  {selectedItem.patient_name}
                  <span title={selectedItem.country} className="text-lg">{getCountryFlag(selectedItem.country)}</span>
                </h1>
                <div className="text-sm text-gray-500 font-medium flex items-center gap-2">
                  {selectedItem.phone_number} • {selectedItem.department}
                  <button 
                    onClick={() => { navigator.clipboard.writeText(selectedItem.phone_number); }}
                    className="text-indigo-600 hover:text-indigo-800 ml-2"
                    title="Numarayı Kopyala"
                  >
                    <ClipboardList className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  {selectedItem.is_test_whitelist ? (
                    <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded flex items-center gap-1 border border-amber-200">
                      🧪 TEST MODU - Bot cevap verebilir
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded flex items-center gap-1 border border-emerald-200">
                      🛡️ GÜVENLİ MOD - Otomatik mesaj kapalı
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedItem.lead_raw_data && Object.keys(selectedItem.lead_raw_data).length > 0 && (
                    <button
                      onClick={() => setShowFormDrawer(true)}
                      className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                    >
                      <FileText className="w-4 h-4" />
                      <span className="hidden sm:inline">Form Bilgisi</span>
                    </button>
                  )}
                  {onSelectOpportunity && selectedItem.opportunity_id && (
                    <button
                      onClick={handleOpenDetail}
                      className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span className="hidden sm:inline">Takipte Aç</span>
                    </button>
                  )}
                  <button
                    onClick={handleGoToInbox}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition-colors shadow-sm"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Gelen Kutusu
                  </button>
                </div>
              </div>
            </div>

            {/* BLOCK 1: Action */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-5">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Sıradaki Aksiyon</h3>

                <div className="flex flex-col md:flex-row gap-4 items-center">
                  {/* NBA Banner */}
                  <div className={`flex-1 w-full rounded-xl border p-4 flex items-center gap-4 ${NBA_CONFIG[selectedItem.nextBestAction]?.colorClass || 'border-gray-200 bg-gray-50 text-gray-700'}`}>
                  {(() => {
                    const Icon = NBA_CONFIG[selectedItem.nextBestAction]?.icon || Info;
                    return <Icon className="w-8 h-8 opacity-80" />;
                  })()}
                  <div>
                    <div className="font-bold text-lg">
                      {NBA_CONFIG[selectedItem.nextBestAction]?.label || 'Bilinmeyen Aksiyon'}
                    </div>
                    <div className="text-sm opacity-80 mt-0.5">
                      Önerilen en iyi aksiyon
                    </div>
                  </div>
                </div>

                {/* Quick Phone Actions */}
                <div className="flex flex-col gap-2 w-full md:w-auto">
                  <button
                    onClick={handleCallReached}
                    disabled={isSubmitting}
                    className="w-full md:w-48 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
                  >
                    <Phone className="w-4 h-4" />
                    Ulaşıldı & Görüşüldü
                  </button>
                  <button
                    onClick={handleCallMissed}
                    disabled={isSubmitting}
                    className="w-full md:w-48 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <Phone className="w-4 h-4 text-rose-500" />
                    Ulaşılamadı (Cevapsız)
                  </button>
                  <button
                    onClick={() => setShowPhoneSchedule(!showPhoneSchedule)}
                    disabled={isSubmitting}
                    className="w-full md:w-48 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <Calendar className="w-4 h-4 text-purple-600" />
                    Telefon Randevusu Al
                  </button>
                  
                  <div className="relative w-full md:w-auto">
                    <button
                      onClick={() => setShowActionDropdown(!showActionDropdown)}
                      disabled={isSubmitting}
                      className="w-full md:w-auto flex items-center justify-center gap-1 px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      Diğer <ChevronDown className="w-4 h-4" />
                    </button>
                    {showActionDropdown && (
                      <div className="absolute top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                        {onSelectOpportunity && selectedItem.opportunity_id && (
                          <button onClick={() => { handleOpenDetail(); setShowActionDropdown(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Takipte Aç / Detay</button>
                        )}
                        <button onClick={handleMarkLost} className="w-full text-left px-4 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 flex items-center justify-between">
                          Kayıp / İlgilenmiyor <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {showPhoneSchedule && (
                    <div className="w-full md:w-48 p-3 bg-gray-50 border border-gray-200 rounded-lg shadow-sm mt-1">
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Tarih & Saat</label>
                      <input 
                        type="datetime-local" 
                        value={phoneScheduleDate}
                        onChange={e => setPhoneScheduleDate(e.target.value)}
                        className="w-full text-sm p-1.5 border border-gray-300 rounded mb-2"
                      />
                      <button 
                        onClick={handleSchedulePhoneCall}
                        disabled={isSubmitting || !phoneScheduleDate}
                        className="w-full py-1.5 bg-purple-600 text-white text-xs font-semibold rounded hover:bg-purple-700 disabled:opacity-50"
                      >
                        Planla
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

              {/* BLOCK 2 & 3: Summary and Bot Delegation */ }
              <div className = "grid grid-cols-1 lg:grid-cols-2 gap-6" >

          {/* AI Summary Block */ }
          <div className = "bg-gradient-to-br from-indigo-50 to-blue-50/30 rounded-xl border border-indigo-100 p-5 shadow-sm" >
                  <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Bot className="w-4 h-4" />
                    AI Notu & Fırsat Özeti
                  </h3>
                  <div className="text-sm text-indigo-900/90 leading-relaxed font-medium">
                    {selectedItem.summary || selectedItem.ai_reason || "Henüz AI özeti çıkarılmamış. Manuel lead olabilir."}
                  </div>
                  
                  { selectedItem.timezone_needs_confirmation && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-3 text-sm text-amber-800">
          <Globe className="w-5 h-5 text-amber-600 shrink-0" />
          <div>
            <strong>Saat Dilimi Teyidi Gerekiyor!</strong> Hastanın bulunduğu ülke veya saat dilimi belirsiz olabilir. Arama yaparken lokal saate dikkat ediniz.
          </div>
        </div>
      )
    }
                </div>

    {/* Bot Delegation Block */ }
    <div className = "bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex flex-col" >
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Bot Takip Modu
                  </h3>
                  <p className="text-xs text-gray-500 mb-4">
                    Ulaşılamadığında veya teyit gerektiğinde takibi otonom bota devredin. (P0 test: Sadece task oluşturulur, mesaj gitmez.)
                  </p>
                  
                  <div className="space-y-3 mt-auto">
                    <select 
                      value={botMode}
                      onChange={(e) => setBotMode(e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value="unreachable_followup">Ulaşılamadı Takibi (Geri dönüş iste)</option>
                      <option value="collect_phone_call_time">Telefon Randevusu Al</option>
                      <option value="confirm_phone_call">Telefon Randevusunu Teyit Et</option>
                      <option value="request_report">Rapor/Fotoğraf İste</option>
                    </select>
                    
                    <button 
                      onClick={handleBotDelegation}
                      disabled={isSubmitting || !selectedItem.opportunity_id}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
                    >
                      Bota Devret
                    </button>
                  </div>
                </div>

              </div>

    {/* BLOCK 4 & 5: Collected Info and Draft */ }
    <div className = "grid grid-cols-1 lg:grid-cols-2 gap-6" >

      {/* Time Intelligence & Collected Info */}
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          
          {/* Time Intelligence Card */}
          <div className="p-5 flex-1 bg-gradient-to-br from-white to-gray-50/50">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Zaman & Lokasyon (Time Intelligence)
            </h3>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">🇹🇷 Türkiye Saati:</span>
                <span className="text-sm font-bold text-gray-900">{selectedItem.due_at_turkey?.split(' ')[1] || 'Bilinmiyor'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">🌍 Hasta Lokal Saati:</span>
                <span className="text-sm font-bold text-gray-900">
                  {selectedItem.due_at_patient_local?.split(' ')[1] || (selectedItem.timezone_needs_confirmation ? 'Teyit Gerekiyor' : 'Bilinmiyor')}
                </span>
              </div>
              
              {selectedItem.timezone_needs_confirmation ? (
                <div className="mt-2 p-2 bg-amber-50 rounded text-xs font-medium text-amber-800 border border-amber-200">
                  ⚠️ Birden fazla saat dilimi olan ülke. Şehir teyidi gerekiyor.
                </div>
              ) : selectedItem.is_patient_sleeping ? (
                <div className="mt-2 p-2 bg-rose-50 rounded text-xs font-bold text-rose-700 border border-rose-200 flex items-center gap-2">
                  <span>🌙</span> Hasta şu an uyku saatinde (22:00 - 08:00)
                </div>
              ) : (
                <div className="mt-2 p-2 bg-emerald-50 rounded text-xs font-medium text-emerald-700 border border-emerald-200 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Arama için uygun saat
                </div>
              )}
            </div>
          </div>

          {/* Patient Info Basic */}
          <div className="p-5 flex-1">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Info className="w-4 h-4" />
              Özet Bilgiler
            </h3>
            <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
              <div>
                <div className="text-gray-500 text-[11px] mb-1 uppercase tracking-wider">Departman</div>
                <div className="font-medium text-gray-900 truncate">{selectedItem.department}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[11px] mb-1 uppercase tracking-wider">Aşama</div>
                <div className="font-medium text-gray-900">{selectedItem.stage || 'Yeni'}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[11px] mb-1 uppercase tracking-wider">Öncelik</div>
                <div className="font-medium text-gray-900 capitalize">{selectedItem.priority}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[11px] mb-1 uppercase tracking-wider">Niyet</div>
                <div className="font-medium text-gray-900 capitalize truncate">{selectedItem.metadata?.intent_type || 'Bilinmiyor'}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[11px] mb-1 uppercase tracking-wider">Kaynak</div>
                <div className="font-medium text-gray-900 truncate">{selectedItem.metadata.opp_source || 'Whatsapp'}</div>
              </div>
              <div>
                <div className="text-gray-500 text-[11px] mb-1 uppercase tracking-wider">Dil</div>
                <div className="font-medium text-gray-900">{selectedItem.language || 'Bilinmiyor'}</div>
              </div>
              <div className="col-span-2 mt-2 pt-2 border-t border-gray-100 flex justify-between text-[11px] text-gray-500">
                <div>
                  <span className="font-semibold">Son Msj:</span> {selectedItem.metadata?.conv_last_message_at ? new Date(selectedItem.metadata.conv_last_message_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Yok'}
                </div>
                <div>
                  <span className="font-semibold">Oluşturulma:</span> {selectedItem.metadata?.opp_created_at ? new Date(selectedItem.metadata.opp_created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : 'Yok'}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

    {/* Draft Block */ }
    <div className = "bg-white rounded-xl border border-gray-200 p-5 shadow-sm" >
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Takip Taslağı
                  </h3>
                  <p className="text-xs text-gray-500 mb-3">
                    Manuel gönderim için taslak oluşturabilirsiniz. (Buradan mesaj doğrudan gönderilmez).
                  </p>
                  <textarea 
                    value={draftMessage}
                    onChange={(e) => setDraftMessage(e.target.value)}
                    className="w-full h-24 p-3 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                    placeholder="Hastaya gönderilecek mesaj taslağını buraya yazabilirsiniz..."
                  />
                  <div className="mt-3 flex justify-between items-center">
                    <div>
                      {selectedItem.is_test_whitelist && (
                        <button 
                          onClick={handleTestBotMessage}
                          disabled={isSubmitting || !draftMessage}
                          className="px-3 py-1.5 text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                        >
                          Test Mesajı Gönder
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => navigator.clipboard.writeText(draftMessage)}
                        className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        Kopyala
                      </button>
                    </div>
                  </div>
                </div>


              </div>

    {/* Hızlı Not Block */}
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
        <StickyNote className="w-4 h-4" />
        Hızlı Not Ekle
      </h3>
      <div className="flex gap-3">
        <input 
          type="text" 
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Hasta hakkında kısa not girin..."
          className="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          onKeyDown={(e) => { if (e.key === 'Enter') handleAddNote(); }}
        />
        <button 
          onClick={handleAddNote}
          disabled={isSubmitting || !noteText.trim()}
          className="px-4 py-2 bg-gray-900 text-white font-medium rounded-lg text-sm hover:bg-gray-800 transition-colors disabled:opacity-50 shrink-0"
        >
          Not Ekle
        </button>
      </div>
    </div>

    {/* TIMELINE (Collapsible or truncated) */}
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
        <Clock className="w-4 h-4" />
        Geçmiş Loglar & Notlar
      </h3>
      <div className="space-y-3">
        {selectedItem.last_outreach_action && (
          <div className="text-sm text-gray-600 flex items-center justify-between py-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-gray-400" />
              <span>
                Son Aksiyon: <span className="font-semibold text-gray-700">{selectedItem.last_outreach_action}</span>
              </span>
            </div>
            <span className="text-xs text-gray-400">
              {selectedItem.last_outreach_at ? new Date(selectedItem.last_outreach_at).toLocaleString('tr-TR') : ''}
            </span>
          </div>
        )}
        
        {selectedItem.notes && selectedItem.notes.length > 0 && (
          <div className="flex flex-col gap-2">
            {selectedItem.notes.slice().reverse().slice(0, 3).map((note: any, i: number) => (
              <div key={i} className="text-sm text-gray-600 flex items-start gap-2 py-2 border-b border-gray-100 last:border-0">
                <StickyNote className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-xs font-semibold text-gray-500 mb-0.5">{note.author}</div>
                  <div className="text-gray-800">{note.text}</div>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {note.created_at ? new Date(note.created_at).toLocaleString('tr-TR') : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {!selectedItem.last_outreach_action && (!selectedItem.notes || selectedItem.notes.length === 0) && (
          <div className="text-sm text-gray-400 italic text-center py-4">Henüz kayıtlı aksiyon veya not yok.</div>
        )}
      </div>
    </div>

            </div>
          </div>
        ) : (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <ClipboardList className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-1">Seçili Hasta Yok</h3>
        <p className="text-gray-500 text-sm">İşlem yapmak için sol taraftaki listeden bir hasta seçin.</p>
      </div>
    </div>
  )
}
      </div>
      
      {/* Form Details Drawer / Slide-Over */}
      {showFormDrawer && selectedItem && (
        <>
          <div 
            className="fixed inset-0 bg-black/20 z-40 transition-opacity" 
            onClick={() => setShowFormDrawer(false)}
          />
          <div className="fixed inset-y-0 right-0 w-full md:w-[450px] bg-white shadow-2xl z-50 border-l border-gray-200 flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                Form Bilgisi
              </h2>
              <button 
                onClick={() => setShowFormDrawer(false)}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
              >
                <XCircle className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-6">
                <div className="text-sm font-semibold text-gray-900 mb-1">Genel Bilgiler</div>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-500 text-xs">Form Adı</span>
                    <span className="text-gray-900 text-xs font-medium">{selectedItem.lead_raw_data?.form_name || selectedItem.metadata.opp_source || 'Bilinmiyor'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 text-xs">Hasta Adı</span>
                    <span className="text-gray-900 text-xs font-medium">{selectedItem.patient_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 text-xs">Telefon</span>
                    <span className="text-gray-900 text-xs font-medium">{selectedItem.phone_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 text-xs">Ülke</span>
                    <span className="text-gray-900 text-xs font-medium">{selectedItem.country || 'Bilinmiyor'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 text-xs">Departman</span>
                    <span className="text-gray-900 text-xs font-medium">{selectedItem.department || 'Bilinmiyor'}</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold text-gray-900 mb-2">Form Cevapları (Raw Data)</div>
                {selectedItem.lead_raw_data && Object.keys(selectedItem.lead_raw_data).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(selectedItem.lead_raw_data).map(([key, value]) => {
                      // Filter out empty or extremely long internal IDs if necessary
                      if (!value || typeof value !== 'string' || value.trim() === '') return null;
                      if (key.includes('id') && value.length > 30) return null; // skip long fb ids
                      
                      return (
                        <div key={key} className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
                          <div className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1">{key}</div>
                          <div className="text-sm text-gray-800 whitespace-pre-wrap">{value}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center p-6 bg-gray-50 rounded-lg border border-gray-100 border-dashed text-gray-400 text-sm">
                    Bu hastaya ait detaylı form cevabı bulunamadı.
                  </div>
                )}
              </div>
            </div>
            
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button 
                onClick={() => setShowFormDrawer(false)}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Kapat
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
