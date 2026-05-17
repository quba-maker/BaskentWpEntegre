"use client";

import { useEffect, useState } from "react";
import { getTenantSettings, updateTenantSettings, getUsageStats } from "@/app/actions/settings";
import { changeMyPassword } from "@/app/actions/users";
import { Building2, Gauge, Shield, KeyRound } from "lucide-react";
import { PageLoader } from "@/components/ui/shared-states";
import { SectionCard, SectionHeader, SaveButton, ActionButton } from "@/components/governance";

// ==========================================
// QUBA AI — Settings Page
// Authority: Company profile + Account + Usage
// Governance: SectionCard + SaveButton + ActionButton
// ==========================================

export default function SettingsPage() {
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
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto p-6 pb-20 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-[22px] font-bold" style={{ color: "var(--q-text-primary)" }}>Ayarlar</h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--q-text-secondary)" }}>Firma bilgileri ve hesap ayarlarınızı yönetin.</p>
        </div>

        {/* Plan & Usage */}
        {usage && (
          <SectionCard>
            <SectionHeader icon={Gauge} title="Kullanım" />
            <div className="grid grid-cols-2 gap-4">
              <StatBox label="Plan" value={usage.plan.toUpperCase()} />
              <StatBox label="Bu Ay Mesaj" value={`${usage.totalMessages} / ${usage.limit}`} />
              <StatBox label="AI Mesajları" value={String(usage.totalAiMessages)} />
              <StatBox label="Tahmini Maliyet" value={`$${usage.estimatedCost.toFixed(2)}`} />
            </div>
            <div className="mt-3">
              <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--q-bg-secondary)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min((usage.totalMessages / usage.limit) * 100, 100)}%`,
                    background: "linear-gradient(to right, var(--q-blue), var(--q-purple))",
                    transition: "width var(--q-transition-slow)",
                  }}
                />
              </div>
              <p className="text-[11px] mt-1" style={{ color: "var(--q-text-secondary)" }}>
                {Math.round((usage.totalMessages / usage.limit) * 100)}% kullanıldı
              </p>
            </div>
          </SectionCard>
        )}

        {/* Firma Bilgileri */}
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

        {/* Hesap */}
        <SectionCard>
          <SectionHeader icon={Shield} title="Hesap" />
          <div className="space-y-0">
            <InfoRow label="Ad" value={user?.name || "—"} />
            <InfoRow label="E-posta" value={user?.email || "—"} />
            <InfoRow label="Rol" value={user?.role === "owner" ? "Sahip" : user?.role || "—"} />
            <InfoRow label="Tenant Slug" value={tenant.slug} />
          </div>
        </SectionCard>

        {/* Şifre Değiştir */}
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

        {/* Save */}
        <SaveButton saving={saving} saved={saved} onClick={handleSave} />
      </div>
    </div>
  );
}

// ---- Local sub-components (display-only, no governance equivalent needed) ----

function Field({ label, value, onChange, type = "text", options }: { label: string; value: string; onChange: (v: string) => void; type?: string; options?: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--q-text-secondary)" }}>{label}</label>
      {type === "select" && options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 text-[14px] border-0 rounded-xl outline-none" style={{ backgroundColor: "var(--q-bg-secondary)" }}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2.5 text-[14px] border-0 rounded-xl outline-none" style={{ backgroundColor: "var(--q-bg-secondary)" }} />
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 last:border-0" style={{ borderBottom: "1px solid var(--q-border-default)" }}>
      <span className="text-[13px]" style={{ color: "var(--q-text-secondary)" }}>{label}</span>
      <span className="text-[13px] font-medium font-mono" style={{ color: "var(--q-text-primary)" }}>{value}</span>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: "var(--q-bg-secondary)" }}>
      <p className="text-[11px] font-medium" style={{ color: "var(--q-text-secondary)" }}>{label}</p>
      <p className="text-[16px] font-bold mt-0.5" style={{ color: "var(--q-text-primary)" }}>{value}</p>
    </div>
  );
}
