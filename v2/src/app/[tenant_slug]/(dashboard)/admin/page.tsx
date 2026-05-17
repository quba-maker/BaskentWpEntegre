"use client";

import { useEffect, useState } from "react";
import { getAllTenants, createTenant, toggleTenantStatus } from "@/app/actions/admin";
import { startImpersonation } from "@/lib/auth/session";
import { Building2, Plus, Users, MessageSquare, Loader2, Shield, Power, Sparkles, Eye } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PageLoader, ErrorBanner } from "@/components/ui/shared-states";

// ==========================================
// QUBA AI — Super Admin Panel
// ==========================================

export default function AdminPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: "", slug: "", industry: "general", plan: "starter" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await getAllTenants();
    if (res.success && res.tenants) setTenants(res.tenants);
    setLoading(false);
  }

  async function handleCreate() {
    if (!newTenant.name || !newTenant.slug) return;
    setCreating(true);
    setError(null);
    const res = await createTenant(newTenant);
    if (res.success) {
      setShowCreate(false);
      setNewTenant({ name: "", slug: "", industry: "general", plan: "starter" });
      load();
    } else {
      setError(res.error || "Firma oluşturulamadı.");
    }
    setCreating(false);
  }

  async function handleToggle(id: string) {
    await toggleTenantStatus(id);
    load();
  }

  async function handleImpersonate(tenantId: string, slug: string) {
    const ok = await confirm({
      title: "Gözlem Moduna Geç",
      message: `Tüm admin yetkilerinizle "${slug}" firmasının arayüzüne geçiş yapmak üzeresiniz.`,
      confirmLabel: "Geçiş Yap",
      variant: "warning",
    });
    if (!ok) return;
    
    setLoading(true);
    try {
      const res = await startImpersonation(tenantId, slug);
      if (res.success && res.redirectUrl) {
        window.location.href = res.redirectUrl;
      }
    } catch (err: any) {
      setError("Geçiş hatası: " + err.message);
      setLoading(false);
    }
  }

  if (loading) return <PageLoader />;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto p-6 pb-20 space-y-6">
        {/* Error Banner */}
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-[--q-text-primary] flex items-center gap-2">
              <Shield className="w-6 h-6 text-[--q-blue]" /> Süper Admin
            </h1>
            <p className="text-[13px] text-[--q-text-secondary] mt-1">{tenants.length} firma kayıtlı</p>
          </div>
        <div className="flex items-center gap-2">
            <a
              href="admin/onboarding"
              className="flex items-center gap-2 px-4 py-2.5 bg-[--q-purple-alt] hover:bg-[--q-purple-hover] text-white text-[13px] font-semibold rounded-xl transition-all"
            >
              <Sparkles className="w-4 h-4" /> Kurulum Sihirbazı
            </a>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="flex items-center gap-2 px-4 py-2.5 bg-[--q-blue] hover:bg-[--q-blue-hover] text-white text-[13px] font-semibold rounded-xl transition-all"
            >
              <Plus className="w-4 h-4" /> Hızlı Ekle
            </button>
          </div>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="bg-white rounded-2xl border border-[--q-border-default] shadow-sm p-5 space-y-4">
            <h3 className="text-[15px] font-semibold text-[--q-text-primary]">Yeni Firma Oluştur</h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                placeholder="Firma Adı"
                value={newTenant.name}
                onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                className="px-3 py-2.5 text-[14px] bg-[--q-bg-secondary] rounded-xl outline-none focus:ring-2 focus:ring-[--q-blue]/30"
              />
              <input
                placeholder="Slug (ör: baskent)"
                value={newTenant.slug}
                onChange={(e) => setNewTenant({ ...newTenant, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                className="px-3 py-2.5 text-[14px] bg-[--q-bg-secondary] rounded-xl outline-none focus:ring-2 focus:ring-[--q-blue]/30 font-mono"
              />
              <select
                value={newTenant.industry}
                onChange={(e) => setNewTenant({ ...newTenant, industry: e.target.value })}
                className="px-3 py-2.5 text-[14px] bg-[--q-bg-secondary] rounded-xl outline-none"
              >
                <option value="health">Sağlık</option>
                <option value="real_estate">Gayrimenkul</option>
                <option value="education">Eğitim</option>
                <option value="ecommerce">E-Ticaret</option>
                <option value="general">Genel</option>
              </select>
              <select
                value={newTenant.plan}
                onChange={(e) => setNewTenant({ ...newTenant, plan: e.target.value })}
                className="px-3 py-2.5 text-[14px] bg-[--q-bg-secondary] rounded-xl outline-none"
              >
                <option value="starter">Starter</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-6 py-2.5 bg-[--q-green] hover:bg-[--q-green-hover] text-white text-[13px] font-semibold rounded-xl transition-all disabled:opacity-50"
            >
              {creating ? "Oluşturuluyor..." : "Firma Oluştur"}
            </button>
          </div>
        )}

        {/* Tenant List */}
        <div className="space-y-3">
          {tenants.map((t: any) => (
            <div key={t.id} className="bg-white rounded-2xl border border-[--q-border-default] shadow-sm p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-[15px] ${t.status === 'active' ? 'bg-gradient-to-br from-[--q-blue] to-[--q-purple]' : 'bg-[--q-text-secondary]'}`}>
                    {t.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-[15px] font-semibold text-[--q-text-primary]">{t.name}</h3>
                    <p className="text-[12px] text-[--q-text-secondary] font-mono">{t.slug} · {t.plan}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${t.status === 'active' ? 'bg-[--q-green]/10 text-[--q-green]' : 'bg-[--q-red-bg] text-[--q-red]'}`}>
                    {t.status === 'active' ? 'Aktif' : 'Askıda'}
                  </span>
                  
                  <button
                    onClick={() => handleImpersonate(t.id, t.slug)}
                    className="p-2 hover:bg-[--q-blue]/10 text-[--q-blue] rounded-lg transition-colors"
                    title="Müşteri Gözünden Bak"
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleToggle(t.id)}
                    className="p-2 hover:bg-black/5 rounded-lg transition-colors"
                    title={t.status === 'active' ? 'Askıya Al' : 'Aktifleştir'}
                  >
                    <Power className={`w-4 h-4 ${t.status === 'active' ? 'text-[--q-green]' : 'text-[--q-red]'}`} />
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="flex items-center gap-2 text-[12px] text-[--q-text-secondary]">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{t.conversation_count || 0} konuşma</span>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-[--q-text-secondary]">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>{t.message_count || 0} mesaj</span>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-[--q-text-secondary]">
                  <Users className="w-3.5 h-3.5" />
                  <span>{t.user_count || 0} kullanıcı</span>
                </div>
              </div>

              {/* Meta Info */}
              {(t.whatsapp_phone_id || t.meta_page_id || t.instagram_id) && (
                <div className="mt-3 pt-3 border-t border-[--q-border-default] flex gap-4 text-[11px] text-[--q-text-secondary] font-mono">
                  {t.whatsapp_phone_id && <span>WA: {t.whatsapp_phone_id.substring(0, 8)}...</span>}
                  {t.meta_page_id && <span>FB: {t.meta_page_id.substring(0, 8)}...</span>}
                  {t.instagram_id && <span>IG: {t.instagram_id.substring(0, 8)}...</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
