"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { 
  getPendingDrafts, 
  getDraftApprovalStats, 
  updateDraftText, 
  markDraftApproved, 
  markDraftRejected, 
  markDraftCopied,
  type DraftRow 
} from "@/app/actions/draft-approval";
import { 
  CheckSquare, 
  Bot, 
  Clock, 
  Sparkles, 
  Copy, 
  Check, 
  X, XCircle, 
  Search, 
  Filter, 
  AlertTriangle, 
  FileText, 
  ExternalLink, 
  MessageSquare, 
  Undo2,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
  User,
  Activity,
  AlertCircle
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { resolvePatientDisplayName, formatPhoneReadable } from "@/lib/utils/patient-name-resolver";

export default function DraftApprovalCenterPage() {
  const params = useParams();
  const tenantSlug = params.tenant_slug as string;

  // State Management
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters State
  const [filterType, setFilterType] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Selected Draft for Drawer
  const [selectedDraft, setSelectedDraft] = useState<DraftRow | null>(null);
  const [editedText, setEditedText] = useState<string>("");
  const [savingText, setSavingText] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Custom premium dialog states & helpers
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
  });

  const [rejectPromptModal, setRejectPromptModal] = useState<{
    isOpen: boolean;
    draft: DraftRow | null;
    reason: string;
  }>({
    isOpen: false,
    draft: null,
    reason: "Koordinatör uygun görmedi",
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm,
    });
  };

  const showAlert = (title: string, message: string) => {
    setAlertModal({
      isOpen: true,
      title,
      message,
    });
  };

  // Load Data
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const draftsRes = await getPendingDrafts({
        type: filterType === "all" ? undefined : filterType,
        priority: filterPriority === "all" ? undefined : filterPriority,
        query: searchQuery.trim() !== "" ? searchQuery : undefined
      });

      if (draftsRes.success && draftsRes.data) {
        setDrafts(draftsRes.data);
      } else {
        setError(draftsRes.error || "Taslaklar yüklenemedi.");
      }

      const statsRes = await getDraftApprovalStats();
      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data);
      }
    } catch (err: any) {
      console.error(err);
      setError("Bir bağlantı hatası oluştu.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filterType, filterPriority]);

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      loadData();
    }
  };

  const handleCopyDraft = async (draft: DraftRow) => {
    try {
      await navigator.clipboard.writeText(draft.draft_text);
      await markDraftCopied(draft.draft_id, draft.source);
      setCopiedId(draft.draft_id);
      setToastMessage("Taslak kopyalandı!");
      setTimeout(() => setCopiedId(null), 2000);
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  };

  const handleSaveText = async () => {
    if (!selectedDraft || !editedText.trim()) return;
    setSavingText(true);
    try {
      const res = await updateDraftText(selectedDraft.draft_id, selectedDraft.source, editedText);
      if (res.success) {
        setToastMessage("Taslak güncellendi.");
        // Update local list
        setDrafts(prev => prev.map(d => d.draft_id === selectedDraft.draft_id ? { ...d, draft_text: editedText, draft_preview: editedText.slice(0, 100) } : d));
        setSelectedDraft(prev => prev ? { ...prev, draft_text: editedText } : null);
        setTimeout(() => setToastMessage(null), 3000);
      } else {
        showAlert("Hata", res.error || "Taslak kaydedilemedi.");
      }
    } catch (err) {
      console.error(err);
      showAlert("Hata", "Bir hata oluştu.");
    } finally {
      setSavingText(false);
    }
  };

  const handleApprove = async (draft: DraftRow) => {
    setActionLoading("approve");
    const txt = draft.draft_id === selectedDraft?.draft_id ? editedText : draft.draft_text;
    try {
      const res = await markDraftApproved(draft.draft_id, draft.source, txt);
      if (res.success) {
        setToastMessage("Taslak başarıyla onaylandı (P0 zero-outbound).");
        setSelectedDraft(null);
        await loadData();
        setTimeout(() => setToastMessage(null), 3000);
      } else {
        showAlert("Hata", res.error || "İşlem başarısız.");
      }
    } catch (err) {
      console.error(err);
      showAlert("Hata", "Bir hata oluştu.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = (draft: DraftRow) => {
    setRejectPromptModal({
      isOpen: true,
      draft,
      reason: "Koordinatör uygun görmedi",
    });
  };

  const getSourceBadgeColor = (source: string, draftType?: string) => {
    if (source === "remarketing" && (draftType === "no_reply_followup" || draftType === "template_required_task")) {
      return "bg-amber-50 text-amber-700 border-amber-200/50"; // Use distinct amber badge for no-reply follow-ups
    }
    switch (source) {
      case "bot_delegation":
        return "bg-cyan-50 text-cyan-700 border-cyan-200/50";
      case "appointment_reminder":
        return "bg-emerald-50 text-emerald-700 border-emerald-200/50";
      case "remarketing":
        return "bg-indigo-50 text-indigo-700 border-indigo-200/50";
      case "greeting":
        return "bg-pink-50 text-pink-700 border-pink-200/50";
      default:
        return "bg-slate-50 text-slate-700 border-slate-200/50";
    }
  };

  const getSourceLabel = (source: string, draftType?: string) => {
    if (source === "remarketing" && (draftType === "no_reply_followup" || draftType === "template_required_task")) {
      return "Cevap Bekleyen Takip Taslağı";
    }
    switch (source) {
      case "bot_delegation": return "Bot Takip";
      case "appointment_reminder": return "Randevu Hatırlatma";
      case "remarketing": return "Remarketing";
      case "greeting": return "Karşılama";
      default: return source;
    }
  };

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-[#F5F5F7]">
      {/* 1. Header Area */}
      <div className="flex-none bg-white border-b border-black/5 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1D1D1F] flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-indigo-600" />
            Taslak Onay Merkezi
          </h2>
          <p className="text-[12px] text-[#86868B] font-medium mt-1">
            Yapay zeka asistanının ve zamanlanmış hatırlatıcıların hazırladığı taslak mesajları denetleyin.
          </p>
        </div>
        
        {/* Toast ToastNotification */}
        {toastMessage && (
          <div className="px-4 py-2 bg-emerald-600 text-white rounded-xl shadow-lg text-[12px] font-bold flex items-center gap-2 animate-bounce">
            <ShieldCheck className="w-4 h-4" />
            {toastMessage}
          </div>
        )}
      </div>

      {/* 2. Zero Outbound Safety Warning Banner */}
      <div className="flex-none px-6 pt-4">
        <div className="p-3 bg-amber-50/80 border border-amber-200/70 rounded-xl flex items-start gap-2.5 shadow-sm">
          <AlertCircle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-[11px] text-amber-800 leading-relaxed font-semibold">
            <span className="font-extrabold uppercase text-amber-900 block mb-0.5">🔒 P0 Denetim Modu Güvenlik Kuralı:</span>
            Onaylanan veya reddedilen taslaklar veritabanına loglanır ve statü güncellenir ancak hastaya otomatik WhatsApp mesajı gönderilmez. Gönderim yetkisi P0 kapsamında tamamen kapalıdır (zero-outbound).
          </div>
        </div>
      </div>

      {/* 3. Metrics Cards Grid */}
      {stats && (
        <div className="flex-none grid grid-cols-2 md:grid-cols-4 gap-4 px-6 pt-4">
          <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider">Bekleyen Taslaklar</p>
              <h3 className="text-xl font-bold text-[#1D1D1F] mt-0.5">{stats.pending}</h3>
            </div>
          </div>
          <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-orange-50 text-orange-600">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider">Bugün Üretilen</p>
              <h3 className="text-xl font-bold text-[#1D1D1F] mt-0.5">{stats.generatedToday}</h3>
            </div>
          </div>
          <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider">Randevu Taslağı</p>
              <h3 className="text-xl font-bold text-[#1D1D1F] mt-0.5">{stats.reminderCount}</h3>
            </div>
          </div>
          <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider">Riskli Taslaklar</p>
              <h3 className="text-xl font-bold text-[#1D1D1F] mt-0.5">{stats.riskyCount}</h3>
            </div>
          </div>
        </div>
      )}

      {/* 4. Filters Bar */}
      <div className="flex-none bg-white border border-black/5 rounded-2xl m-6 mb-2 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left: Tab selectors */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 no-scrollbar">
          {[
            { value: "all", label: "Tümü" },
            { value: "bot_delegation", label: "Bot Takip" },
            { value: "appointment_reminder", label: "Randevular" },
            { value: "remarketing", label: "Remarketing" },
            { value: "greeting", label: "Karşılama" }
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilterType(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all shrink-0 ${
                filterType === tab.value 
                  ? "bg-indigo-600 text-white shadow-sm" 
                  : "text-[#86868B] hover:text-[#1D1D1F]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right: Search Input */}
        <div className="flex items-center gap-2">
          <div className="relative max-w-xs w-full">
            <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyPress}
              placeholder="Hasta adı, telefon veya bölüm..."
              className="pl-9 pr-4 py-1.5 bg-[#F5F5F7] border border-black/5 rounded-xl text-[12px] outline-none w-[200px] focus:w-[240px] focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
            />
          </div>
          <button
            onClick={loadData}
            className="px-3.5 py-1.5 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 text-indigo-600 text-[12px] font-bold rounded-xl transition-all"
          >
            Ara
          </button>
        </div>
      </div>

      {/* 5. Main Queue List */}
      <div className="flex-1 overflow-auto px-6 pb-6 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50">
            <div className="flex flex-col items-center gap-2">
              <Activity className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-[12px] font-bold text-[#86868B]">Yükleniyor...</p>
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-black/5 shadow-sm">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-2" />
            <p className="text-[13px] font-bold text-[#1D1D1F]">{error}</p>
            <button onClick={loadData} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">Tekrar Dene</button>
          </div>
        ) : drafts.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-2xl border border-black/5 shadow-sm">
            <FileText className="w-10 h-10 text-[#C7C7CC] mx-auto mb-2" />
            <p className="text-[13px] font-bold text-[#1D1D1F]">Denetim bekleyen taslak mesaj bulunmamaktadır.</p>
            <p className="text-[11px] text-[#86868B] mt-1">AI ve hatırlatıcılar devreye girdikçe burası güncellenecektir.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {drafts.map((draft) => (
              <div 
                key={draft.draft_id}
                onClick={() => { setSelectedDraft(draft); setEditedText(draft.draft_text); }}
                className={`p-4 bg-white border border-black/5 hover:border-indigo-200 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:shadow-md transition-all ${
                  selectedDraft?.draft_id === draft.draft_id ? "ring-2 ring-indigo-500/50" : ""
                }`}
              >
                {/* Left: Patient Details & Source */}
                <div className="space-y-1.5 max-w-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-extrabold text-[#1D1D1F]">
                      {resolvePatientDisplayName({
                        oppPatientName: draft.patient_name,
                        convPatientName: draft.patient_name,
                        whatsappProfileName: draft.patient_name
                      })}
                    </span>
                    <span className="text-[11px] font-semibold text-[#86868B]">{formatPhoneReadable(draft.phone)}</span>
                    
                    {draft.risk_flags.length > 0 && (
                      <span className="p-0.5 bg-amber-50 text-amber-600 border border-amber-200 text-[9px] rounded font-bold inline-flex items-center gap-0.5">
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                        Uyarı
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSourceBadgeColor(draft.source, draft.draft_type)}`}>
                      {getSourceLabel(draft.source, draft.draft_type)}
                    </span>
                    {draft.department && (
                      <span className="px-1.5 py-0.5 bg-slate-100 text-[#86868B] text-[9px] rounded font-bold">
                        {draft.department}
                      </span>
                    )}
                    {draft.country && (
                      <span className="px-1.5 py-0.5 bg-slate-100 text-[#86868B] text-[9px] rounded font-bold">
                        {draft.country}
                      </span>
                    )}
                  </div>
                </div>

                {/* Middle: Draft Message Preview */}
                <div className="flex-1 max-w-lg">
                  <p className="text-[12px] text-[#1D1D1F] italic bg-[#F5F5F7] p-2.5 rounded-xl border border-black/5 whitespace-nowrap overflow-hidden text-ellipsis leading-relaxed font-medium">
                    {draft.draft_preview}
                  </p>
                </div>

                {/* Right: Date & Actions */}
                <div className="flex items-center gap-4 shrink-0 justify-end">
                  <div className="text-right text-[10px] text-[#86868B] font-semibold">
                    <div>{new Date(draft.generated_at).toLocaleDateString('tr-TR')}</div>
                    <div>{new Date(draft.generated_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>

                  <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleCopyDraft(draft)}
                      className={`p-2 rounded-xl border border-black/5 hover:bg-slate-50 transition-colors ${
                        copiedId === draft.draft_id ? "bg-emerald-50 border-emerald-200 text-emerald-600" : "bg-white text-indigo-600"
                      }`}
                      title="Kopyala"
                    >
                      {copiedId === draft.draft_id ? <Check className="w-3.5 h-3.5 animate-pulse" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleReject(draft)}
                      className="p-2 bg-white rounded-xl border border-red-200 hover:bg-red-50 text-red-600 transition-colors"
                      title="Reddet"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleApprove(draft)}
                      className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm transition-colors"
                      title="Onayla"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6. Apple/Stripe-Style Details Slide-Over Drawer */}
      {selectedDraft && (
        <>
          {/* Backdrop Overlay */}
          <div 
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setSelectedDraft(null)}
          />

          {/* Right Slide-over Drawer */}
          <div className="fixed inset-y-0 right-0 w-[450px] bg-[#F5F5F7] shadow-2xl z-50 flex flex-col border-l border-black/5 transition-transform translate-x-0">
            {/* Drawer Header */}
            <div className="bg-white border-b border-black/5 p-5 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest block mb-0.5">
                  {getSourceLabel(selectedDraft.source, selectedDraft.draft_type)} İncelemesi
                </span>
                <h3 className="text-[15px] font-bold text-[#1D1D1F]">
                  {selectedDraft.patient_name}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedDraft(null)}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-[#86868B] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body Scroll */}
            <div className="flex-1 overflow-auto p-5 space-y-4">
              
              {/* Patient Badge Summary */}
              <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm grid grid-cols-2 gap-3 text-[11px] font-semibold text-[#86868B]">
                <div>Hasta Adı: <span className="text-[#1D1D1F] block mt-0.5">
                  {resolvePatientDisplayName({
                    oppPatientName: selectedDraft.patient_name,
                    convPatientName: selectedDraft.patient_name,
                    whatsappProfileName: selectedDraft.patient_name
                  })}
                </span></div>
                <div>Telefon: <span className="text-[#1D1D1F] block mt-0.5">{formatPhoneReadable(selectedDraft.phone)}</span></div>
                <div>Ülke: <span className="text-[#1D1D1F] block mt-0.5">{selectedDraft.country || 'TR'}</span></div>
                <div>Bölüm: <span className="text-[#1D1D1F] block mt-0.5">{selectedDraft.department || '—'}</span></div>
                <div>Aşama: <span className="text-[#1D1D1F] block mt-0.5 uppercase tracking-wide text-[9px] font-bold">{selectedDraft.stage}</span></div>
                <div>Dil: <span className="text-[#1D1D1F] block mt-0.5 uppercase">{selectedDraft.language}</span></div>
              </div>

              {/* AI Özet Context */}
              {(selectedDraft.ai_summary || selectedDraft.ai_reason) && (
                <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Yapay Zeka Klinik Özeti</span>
                  </div>
                  {selectedDraft.ai_summary && (
                    <p className="text-[11px] text-[#1D1D1F] font-medium leading-relaxed bg-[#F5F5F7] p-2.5 rounded-xl border border-black/5">
                      {selectedDraft.ai_summary}
                    </p>
                  )}
                  {selectedDraft.ai_reason && (
                    <p className="text-[10px] text-[#86868B] font-semibold italic">
                      AI Karar Gerekçesi: {selectedDraft.ai_reason}
                    </p>
                  )}
                </div>
              )}

              {/* Risk ve Uygunluk Uyarıları */}
              <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  <span>Risk ve Uygunluk Değerlendirmesi</span>
                </div>
                
                <div className="space-y-1.5">
                  {/* 24h Window Check */}
                  <div className="flex items-center justify-between text-[11px] font-semibold">
                    <span className="text-[#86868B]">WhatsApp 24s Penceresi:</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      selectedDraft.whatsapp_24h_window_status === 'open' 
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {selectedDraft.whatsapp_24h_window_status === 'open' ? '🟢 AÇIK' : '🟠 KAPALI (Şablon Gerekir)'}
                    </span>
                  </div>

                  {/* Risks Tags list */}
                  {selectedDraft.risk_flags.length > 0 ? (
                    <div className="flex flex-wrap gap-1 pt-1.5">
                      {selectedDraft.risk_flags.map(flag => (
                        <span 
                          key={flag} 
                          className="px-2 py-0.5 bg-red-50 text-red-600 border border-red-100 rounded text-[9px] font-extrabold"
                        >
                          {flag === 'whatsapp_24h_window_closed' ? 'PENCERE KAPALI' : 
                           flag === 'template_required' ? 'ŞABLON GEREKEBİLİR' : 
                           flag === 'missing_patient_name' ? 'HASTA ADI EKSİK' : 
                           flag === 'medical_claim_risk' ? 'TIBBİ İDDİA RİSKİ' : 
                           flag === 'timezone_warning' ? 'UYKU SAATİ UYARISI' : 
                           flag === 'long_message' ? 'UZUN MESAJ' : flag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-emerald-600 font-bold">✅ Herhangi bir risk faktörü bulunamadı.</p>
                  )}
                </div>
              </div>

              {/* Taslak Düzenleme TextArea */}
              <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Taslak Metni</label>
                  <span className="text-[10px] font-semibold text-[#86868B]">{editedText.length} karakter</span>
                </div>
                <textarea
                  value={editedText}
                  onChange={(e) => setEditedText(e.target.value)}
                  rows={8}
                  className="w-full p-3 bg-[#F5F5F7] border border-black/5 rounded-xl text-[12px] font-medium outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono leading-relaxed"
                />
                <p className="text-[9px] text-[#86868B] italic">
                  Not: Bu taslak sadece koordinatör incelemesi içindir. Sistem hastaya otomatik göndermez.
                </p>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleSaveText}
                    disabled={savingText || editedText === selectedDraft.draft_text}
                    className="px-3.5 py-1.5 bg-indigo-600 disabled:opacity-40 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg shadow-sm transition-all"
                  >
                    {savingText ? "Kaydediliyor..." : "Düzenlemeyi Kaydet"}
                  </button>
                </div>
              </div>

              {/* Navigation Deep Links */}
              <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm space-y-2 text-[12px] font-bold">
                <div className="flex items-center justify-between">
                  <span className="text-[#86868B]">Hasta Profili:</span>
                  {selectedDraft.opportunity_id ? (
                    <Link 
                      href={`/${tenantSlug}/takip`}
                      className="text-indigo-600 hover:text-indigo-700 flex items-center gap-1 hover:underline"
                    >
                      Hasta Detayına Git <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  ) : (
                    <span className="text-[#86868B] font-medium">—</span>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-black/5 pt-2">
                  <span className="text-[#86868B]">Sohbet Odası:</span>
                  {selectedDraft.conversation_id ? (
                    <Link 
                      href={`/${tenantSlug}/inbox`}
                      className="text-indigo-600 hover:text-indigo-700 flex items-center gap-1 hover:underline"
                    >
                      Mesajlara Git <MessageSquare className="w-3.5 h-3.5" />
                    </Link>
                  ) : (
                    <span className="text-[#86868B] font-medium">—</span>
                  )}
                </div>
              </div>

            </div>

            {/* Drawer Footer Actions */}
            <div className="bg-white border-t border-black/5 p-4 flex items-center gap-2">
              <button
                onClick={() => handleReject(selectedDraft)}
                className="flex-1 py-2.5 border border-red-200 hover:bg-red-50 text-red-600 text-[12px] font-bold rounded-xl transition-all"
              >
                Reddet
              </button>
              <button
                onClick={() => handleCopyDraft(selectedDraft)}
                className="flex-1 py-2.5 border border-indigo-100 hover:bg-indigo-50 text-indigo-600 text-[12px] font-bold rounded-xl flex items-center justify-center gap-1 transition-all"
              >
                <Copy className="w-3.5 h-3.5" /> Kopyala
              </button>
              <button
                onClick={() => handleApprove(selectedDraft)}
                disabled={actionLoading !== null}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold rounded-xl shadow-sm transition-all"
              >
                {actionLoading === "approve" ? "..." : "Onayla"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Custom Premium Confirm Modal */}
      {confirmModal.isOpen && createPortal(
        <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}>
          <div className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-sm p-6 mx-4 text-center animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6 text-rose-500" />
            </div>
            
            <h3 className="text-sm font-extrabold text-[#1D1D1F] mb-2">
              {confirmModal.title}
            </h3>
            
            <p className="text-[11px] font-semibold text-[#86868B] leading-relaxed px-2 mb-6">
              {confirmModal.message}
            </p>

            <div className="flex items-center justify-center gap-2 pt-2 border-t border-black/5">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="flex-1 py-2.5 bg-[#F5F5F7] hover:bg-[#E8E8ED] text-[#1D1D1F] rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer text-center"
              >
                Vazgeç
              </button>
              <button
                onClick={() => {
                  setConfirmModal(prev => ({ ...prev, isOpen: false }));
                  confirmModal.onConfirm();
                }}
                className="flex-1 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm hover:shadow text-center"
              >
                Onayla
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Custom Premium Alert Modal */}
      {alertModal.isOpen && createPortal(
        <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}>
          <div className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-sm p-6 mx-4 text-center animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
              <AlertCircle className="w-6 h-6 text-indigo-500" />
            </div>
            
            <h3 className="text-sm font-extrabold text-[#1D1D1F] mb-2">
              {alertModal.title}
            </h3>
            
            <p className="text-[11px] font-semibold text-[#86868B] leading-relaxed px-2 mb-6">
              {alertModal.message}
            </p>

            <div className="pt-2 border-t border-black/5">
              <button
                onClick={() => setAlertModal(prev => ({ ...prev, isOpen: false }))}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm hover:shadow text-center"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Custom Premium Reject Prompt Modal */}
      {rejectPromptModal.isOpen && createPortal(
        <div className="fixed inset-0 bg-black/45 backdrop-blur-[4px] flex items-center justify-center z-[9999] animate-in fade-in duration-200" onClick={() => setRejectPromptModal(prev => ({ ...prev, isOpen: false }))}>
          <div className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-black/5 w-full max-w-sm p-6 mx-4 text-left animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
                <XCircle className="w-6 h-6 text-amber-500" />
              </div>
              
              <h3 className="text-sm font-extrabold text-[#1D1D1F] mb-2 text-center">
                Taslağı Reddet
              </h3>
              
              <p className="text-[11px] font-semibold text-[#86868B] leading-relaxed px-2 mb-4 text-center">
                Lütfen bu taslak mesajı reddetme sebebini belirtin (isteğe bağlı):
              </p>
            </div>

            <div className="mb-6 px-2">
              <input
                type="text"
                value={rejectPromptModal.reason}
                onChange={(e) => setRejectPromptModal(prev => ({ ...prev, reason: e.target.value }))}
                className="w-full px-3 py-2.5 bg-[#F5F5F7] border border-black/5 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 text-[#1D1D1F]"
                placeholder="Reddedilme sebebi..."
                autoFocus
              />
            </div>

            <div className="flex items-center justify-center gap-2 pt-2 border-t border-black/5">
              <button
                onClick={() => setRejectPromptModal(prev => ({ ...prev, isOpen: false }))}
                className="flex-1 py-2.5 bg-[#F5F5F7] hover:bg-[#E8E8ED] text-[#1D1D1F] rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer text-center"
              >
                Vazgeç
              </button>
              <button
                onClick={async () => {
                  const draft = rejectPromptModal.draft;
                  if (!draft) return;
                  const reason = rejectPromptModal.reason;
                  setRejectPromptModal(prev => ({ ...prev, isOpen: false }));
                  
                  setActionLoading("reject");
                  try {
                    const res = await markDraftRejected(draft.draft_id, draft.source, reason);
                    if (res.success) {
                      setToastMessage("Taslak reddedildi.");
                      setSelectedDraft(null);
                      await loadData();
                      setTimeout(() => setToastMessage(null), 3000);
                    } else {
                      showAlert("Hata", res.error || "İşlem başarısız.");
                    }
                  } catch (err) {
                    console.error(err);
                    showAlert("Hata", "Bir hata oluştu.");
                  } finally {
                    setActionLoading(null);
                  }
                }}
                className="flex-1 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm hover:shadow text-center"
              >
                Taslağı Reddet
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
