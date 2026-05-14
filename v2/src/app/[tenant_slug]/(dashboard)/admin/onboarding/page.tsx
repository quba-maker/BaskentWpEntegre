"use client";

import { useState } from "react";
import { createTenant, updateTenantConfig, createTenantUser, verifyTenantSetup } from "@/app/actions/admin";
import {
  Building2, Key, UserPlus, CheckCircle2, ChevronRight, ChevronLeft,
  Loader2, AlertCircle, Sparkles, ArrowRight, Copy, Check
} from "lucide-react";

// ==========================================
// QUBA AI — Onboarding Wizard
// 4 adımlı yeni firma kurulum sihirbazı
// ==========================================

const STEPS = [
  { id: 1, title: "Firma Bilgileri", icon: Building2, desc: "Temel firma bilgilerini girin" },
  { id: 2, title: "Entegrasyon", icon: Key, desc: "WhatsApp & Meta bağlantıları" },
  { id: 3, title: "Admin Kullanıcı", icon: UserPlus, desc: "Firma yöneticisini oluşturun" },
  { id: 4, title: "Doğrulama", icon: CheckCircle2, desc: "Kurulumu kontrol edin" },
];

const INDUSTRIES = [
  { value: "health", label: "🏥 Sağlık" },
  { value: "real_estate", label: "🏠 Gayrimenkul" },
  { value: "education", label: "🎓 Eğitim" },
  { value: "ecommerce", label: "🛒 E-Ticaret" },
  { value: "beauty", label: "💇 Güzellik & Bakım" },
  { value: "automotive", label: "🚗 Otomotiv" },
  { value: "legal", label: "⚖️ Hukuk" },
  { value: "food", label: "🍽️ Yeme & İçme" },
  { value: "general", label: "🏢 Genel" },
];

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Step 1 — Firma
  const [firm, setFirm] = useState({ name: "", slug: "", industry: "general", plan: "starter" });
  
  // Step 2 — Entegrasyon
  const [config, setConfig] = useState({
    meta_page_token: "", whatsapp_phone_id: "", whatsapp_business_id: "",
    meta_page_id: "", instagram_id: "", ai_model: "gemini-2.5-flash"
  });

  // Step 3 — Admin
  const [admin, setAdmin] = useState({ name: "", email: "", password: "" });

  // Step 4 — Doğrulama
  const [checks, setChecks] = useState<any[]>([]);
  const [ready, setReady] = useState(false);
  const [summary, setSummary] = useState("");

  // Auto-slug generation
  function handleNameChange(name: string) {
    const slug = name
      .toLowerCase()
      .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
      .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .substring(0, 30);
    setFirm({ ...firm, name, slug });
  }

  // Step 1: Firma Oluştur
  async function handleStep1() {
    if (!firm.name || !firm.slug) { setError("Firma adı ve slug gerekli."); return; }
    setLoading(true); setError("");
    
    const res = await createTenant(firm);
    if (res.success && res.tenantId) {
      setTenantId(res.tenantId);
      setStep(2);
    } else {
      setError(res.error || "Firma oluşturulamadı.");
    }
    setLoading(false);
  }

  // Step 2: Config Kaydet
  async function handleStep2() {
    if (!tenantId) return;
    setLoading(true); setError("");
    
    const res = await updateTenantConfig(tenantId, config);
    if (res.success) {
      setStep(3);
    } else {
      setError(res.error || "Ayarlar kaydedilemedi.");
    }
    setLoading(false);
  }

  // Step 3: Admin Oluştur
  async function handleStep3() {
    if (!admin.name || !admin.email || !admin.password) { setError("Tüm alanları doldurun."); return; }
    if (admin.password.length < 6) { setError("Şifre en az 6 karakter olmalı."); return; }
    if (!tenantId) return;
    setLoading(true); setError("");
    
    const res = await createTenantUser(tenantId, { ...admin, role: "admin" });
    if (res.success) {
      setStep(4);
      // Otomatik doğrulama başlat
      runVerification();
    } else {
      setError(res.error || "Kullanıcı oluşturulamadı.");
    }
    setLoading(false);
  }

  // Step 4: Doğrulama
  async function runVerification() {
    if (!tenantId) return;
    setLoading(true);
    
    const res = await verifyTenantSetup(tenantId);
    if (res.success) {
      setChecks(res.checks || []);
      setReady(res.ready || false);
      setSummary(res.summary || "");
    }
    setLoading(false);
  }

  function copyWebhookUrl() {
    navigator.clipboard.writeText("https://ai.qubamedya.com/api/webhook");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto p-6 pb-20">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-[24px] font-bold text-[#1D1D1F] flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-[#AF52DE]" /> Yeni Firma Kurulumu
          </h1>
          <p className="text-[14px] text-[#86868B] mt-1">
            Adım adım yeni firmayı sisteme ekleyin
          </p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium transition-all w-full
                ${step === s.id ? 'bg-[#007AFF] text-white shadow-sm' : 
                  step > s.id ? 'bg-[#34C759]/10 text-[#34C759]' : 'bg-[#F5F5F7] text-[#86868B]'}`}
              >
                <s.icon className="w-4 h-4 flex-shrink-0" />
                <span className="hidden sm:inline truncate">{s.title}</span>
                <span className="sm:hidden">{s.id}</span>
              </div>
              {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-[#86868B] flex-shrink-0" />}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-[#FF3B30]/8 border border-[#FF3B30]/15 rounded-xl mb-6 text-[13px] text-[#FF3B30]">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* Step 1: Firma Bilgileri */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 space-y-5">
            <div>
              <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Firma Bilgileri</h2>
              <p className="text-[13px] text-[#86868B] mt-1">Firmanın temel bilgilerini girin</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">Firma Adı *</label>
                <input
                  placeholder="Örn: Başkent Hastanesi"
                  value={firm.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full mt-1.5 px-4 py-3 text-[15px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all"
                />
              </div>

              <div>
                <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">URL Slug *</label>
                <div className="flex items-center mt-1.5 bg-[#F5F5F7] rounded-xl overflow-hidden">
                  <span className="pl-4 text-[13px] text-[#86868B]">ai.qubamedya.com/</span>
                  <input
                    value={firm.slug}
                    onChange={(e) => setFirm({ ...firm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                    className="flex-1 py-3 pr-4 text-[15px] bg-transparent outline-none font-mono"
                    placeholder="firma-slug"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">Sektör</label>
                  <select
                    value={firm.industry}
                    onChange={(e) => setFirm({ ...firm, industry: e.target.value })}
                    className="w-full mt-1.5 px-4 py-3 text-[14px] bg-[#F5F5F7] rounded-xl outline-none"
                  >
                    {INDUSTRIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">Plan</label>
                  <select
                    value={firm.plan}
                    onChange={(e) => setFirm({ ...firm, plan: e.target.value })}
                    className="w-full mt-1.5 px-4 py-3 text-[14px] bg-[#F5F5F7] rounded-xl outline-none"
                  >
                    <option value="starter">Starter — 500 mesaj/ay</option>
                    <option value="professional">Professional — 2000 mesaj/ay</option>
                    <option value="enterprise">Enterprise — Sınırsız</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleStep1}
              disabled={loading || !firm.name || !firm.slug}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#007AFF] hover:bg-[#0066D6] text-white text-[15px] font-semibold rounded-xl transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><span>Firma Oluştur</span><ArrowRight className="w-4 h-4" /></>}
            </button>
          </div>
        )}

        {/* Step 2: Entegrasyon */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 space-y-5">
            <div>
              <h2 className="text-[17px] font-semibold text-[#1D1D1F]">WhatsApp & Meta Entegrasyonu</h2>
              <p className="text-[13px] text-[#86868B] mt-1">Meta Business portalından alınan bilgileri girin</p>
            </div>

            {/* Webhook URL */}
            <div className="bg-[#F5F5F7] rounded-xl p-4">
              <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">Webhook URL</label>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-[13px] text-[#1D1D1F] font-mono flex-1">https://ai.qubamedya.com/api/webhook</code>
                <button onClick={copyWebhookUrl} className="p-2 hover:bg-white rounded-lg transition-colors">
                  {copied ? <Check className="w-4 h-4 text-[#34C759]" /> : <Copy className="w-4 h-4 text-[#86868B]" />}
                </button>
              </div>
              <p className="text-[11px] text-[#86868B] mt-1">Bu URL'yi Meta Business → Webhook ayarlarına yapıştırın</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">Meta Page Token *</label>
                <input
                  type="password"
                  placeholder="EAAxxxxxxx..."
                  value={config.meta_page_token}
                  onChange={(e) => setConfig({ ...config, meta_page_token: e.target.value })}
                  className="w-full mt-1.5 px-4 py-3 text-[14px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30 font-mono"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">WhatsApp Phone ID *</label>
                  <input
                    placeholder="1234567890"
                    value={config.whatsapp_phone_id}
                    onChange={(e) => setConfig({ ...config, whatsapp_phone_id: e.target.value })}
                    className="w-full mt-1.5 px-4 py-3 text-[14px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">Business Account ID</label>
                  <input
                    placeholder="Opsiyonel"
                    value={config.whatsapp_business_id}
                    onChange={(e) => setConfig({ ...config, whatsapp_business_id: e.target.value })}
                    className="w-full mt-1.5 px-4 py-3 text-[14px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">Facebook Page ID</label>
                  <input
                    placeholder="Messenger için"
                    value={config.meta_page_id}
                    onChange={(e) => setConfig({ ...config, meta_page_id: e.target.value })}
                    className="w-full mt-1.5 px-4 py-3 text-[14px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">Instagram ID</label>
                  <input
                    placeholder="Instagram DM için"
                    value={config.instagram_id}
                    onChange={(e) => setConfig({ ...config, instagram_id: e.target.value })}
                    className="w-full mt-1.5 px-4 py-3 text-[14px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">AI Model</label>
                <select
                  value={config.ai_model}
                  onChange={(e) => setConfig({ ...config, ai_model: e.target.value })}
                  className="w-full mt-1.5 px-4 py-3 text-[14px] bg-[#F5F5F7] rounded-xl outline-none"
                >
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (Hızlı, Ekonomik)</option>
                  <option value="gemini-2.5-flash-lite">Flash Lite (Ultra Ekonomik)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro (Premium)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="px-5 py-3 bg-[#F5F5F7] text-[#1D1D1F] text-[14px] font-medium rounded-xl flex items-center gap-1.5">
                <ChevronLeft className="w-4 h-4" /> Geri
              </button>
              <button
                onClick={handleStep2}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#007AFF] hover:bg-[#0066D6] text-white text-[15px] font-semibold rounded-xl transition-all disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><span>Kaydet & Devam</span><ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>

            <p className="text-[11px] text-[#86868B] text-center">
              Bu adımı atlayabilirsiniz — entegrasyon sonra da yapılabilir
            </p>
          </div>
        )}

        {/* Step 3: Admin Kullanıcı */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6 space-y-5">
            <div>
              <h2 className="text-[17px] font-semibold text-[#1D1D1F]">Admin Kullanıcı Oluştur</h2>
              <p className="text-[13px] text-[#86868B] mt-1">Firma yöneticisinin giriş bilgilerini belirleyin</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">Ad Soyad *</label>
                <input
                  placeholder="Firma yöneticisinin adı"
                  value={admin.name}
                  onChange={(e) => setAdmin({ ...admin, name: e.target.value })}
                  className="w-full mt-1.5 px-4 py-3 text-[15px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">E-posta *</label>
                <input
                  type="email"
                  placeholder="admin@firma.com"
                  value={admin.email}
                  onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
                  className="w-full mt-1.5 px-4 py-3 text-[15px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-[#86868B] uppercase tracking-wide">Şifre * (min 6 karakter)</label>
                <input
                  type="password"
                  placeholder="Güçlü bir şifre belirleyin"
                  value={admin.password}
                  onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                  className="w-full mt-1.5 px-4 py-3 text-[15px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                />
                {admin.password && admin.password.length < 6 && (
                  <p className="text-[11px] text-[#FF3B30] mt-1">Şifre en az 6 karakter olmalı</p>
                )}
              </div>
            </div>

            <div className="bg-[#F5F5F7] rounded-xl p-4 space-y-1">
              <p className="text-[12px] font-medium text-[#1D1D1F]">Giriş Bilgileri</p>
              <p className="text-[12px] text-[#86868B]">Panel: <code className="font-mono">ai.qubamedya.com</code></p>
              <p className="text-[12px] text-[#86868B]">E-posta: <code className="font-mono">{admin.email || "—"}</code></p>
              <p className="text-[12px] text-[#86868B]">Şifre: ******</p>
              <p className="text-[11px] text-[#FF9500] mt-2">⚠️ Bu bilgileri firma yöneticisine güvenli bir şekilde iletin</p>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(2)} className="px-5 py-3 bg-[#F5F5F7] text-[#1D1D1F] text-[14px] font-medium rounded-xl flex items-center gap-1.5">
                <ChevronLeft className="w-4 h-4" /> Geri
              </button>
              <button
                onClick={handleStep3}
                disabled={loading || !admin.name || !admin.email || admin.password.length < 6}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#34C759] hover:bg-[#30B350] text-white text-[15px] font-semibold rounded-xl transition-all disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><span>Oluştur & Doğrula</span><CheckCircle2 className="w-4 h-4" /></>}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Doğrulama */}
        {step === 4 && (
          <div className="space-y-4">
            <div className={`rounded-2xl border p-6 ${ready ? 'bg-[#34C759]/5 border-[#34C759]/20' : 'bg-[#FF9500]/5 border-[#FF9500]/20'}`}>
              <h2 className="text-[20px] font-bold text-[#1D1D1F]">
                {ready ? "✅ Kurulum Tamamlandı!" : "⚠️ Kurulum Kontrolü"}
              </h2>
              <p className="text-[14px] text-[#86868B] mt-1">{summary}</p>
            </div>

            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-[#007AFF]" />
                </div>
              ) : (
                checks.map((c: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-black/5 last:border-0">
                    <span className="text-[14px] text-[#1D1D1F]">{c.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-[#86868B]">{c.detail}</span>
                      <span className={`text-[14px] ${c.ok ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>
                        {c.ok ? "✓" : "✗"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {ready && (
              <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 space-y-3">
                <h3 className="text-[15px] font-semibold text-[#1D1D1F]">Sonraki Adımlar</h3>
                <ul className="space-y-2 text-[13px] text-[#86868B]">
                  <li className="flex items-start gap-2"><span className="text-[#007AFF]">1.</span> Firma yöneticisine giriş bilgilerini iletin</li>
                  <li className="flex items-start gap-2"><span className="text-[#007AFF]">2.</span> Bot sayfasından AI promptlarını özelleştirin</li>
                  <li className="flex items-start gap-2"><span className="text-[#007AFF]">3.</span> Test mesajı göndererek botu doğrulayın</li>
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={runVerification}
                className="px-5 py-3 bg-[#F5F5F7] text-[#1D1D1F] text-[14px] font-medium rounded-xl"
              >
                Tekrar Kontrol
              </button>
              <a
                href="../admin"
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#007AFF] hover:bg-[#0066D6] text-white text-[15px] font-semibold rounded-xl transition-all"
              >
                Admin Paneline Dön <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
