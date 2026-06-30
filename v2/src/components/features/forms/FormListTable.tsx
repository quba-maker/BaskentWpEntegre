"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, MessageCircle, Bot, StickyNote, CheckCircle2, XCircle } from "lucide-react";
import { getBestDate, getDisplayName, getAllPhones, getFormCountry, getStageInfo, STAGES } from "./utils";
import { formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

const BULK_SELECTION_LIMIT = 50;

// Simple outside click hook for dropdowns
function useDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);
  
  return { isOpen, setIsOpen, ref };
}

interface FormListTableProps {
  forms: any[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isReachingEnd: boolean;
  size: number;
  setSize: (size: number) => void;
  selectedLeadIds: string[];
  setSelectedLeadIds: (ids: string[]) => void;
  onSelectForm: (form: any) => void;
  onStageChange: (form: any, newStage: string) => void;
  onMessageClick: (form: any, e: React.MouseEvent) => void;
  onPrepareDraft: (form: any) => void;
  hasFiltersActive: boolean;
  hasError?: boolean;
  onRetry?: () => void;
}

export function FormListTable({
  forms,
  isLoading,
  isLoadingMore,
  isReachingEnd,
  size,
  setSize,
  selectedLeadIds,
  setSelectedLeadIds,
  onSelectForm,
  onStageChange,
  onMessageClick,
  onPrepareDraft,
  hasFiltersActive,
  hasError,
  onRetry
}: FormListTableProps) {
  const campDropdown = useDropdown();
  const stageDropdown = useDropdown();

  // Unique campaign list for filter header
  const uniqueCampaigns = Array.from(new Set(forms.map(f => f.form_name).filter(Boolean))) as string[];

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const selectableIds = forms
        .filter((f: any) => f.firstContactStatus === 'needs_greeting' && !f.noReplyFollowup?.is_no_reply_eligible)
        .map((f: any) => f.id)
        .slice(0, BULK_SELECTION_LIMIT);
      setSelectedLeadIds(selectableIds);
    } else {
      setSelectedLeadIds([]);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "";
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
  };

