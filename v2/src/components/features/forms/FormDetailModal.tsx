"use client";

import { useState } from "react";
import { X, Send, Save, RefreshCw, Phone, PhoneOff, PhoneForwarded, XCircle, ChevronDown, MessageCircle, Calendar, Bot, StickyNote, Sparkles, Clock, CheckCheck, User, MapPin, Building2, Flame, TrendingUp } from "lucide-react";
import { FormDetailViewer } from "@/components/shared/form-detail-viewer/FormDetailViewer";
import { UniversalFormDetailData } from "@/components/shared/form-detail-viewer/types";
import { extractFormFields } from "@/lib/utils/form-field-extractor";
import { getBestDate, getDisplayName, getAllPhones, getFormCountry, STAGES } from "./utils";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

interface FormDetailModalProps {
  form: any;
  onClose: () => void;
  // Detail State Custom Hook Props
  selectedPhone: string;
  setSelectedPhone: (val: string) => void;
  detailData: any;
  detailLoading: boolean;
  outreachTimeline: any[];
  outreachLoading: 'draft' | 'sending' | 'bot' | 'call_action' | null;
  setOutreachLoading: (val: any) => void;
  outreachError: string | null;
  setOutreachError: (val: string | null) => void;
  outreachSuccess: string | null;
  setOutreachSuccess: (val: string | null) => void;
  greetingSent: boolean;
  setGreetingSent: (val: boolean) => void;
  draftMessage: string | null;
  setDraftMessage: (val: string | null) => void;
  isDraftOpen: boolean;
  setIsDraftOpen: (val: boolean) => void;
  templates: any[];
  selectedTemplateId: string | null;
  setSelectedTemplateId: (val: string | null) => void;
  callActionNote: string;
  setCallActionNote: (val: string) => void;
  showCallActions: boolean;
  setShowCallActions: (val: boolean) => void;
  botNote: string;
  setBotNote: (val: string) => void;
  readiness: any;
  readinessLoading: boolean;
  techOpen: boolean;
  setTechOpen: (val: boolean) => void;
  draftSuccessTemp: boolean;
  tenantSlug: string;
  returnParams: string;
  // Callback Handlers
  onPrepareDraft: (form: any) => void;
  onConfirmSend: (form: any) => void;
  onOpenWhatsAppApp: (form: any) => void;
  onSaveInternal: (form: any) => void;
  onCancelDraft: () => void;
  onCallAction: (action: 'reached' | 'missed' | 'callback' | 'not_interested', form: any) => void;
  onTemplateSelect: (templateId: string) => void;
  onOutreachBotActivate: (form: any) => void;
  onNotesSave: (notes: string) => void;
  onStageChange: (form: any, stage: string) => void;
}

