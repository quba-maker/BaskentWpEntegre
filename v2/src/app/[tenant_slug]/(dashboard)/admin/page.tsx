"use client";

import { useEffect, useState } from "react";
import { getAllTenants, createTenant, toggleTenantStatus } from "@/app/actions/admin";
import { startImpersonation } from "@/lib/auth/session";
import { Building2, Plus, Users, MessageSquare, Shield, Power, Eye } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PageLoader, ErrorBanner } from "@/components/ui/shared-states";
import {
  PageShell,
  PageHeader,
  SectionCard,
  CardInteractive,
  ActionButton,
  StatusBadge,
  IconButton,
  SaveButton,
} from "@/components/governance";

// ==========================================
// QUBA AI — Super Admin Panel
// Governance: PageShell + CardInteractive + StatusBadge + IconButton
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
    if (res.success && res.data) setTenants(res.data as any[]);
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
    <PageShell>
      {/* Error Banner */}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* Header */}
      <PageHeader
        icon={Shield}
        title="Süper Admin"
        subtitle={`${tenants.length} firma kayıtlı`}
      >
        <ActionButton onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4" /> Yeni Firma Ekle
        </ActionButton>
      </PageHeader>

      {/* Create Form */}
      {showCreate && (
        <SectionCard className="mb-6 q-modal-enter">
          <h3 className="text-[15px] font-semibold mb-4" style={{ color: "var(--q-text-primary)" }}>
            Yeni Firma Oluştur
          </h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <input
              placeholder="Firma Adı"
              value={newTenant.name}
              onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
              className="px-3 py-2.5 text-[14px] rounded-xl outline-none"
              style={{ backgroundColor: "var(--q-bg-secondary)" }}
            />
            <input
              placeholder="Slug (ör: baskent)"
              value={newTenant.slug}
              onChange={(e) => setNewTenant({ ...newTenant, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
              className="px-3 py-2.5 text-[14px] rounded-xl outline-none font-mono"
              style={{ backgroundColor: "var(--q-bg-secondary)" }}
            />
            <select
              value={newTenant.industry}
              onChange={(e) => setNewTenant({ ...newTenant, industry: e.target.value })}
              className="px-3 py-2.5 text-[14px] rounded-xl outline-none"
              style={{ backgroundColor: "var(--q-bg-secondary)" }}
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
              className="px-3 py-2.5 text-[14px] rounded-xl outline-none"
              style={{ backgroundColor: "var(--q-bg-secondary)" }}
            >
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <ActionButton onClick={handleCreate} color="var(--q-green)" disabled={creating}>
            {creating ? "Oluşturuluyor..." : "Firma Oluştur"}
          </ActionButton>
        </SectionCard>
      )}

      {/* Tenant List */}
      <div className="space-y-3">
        {tenants.map((t: any) => (
          <CardInteractive key={t.id} className="q-card-interactive">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-[15px]"
                  style={{
                    background: t.status === 'active'
                      ? "linear-gradient(135deg, var(--q-blue), var(--q-purple))"
                      : "var(--q-text-secondary)",
                  }}
                >
                  {t.name?.charAt(0)?.toUpperCase()}
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold" style={{ color: "var(--q-text-primary)" }}>{t.name}</h3>
                  <p className="text-[12px] font-mono" style={{ color: "var(--q-text-secondary)" }}>{t.slug} · {t.plan}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  label={t.status === 'active' ? 'Aktif' : 'Askıda'}
                  color={t.status === 'active' ? "var(--q-green)" : "var(--q-red)"}
                />
                <IconButton
                  icon={Eye}
                  onClick={() => handleImpersonate(t.id, t.slug)}
                  color="var(--q-blue)"
                  title="Müşteri Gözünden Bak"
                />
                <IconButton
                  icon={Power}
                  onClick={() => handleToggle(t.id)}
                  color={t.status === 'active' ? "var(--q-green)" : "var(--q-red)"}
                  title={t.status === 'active' ? 'Askıya Al' : 'Aktifleştir'}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--q-text-secondary)" }}>
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{t.conversation_count || 0} konuşma</span>
              </div>
              <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--q-text-secondary)" }}>
                <Building2 className="w-3.5 h-3.5" />
                <span>{t.message_count || 0} mesaj</span>
              </div>
              <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--q-text-secondary)" }}>
                <Users className="w-3.5 h-3.5" />
                <span>{t.user_count || 0} kullanıcı</span>
              </div>
            </div>

            {/* Meta Info */}
            {(t.whatsapp_phone_id || t.meta_page_id || t.instagram_id) && (
              <div className="mt-3 pt-3 flex gap-4 text-[11px] font-mono" style={{ borderTop: "1px solid var(--q-border-default)", color: "var(--q-text-secondary)" }}>
                {t.whatsapp_phone_id && <span>WA: {t.whatsapp_phone_id.substring(0, 8)}...</span>}
                {t.meta_page_id && <span>FB: {t.meta_page_id.substring(0, 8)}...</span>}
                {t.instagram_id && <span>IG: {t.instagram_id.substring(0, 8)}...</span>}
              </div>
            )}
          </CardInteractive>
        ))}
      </div>
    </PageShell>
  );
}
