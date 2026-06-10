"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import { 
  listLearningCandidates, 
  getLearningCandidateDetail, 
  updateCandidateStatus, 
  updateCandidateContent, 
  getLearningStats, 
  getTenantChannels,
  type CandidateRow,
  type CandidateFilters
} from "@/app/actions/learning-approval";
import { 
  GraduationCap, 
  Search, 
  Filter, 
  Check, 
  X, 
  AlertTriangle, 
  AlertCircle, 
  Sparkles, 
  Clock, 
  ExternalLink, 
  MessageSquare,
  ChevronRight,
  Info,
  Calendar,
  ShieldAlert,
  RefreshCw,
  FileEdit,
  Eye,
  TrendingUp,
  Brain
} from "lucide-react";
import Link from "next/link";

export default function LearningApprovalPage() {
  const params = useParams();
  const tenantSlug = params.tenant_slug as string;

  // State
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0, ignored: 0 });
  const [channels, setChannels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters State
  const [statusTab, setStatusTab] = useState<'pending' | 'approved' | 'rejected' | 'ignored' | 'all'>('pending');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Detail Drawer State
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateRow | null>(null);
  const [sourceEventsCount, setSourceEventsCount] = useState<number>(0);
  const [drawerLoading, setDrawerLoading] = useState(false);
  
  // Edit States (Only allowed for pending)
  const [editedTitle, setEditedTitle] = useState("");
  const [editedSummary, setEditedSummary] = useState("");
  const [editedRuleText, setEditedRuleText] = useState("");
  const [editedReviewNote, setEditedReviewNote] = useState("");
  const [savingContent, setSavingContent] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Collapsible fingerprint in drawer
  const [isFingerprintOpen, setIsFingerprintOpen] = useState(false);

  // Toast / Status Message
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Custom Modal States
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

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

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

  // Load Channels
  useEffect(() => {
    async function loadChannels() {
      try {
        const res = await getTenantChannels();
        if (res.success && res.data) {
          setChannels(res.data);
        }
      } catch (err) {
        console.error("Kanal listesi yüklenemedi", err);
      }
    }
    loadChannels();
  }, []);

  // Fetch stats & candidates list
  const loadData = async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      // Fetch stats
      const statsRes = await getLearningStats();
      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data);
      }

      // Fetch list
      const filterParams: CandidateFilters = {
        status: statusTab,
        riskLevel: riskFilter as any,
        candidateType: typeFilter,
        channelId: channelFilter,
        search: searchQuery.trim() || undefined,
        page,
        limit: 10
      };

      const listRes = await listLearningCandidates(filterParams);
      if (listRes.success && listRes.data) {
        setCandidates(listRes.data.items);
        setTotalItems(listRes.data.total);
        setTotalPages(listRes.data.totalPages);
        setCurrentPage(listRes.data.page);
      } else {
        setError(listRes.error || "Öğrenme adayları yüklenemedi.");
      }
    } catch (err: any) {
      console.error(err);
      setError("Bağlantı hatası oluştu.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(1);
  }, [statusTab, riskFilter, typeFilter, channelFilter, debouncedSearch]);

  // Handle Search Input Debounce or Button trigger
  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      setDebouncedSearch(searchQuery);
    }
  };

  const triggerSearch = () => {
    setDebouncedSearch(searchQuery);
  };

  // Open detail drawer
  const handleOpenDrawer = async (candidate: CandidateRow) => {
    setDrawerLoading(true);
    setSelectedCandidate(candidate);
    setIsFingerprintOpen(false);
    
    // Set edit fields
    setEditedTitle(candidate.title);
    setEditedSummary(candidate.summary);
    setEditedRuleText(candidate.suggestedRuleText);
    setEditedReviewNote(candidate.metadata.review_note || "");

    try {
      const detailRes = await getLearningCandidateDetail(candidate.id);
      if (detailRes.success && detailRes.data) {
        // Update local view with fresh detailed data
        setSelectedCandidate(detailRes.data);
        setSourceEventsCount(detailRes.data.sourceEventsCount);
      } else {
        setSourceEventsCount(Array.isArray(candidate.sourceEventIds) ? candidate.sourceEventIds.length : 0);
      }
    } catch (err) {
      console.error("Detay yüklenemedi", err);
      setSourceEventsCount(Array.isArray(candidate.sourceEventIds) ? candidate.sourceEventIds.length : 0);
    } finally {
      setDrawerLoading(false);
    }
  };

  // Edit Candidate Contents (Title, Summary, Rule text, Review note)
  const handleSaveContent = async () => {
    if (!selectedCandidate) return;
    if (selectedCandidate.status !== 'pending') {
      showAlert("Hata", "Sadece Değerlendirme Bekleyen (Pending) adaylar düzenlenebilir.");
      return;
    }

    setSavingContent(true);
    try {
      const res = await updateCandidateContent(selectedCandidate.id, {
        title: editedTitle,
        summary: editedSummary,
        suggestedRuleText: editedRuleText,
        reviewNote: editedReviewNote
      });

      if (res.success) {
        showToast("Aday başarıyla güncellendi.");
        // Refresh detail in drawer and update list
        setSelectedCandidate(prev => prev ? {
          ...prev,
          title: editedTitle,
          summary: editedSummary,
          suggestedRuleText: editedRuleText,
          metadata: { ...prev.metadata, review_note: editedReviewNote }
        } : null);
        loadData(currentPage);
      } else {
        showAlert("Hata", res.error || "Güncelleme başarısız oldu.");
      }
    } catch (err) {
      showAlert("Hata", "Güncelleme sırasında bir hata oluştu.");
    } finally {
      setSavingContent(false);
    }
  };

  // Status transitions
  const handleStatusChange = async (candidate: CandidateRow, newStatus: 'approved' | 'rejected' | 'ignored' | 'pending') => {
    const isApproved = newStatus === 'approved';
    const isHighRisk = candidate.riskLevel === 'high';
    const isBlocked = candidate.riskLevel === 'blocked';

    if (isApproved && isBlocked) {
      showAlert("İşlem Engellendi", "Yüksek riskli/engellenmiş (Blocked) adaylar onaylanamaz. Sadece reddedilebilir veya yok sayılabilir.");
      return;
    }

    const action = () => executeStatusChange(candidate.id, newStatus);

    if (isApproved && isHighRisk) {
      showConfirm(
        "⚠️ Çift Onay Gereklidir",
        "Bu öğrenme adayı YÜKSEK RİSK düzeyindedir. Onaylamanız durumunda kural veritabanına eklenecektir ancak P1.2 sınırları gereği şu an bot çalışma zamanına (runtime) etki etmeyecektir. Devam etmek istiyor musunuz?",
        action
      );
    } else if (isApproved) {
      showConfirm(
        "Kural Adayını Onayla",
        "Adayı onaylamak istediğinize emin misiniz? (Onaylı durum veritabanında saklanır, runtime'da otomatik uygulanmaz)",
        action
      );
    } else if (newStatus === 'rejected') {
      showConfirm(
        "Adayı Reddet",
        "Bu kural adayını kalıcı olarak reddetmek istediğinize emin misiniz? Reddedilen adaylar tekrar işleme alınamaz.",
        action
      );
    } else {
      action();
    }
  };

  const executeStatusChange = async (candidateId: string, newStatus: 'approved' | 'rejected' | 'ignored' | 'pending') => {
    setActionLoading(newStatus);
    try {
      const res = await updateCandidateStatus(candidateId, newStatus);
      if (res.success) {
        showToast(`Durum başarıyla güncellendi: ${
          newStatus === 'approved' ? 'Onaylandı' : newStatus === 'rejected' ? 'Reddedildi' : 'Yok Sayıldı'
        }`);
        setSelectedCandidate(null);
        loadData(currentPage);
      } else {
        showAlert("İşlem Başarısız", res.error || "Durum güncellenirken bir hata oluştu.");
      }
    } catch (err) {
      showAlert("Hata", "Durum güncellenirken hata oluştu.");
    } finally {
      setActionLoading(null);
    }
  };

  // Candidate Type Helpers
  const getCandidateTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      'tone_rule': 'Ton Kuralı',
      'forbidden_phrase': 'Yasaklı İfade',
      'cta_rule': 'CTA Kuralı',
      'policy_rule': 'Politika Kuralı',
      'answer_pattern': 'Cevap Kalıbı',
      'knowledge_hint': 'Bilgi İpucu',
      'identity_rule': 'Kimlik Kuralı',
      'risk_warning': 'Risk Uyarısı'
    };
    return map[type] || type;
  };

  const getCandidateTypeBadgeClass = (type: string) => {
    const map: Record<string, string> = {
      'tone_rule': 'bg-indigo-50 text-indigo-700 border-indigo-200',
      'forbidden_phrase': 'bg-rose-50 text-rose-700 border-rose-200',
      'cta_rule': 'bg-amber-50 text-amber-700 border-amber-200',
      'policy_rule': 'bg-red-50 text-red-700 border-red-200',
      'answer_pattern': 'bg-cyan-50 text-cyan-700 border-cyan-200',
      'knowledge_hint': 'bg-emerald-50 text-emerald-700 border-emerald-200',
      'identity_rule': 'bg-purple-50 text-purple-700 border-purple-200',
      'risk_warning': 'bg-orange-50 text-orange-700 border-orange-200'
    };
    return `px-2 py-0.5 rounded-lg border text-[10px] font-bold ${map[type] || 'bg-slate-50 text-slate-700 border-slate-200'}`;
  };

  const getRiskLevelBadgeClass = (level: string) => {
    const map: Record<string, string> = {
      'low': 'bg-emerald-50 text-emerald-700 border-emerald-200',
      'medium': 'bg-amber-50 text-amber-700 border-amber-200',
      'high': 'bg-rose-50 text-rose-700 border-rose-200',
      'blocked': 'bg-red-100 text-red-800 border-red-300'
    };
    return `px-1.5 py-0.5 rounded-md border text-[9px] font-extrabold uppercase tracking-wide inline-flex items-center gap-0.5 ${
      map[level] || 'bg-slate-50 text-slate-700 border-slate-200'
    }`;
  };

  const getRiskLevelIndicator = (level: string) => {
    const map: Record<string, string> = {
      'low': '🟢 Düşük Risk',
      'medium': '🟡 Orta Risk',
      'high': '🔴 Yüksek Risk',
      'blocked': '⛔ ENGELLENMİŞ'
    };
    return map[level] || level;
  };

  return (
    <div className="flex flex-col h-full bg-[#F5F5F7] overflow-hidden">
      
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-[10000] bg-white border border-black/5 shadow-2xl p-4 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300">
          <div className={`p-1.5 rounded-full ${toastMessage.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
            {toastMessage.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </div>
          <span className="text-[12px] font-extrabold text-[#1D1D1F]">{toastMessage.text}</span>
        </div>
      )}

      {/* 1. Header & Security Banner */}
      <div className="flex-none bg-white border-b border-black/5 p-6 pb-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                <GraduationCap className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-black text-[#1D1D1F] tracking-tight">AI Öğrenme ve Kural Onayları</h1>
            </div>
            <p className="text-[12px] text-[#86868B] font-semibold">
              Bot mesajlaşma geçmişinden üretilen kural adaylarının incelendiği ve onaylandığı kontrol paneli.
            </p>
          </div>
        </div>

        {/* Security / Phase 1.2 Banner */}
        <div className="mt-4 bg-indigo-50/50 border border-indigo-100/50 rounded-2xl p-3.5 flex items-start gap-3">
          <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <div className="text-[11px] font-semibold text-indigo-900 leading-relaxed">
            <span className="font-extrabold">Güvenlik ve Tasarım Sınırları (P1.2): </span>
            Adayların onaylanması veya düzenlenmesi sadece veritabanı inceleme statüsünü günceller. 
            Burada yapılan işlemler, bir sonraki aşama (P1.3) devreye girmeden botun canlı cevaplama mantığına, prompt-builder veya 
            BrainResolver mekanizmalarına etki etmez. KVKK uyumluluğu nedeniyle ham hasta konuşmaları veya özel kişisel veriler UI'a taşınmaz.
          </div>
        </div>
      </div>

      {/* 2. Stats Grid */}
      <div className="flex-none px-6 pt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider">Bekleyen (Pending)</p>
            <h3 className="text-xl font-bold text-[#1D1D1F] mt-0.5">{stats.pending}</h3>
          </div>
        </div>

        <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600">
            <Check className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider">Onaylanan</p>
            <h3 className="text-xl font-bold text-[#1D1D1F] mt-0.5">{stats.approved}</h3>
          </div>
        </div>

        <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-50 text-red-600">
            <X className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider">Reddedilen</p>
            <h3 className="text-xl font-bold text-[#1D1D1F] mt-0.5">{stats.rejected}</h3>
          </div>
        </div>

        <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-slate-100 text-slate-600">
            <Eye className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-[#86868B] uppercase tracking-wider">Yok Sayılan (Ignored)</p>
            <h3 className="text-xl font-bold text-[#1D1D1F] mt-0.5">{stats.ignored}</h3>
          </div>
        </div>
      </div>

      {/* 3. Filters Bar */}
      <div className="flex-none bg-white border border-black/5 rounded-2xl mx-6 mt-4 p-4 shadow-sm flex flex-col gap-4">
        {/* Row 1: Status Tab selectors */}
        <div className="flex items-center justify-between border-b border-black/5 pb-3 flex-wrap gap-2">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 no-scrollbar">
            {[
              { value: "pending", label: "Değerlendirme Bekleyen" },
              { value: "approved", label: "Onaylananlar" },
              { value: "rejected", label: "Reddedilenler" },
              { value: "ignored", label: "Yok Sayılanlar" },
              { value: "all", label: "Tümü" }
            ].map(tab => (
              <button
                key={tab.value}
                onClick={() => { setStatusTab(tab.value as any); setCurrentPage(1); }}
                className={`px-3.5 py-1.5 rounded-xl text-[12px] font-extrabold transition-all shrink-0 ${
                  statusTab === tab.value 
                    ? "bg-indigo-600 text-white shadow-sm" 
                    : "text-[#86868B] hover:text-[#1D1D1F]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          
          <div className="text-[11px] font-semibold text-[#86868B]">
            Toplam kayıt: <span className="text-[#1D1D1F] font-bold">{totalItems}</span>
          </div>
        </div>

        {/* Row 2: Advanced filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          
          {/* Dropdown Candidate Type */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Kural Adayı Tipi</label>
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setCurrentPage(1); }}
              className="w-full bg-[#F5F5F7] border border-black/5 rounded-xl px-3 py-2 text-[12px] font-bold text-[#1D1D1F] outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer"
            >
              <option value="all">Tüm Tipler</option>
              <option value="tone_rule">Ton Kuralı</option>
              <option value="forbidden_phrase">Yasaklı İfade</option>
              <option value="cta_rule">CTA Kuralı</option>
              <option value="policy_rule">Politika Kuralı</option>
              <option value="answer_pattern">Cevap Kalıbı</option>
              <option value="knowledge_hint">Bilgi İpucu</option>
              <option value="identity_rule">Kimlik Kuralı</option>
              <option value="risk_warning">Risk Uyarısı</option>
            </select>
          </div>

          {/* Dropdown Risk Level */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Risk Seviyesi</label>
            <select
              value={riskFilter}
              onChange={(e) => { setRiskFilter(e.target.value); setCurrentPage(1); }}
              className="w-full bg-[#F5F5F7] border border-black/5 rounded-xl px-3 py-2 text-[12px] font-bold text-[#1D1D1F] outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer"
            >
              <option value="all">Tüm Seviyeler</option>
              <option value="low">🟢 Düşük Risk</option>
              <option value="medium">🟡 Orta Risk</option>
              <option value="high">🔴 Yüksek Risk</option>
              <option value="blocked">⛔ Engellenmiş (Blocked)</option>
            </select>
          </div>

          {/* Dropdown Channels */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Kanal</label>
            <select
              value={channelFilter}
              onChange={(e) => { setChannelFilter(e.target.value); setCurrentPage(1); }}
              className="w-full bg-[#F5F5F7] border border-black/5 rounded-xl px-3 py-2 text-[12px] font-bold text-[#1D1D1F] outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer"
            >
              <option value="all">Tüm Kanallar</option>
              {channels.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.provider.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Arama</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#86868B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyPress}
                  placeholder="Başlık, özet veya kural metni..."
                  className="w-full pl-9 pr-3 py-2 bg-[#F5F5F7] border border-black/5 rounded-xl text-[12px] font-semibold text-[#1D1D1F] outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all"
                />
              </div>
              <button
                onClick={triggerSearch}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-extrabold rounded-xl shadow-sm transition-all"
              >
                Ara
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* 4. Main Queue List */}
      <div className="flex-1 overflow-auto px-6 py-4 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
            <div className="flex flex-col items-center gap-2">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-[12px] font-bold text-[#86868B]">Adaylar yükleniyor...</p>
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-black/5 shadow-sm max-w-lg mx-auto mt-6">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-2" />
            <p className="text-[13px] font-bold text-[#1D1D1F]">{error}</p>
            <button onClick={() => loadData(currentPage)} className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow hover:bg-indigo-700 transition-colors">
              Tekrar Dene
            </button>
          </div>
        ) : candidates.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-2xl border border-black/5 shadow-sm max-w-lg mx-auto mt-6">
            <Brain className="w-10 h-10 text-[#C7C7CC] mx-auto mb-2" />
            <p className="text-[13px] font-bold text-[#1D1D1F]">Uyumlu aday bulunamadı.</p>
            <p className="text-[11px] text-[#86868B] mt-1">
              Filtrelerinizi değiştirmeyi deneyin veya bot işlemlerini takip edin.
            </p>
          </div>
        ) : (
          <div className="space-y-3 pb-8">
            {candidates.map((candidate) => (
              <div 
                key={candidate.id}
                onClick={() => handleOpenDrawer(candidate)}
                className={`p-4 bg-white border border-black/5 hover:border-indigo-200 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:shadow-md transition-all ${
                  selectedCandidate?.id === candidate.id ? "ring-2 ring-indigo-500/50 border-indigo-200" : ""
                }`}
              >
                {/* Left Section: Badges and Title */}
                <div className="space-y-1.5 max-w-md">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={getCandidateTypeBadgeClass(candidate.candidateType)}>
                      {getCandidateTypeLabel(candidate.candidateType)}
                    </span>
                    <span className={getRiskLevelBadgeClass(candidate.riskLevel)}>
                      {getRiskLevelIndicator(candidate.riskLevel)}
                    </span>
                    
                    <span className="text-[10px] font-extrabold text-[#86868B] bg-slate-100 px-1.5 py-0.5 rounded">
                      Güven: %{Math.round(parseFloat(candidate.confidenceScore) * 100)}
                    </span>
                  </div>
                  
                  <h3 className="text-[13px] font-extrabold text-[#1D1D1F] tracking-tight line-clamp-1">
                    {candidate.title}
                  </h3>
                  
                  <p className="text-[11px] text-[#86868B] font-semibold line-clamp-1">
                    {candidate.summary}
                  </p>
                </div>

                {/* Middle Section: Rule Text Preview */}
                <div className="flex-1 max-w-md md:max-w-xl">
                  <p className="text-[11px] text-[#1D1D1F] bg-[#F5F5F7] p-2.5 rounded-xl border border-black/5 whitespace-nowrap overflow-hidden text-ellipsis font-mono leading-relaxed font-semibold">
                    {candidate.suggestedRuleText}
                  </p>
                </div>

                {/* Right Section: Metadata and Quick Actions */}
                <div className="flex items-center gap-4 shrink-0 justify-end" onClick={e => e.stopPropagation()}>
                  <div className="text-right text-[10px] text-[#86868B] font-semibold">
                    <div>{new Date(candidate.createdAt).toLocaleDateString('tr-TR')}</div>
                    <div>{new Date(candidate.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Hide Approve for Blocked, show double-confirm for High risk */}
                    {candidate.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleStatusChange(candidate, 'ignored')}
                          className="p-2 bg-white rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
                          title="Yok Say"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleStatusChange(candidate, 'rejected')}
                          className="p-2 bg-white rounded-xl border border-red-200 hover:bg-red-50 text-red-600 transition-colors"
                          title="Reddet"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleStatusChange(candidate, 'approved')}
                          disabled={candidate.riskLevel === 'blocked'}
                          className={`p-2 rounded-xl text-white shadow-sm transition-colors ${
                            candidate.riskLevel === 'blocked'
                              ? 'bg-slate-200 text-slate-400 cursor-not-allowed border-none'
                              : 'bg-indigo-600 hover:bg-indigo-700'
                          }`}
                          title={candidate.riskLevel === 'blocked' ? 'Engellenmiş (Onaylanamaz)' : 'Onayla'}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    
                    {/* For Ignored status, allow restoring to pending */}
                    {candidate.status === 'ignored' && (
                      <button
                        onClick={() => handleStatusChange(candidate, 'pending')}
                        className="px-2.5 py-1.5 bg-white border border-indigo-200 rounded-xl text-indigo-600 text-[11px] font-bold hover:bg-indigo-50 transition-colors"
                      >
                        Sıraya Geri Al
                      </button>
                    )}

                    {/* Show badge for approved/rejected status */}
                    {(candidate.status === 'approved' || candidate.status === 'rejected') && (
                      <span className={`px-2.5 py-1 text-[11px] font-extrabold rounded-xl border ${
                        candidate.status === 'approved' 
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                          : 'bg-red-50 text-red-700 border-red-200'
                      }`}>
                        {candidate.status === 'approved' ? 'Onaylandı' : 'Reddedildi'}
                      </span>
                    )}
                  </div>
                </div>

              </div>
            ))}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t border-black/5">
                <button
                  disabled={currentPage === 1}
                  onClick={() => loadData(currentPage - 1)}
                  className="px-3 py-1.5 bg-white border border-black/5 rounded-xl text-[11px] font-extrabold text-[#1D1D1F] disabled:opacity-40 hover:bg-slate-50 transition-colors"
                >
                  Önceki Sayfa
                </button>
                <span className="text-[11px] font-bold text-[#86868B]">
                  Sayfa {currentPage} / {totalPages}
                </span>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => loadData(currentPage + 1)}
                  className="px-3 py-1.5 bg-white border border-black/5 rounded-xl text-[11px] font-extrabold text-[#1D1D1F] disabled:opacity-40 hover:bg-slate-50 transition-colors"
                >
                  Sonraki Sayfa
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 5. Apple/Stripe-Style Details Slide-Over Drawer */}
      {selectedCandidate && (
        <>
          {/* Backdrop Overlay */}
          <div 
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setSelectedCandidate(null)}
          />

          {/* Right Slide-over Drawer */}
          <div className="fixed inset-y-0 right-0 w-[480px] bg-[#F5F5F7] shadow-2xl z-50 flex flex-col border-l border-black/5 transition-transform translate-x-0">
            
            {/* Drawer Header */}
            <div className="bg-white border-b border-black/5 p-5 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-widest block mb-0.5 animate-pulse">
                  {getCandidateTypeLabel(selectedCandidate.candidateType)} İnceleme
                </span>
                <h3 className="text-[14px] font-black text-[#1D1D1F] tracking-tight">
                  Kural Adayı Detayı
                </h3>
              </div>
              <button 
                onClick={() => setSelectedCandidate(null)}
                className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-[#86868B] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body Scroll */}
            <div className="flex-1 overflow-auto p-5 space-y-4">
              
              {/* Drawer Loading Overlay */}
              {drawerLoading && (
                <div className="absolute inset-0 bg-white/70 backdrop-blur-xs flex items-center justify-center z-30">
                  <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin" />
                </div>
              )}

              {/* Blocked or High Risk Warning Banner */}
              {selectedCandidate.riskLevel === 'blocked' && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-3 flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="text-[10px] font-semibold text-red-900 leading-normal">
                    <span className="font-bold">KRİTİK ENGEL:</span> Bu aday tıbbi veya hukuki açıdan sakıncalı içerik barındırdığı için 
                    sistem tarafından engellenmiştir. Onaylanamaz. Sadece reddedilebilir veya yok sayılabilir.
                  </div>
                </div>
              )}

              {selectedCandidate.riskLevel === 'high' && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5 animate-bounce" />
                  <div className="text-[10px] font-semibold text-rose-900 leading-normal">
                    <span className="font-bold">YÜKSEK RİSK UYARISI:</span> Bu kural adayı hassas kelimeler (doktor, fiyat, tedavi süresi, tıbbi iddia) 
                    içermektedir. Onaylanırken çift aşamalı güvenlik onayı gereklidir.
                  </div>
                </div>
              )}

              {/* Candidate Metadata Summary */}
              <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm grid grid-cols-2 gap-3 text-[11px] font-semibold text-[#86868B]">
                <div>Aday Tipi: 
                  <span className="text-[#1D1D1F] block mt-0.5">
                    {getCandidateTypeLabel(selectedCandidate.candidateType)}
                  </span>
                </div>
                <div>Güven Puanı: 
                  <span className="text-[#1D1D1F] block mt-0.5 font-extrabold text-indigo-600">
                    %{Math.round(parseFloat(selectedCandidate.confidenceScore) * 100)}
                  </span>
                </div>
                <div>Risk Düzeyi: 
                  <span className="text-[#1D1D1F] block mt-0.5">
                    {getRiskLevelIndicator(selectedCandidate.riskLevel)}
                  </span>
                </div>
                <div>Kaynak Sayısı: 
                  <span className="text-[#1D1D1F] block mt-0.5">
                    {sourceEventsCount} mesajlaşma olayı
                  </span>
                </div>
                <div>Oluşturulma: 
                  <span className="text-[#1D1D1F] block mt-0.5 font-medium">
                    {new Date(selectedCandidate.createdAt).toLocaleString('tr-TR')}
                  </span>
                </div>
                <div>Son Güncelleme: 
                  <span className="text-[#1D1D1F] block mt-0.5 font-medium">
                    {new Date(selectedCandidate.updatedAt).toLocaleString('tr-TR')}
                  </span>
                </div>
              </div>

              {/* Abstract Evidence Summary (KVKK Compliant, Read-only) */}
              <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Soyut Kanıt Gerekçesi</span>
                </div>
                <p className="text-[11px] text-[#1D1D1F] font-semibold leading-relaxed bg-[#F5F5F7] p-2.5 rounded-xl border border-black/5 leading-relaxed">
                  {selectedCandidate.evidenceSummary}
                </p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {selectedCandidate.riskTags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-slate-100 text-[#86868B] text-[9px] rounded font-bold uppercase tracking-wide">
                      #{tag}
                    </span>
                  ))}
                  {selectedCandidate.riskTags.length === 0 && (
                    <span className="text-[10px] text-[#86868B] italic">Risk etiketi tanımlanmamış.</span>
                  )}
                </div>
              </div>

              {/* Edit Form (Only editable if pending) */}
              <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-center gap-1 border-b border-black/5 pb-2">
                  <FileEdit className="w-4 h-4 text-indigo-600" />
                  <span className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">
                    {selectedCandidate.status === 'pending' ? 'Düzenlenebilir Alanlar' : 'Kural Detayları (Salt Okunur)'}
                  </span>
                </div>

                {/* Title */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Aday Başlığı</label>
                  <input
                    type="text"
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    disabled={selectedCandidate.status !== 'pending'}
                    className="w-full px-3 py-2 bg-[#F5F5F7] border border-black/5 rounded-xl text-[12px] font-semibold text-[#1D1D1F] outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition-all"
                  />
                </div>

                {/* Summary */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Kural Özeti</label>
                  <textarea
                    value={editedSummary}
                    onChange={(e) => setEditedSummary(e.target.value)}
                    disabled={selectedCandidate.status !== 'pending'}
                    rows={2}
                    className="w-full p-3 bg-[#F5F5F7] border border-black/5 rounded-xl text-[12px] font-semibold text-[#1D1D1F] outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition-all leading-normal"
                  />
                </div>

                {/* Suggested Rule Text */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Önerilen Kural Metni</label>
                    <span className="text-[10px] font-bold text-[#86868B]">{editedRuleText.length} Karakter</span>
                  </div>
                  <textarea
                    value={editedRuleText}
                    onChange={(e) => setEditedRuleText(e.target.value)}
                    disabled={selectedCandidate.status !== 'pending'}
                    rows={5}
                    className="w-full p-3 bg-[#F5F5F7] border border-black/5 rounded-xl text-[12px] font-semibold text-[#1D1D1F] outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition-all font-mono leading-relaxed"
                  />
                </div>

                {/* Review Note */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#86868B] uppercase tracking-wider">Değerlendirme Notu / Audit Notu</label>
                  <textarea
                    value={editedReviewNote}
                    onChange={(e) => setEditedReviewNote(e.target.value)}
                    disabled={selectedCandidate.status !== 'pending'}
                    rows={2}
                    placeholder="Onaylama veya inceleme nedeni buraya eklenebilir..."
                    className="w-full p-3 bg-[#F5F5F7] border border-black/5 rounded-xl text-[12px] font-semibold text-[#1D1D1F] outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 transition-all leading-normal"
                  />
                </div>

                {/* Save Content Button */}
                {selectedCandidate.status === 'pending' && (
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={handleSaveContent}
                      disabled={savingContent || (
                        editedTitle === selectedCandidate.title &&
                        editedSummary === selectedCandidate.summary &&
                        editedRuleText === selectedCandidate.suggestedRuleText &&
                        editedReviewNote === (selectedCandidate.metadata.review_note || "")
                      )}
                      className="px-4 py-2 bg-indigo-600 disabled:opacity-40 hover:bg-indigo-700 text-white text-[11px] font-extrabold rounded-xl shadow-sm transition-all cursor-pointer"
                    >
                      {savingContent ? "Kaydediliyor..." : "Değişiklikleri Kaydet"}
                    </button>
                  </div>
                )}
              </div>

              {/* Technical Fingerprint (Collapsible) */}
              <div className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm space-y-2">
                <button
                  onClick={() => setIsFingerprintOpen(!isFingerprintOpen)}
                  className="w-full flex items-center justify-between text-[10px] font-bold text-[#86868B] uppercase tracking-wider outline-none"
                >
                  <span>Teknik Parmak İzi (Fingerprint)</span>
                  <ChevronRight className={`w-4 h-4 transition-transform ${isFingerprintOpen ? 'rotate-90' : ''}`} />
                </button>
                {isFingerprintOpen && (
                  <div className="p-3 bg-[#F5F5F7] border border-black/5 rounded-xl font-mono text-[9px] font-semibold text-[#1D1D1F] select-all break-all leading-normal">
                    {selectedCandidate.fingerprint}
                  </div>
                )}
              </div>

            </div>

            {/* Drawer Footer Actions */}
            <div className="bg-white border-t border-black/5 p-4 flex items-center gap-2">
              {selectedCandidate.status === 'pending' ? (
                <>
                  <button
                    onClick={() => handleStatusChange(selectedCandidate, 'ignored')}
                    disabled={actionLoading !== null}
                    className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-[12px] font-extrabold rounded-xl transition-all"
                  >
                    Yok Say
                  </button>
                  <button
                    onClick={() => handleStatusChange(selectedCandidate, 'rejected')}
                    disabled={actionLoading !== null}
                    className="flex-1 py-2.5 border border-red-200 hover:bg-red-50 text-red-600 text-[12px] font-extrabold rounded-xl transition-all"
                  >
                    Reddet
                  </button>
                  <button
                    onClick={() => handleStatusChange(selectedCandidate, 'approved')}
                    disabled={actionLoading !== null || selectedCandidate.riskLevel === 'blocked'}
                    className={`flex-1 py-2.5 text-white text-[12px] font-extrabold rounded-xl shadow-sm transition-all ${
                      selectedCandidate.riskLevel === 'blocked'
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed border-none'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    {actionLoading === "approved" ? "..." : "Onayla"}
                  </button>
                </>
              ) : selectedCandidate.status === 'ignored' ? (
                <button
                  onClick={() => handleStatusChange(selectedCandidate, 'pending')}
                  disabled={actionLoading !== null}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-extrabold rounded-xl shadow-sm transition-all"
                >
                  {actionLoading === "pending" ? "..." : "Sıraya Geri Al"}
                </button>
              ) : (
                <div className="w-full text-center py-2.5 text-[11px] font-extrabold text-[#86868B]">
                  Bu aday {selectedCandidate.status === 'approved' ? 'ONAYLANDI' : 'REDDEDİLDİ'} durumundadır ve içeriği düzenlenemez.
                </div>
              )}
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

    </div>
  );
}
