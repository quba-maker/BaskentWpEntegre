"use client";

import { useEffect, useState } from "react";
import { getTenantSettings, updateTenantSettings, getUsageStats } from "@/app/actions/settings";
import { changeMyPassword } from "@/app/actions/users";
import { Building2, Gauge, Shield, KeyRound, CreditCard, LayoutDashboard } from "lucide-react";
import { PageLoader } from "@/components/ui/shared-states";
import { SectionCard, SectionHeader, SaveButton, ActionButton } from "@/components/governance";

// ==========================================
// QUBA AI — Modular Settings Page
// Architecture: Apple/Stripe-inspired vertical tabs
// ==========================================

type TabType = 'general' | 'account' | 'billing';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [tenant, setTenant] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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

  useEffect(() => { loadData(); }, []);

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
    if (usageRes.success && usageRes.stats) setUsage(usageRes.stats);
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
    <div className="h-full flex flex-col md:flex-row bg-[#FAFAFA] dark:bg-black">
      {/* Sidebar Navigation */}
      <div className="w-full md:w-64 border-r border-black/5 dark:border-white/10 p-6 flex-shrink-0">
        <div className="mb-8">
          <h1 className="text-[22px] font-semibold tracking-tight text-black dark:text-white">Ayarlar</h1>
          <p className="text-[13px] text-black/50 dark:text-white/50 mt-1">Sistem yapılandırması</p>
        </div>
        
        <nav className="space-y-1">
          <TabButton 
            active={activeTab === 'general'} 
            icon={Building2} 
            label="Genel" 
            onClick={() => setActiveTab('general')} 
          />
          <TabButton 
            active={activeTab === 'account'} 
            icon={Shield} 
            label="Hesap ve Güvenlik" 
            onClick={() => setActiveTab('account')} 
          />
          <TabButton 
            active={activeTab === 'billing'} 
            icon={CreditCard} 
            label="Faturalandırma" 
            onClick={() => setActiveTab('billing')} 
          />
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-6 md:p-10 pb-24">
        <div className="max-w-2xl">
          
          {/* TAB: GENERAL */}
          {activeTab === 'general' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div>
                <h2 className="text-lg font-medium text-black dark:text-white">Çalışma Alanı Genel Ayarları</h2>
                <p className="text-[13px] text-black/50 dark:text-white/50 mt-1">Şirket profilinizi ve saat dilimini yapılandırın.</p>
              </div>

              <SectionCard>
                <SectionHeader icon={Building2} title="Firma Bilgileri" />
                <div className="space-y-4">
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
                </div>
              </SectionCard>

              <SaveButton saving={saving} saved={saved} onClick={handleSave} />
            </div>
          )}

          {/* TAB: ACCOUNT */}
          {activeTab === 'account' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div>
                <h2 className="text-lg font-medium text-black dark:text-white">Hesap ve Güvenlik</h2>
                <p className="text-[13px] text-black/50 dark:text-white/50 mt-1">Yetkili hesap bilgileri ve şifre yönetimi.</p>
              </div>

              <SectionCard>
                <SectionHeader icon={Shield} title="Yetkili Profil" />
                <div className="space-y-0">
                  <InfoRow label="Ad" value={user?.name || "—"} />
                  <InfoRow label="E-posta" value={user?.email || "—"} />
                  <InfoRow label="Rol" value={user?.role === "owner" ? "Sahip" : user?.role || "—"} />
                  <InfoRow label="Tenant Slug" value={tenant.slug} />
                </div>
              </SectionCard>

              <SectionCard>
                <SectionHeader icon={KeyRound} title="Şifre Değiştir" />
                <div className="space-y-4">
                  <Field label="Mevcut Şifre" value={pwCurrent} onChange={setPwCurrent} type="password" />
                  <Field label="Yeni Şifre" value={pwNew} onChange={setPwNew} type="password" />
                  <Field label="Yeni Şifre (Tekrar)" value={pwConfirm} onChange={setPwConfirm} type="password" />
                  {pwMsg && <p className={`text-[13px] ${pwMsg.startsWith('✅') ? 'text-[--q-green]' : 'text-[--q-red]'}`}>{pwMsg}</p>}
                  <ActionButton
                    onClick={handlePasswordChange}
                    color="var(--q-orange)"
                    disabled={pwLoading || !pwCurrent || pwNew.length < 6}
                  >
                    {pwLoading ? "Değiştiriliyor..." : "Şifre Güncelle"}
                  </ActionButton>
                </div>
              </SectionCard>
            </div>
          )}

          {/* TAB: BILLING & USAGE */}
          {activeTab === 'billing' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div>
                <h2 className="text-lg font-medium text-black dark:text-white">Faturalandırma ve Kullanım</h2>
                <p className="text-[13px] text-black/50 dark:text-white/50 mt-1">Gerçek zamanlı AI maliyetleri ve plan sınırları.</p>
              </div>

              {usage ? (
                <SectionCard>
                  <SectionHeader icon={Gauge} title="Gerçek Zamanlı Tüketim" />
                  <div className="grid grid-cols-2 gap-4">
                    <StatBox label="Mevcut Plan" value={usage.plan.toUpperCase()} />
                    <StatBox label="Aylık AI Mesajı" value={`${usage.totalMessages} / ${usage.limit}`} />
                    <StatBox label="İşlenen Token" value={String(usage.totalAiMessages)} />
                    <StatBox label="Tahmini Maliyet" value={`$${usage.estimatedCost.toFixed(2)}`} />
                  </div>
                  <div className="mt-4 p-4 rounded-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
                    <div className="flex justify-between text-[12px] font-medium mb-2 text-black/60 dark:text-white/60">
                      <span>Kota Kullanımı</span>
                      <span>{Math.round((usage.totalMessages / usage.limit) * 100)}%</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden bg-black/10 dark:bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min((usage.totalMessages / usage.limit) * 100, 100)}%`,
                          background: "linear-gradient(to right, #007AFF, #5856D6)",
                          transition: "width 0.5s ease-out",
                        }}
                      />
                    </div>
                  </div>
                </SectionCard>
              ) : (
                <div className="p-6 text-center text-[13px] text-black/50">Kullanım verisi yükleniyor...</div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ---- Local Sub-Components ----

function TabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: any; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] font-medium transition-colors ${
        active 
          ? "bg-black/5 dark:bg-white/10 text-black dark:text-white" 
          : "text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5 hover:text-black dark:hover:text-white"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function Field({ label, value, onChange, type = "text", options }: { label: string; value: string; onChange: (v: string) => void; type?: string; options?: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-[12px] font-medium mb-1.5 text-black/60 dark:text-white/60">{label}</label>
      {type === "select" && options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 text-[14px] border border-black/10 dark:border-white/10 rounded-xl outline-none bg-white dark:bg-[#111] focus:ring-2 focus:ring-[#007AFF]/20 transition-all text-black dark:text-white">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 text-[14px] border border-black/10 dark:border-white/10 rounded-xl outline-none bg-white dark:bg-[#111] focus:ring-2 focus:ring-[#007AFF]/20 transition-all text-black dark:text-white" />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3 last:border-0 border-b border-black/5 dark:border-white/5">
      <span className="text-[13px] text-black/60 dark:text-white/60">{label}</span>
      <span className="text-[13px] font-medium font-mono text-black dark:text-white">{value}</span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-4 bg-white dark:bg-[#111] border border-black/5 dark:border-white/10 shadow-sm">
      <p className="text-[12px] font-medium text-black/50 dark:text-white/50">{label}</p>
      <p className="text-[18px] font-bold mt-1 text-black dark:text-white tracking-tight">{value}</p>
    </div>
  );
}
