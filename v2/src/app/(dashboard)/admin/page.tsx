"use client";

import { useEffect, useState } from "react";
import { getAllTenants, createTenant, toggleTenantStatus } from "@/app/actions/admin";
import { Building2, Plus, Users, MessageSquare, Loader2, Shield, Power } from "lucide-react";

// ==========================================
// QUBA AI — Super Admin Panel
// ==========================================

export default function AdminPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: "", slug: "", industry: "general", plan: "starter" });
  const [creating, setCreating] = useState(false);

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
    const res = await createTenant(newTenant);
    if (res.success) {
      setShowCreate(false);
      setNewTenant({ name: "", slug: "", industry: "general", plan: "starter" });
      load();
    } else {
      alert(res.error);
    }
    setCreating(false);
  }

  async function handleToggle(id: string) {
    await toggleTenantStatus(id);
    load();
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#86868B]" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto p-6 pb-20 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-[#1D1D1F] flex items-center gap-2">
              <Shield className="w-6 h-6 text-[#007AFF]" /> Süper Admin
            </h1>
            <p className="text-[13px] text-[#86868B] mt-1">{tenants.length} firma kayıtlı</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#007AFF] hover:bg-[#0066D6] text-white text-[13px] font-semibold rounded-xl transition-all"
          >
            <Plus className="w-4 h-4" /> Yeni Firma
          </button>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 space-y-4">
            <h3 className="text-[15px] font-semibold text-[#1D1D1F]">Yeni Firma Oluştur</h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                placeholder="Firma Adı"
                value={newTenant.name}
                onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                className="px-3 py-2.5 text-[14px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
              />
              <input
                placeholder="Slug (ör: baskent)"
                value={newTenant.slug}
                onChange={(e) => setNewTenant({ ...newTenant, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                className="px-3 py-2.5 text-[14px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30 font-mono"
              />
              <select
                value={newTenant.industry}
                onChange={(e) => setNewTenant({ ...newTenant, industry: e.target.value })}
                className="px-3 py-2.5 text-[14px] bg-[#F5F5F7] rounded-xl outline-none"
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
                className="px-3 py-2.5 text-[14px] bg-[#F5F5F7] rounded-xl outline-none"
              >
                <option value="starter">Starter</option>
                <option value="professional">Professional</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-6 py-2.5 bg-[#34C759] hover:bg-[#30B350] text-white text-[13px] font-semibold rounded-xl transition-all disabled:opacity-50"
            >
              {creating ? "Oluşturuluyor..." : "Firma Oluştur"}
            </button>
          </div>
        )}

        {/* Tenant List */}
        <div className="space-y-3">
          {tenants.map((t: any) => (
            <div key={t.id} className="bg-white rounded-2xl border border-black/5 shadow-sm p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-[15px] ${t.status === 'active' ? 'bg-gradient-to-br from-[#007AFF] to-[#5856D6]' : 'bg-[#86868B]'}`}>
                    {t.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-[15px] font-semibold text-[#1D1D1F]">{t.name}</h3>
                    <p className="text-[12px] text-[#86868B] font-mono">{t.slug} · {t.plan}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${t.status === 'active' ? 'bg-[#34C759]/10 text-[#34C759]' : 'bg-[#FF3B30]/10 text-[#FF3B30]'}`}>
                    {t.status === 'active' ? 'Aktif' : 'Askıda'}
                  </span>
                  <button
                    onClick={() => handleToggle(t.id)}
                    className="p-2 hover:bg-black/5 rounded-lg transition-colors"
                    title={t.status === 'active' ? 'Askıya Al' : 'Aktifleştir'}
                  >
                    <Power className={`w-4 h-4 ${t.status === 'active' ? 'text-[#34C759]' : 'text-[#FF3B30]'}`} />
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="flex items-center gap-2 text-[12px] text-[#86868B]">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{t.conversation_count || 0} konuşma</span>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-[#86868B]">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>{t.message_count || 0} mesaj</span>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-[#86868B]">
                  <Users className="w-3.5 h-3.5" />
                  <span>{t.user_count || 0} kullanıcı</span>
                </div>
              </div>

              {/* Meta Info */}
              {(t.whatsapp_phone_id || t.meta_page_id || t.instagram_id) && (
                <div className="mt-3 pt-3 border-t border-black/5 flex gap-4 text-[11px] text-[#86868B] font-mono">
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
