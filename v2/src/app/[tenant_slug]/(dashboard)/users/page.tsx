"use client";

import { useEffect, useState } from "react";
import { getUsers, createUser, updateUserRole, toggleUserActive, deleteUser, resetUserPassword, generateInviteLink } from "@/app/actions/users";
import { Users, Plus, Loader2, Shield, UserCheck, Eye, Trash2, Power, KeyRound, Link2, Copy, Check } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PageLoader, ErrorBanner } from "@/components/ui/shared-states";
import { PageShell, PageHeader, SectionCard, ActionButton } from "@/components/governance";

// ==========================================
// QUBA AI — Kullanıcı Yönetimi Sayfası
// Authority: User CRUD, roles, invites
// ==========================================

const ROLES = [
  { value: "admin", label: "Yönetici", desc: "Tam yetki — kullanıcı yönetimi dahil", color: "var(--q-blue)" },
  { value: "agent", label: "Temsilci", desc: "Mesaj gönderebilir, bot ayarlayabilir", color: "var(--q-green)" },
  { value: "viewer", label: "İzleyici", desc: "Sadece görüntüleme", color: "var(--q-text-secondary)" },
];

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "agent" });
  const [tempPass, setTempPass] = useState<{userId: string, pass: string, name: string} | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{userId: string, url: string, name: string} | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

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
    setError(null);
    const res = await createUser(form);
    if (res.success) {
      setShowCreate(false);
      setForm({ name: "", email: "", password: "", role: "agent" });
      load();
    } else {
      setError(res.error || "Kullanıcı oluşturulamadı.");
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
    const ok = await confirm({
      title: "Kullanıcıyı Sil",
      message: "Bu kullanıcıyı kalıcı olarak silmek istediğinize emin misiniz?",
      confirmLabel: "Sil",
      variant: "danger",
    });
    if (!ok) return;
    await deleteUser(userId);
    load();
  }

  async function handleResetPassword(userId: string, userName: string) {
    const ok = await confirm({
      title: "Şifre Sıfırla",
      message: `${userName} kullanıcısının şifresi sıfırlanacak ve geçici yeni bir şifre oluşturulacak.`,
      confirmLabel: "Sıfırla",
      variant: "warning",
    });
    if (!ok) return;
    const res = await resetUserPassword(userId);
    if (res.success && res.tempPassword) {
      setTempPass({ userId, pass: res.tempPassword, name: userName });
    } else {
      setError(res.error || "Şifre sıfırlanamadı.");
    }
  }

  async function handleInviteLink(userId: string, userName: string) {
    const res = await generateInviteLink(userId);
    if (res.success && res.inviteUrl) {
      setInviteInfo({ userId, url: res.inviteUrl, name: userName });
    } else {
      setError(res.error || "Davet linki oluşturulamadı.");
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <PageLoader />;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto p-6 pb-20 space-y-6">
        {/* Error Banner */}
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold flex items-center gap-2" style={{ color: "var(--q-text-primary)" }}>
              <Users className="w-6 h-6" style={{ color: "var(--q-blue)" }} /> Kullanıcılar
            </h1>
            <p className="text-[13px] mt-1" style={{ color: "var(--q-text-secondary)" }}>{users.length} kullanıcı</p>
          </div>
          <ActionButton onClick={() => setShowCreate(!showCreate)}>
            <Plus className="w-4 h-4" /> Yeni Kullanıcı
          </ActionButton>
        </div>

        {/* Create Form */}
        {showCreate && (
          <SectionCard>
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--q-text-primary)" }}>Yeni Kullanıcı Ekle</h3>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <input
                placeholder="Ad Soyad"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="px-3 py-2.5 text-[14px] rounded-xl outline-none focus:ring-2 focus:ring-[--q-blue]/30"
                style={{ backgroundColor: "var(--q-bg-secondary)" }}
              />
              <input
                placeholder="E-posta"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="px-3 py-2.5 text-[14px] rounded-xl outline-none focus:ring-2 focus:ring-[--q-blue]/30"
                style={{ backgroundColor: "var(--q-bg-secondary)" }}
              />
              <input
                placeholder="Şifre"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="px-3 py-2.5 text-[14px] rounded-xl outline-none focus:ring-2 focus:ring-[--q-blue]/30"
                style={{ backgroundColor: "var(--q-bg-secondary)" }}
              />
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="px-3 py-2.5 text-[14px] rounded-xl outline-none"
                style={{ backgroundColor: "var(--q-bg-secondary)" }}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="mt-4 px-6 py-2.5 text-white text-[13px] font-semibold rounded-xl transition-all disabled:opacity-50"
              style={{ backgroundColor: "var(--q-green)" }}
            >
              {creating ? "Oluşturuluyor..." : "Kullanıcı Ekle"}
            </button>
          </SectionCard>
        )}

        {/* User List */}
        <div className="space-y-3">
          {users.map((u: any) => {
            const roleInfo = ROLES.find((r) => r.value === u.role) || ROLES[2];
            return (
              <SectionCard key={u.id} className={!u.is_active ? 'opacity-50' : ''}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-[14px]"
                      style={{ backgroundColor: roleInfo.color }}>
                      {u.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-[15px] font-semibold" style={{ color: "var(--q-text-primary)" }}>{u.name}</h3>
                      <p className="text-[12px]" style={{ color: "var(--q-text-secondary)" }}>{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="text-[12px] rounded-lg px-2 py-1.5 outline-none"
                      style={{ backgroundColor: "var(--q-bg-secondary)" }}
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <button onClick={() => handleToggle(u.id)} className="p-2 rounded-lg transition-colors" style={{ color: u.is_active ? 'var(--q-green)' : 'var(--q-red)' }} title={u.is_active ? 'Deaktif Et' : 'Aktifleştir'}>
                      <Power className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleResetPassword(u.id, u.name)} className="p-2 rounded-lg transition-colors" style={{ color: "var(--q-orange)" }} title="Şifre Sıfırla">
                      <KeyRound className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleInviteLink(u.id, u.name)} className="p-2 rounded-lg transition-colors" style={{ color: "var(--q-purple)" }} title="Davet Linki">
                      <Link2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(u.id)} className="p-2 rounded-lg transition-colors" style={{ color: "var(--q-red)" }} title="Sil">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-4 mt-3 text-[11px]" style={{ color: "var(--q-text-secondary)" }}>
                  <span>Rol: {roleInfo.label}</span>
                  <span>·</span>
                  <span>{u.last_login_at ? `Son giriş: ${new Date(u.last_login_at).toLocaleDateString('tr-TR')}` : 'Henüz giriş yapmadı'}</span>
                </div>
              </SectionCard>
            );
          })}
        </div>

        {/* Temp Password Modal */}
        {tempPass && (
          <div className="rounded-2xl p-5 space-y-3" style={{ backgroundColor: "var(--q-orange-bg)", border: "1px solid var(--q-orange)" }}>
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--q-text-primary)" }}>🔑 {tempPass.name} — Geçici Şifre</h3>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[18px] font-mono font-bold tracking-wider bg-white px-4 py-2 rounded-lg" style={{ color: "var(--q-orange)" }}>{tempPass.pass}</code>
              <button onClick={() => copyToClipboard(tempPass.pass)} className="p-2 bg-white rounded-lg">
                {copied ? <Check className="w-4 h-4" style={{ color: "var(--q-green)" }} /> : <Copy className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />}
              </button>
            </div>
            <p className="text-[12px]" style={{ color: "var(--q-text-secondary)" }}>Bu şifreyi kullanıcıya güvenli şekilde iletin. İlk girişte değiştirilecektir.</p>
            <button onClick={() => setTempPass(null)} className="text-[13px] font-medium" style={{ color: "var(--q-blue)" }}>Kapat</button>
          </div>
        )}

        {/* Invite Link Modal */}
        {inviteInfo && (
          <div className="rounded-2xl p-5 space-y-3" style={{ backgroundColor: "var(--q-purple-bg)", border: "1px solid var(--q-purple)" }}>
            <h3 className="text-[15px] font-semibold" style={{ color: "var(--q-text-primary)" }}>🔗 {inviteInfo.name} — Davet Linki</h3>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[12px] font-mono bg-white px-3 py-2 rounded-lg truncate" style={{ color: "var(--q-purple)" }}>{inviteInfo.url}</code>
              <button onClick={() => copyToClipboard(inviteInfo.url)} className="p-2 bg-white rounded-lg flex-shrink-0">
                {copied ? <Check className="w-4 h-4" style={{ color: "var(--q-green)" }} /> : <Copy className="w-4 h-4" style={{ color: "var(--q-text-secondary)" }} />}
              </button>
            </div>
            <p className="text-[12px]" style={{ color: "var(--q-text-secondary)" }}>72 saat geçerli. Kullanıcı bu linke tıklayarak şifresini belirleyebilir.</p>
            <button onClick={() => setInviteInfo(null)} className="text-[13px] font-medium" style={{ color: "var(--q-blue)" }}>Kapat</button>
          </div>
        )}
      </div>
    </div>
  );
}