  const formatTime = (dateString?: string) => {
    if (!dateString) return "";
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
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
    'control_required': { label: 'Sync Dışı Sekme / Kontrol Gerekli', color: '#FF9500', icon: '🔍' },
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-white/40 backdrop-blur-xl border border-white/50 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-white/80 backdrop-blur-md z-10 border-b border-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <tr>
              <th className="py-3 px-4 w-12 text-center border-r border-black/5">
                <input 
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-[#007AFF] focus:ring-[#007AFF] cursor-pointer"
                  checked={forms.length > 0 && selectedLeadIds.length > 0 && selectedLeadIds.length === Math.min(BULK_SELECTION_LIMIT, forms.filter((f:any) => f.firstContactStatus === 'needs_greeting' && !f.noReplyFollowup?.is_no_reply_eligible).length)}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                />
              </th>
              <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Tarih</th>
              <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Hasta Adı & İletişim</th>
              <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Kampanya / Form</th>
              <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">Durum</th>
              <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase">İlk Temas</th>
              <th className="py-3 px-4 text-xs font-semibold text-[#86868B] tracking-wider uppercase text-right">Aksiyon</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {/* 1. Error State */}
            {hasError && (
              <tr>
                <td colSpan={7} className="py-12 text-center">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <XCircle className="w-8 h-8 text-rose-500" />
                    <p className="text-sm font-semibold text-rose-600">Veriler yüklenirken bir hata oluştu.</p>
                    {onRetry && (
                      <button 
                        onClick={onRetry}
                        className="mt-2 px-4 py-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-lg hover:bg-rose-100 transition-colors"
                      >
                        Yeniden Dene
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {/* 2. Loading / Skeleton Table State */}
            {!hasError && isLoading && forms.length === 0 && (
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} className="animate-pulse">
                  <td className="py-4 px-4 w-12 text-center border-r border-black/5">
                    <div className="w-4 h-4 bg-slate-200 rounded mx-auto" />
                  </td>
                  <td className="py-4 px-4">
                    <div className="w-16 h-3 bg-slate-200 rounded mb-1" />
                    <div className="w-10 h-2 bg-slate-200 rounded" />
                  </td>
                  <td className="py-4 px-4">
                    <div className="w-32 h-4 bg-slate-200 rounded mb-1.5" />
                    <div className="w-24 h-3 bg-slate-200 rounded" />
                  </td>
                  <td className="py-4 px-4">
                    <div className="w-28 h-5 bg-slate-200 rounded-lg" />
                  </td>
                  <td className="py-4 px-4">
                    <div className="w-20 h-5 bg-slate-200 rounded-md" />
                  </td>
                  <td className="py-4 px-4">
                    <div className="w-24 h-5 bg-slate-200 rounded-md" />
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="w-20 h-7 bg-slate-200 rounded-lg ml-auto" />
                  </td>
                </tr>
              ))
            )}

            {/* 3. Empty State */}
            {!hasError && !isLoading && forms.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-[#86868B] font-medium text-sm">
                  {hasFiltersActive ? "Filtrelere uygun kayıt bulunamadı." : "Henüz kayıt bulunmuyor."}
                </td>
              </tr>
            )}

            {/* 4. Normal Rows State */}
            {!hasError && forms.map((form: any) => {
              const displayName = getDisplayName(form);
              const bestDate = getBestDate(form);
              const allPhones = getAllPhones(form);
              const primaryPhone = allPhones[0] || form.phone_number;
              const extraPhones = allPhones.slice(1);
              const country = getFormCountry(form);
              const stageInfo = getStageInfo(form.stage);
              
              return (
                <tr 
                  key={form.id} 
                  onClick={() => onSelectForm(form)}
                  className="hover:bg-white/50 transition-colors group cursor-pointer"
                >
                  <td className="py-4 px-4 w-12 text-center border-r border-black/5" onClick={(e) => e.stopPropagation()}>
                    <input 
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300 text-[#007AFF] focus:ring-[#007AFF] disabled:opacity-50 cursor-pointer"
                      disabled={form.stage === 'quarantine' || form.firstContactStatus === 'control_required' || form.firstContactStatus !== 'needs_greeting' || form.noReplyFollowup?.is_no_reply_eligible}
                      checked={selectedLeadIds.includes(form.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (selectedLeadIds.length >= BULK_SELECTION_LIMIT) {
                            alert(`En fazla ${BULK_SELECTION_LIMIT} kişi seçebilirsiniz.`);
                            return;
                          }
                          setSelectedLeadIds([...selectedLeadIds, form.id]);
                        } else {
                          setSelectedLeadIds(selectedLeadIds.filter(id => id !== form.id));
                        }
                      }}
                    />
                  </td>
                  <td className="py-4 px-4 whitespace-nowrap">
                    <div className="text-[13px] font-semibold text-[#1D1D1F]">
                      {formatDate(bestDate)}
                    </div>
                    <div className="text-[11px] font-medium text-[#86868B] mt-0.5">
                      {formatTime(bestDate)}
                    </div>
                  </td>
                  <td className="py-4 px-4 min-w-[200px] max-w-[280px] whitespace-normal align-middle">
                    <div className="font-bold text-[14px] text-[#1D1D1F] flex flex-wrap items-center gap-1.5 leading-snug">
                      <span className="break-words whitespace-pre-wrap">
                        {displayName}
                      </span>
                      {country && (
                        <span 
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold text-[#86868B] shrink-0 border bg-slate-50 border-black/5"
                          title={country.isEstimated ? "Tahmini Ülke" : undefined}
                        >
                          {country.flag} {country.name}
                        </span>
                      )}
                      {form.isBotActive && (
                        <span className="px-1.5 py-0.5 shrink-0 bg-[#0F9D58]/10 text-[#0F9D58] border border-[#0F9D58]/20 rounded text-[10px] font-bold uppercase flex items-center gap-1" title="Bot İlgileniyor">
                          <Bot className="w-3 h-3 animate-pulse" /> Bot
                        </span>
                      )}
                      {form.notes && form.notes.trim() !== '' && (
                        <span className="px-1.5 py-0.5 shrink-0 bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/20 rounded text-[10px] font-bold uppercase flex items-center gap-1" title="Not Eklendi">
                          <StickyNote className="w-3 h-3" /> Notlu
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[12px] font-medium text-[#86868B]">{formatPhoneReadable(primaryPhone)}</span>
                      {extraPhones.length > 0 && (
                        <span 
                          className="text-[10px] font-bold text-[#007AFF] bg-[#007AFF]/10 px-1.5 py-0.5 rounded cursor-pointer hover:bg-[#007AFF]/20 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            alert(`Diğer numaralar:\n${extraPhones.map(formatPhoneReadable).join('\n')}`);
                          }}
                        >
                          +{extraPhones.length} numara
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-black/5 shadow-sm">
                      <span className="text-[12px] font-semibold text-[#1D1D1F] max-w-[150px] truncate" title={form.form_name}>
                        {form.form_name}
                      </span>
                    </div>
                  </td>
                  <td className="py-4 px-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <InlineStageSelector 
                      currentStage={form.stage} 
                      stageInfo={stageInfo}
                      onStageChange={(newStage) => onStageChange(form, newStage)}
                    />
                  </td>
                  <td className="py-4 px-4 whitespace-nowrap">
                    <div className="flex flex-col items-start gap-1">
                      {(() => {
                        const badgeKey = form.stage === 'quarantine' || form.firstContactStatus === 'control_required'
                          ? 'control_required'
                          : (form.noReplyFollowup?.is_no_reply_eligible ? 'no_reply_waiting' : form.firstContactStatus);
                        const badge = OUTREACH_BADGE_CONFIG[badgeKey];
                        if (!badge) return <span className="text-[11px] text-[#86868B] italic">—</span>;
                        return (
                          <span 
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border uppercase tracking-wide shadow-sm"
                            style={{ 
                              backgroundColor: `${badge.color}15`,
                              color: badge.color,
                              borderColor: `${badge.color}25`
                            }}
                          >
                            <span className="text-[11px]">{badge.icon}</span> {badge.label}
                          </span>
                        );
                      })()}

                      {form.autopilotDecision && (() => {
                        const getAutopilotBadge = (category: string) => {
                          switch (category) {
                            case 'bot_auto_eligible':
                              return { label: 'Bot Uygun', color: '#34C759', icon: '🤖' };
                            case 'manual_draft_required':
                              return { label: 'Taslak Gerekli', color: '#FF9500', icon: '✍️' };
                            case 'manual_template_required':
                              return { label: 'Şablon Gerekli', color: '#FFCC00', icon: '📄' };
                            case 'already_open_inbox':
                            case 'already_processed':
                              return { label: "Inbox'tan Devam", color: '#007AFF', icon: '💬' };
                            default:
                              return { label: 'Uygun Değil', color: '#FF3B30', icon: '🚫' };
                          }
                        };
                        const baseCat = form.autopilotDecision.baseCategory || form.autopilotDecision.category;
                        const apBadge = getAutopilotBadge(baseCat);
                        const gate = form.autopilotDecision.gateState;

                        const getGateBadge = (gState: string) => {
                          switch (gState) {
                            case 'live_locked':
                              return { label: 'Kilitli', icon: '🔒' };
                            case 'dry_run':
                              return { label: 'Dry-Run', icon: '🧪' };
                            case 'feature_disabled':
                              return { label: 'Ayar Kapalı', icon: '🔒' };
                            case 'allowlist_missing':
                              return { label: 'İzin Eksik', icon: '🔒' };
                            case 'global_disabled':
                              return { label: 'Kilit Kapalı', icon: '🔒' };
                            default:
                              return null;
                          }
                        };
                        const gateBadge = getGateBadge(gate);

                        const mapExactGateReason = (gateState: string, reason: string): string => {
                          const r = (reason || '').toLowerCase();
                          const g = (gateState || '').toLowerCase();

                          if (g === 'allowlist_missing' || r === 'tenant_not_allowlisted' || r === 'tenant_not_found') {
                            return 'tenant_not_allowlisted';
                          }
                          if (g === 'live_locked' || r === 'phase_lock_outbound_blocked' || r === 'phase_lock_enabled') {
                            return 'phase_lock_outbound_blocked';
                          }
                          if (g === 'global_disabled' || r === 'global_disabled') {
                            return 'global_disabled';
                          }
                          if (g === 'dry_run' || r === 'dry_run' || r === 'dry_run_enabled') {
                            return 'dry_run';
                          }
                          if (r === 'rollout_percentage_excluded' || r === 'rollout_excluded') {
                            return 'rollout_excluded';
                          }
                          if (r === 'department_not_allowed') {
                            return 'department_not_allowed';
                          }
                          if (r === 'meta_window_closed' || r === 'template_required' || r === 'template_not_available') {
                            return 'outside_24h_window';
                          }
                          if (r === 'not_whatsapp_channel' || r === 'invalid_phone' || r === 'invalid_phone/channel') {
                            return 'invalid_phone/channel';
                          }
                          
                          if (g === 'feature_disabled') return 'global_disabled';
                          
                          return reason || gateState || 'unknown_reason';
                        };

                        return (
                          <div className="flex flex-col items-start gap-1">
                            <div className="relative group inline-block">
                              <span 
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold border uppercase tracking-wider shadow-sm cursor-help transition-all hover:scale-[1.02]"
                                style={{ 
                                  backgroundColor: `${apBadge.color}15`,
                                  color: apBadge.color,
                                  borderColor: `${apBadge.color}25`
                                }}
                              >
                                <span className="text-[10px]">{apBadge.icon}</span> {apBadge.label}
                              </span>
                              
                              {/* CSS Hover Tooltip */}
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-56 p-2.5 bg-slate-900 text-white text-[10px] font-semibold rounded-lg shadow-lg z-50 text-center leading-normal break-words whitespace-normal border border-white/10">
                                <div className="font-bold border-b border-white/10 pb-1 mb-1">{apBadge.label} Durumu</div>
                                <div className="text-gray-300 font-medium">{form.autopilotDecision.userFriendlyReason || 'Uyum durumu hesaplanamadı.'}</div>
                                {gate && gate !== 'open' && (
                                  <div className="mt-1.5 pt-1.5 border-t border-white/10 text-[9px] text-orange-400 font-bold uppercase tracking-wider flex items-center justify-center gap-1">
                                    <span>⚠️</span> Canlı Mesaj Gönderimi Devre Dışı
                                  </div>
                                )}
                                {/* Tooltip Arrow */}
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                              </div>
                            </div>

                            {gateBadge && (
                              <div className="relative group inline-block mt-0.5">
                                <span 
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase tracking-wider text-slate-500 bg-slate-100 border-slate-200 cursor-help transition-all hover:scale-[1.02]"
                                >
                                  <span className="text-[9px]">{gateBadge.icon}</span> {gateBadge.label}
                                </span>
                                {/* Exact Reason Tooltip */}
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-slate-950 text-white text-[9px] font-bold rounded shadow-lg z-50 text-center leading-normal border border-white/5">
                                  <div className="text-gray-400 font-semibold mb-0.5">Kilit Gerekçesi</div>
                                  <div className="text-orange-400 font-extrabold font-mono tracking-wider break-all">
                                    {mapExactGateReason(gate, form.autopilotDecision.reason)}
                                  </div>
                                  {/* Tooltip Arrow */}
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-950" />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                  <td className="py-4 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      let label = 'Detay';
                      let btnClass = "bg-white border border-black/5 hover:bg-black/5 text-[#1D1D1F]";
                      
                      const isNoReply = form.noReplyFollowup?.is_no_reply_eligible;
                      
                      if (form.stage === 'quarantine' || form.firstContactStatus === 'control_required') {
                        label = 'Kontrol Gerekli';
                        btnClass = "bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed opacity-60";
                      } else if (isNoReply) {
                        label = 'Inbox’a Git';
                        btnClass = "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100";
                      } else {
                        switch (form.firstContactStatus) {
                          case 'needs_greeting':
                            label = 'WhatsApp’ta Karşıla';
                            btnClass = "bg-[#25D366]/10 border border-[#25D366]/20 text-[#25D366] hover:bg-[#25D366]/20";
                            break;
                          case 'waiting_inbox_reply':
                            label = 'Inbox’ta Karşıla';
                            btnClass = "bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100";
                            break;
                          case 'whatsapp_opened':
                            label = 'Tekrar Aç';
                            btnClass = "bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100";
                            break;
                          case 'manual_greeting_confirmed':
                          case 'inbox_greeting_sent':
                            label = 'Mesaja Git';
                            btnClass = "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100";
                            break;
                          case 'patient_replied':
                            label = 'Inbox’a Git';
                            btnClass = "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100";
                            break;
                        }
                      }

                      return (
                        <button 
                          disabled={form.stage === 'quarantine' || form.firstContactStatus === 'control_required'}
                          onClick={(e) => {
                            if (['Inbox’ta Karşıla', 'Mesaja Git', 'Inbox’a Git'].includes(label)) {
                              onMessageClick(form, e);
                            } else {
                              onPrepareDraft(form);
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg shadow-sm transition-all text-[11px] font-bold ${btnClass}`}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span>{label}</span>
                        </button>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {/* Footer / Load More */}
      <div className="p-3 border-t border-black/5 bg-white/40 flex justify-center shrink-0">
        {!isReachingEnd && forms.length > 0 && (
          <button
            onClick={() => setSize(size + 1)}
            disabled={isLoadingMore}
            className="px-6 py-2 text-sm font-semibold text-[#007AFF] bg-white border border-[#007AFF]/20 rounded-full shadow-sm hover:bg-[#007AFF]/5 transition-all disabled:opacity-50"
          >
            {isLoadingMore ? "Yükleniyor..." : "Daha Fazla Kayıt Yükle"}
          </button>
        )}
        {isReachingEnd && forms.length > 0 && (
          <span className="text-[12px] font-medium text-[#86868B]">Tüm kayıtlar yüklendi.</span>
        )}
      </div>
    </div>
  );
}

// Inline Stage Selector Component
function InlineStageSelector({ currentStage, stageInfo, onStageChange }: { 
  currentStage: string; 
  stageInfo: { value: string; label: string; color: string };
  onStageChange: (stage: string) => void;
}) {
  const dropdown = useDropdown();
  
  return (
    <div ref={dropdown.ref} className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); dropdown.setIsOpen(!dropdown.isOpen); }}
        className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border transition-all hover:shadow-sm cursor-pointer"
        style={{
          backgroundColor: `${stageInfo.color}12`,
          borderColor: `${stageInfo.color}25`,
          color: stageInfo.color
        }}
      >
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stageInfo.color }} />
        {stageInfo.label}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      
      {dropdown.isOpen && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-black/5 py-1 z-50">
          {STAGES.map(s => (
            <button
              key={s.value}
              onClick={() => { onStageChange(s.value); dropdown.setIsOpen(false); }}
              className={`w-full text-left px-3 py-2 text-[12px] font-medium hover:bg-black/5 transition-colors flex items-center gap-2`}
              style={{ color: s.color }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
              {currentStage === s.value && <CheckCircle2 className="w-3.5 h-3.5 ml-auto text-indigo-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
