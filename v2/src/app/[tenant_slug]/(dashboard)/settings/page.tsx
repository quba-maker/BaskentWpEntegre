"use client";

import { useEffect, useState } from "react";
import { getTenantSettings, updateTenantSettings, getUsageStats } from "@/app/actions/settings";
import { changeMyPassword } from "@/app/actions/users";
import { Building2, Gauge, Shield, Save, Loader2, CheckCircle, KeyRound } from "lucide-react";
import { PageLoader } from "@/components/ui/shared-states";

// ==========================================
// QUBA AI — Settings Page (Apple Style)
// Single Responsibility: Company + Account + Usage
// Bot/AI config → Bot Yönetimi page
// Meta/Integration config → Entegrasyonlar page
// ==========================================

export default function SettingsPage() {
  const [tenant, setTenant] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Password change
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [form, setForm] = useState({
    name: "",
    industry: "",
    timezone: "Europe/Istanbul",
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [tenantRes, usageRes] = await Promise.all([
      getTenantSettings(),
      getUsageStats(),
    ]);

    if (tenantRes.success && tenantRes.tenant) {
      setTenant(tenantRes.tenant);
      setUser(tenantRes.user);
      setForm({
        name: tenantRes.tenant.name || "",
        industry: tenantRes.tenant.industry || "",
        timezone: tenantRes.tenant.timezone || "Europe/Istanbul",
      });
    }

    if (usageRes.success && usageRes.stats) {
      setUsage(usageRes.stats);
    }
  }

  async function handlePasswordChange() {
    if (pwNew.length < 6) { setPwMsg("❌ Yeni şifre en az 6 karakter."); return; }
    if (pwNew !== pwConfirm) { setPwMsg("❌ Şifreler eşleşmiyor."); return; }
    setPwLoading(true); setPwMsg("");
    const res = await changeMyPassword(pwCurrent, pwNew);
    if (res.success) {
      setPwMsg("✅ Şifre başarıyla güncellendi!");
      setPwCurrent(""); setPwNew(""); setPwConfirm("");
    } else {
      setPwMsg(`❌ ${res.error}`);
    }
    setPwLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    await updateTenantSettings(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!tenant) return <PageLoader />;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto p-6 pb-20 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-[22px] font-bold text-[#1D1D1F]">Ayarlar</h1>
          <p className="text-[13px] text-[#86868B] mt-1">Firma bilgileri ve hesap ayarlarınızı yönetin.</p>
        </div>

        {/* Plan & Usage */}
        {usage && (
          <Card icon={<Gauge className="w-5 h-5" />} title="Kullanım">
            <div className="grid grid-cols-2 gap-4">
              <StatBox label="Plan" value={usage.plan.toUpperCase()} />
              <StatBox label="Bu Ay Mesaj" value={`${usage.totalMessages} / ${usage.limit}`} />
              <StatBox label="AI Mesajları" value={String(usage.totalAiMessages)} />
              <StatBox label="Tahmini Maliyet" value={`$${usage.estimatedCost.toFixed(2)}`} />
            </div>
            <div className="mt-3">
              <div className="h-2 bg-[#F5F5F7] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#007AFF] to-[#5856D6] rounded-full transition-all"
                  style={{ width: `${Math.min((usage.totalMessages / usage.limit) * 100, 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-[#86868B] mt-1">
                {Math.round((usage.totalMessages / usage.limit) * 100)}% kullanıldı
              </p>
            </div>
          </Card>
        )}

        {/* Firma Bilgileri */}
        <Card icon={<Building2 className="w-5 h-5" />} title="Firma Bilgileri">
          <Field label="Firma Adı" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Sektör" value={form.industry} onChange={(v) => setForm({ ...form, industry: v })} type="select" options={[
            { value: "health", label: "Sağlık" },
            { value: "real_estate", label: "Gayrimenkul" },
            { value: "education", label: "Eğitim" },
            { value: "ecommerce", label: "E-Ticaret" },
            { value: "general", label: "Genel" },
          ]} />
          <Field label="Zaman Dilimi" value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })} type="select" options={[
            { value: "Europe/Istanbul", label: "Türkiye (GMT+3)" },
            { value: "Europe/Berlin", label: "Almanya (GMT+2)" },
            { value: "Asia/Dubai", label: "Dubai (GMT+4)" },
          ]} />
        </Card>

        {/* Hesap */}
        <Card icon={<Shield className="w-5 h-5" />} title="Hesap">
          <InfoRow label="Ad" value={user?.name || "—"} />
          <InfoRow label="E-posta" value={user?.email || "—"} />
          <InfoRow label="Rol" value={user?.role === "owner" ? "Sahip" : user?.role || "—"} />
          <InfoRow label="Tenant Slug" value={tenant.slug} />
        </Card>

        {/* Şifre Değiştir */}
        <Card icon={<KeyRound className="w-5 h-5" />} title="Şifre Değiştir">
          <Field label="Mevcut Şifre" value={pwCurrent} onChange={setPwCurrent} type="password" />
          <Field label="Yeni Şifre" value={pwNew} onChange={setPwNew} type="password" />
          <Field label="Yeni Şifre (Tekrar)" value={pwConfirm} onChange={setPwConfirm} type="password" />
          {pwMsg && <p className={`text-[13px] ${pwMsg.startsWith('✅') ? 'text-[#34C759]' : 'text-[#FF3B30]'}`}>{pwMsg}</p>}
          <button
            onClick={handlePasswordChange}
            disabled={pwLoading || !pwCurrent || pwNew.length < 6}
            className="px-5 py-2.5 bg-[#FF9500] hover:bg-[#E68A00] text-white text-[13px] font-semibold rounded-xl transition-all disabled:opacity-50"
          >
            {pwLoading ? "Değiştiriliyor..." : "Şifre Güncelle"}
          </button>
        </Card>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-[#007AFF] hover:bg-[#0066D6] text-white text-[15px] font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Kaydediliyor...</>
          ) : saved ? (
            <><CheckCircle className="w-4 h-4" /> Kaydedildi!</>
          ) : (
            <><Save className="w-4 h-4" /> Kaydet</>
          )}
        </button>
      </div>
    </div>
  );
}

// Sub-components
function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-black/5 flex items-center gap-3">
        <span className="text-[#007AFF]">{icon}</span>
        <h2 className="text-[15px] font-semibold text-[#1D1D1F]">{title}</h2>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", options }: { label: string; value: string; onChange: (v: string) => void; type?: string; options?: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-[#86868B] mb-1">{label}</label>
      {type === "select" && options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 text-[14px] bg-[#F5F5F7] border-0 rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 text-[14px] bg-[#F5F5F7] border-0 rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30" />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-black/5 last:border-0">
      <span className="text-[13px] text-[#86868B]">{label}</span>
      <span className="text-[13px] font-medium text-[#1D1D1F] font-mono">{value}</span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#F5F5F7] rounded-xl p-3">
      <p className="text-[11px] text-[#86868B] font-medium">{label}</p>
      <p className="text-[16px] font-bold text-[#1D1D1F] mt-0.5">{value}</p>
    </div>
  );
}