export function FormDetailModal({
  form,
  onClose,
  selectedPhone,
  setSelectedPhone,
  detailData,
  detailLoading,
  outreachTimeline,
  outreachLoading,
  setOutreachLoading,
  outreachError,
  setOutreachError,
  outreachSuccess,
  setOutreachSuccess,
  greetingSent,
  setGreetingSent,
  draftMessage,
  setDraftMessage,
  isDraftOpen,
  setIsDraftOpen,
  templates,
  selectedTemplateId,
  setSelectedTemplateId,
  callActionNote,
  setCallActionNote,
  showCallActions,
  setShowCallActions,
  botNote,
  setBotNote,
  readiness,
  readinessLoading,
  techOpen,
  setTechOpen,
  draftSuccessTemp,
  tenantSlug,
  returnParams,
  onPrepareDraft,
  onConfirmSend,
  onOpenWhatsAppApp,
  onSaveInternal,
  onCancelDraft,
  onCallAction,
  onTemplateSelect,
  onOutreachBotActivate,
  onNotesSave,
  onStageChange
}: FormDetailModalProps) {
  const [modalNotes, setModalNotes] = useState(form.notes || "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [activeOutreachTab, setActiveOutreachTab] = useState<'ai_draft' | 'template'>('ai_draft');

  const formExtraction = extractFormFields(form.raw_data);
  const displayName = getDisplayName(form);
  const bestDate = getBestDate(form);
  const allPhones = getAllPhones(form);
  const primaryPhone = allPhones[0] || form.phone_number;
  const country = getFormCountry(form);

  const entries = Object.entries(form.raw_data || {});
  const isTechnicalKey = (key: string): boolean => {
    const k = key.toLowerCase();
    return (
      k === 'id' || k === 'leadgen_id' || k === 'form_id' || k === 'ad_id' || k === 'adset_id' || k === 'campaign_id' ||
      k === 'platform' || k === 'is_organic' || k === 'created_time' || k === 'phone_number_id' ||
      k === 'ad_name' || k === 'adset_name' || k === 'campaign_name' || k.startsWith('_') ||
      k.includes('campaign') || k.includes('adset') || k.includes('ad_') ||
      k.includes('phone') || k.includes('tel') || k.includes('whatsapp') || k === 'numara' || k.includes('cep') ||
      k.includes('email') || k.includes('e-posta') || k.includes('eposta') || k.includes('mail')
    );
  };
  const operationalEntries = entries.filter(([k]) => !isTechnicalKey(k));
  const technicalEntries = entries.filter(([k]) => isTechnicalKey(k));

  // Build the UniversalFormDetailData object
  const detailDataMapped: UniversalFormDetailData = {
    id: String(form.id),
    identity: {
      name: displayName,
      phoneNumbers: allPhones,
      primaryPhone: primaryPhone,
      email: form.email,
      country: country
    },
    source: {
      platform: form.form_name.toLowerCase().includes("facebook") ? "Facebook" : form.form_name.toLowerCase().includes("instagram") ? "Instagram" : "Form",
      formName: form.form_name,
      submittedAt: bestDate
    },
    content: {
      complaint: formExtraction.complaint || form.raw_data?.complaint || form.raw_data?.sikayet || null,
      appointmentPreference: formExtraction.appointmentPref || form.raw_data?.appointment_pref || form.raw_data?.randevu_tercihi || null,
      reportStatus: formExtraction.reportStatus || null,
      department: form.current_department || formExtraction.department || null,
      userAnswers: operationalEntries.map(([k, v]) => ({ key: k, label: k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()), value: String(v) })),
      techMetadata: technicalEntries.map(([k, v]) => ({ key: k, label: k, value: String(v) }))
    },
    ai: {
      summary: detailData?.ai_summary || null
    }
  };

  const OUTREACH_BADGE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
    'needs_greeting': { label: 'Karşılama Bekliyor', color: '#FF9500', icon: '👋' },
    'waiting_inbox_reply': { label: 'Panelden Cevap Bekliyor', color: '#5856D6', icon: '💬' },
    'whatsapp_opened': { label: 'WhatsApp’ta Açıldı', color: '#007AFF', icon: '📲' },
    'manual_greeting_confirmed': { label: 'Manuel Gönderildi', color: '#34C759', icon: '✅' },
    'inbox_greeting_sent': { label: 'Panelden Gönderildi', color: '#34C759', icon: '✅' },
    'patient_replied': { label: 'Cevap Geldi', color: '#10B981', icon: '↩️' },
    'blocked_or_invalid': { label: 'Sorunlu', color: '#FF3B30', icon: '⚠️' },
    'out_of_scope': { label: 'Kapsam Dışı', color: '#8E8E93', icon: '⛔' },
    'no_reply_waiting': { label: 'Cevap Bekleniyor', color: '#FF3B30', icon: '⏳' },
  };

  const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
    'hot': { label: 'SICAK', color: '#FF3B30', icon: '🔥' },
    'warm': { label: 'ILIK', color: '#FF9500', icon: '🟡' },
    'cold': { label: 'SOĞUK', color: '#007AFF', icon: '🔵' },
  };

  const OPP_STAGES: { value: string; label: string; color: string; icon: string }[] = [
    { value: 'new_lead', label: 'Yeni', color: '#007AFF', icon: '🆕' },
    { value: 'first_contact', label: 'İlk İletişim', color: '#FF9500', icon: '📞' },
    { value: 'engaged', label: 'Cevap Alındı', color: '#34C759', icon: '💬' },
    { value: 'discovery', label: 'Keşif/Analiz', color: '#5856D6', icon: '🔍' },
    { value: 'qualified', label: 'Nitelikli', color: '#30B0C7', icon: '⭐' },
    { value: 'phone_call_planning', label: 'Telefon Görüşmesi Planlanıyor', color: '#AF52DE', icon: '📞' },
    { value: 'appointment_planning', label: 'Randevu Planlanıyor', color: '#FFD60A', icon: '📅' },
    { value: 'appointment_booked', label: 'Randevu Alındı', color: '#0F9D58', icon: '✅' },
    { value: 'arrived', label: 'Geldi', color: '#0F9D58', icon: '🏥' },
    { value: 'not_qualified', label: 'Uygun Değil', color: '#8E8E93', icon: '🚫' },
  ];

  const getOppStageInfo = (stage: string) => OPP_STAGES.find(s => s.value === stage) || { value: stage, label: stage, color: '#86868B', icon: '❓' };

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity animate-in fade-in"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
        <div className="w-full max-w-[650px] bg-[#F5F5F7] rounded-[28px] shadow-[0_20px_40px_rgba(0,0,0,0.2)] flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200 pointer-events-auto border border-white/20">
          
          {/* Header */}
          <div className="px-6 py-5 bg-white border-b border-black/5 flex items-center justify-between shrink-0 rounded-t-[28px]">
            <div className="pr-4 w-full">
              <h2 className="text-xl font-bold text-[#1D1D1F] flex flex-wrap items-center gap-2 leading-snug">
                <span className="break-words whitespace-pre-wrap max-w-full">{displayName}</span>
                {country && (
                  <span 
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[12px] font-semibold shrink-0"
                    style={{
                      color: '#86868B',
                      backgroundColor: country.isEstimated ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.04)',
                      border: country.isEstimated ? '1px dashed rgba(0,0,0,0.1)' : 'none'
                    }}
                  >
                    {country.flag} {country.name}
                  </span>
                )}
              </h2>
              <p className="text-[#86868B] text-sm font-medium mt-1 break-words">{formatPhoneReadable(form.phone_number)}</p>
            </div>
            <button 
              onClick={onClose}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-black/5 hover:bg-black/10 transition-colors"
            >
              <X className="w-5 h-5 text-[#1D1D1F]" />
            </button>
          </div>

          {/* Content (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
            
            {/* Phone Selection Card */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-4 space-y-2.5 text-left">
              <span className="block text-[10px] font-bold uppercase tracking-widest text-[#86868B] mb-1">Telefon Numaraları</span>
              <div className="space-y-2">
                {allPhones.map((phone, idx) => {
                  const isRecommended = readiness?.recommendedPhone?.phone === phone || (idx === 0 && !readiness?.recommendedPhone);
                  const isSelected = selectedPhone === phone;
                  const pInfo = readiness?.phones?.find((p: any) => p.phone === phone);
                  
                  let statusBadge = null;
                  if (pInfo) {
                    if (pInfo.hasInbound) {
                      statusBadge = <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 uppercase tracking-wide">↩️ Cevap</span>;
                    } else if (pInfo.hasManualGreetingConfirmed || pInfo.hasInboxGreetingSent || pInfo.hasApiGreetingSent) {
                      statusBadge = <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 uppercase tracking-wide">✅ İletişim</span>;
                    } else if (pInfo.hasWhatsappAppOpened) {
                      statusBadge = <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 uppercase tracking-wide">📲 Açıldı</span>;
                    }
                  }

                  return (
                    <label 
                      key={phone} 
                      className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all ${
                        isSelected 
                          ? 'border-[#007AFF] bg-[#007AFF]/5 shadow-sm' 
                          : 'border-black/5 hover:bg-black/[0.02]'
                      }`}
                      onClick={() => setSelectedPhone(phone)}
                    >
                      <div className="flex items-center gap-2">
                        <input 
                          type="radio" 
                          name="selected_phone" 
                          checked={isSelected}
                          onChange={() => setSelectedPhone(phone)}
                          className="w-3.5 h-3.5 text-[#007AFF] focus:ring-[#007AFF]" 
                        />
                        <span className="font-semibold text-[13.5px] text-[#1D1D1F]">
                          {formatPhoneReadable(phone)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-semibold">
                        {statusBadge}
                        {isRecommended && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase tracking-wider">
                            Önerilen
                          </span>
                        )}
                        <span className="text-[9.5px] font-medium text-[#86868B]">
                          {idx === 0 ? 'Birincil' : 'İkincil'}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Outreach Action Controls */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-black/5 bg-gradient-to-r from-[#25D366]/5 to-[#007AFF]/5">
                <h3 className="text-sm font-bold text-[#1D1D1F] flex items-center gap-2">
                  <Send className="w-4 h-4 text-[#25D366]" />
                  İlk İletişim (Outreach)
                </h3>
              </div>

              <div className="flex border-b border-black/5 bg-black/[0.02] p-1 gap-1">
                <button
                  onClick={() => {
                    setActiveOutreachTab('ai_draft');
                    onCancelDraft();
                  }}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold text-center transition-all cursor-pointer ${
                    activeOutreachTab === 'ai_draft'
                      ? 'bg-white text-[#007AFF] shadow-sm'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  🤖 Yapay Zeka Taslağı
                </button>
                <button
                  onClick={() => {
                    setActiveOutreachTab('template');
                    onCancelDraft();
                  }}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold text-center transition-all cursor-pointer ${
                    activeOutreachTab === 'template'
                      ? 'bg-white text-[#007AFF] shadow-sm'
                      : 'text-[#86868B] hover:text-[#1D1D1F]'
                  }`}
                >
                  📄 Hazır Şablon Seç
                </button>
              </div>

              <div className="p-4 space-y-3">
                {(() => {
                  const currentStatus = readiness?.patientLevelStatus || form.firstContactStatus;
                  const badge = OUTREACH_BADGE_CONFIG[currentStatus];
                  
                  return (
                    <div className="space-y-3">
                      {badge && (
                        <div className="text-left space-y-1.5 p-3 bg-black/[0.02] border border-black/[0.04] rounded-xl shadow-sm">
                          <span 
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border uppercase"
                            style={{ 
                              backgroundColor: `${badge.color}15`,
                              color: badge.color,
                              borderColor: `${badge.color}30`
                            }}
                          >
                            {badge.icon} {badge.label}
                          </span>
                        </div>
                      )}

                      {outreachError && (
                        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px] font-medium flex items-center gap-2">
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          {outreachError}
                        </div>
                      )}
                      {outreachSuccess && (
                        <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12px] font-medium flex items-center gap-2">
                          <CheckCheck className="w-3.5 h-3.5 shrink-0" />
                          {outreachSuccess}
                        </div>
                      )}

                      {activeOutreachTab === 'ai_draft' ? (
                        <div className="space-y-3">
                          {isDraftOpen && draftMessage !== null ? (
                            <div className="space-y-3">
                              <textarea
                                value={draftMessage}
                                onChange={(e) => setDraftMessage(e.target.value)}
                                rows={5}
                                className="w-full border border-black/10 rounded-xl p-3 text-[13px] text-[#1D1D1F] font-medium resize-none outline-none transition-all leading-relaxed bg-white focus:ring-2 focus:ring-[#25D366]/40 focus:border-[#25D366]/30"
                              />
                              <div className="space-y-1 text-left">
                                <label className="block text-[10.5px] font-bold text-[#86868B] uppercase tracking-wider">
                                  🤖 Bota kısa not/direktif ekle (opsiyonel)
                                </label>
                                <input
                                  type="text"
                                  value={botNote}
                                  onChange={(e) => setBotNote(e.target.value)}
                                  placeholder="Örn: Geliş tarihini netleştir..."
                                  className="w-full bg-[#F5F5F7] border border-black/10 rounded-xl px-3 py-2 text-[12px] text-[#1D1D1F] font-medium outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all"
                                />
                              </div>
                              <div className="space-y-2 pt-3 border-t border-black/5">
                                <button 
                                  onClick={() => onOpenWhatsAppApp(form)}
                                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold bg-[#25D366] hover:bg-[#1DA851] text-white shadow-[0_4px_14px_rgba(37,211,102,0.39)] transition-all cursor-pointer"
                                >
                                  <Send className="w-4 h-4" /> WhatsApp Uygulamasında Aç
                                </button>
                                <button 
                                  onClick={() => onSaveInternal(form)}
                                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold bg-[#007AFF]/10 text-[#007AFF] hover:bg-[#007AFF]/20 cursor-pointer transition-all"
                                >
                                  {outreachLoading === 'sending' ? (
                                    <><RefreshCw className="w-4 h-4 animate-spin" /> Kaydediliyor...</>
                                  ) : (
                                    <><Save className="w-4 h-4" /> Taslağı Kaydet</>
                                  )}
                                </button>
                                <button 
                                  onClick={onCancelDraft}
                                  className="w-full py-2.5 rounded-xl text-[13px] font-bold bg-black/[0.04] hover:bg-black/[0.08] text-[#1D1D1F] transition-colors cursor-pointer"
                                >
                                  İptal
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="pt-2">
                              <button
                                onClick={() => onPrepareDraft(form)}
                                disabled={outreachLoading === 'draft' || draftSuccessTemp}
                                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold text-white transition-all cursor-pointer ${
                                  draftSuccessTemp 
                                    ? 'bg-[#0F9D58] shadow-[0_4px_14px_rgba(15,157,88,0.39)] hover:bg-[#0F9D58]' 
                                    : 'bg-[#25D366] hover:bg-[#1DA851] shadow-[0_4px_14px_rgba(37,211,102,0.39)]'
                                }`}
                              >
                                {outreachLoading === 'draft' ? (
                                  <>
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                    Taslak hazırlanıyor...
                                  </>
                                ) : draftSuccessTemp ? (
                                  <>
                                    <CheckCheck className="w-4 h-4" />
                                    Taslak hazırlandı
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="w-4 h-4" />
                                    Karşılama Taslağı Hazırla
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-[#86868B] shrink-0">Şablon Seç:</span>
                            <select
                              value={selectedTemplateId || ''}
                              onChange={(e) => onTemplateSelect(e.target.value)}
                              className="flex-1 text-[12px] font-medium bg-[#F5F5F7] border border-black/10 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all cursor-pointer appearance-none"
                            >
                              <option value="" disabled>Şablon seçin…</option>
                              {templates.map((tpl: any) => (
                                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                              ))}
                            </select>
                          </div>

                          {draftMessage !== null && (
                            <div className="space-y-3">
                              <textarea
                                value={draftMessage}
                                readOnly
                                rows={5}
                                className="w-full border border-black/10 rounded-xl p-3 text-[13px] text-[#1D1D1F] font-medium resize-none outline-none leading-relaxed bg-[#F5F5F7] opacity-80"
                              />
                              
                              <div className="space-y-2 pt-3 border-t border-black/5">
                                <button 
                                  onClick={() => onOpenWhatsAppApp(form)}
                                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold bg-[#25D366] hover:bg-[#1DA851] text-white shadow-[0_4px_14px_rgba(37,211,102,0.39)] transition-all cursor-pointer"
                                >
                                  <Send className="w-4 h-4" /> WhatsApp Uygulamasında Aç
                                </button>
                                
                                <button
                                  disabled
                                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold bg-gray-100 text-gray-400 cursor-not-allowed opacity-60"
                                >
                                  <Send className="w-4 h-4" /> Panelden Gönder (Devre Dışı)
                                </button>
                                <p className="text-[10.5px] text-[#86868B] font-medium text-center italic">
                                  Panelden şablon gönderimi bu sürümde aktif değildir. Lütfen WhatsApp ile manuel gönderin.
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Call actions collapsed drawer */}
                {!isDraftOpen && (
                  <div className="space-y-2 pt-2">
                    <button
                      onClick={() => setShowCallActions(!showCallActions)}
                      className="w-full flex items-center justify-center gap-2 py-2 bg-black/[0.03] hover:bg-black/[0.06] rounded-xl text-[12px] font-semibold text-[#86868B] transition-colors cursor-pointer"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      {showCallActions ? 'Arama Aksiyonlarını Gizle' : 'Arama Aksiyonları'}
                      <ChevronDown className={`w-3 h-3 transition-transform ${showCallActions ? 'rotate-180' : ''}`} />
                    </button>
                    {showCallActions && (
                      <div className="space-y-2 animate-in slide-in-from-top-1 duration-150">
                        <input
                          type="text"
                          value={callActionNote}
                          onChange={(e) => setCallActionNote(e.target.value)}
                          placeholder="Kısa not (opsiyonel)…"
                          className="w-full bg-[#F5F5F7] border border-black/10 rounded-lg px-3 py-2 text-[12px] text-[#1D1D1F] font-medium outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => onCallAction('reached', form)}
                            className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-[#0F9D58]/10 text-[#0F9D58] border border-[#0F9D58]/20 hover:bg-[#0F9D58]/20 transition-all cursor-pointer"
                          >
                            <Phone className="w-3.5 h-3.5" /> Ulaşıldı
                          </button>
                          <button
                            onClick={() => onCallAction('missed', form)}
                            className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-[#FF9500]/10 text-[#FF9500] border border-[#FF9500]/20 hover:bg-[#FF9500]/20 transition-all cursor-pointer"
                          >
                            <PhoneOff className="w-3.5 h-3.5" /> Ulaşılamadı
                          </button>
                          <button
                            onClick={() => onCallAction('callback', form)}
                            className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-[#5856D6]/10 text-[#5856D6] border border-[#5856D6]/20 hover:bg-[#5856D6]/20 transition-all cursor-pointer"
                          >
                            <PhoneForwarded className="w-3.5 h-3.5" /> Geri Arama
                          </button>
                          <button
                            onClick={() => {
                              if (!window.confirm('Bu lead "İlgilenmiyor" olarak işaretlenecek ve takip süreci kapatılacak. Emin misiniz?')) return;
                              onCallAction('not_interested', form);
                            }}
                            className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold bg-[#FF3B30]/10 text-[#FF3B30] border border-[#FF3B30]/20 hover:bg-[#FF3B30]/20 transition-all cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" /> İlgilenmiyor
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Operations links */}
                {!isDraftOpen && (
                  <div className="pt-3 border-t border-black/5 space-y-2">
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-[#86868B] mb-1 text-center">
                      Operasyonel Yönlendirmeler
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      {form.linked_conversation_id ? (
                        <a
                          href={`/${tenantSlug}/inbox?phone=${selectedPhone || form.phone_number}&${returnParams}`}
                          className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-blue-200 bg-blue-50/30 text-blue-600 text-center transition-all duration-200 hover:bg-blue-50 active:scale-[0.98] cursor-pointer"
                        >
                          <MessageCircle className="w-4 h-4 mb-1 text-[#25D366]" />
                          <span className="text-[9px] font-bold leading-tight">Konuşmaya Git</span>
                        </a>
                      ) : (
                        <button
                          disabled
                          title="Sohbet bulunamadı."
                          className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-400 text-center cursor-not-allowed opacity-60 animate-none"
                        >
                          <MessageCircle className="w-4 h-4 mb-1" />
                          <span className="text-[9px] font-bold leading-tight">Sohbet Yok</span>
                        </button>
                      )}

                      {form.linked_opportunity_id ? (
                        <a
                          href={`/${tenantSlug}/takip?tab=telefon&opp=${form.linked_opportunity_id}&${returnParams}`}
                          className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-indigo-200 bg-indigo-50/30 text-indigo-600 text-center transition-all duration-200 hover:bg-indigo-50 active:scale-[0.98]"
                        >
                          <PhoneForwarded className="w-4 h-4 mb-1" />
                          <span className="text-[9px] font-bold leading-tight">Telefon Takibi</span>
                        </a>
                      ) : (
                        <button
                          disabled
                          title="Fırsat (opportunity) kaydı bulunmamaktadır."
                          className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-400 text-center cursor-not-allowed opacity-60"
                        >
                          <PhoneForwarded className="w-4 h-4 mb-1" />
                          <span className="text-[9px] font-bold leading-tight">Fırsat Yok</span>
                        </button>
                      )}

                      {form.linked_opportunity_id ? (
                        <a
                          href={`/${tenantSlug}/takip?tab=randevu&opp=${form.linked_opportunity_id}&${returnParams}`}
                          className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/30 text-emerald-600 text-center transition-all duration-200 hover:bg-emerald-50 active:scale-[0.98]"
                        >
                          <Calendar className="w-4 h-4 mb-1" />
                          <span className="text-[9px] font-bold leading-tight">Randevu Planla</span>
                        </a>
                      ) : (
                        <button
                          disabled
                          title="Fırsat (opportunity) kaydı bulunmamaktadır."
                          className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-400 text-center cursor-not-allowed opacity-60"
                        >
                          <Calendar className="w-4 h-4 mb-1" />
                          <span className="text-[9px] font-bold leading-tight">Fırsat Yok</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* AI Summary / Notes */}
            <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-[#1D1D1F] flex items-center gap-2">
                  <Bot className="w-4 h-4 text-[#0F9D58]" /> 
                  Görüşme Notları & AI Özeti
                </h3>
                <button 
                  onClick={async () => {
                    setIsSavingNotes(true);
                    await onNotesSave(modalNotes);
                    setIsSavingNotes(false);
                  }}
                  disabled={isSavingNotes}
                  className="text-[#007AFF] text-xs font-bold uppercase tracking-wider hover:text-[#0056b3] transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  <Save className="w-3 h-3" />
                  {isSavingNotes ? "Kaydediliyor..." : "Kaydet"}
                </button>
              </div>
              <textarea 
                value={modalNotes}
                onChange={(e) => setModalNotes(e.target.value)}
                placeholder="Botun görüşme özeti buraya düşer veya manuel olarak kendi satış notlarınızı alabilirsiniz..."
                className="w-full h-28 bg-[#F5F5F7] border-none rounded-xl p-3 text-sm text-[#1D1D1F] placeholder:text-[#86868B] focus:ring-2 focus:ring-[#007AFF]/40 resize-none outline-none transition-all"
              />

              {detailLoading ? (
                <div className="flex items-center justify-center py-4 bg-slate-50 border border-black/5 rounded-xl animate-pulse">
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-400 mr-2" />
                  <span className="text-xs text-slate-500 font-medium">Özet yükleniyor...</span>
                </div>
              ) : (
                <>
                  {detailData?.ai_summary && (
                    <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] backdrop-blur-md relative overflow-hidden transition-all duration-300 shadow-sm text-left">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> Yapay Zeka Önerisi
                        </span>
                      </div>
                      <p className="text-[12px] text-emerald-950 font-medium leading-relaxed italic mb-3">
                        "{detailData.ai_summary}"
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          setModalNotes(detailData.ai_summary);
                          setIsSavingNotes(true);
                          await onNotesSave(detailData.ai_summary);
                          setIsSavingNotes(false);
                        }}
                        className="w-full py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white transition-all flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
                      >
                        Nota Aktar ve Kaydet
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Live opportunity details */}
            {detailData && (detailData.current_priority || detailData.current_intent_type || detailData.current_travel_date) && (
              <div className="bg-white rounded-2xl p-5 border border-black/5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-4 h-4 text-[#007AFF]" />
                  <h3 className="text-sm font-bold text-[#1D1D1F]">Güncel Takip Bilgisi</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {detailData.current_travel_date && (
                    <div>
                      <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider flex items-center gap-1"><Calendar className="w-3 h-3" /> Geliş Tarihi</p>
                      <p className="text-[14px] font-semibold text-[#1D1D1F] mt-1">
                        {new Date(detailData.current_travel_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                    </div>
                  )}
                  {detailData.current_priority && (() => {
                    const p = PRIORITY_CONFIG[detailData.current_priority];
                    return p ? (
                      <div>
                        <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider flex items-center gap-1"><Flame className="w-3 h-3" /> Öncelik</p>
                        <p className="text-[14px] font-bold mt-1" style={{ color: p.color }}>{p.icon} {p.label}</p>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            )}

            {/* Master Universal Viewer */}
            <FormDetailViewer data={detailDataMapped} />

            {/* Timeline */}
            {outreachTimeline.length > 0 && (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm px-5 py-3 text-left">
                <h4 className="text-[11px] font-bold text-[#86868B] uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Outreach Geçmişi
                </h4>
                <div className="space-y-2.5">
                  {outreachTimeline.map((entry) => {
                    const badgeInfo = OUTREACH_BADGE_CONFIG[entry.action];
                    const dotColor = badgeInfo?.color || '#86868B';
                    const displayLabel = badgeInfo 
                      ? `${badgeInfo.icon} ${badgeInfo.label}` 
                      : entry.action;
                    return (
                      <div key={entry.id} className="flex items-start gap-2.5">
                        <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: dotColor }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-[#1D1D1F]">
                            {displayLabel}
                          </p>
                          <p className="text-[11px] text-[#86868B] font-medium mt-0.5">
                            {entry.actor_name} · {new Date(entry.created_at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </>
  );
}
