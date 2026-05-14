"use client";

import { useEffect, useState } from "react";
import { getUsers, createUser, updateUserRole, toggleUserActive, deleteUser } from "@/app/actions/users";
import { Users, Plus, Loader2, Shield, UserCheck, Eye, Trash2, Power } from "lucide-react";

// ==========================================
// QUBA AI — Kullanıcı Yönetimi Sayfası
// ==========================================

const ROLES = [
  { value: "admin", label: "Yönetici", desc: "Tam yetki — kullanıcı yönetimi dahil", color: "#007AFF" },
  { value: "agent", label: "Temsilci", desc: "Mesaj gönderebilir, bot ayarlayabilir", color: "#34C759" },
  { value: "viewer", label: "İzleyici", desc: "Sadece görüntüleme", color: "#86868B" },
];

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "agent" });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await getUsers();
    if (res.success && res.users) setUsers(res.users);
    setLoading(false);
  }

  async function handleCreate() {
    if (!form.name || !form.email || !form.password) return;
    setCreating(true);
    const res = await createUser(form);
    if (res.success) {
      setShowCreate(false);
      setForm({ name: "", email: "", password: "", role: "agent" });
      load();
    } else {
      alert(res.error);
    }
    setCreating(false);
  }

  async function handleRoleChange(userId: string, newRole: string) {
    await updateUserRole(userId, newRole);
    load();
  }

  async function handleToggle(userId: string) {
    await toggleUserActive(userId);
    load();
  }

  async function handleDelete(userId: string) {
    if (!confirm("Bu kullanıcıyı silmek istediğinize emin misiniz?")) return;
    await deleteUser(userId);
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
      <div className="max-w-2xl mx-auto p-6 pb-20 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-[#1D1D1F] flex items-center gap-2">
              <Users className="w-6 h-6 text-[#007AFF]" /> Kullanıcılar
            </h1>
            <p className="text-[13px] text-[#86868B] mt-1">{users.length} kullanıcı</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#007AFF] hover:bg-[#0066D6] text-white text-[13px] font-semibold rounded-xl transition-all"
          >
            <Plus className="w-4 h-4" /> Yeni Kullanıcı
          </button>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-5 space-y-4">
            <h3 className="text-[15px] font-semibold text-[#1D1D1F]">Yeni Kullanıcı Ekle</h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                placeholder="Ad Soyad"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="px-3 py-2.5 text-[14px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
              />
              <input
                placeholder="E-posta"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="px-3 py-2.5 text-[14px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
              />
              <input
                placeholder="Şifre"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="px-3 py-2.5 text-[14px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
              />
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="px-3 py-2.5 text-[14px] bg-[#F5F5F7] rounded-xl outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-6 py-2.5 bg-[#34C759] hover:bg-[#30B350] text-white text-[13px] font-semibold rounded-xl transition-all disabled:opacity-50"
            >
              {creating ? "Oluşturuluyor..." : "Kullanıcı Ekle"}
            </button>
          </div>
        )}

        {/* User List */}
        <div className="space-y-3">
          {users.map((u: any) => {
            const roleInfo = ROLES.find((r) => r.value === u.role) || ROLES[2];
            return (
              <div key={u.id} className={`bg-white rounded-2xl border border-black/5 shadow-sm p-5 ${!u.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-[14px]"
                      style={{ backgroundColor: roleInfo.color }}>
                      {u.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-[15px] font-semibold text-[#1D1D1F]">{u.name}</h3>
                      <p className="text-[12px] text-[#86868B]">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="text-[12px] bg-[#F5F5F7] rounded-lg px-2 py-1.5 outline-none"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <button onClick={() => handleToggle(u.id)} className="p-2 hover:bg-black/5 rounded-lg transition-colors" title={u.is_active ? 'Deaktif Et' : 'Aktifleştir'}>
                      <Power className={`w-4 h-4 ${u.is_active ? 'text-[#34C759]' : 'text-[#FF3B30]'}`} />
                    </button>
                    <button onClick={() => handleDelete(u.id)} className="p-2 hover:bg-red-50 rounded-lg transition-colors" title="Sil">
                      <Trash2 className="w-4 h-4 text-[#FF3B30]" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-4 mt-3 text-[11px] text-[#86868B]">
                  <span>Rol: {roleInfo.label}</span>
                  <span>·</span>
                  <span>{u.last_login_at ? `Son giriş: ${new Date(u.last_login_at).toLocaleDateString('tr-TR')}` : 'Henüz giriş yapmadı'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
