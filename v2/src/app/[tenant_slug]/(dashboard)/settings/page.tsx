"use client";

import { useEffect, useState } from "react";
import { getTenantSettings, updateTenantSettings, getUsageStats, getAutoGreetingSettingsAction, saveAutoGreetingChannelSettingsAction } from "@/app/actions/settings";
import { changeMyPassword, getUsers, createUser, updateUserRole, toggleUserActive, deleteUser, resetUserPassword, generateInviteLink } from "@/app/actions/users";
import { Building2, Gauge, Shield, KeyRound, CreditCard, Users, Plus, Link2, Copy, Check, Trash2, Power, AlertCircle } from "lucide-react";
import { PageLoader } from "@/components/ui/shared-states";
import { SectionCard, SectionHeader, SaveButton, ActionButton } from "@/components/governance";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { AutoGreetingSettingsPanel } from "@/components/features/settings/AutoGreetingSettingsPanel";

// ==========================================
// QUBA AI — Modular Settings Page
// Architecture: Apple/Stripe-inspired vertical tabs
// ==========================================

type TabType = 'general' | 'account' | 'users' | 'billing';

const ROLES = [
  { value: "admin", label: "Yönetici", desc: "Tam yetki", color: "#007AFF" },
  { value: "agent", label: "Temsilci", desc: "Mesaj gönderebilir", color: "#34C759" },
  { value: "viewer", label: "İzleyici", desc: "Sadece görüntüleme", color: "#8E8E93" },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [tenant, setTenant] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const confirm = useConfirm();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Password State
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  // General Settings State
  const [form, setForm] = useState({
    name: "",
    industry: "",
    timezone: "Europe/Istanbul",
  });

  // Users State
  const [users, setUsers] = useState<any[]>([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", role: "agent" });
  const [tempPass, setTempPass] = useState<{userId: string, pass: string, name: string} | null>(null);
  const [inviteInfo, setInviteInfo] = useState<{userId: string, url: string, name: string} | null>(null);
  const [copied, setCopied] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  const [autoGreetingConfig, setAutoGreetingConfig] = useState<any>(null);
  const [envLocks, setEnvLocks] = useState<any>(null);

  async function handleSaveChannelConfig(channelId: string, settings: any) {
    const res = await saveAutoGreetingChannelSettingsAction(channelId, settings);
    if (res.success) {
      // Reload config
      const autoGreetingRes = await getAutoGreetingSettingsAction();
      if (autoGreetingRes.success) {
        setAutoGreetingConfig(autoGreetingRes.channelsConfig);
        setEnvLocks(autoGreetingRes.envLocks);
      }
      return { success: true };
    } else {
      return { success: false, error: res.error || "Hata oluştu." };
    }
  }

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setIsLoading(true);
    setLoadError(null);

    // 1. Critical tenant settings
    try {
      const tenantRes = await getTenantSettings();
      if (tenantRes.success && tenantRes.tenant) {
        setTenant(tenantRes.tenant);
        setUser(tenantRes.user);
        setForm({
          name: tenantRes.tenant.name || "",
          industry: tenantRes.tenant.industry || "",
          timezone: tenantRes.tenant.timezone || "Europe/Istanbul",
        });
      } else {
        setLoadError(tenantRes.error || "Çalışma alanı ayarları yüklenemedi.");
      }
    } catch (err: any) {
      console.error("[SETTINGS_LOAD] Tenant settings failed:", err);
      setLoadError("Çalışma alanı ayarları yüklenirken sistemsel bir hata oluştu.");
    }

    // 2. Non-critical usage statistics
    try {
      const usageRes = await getUsageStats();
      if (usageRes.success && usageRes.stats) {
        setUsage(usageRes.stats);
      }
    } catch (err) {
      console.error("[SETTINGS_LOAD] Usage stats failed:", err);
    }

    // 3. Non-critical user list
    try {
      const usersRes = await getUsers();
      if (usersRes.success && usersRes.data) {
        setUsers(usersRes.data as any[]);
      }
    } catch (err) {
      console.error("[SETTINGS_LOAD] Users list failed:", err);
    }

    // 4. Auto greeting settings
    try {
      const autoGreetingRes = await getAutoGreetingSettingsAction();
      if (autoGreetingRes.success) {
        setAutoGreetingConfig(autoGreetingRes.channelsConfig);
        setEnvLocks(autoGreetingRes.envLocks);
      }
    } catch (err) {
      console.error("[SETTINGS_LOAD] Auto greeting settings failed:", err);
    }

    setIsLoading(false);
  }

  async function reloadUsers() {
    const res = await getUsers();
    if (res.success && res.data) setUsers(res.data as any[]);
  }

  // --- Handlers: Settings & Account ---
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

  // --- Handlers: Users ---
  async function handleCreateUser() {
    if (!userForm.name || !userForm.email || !userForm.password) return;
    setCreatingUser(true);
    setUserError(null);
    const res = await createUser(userForm);
    if (res.success) {
      setShowCreateUser(false);
      setUserForm({ name: "", email: "", password: "", role: "agent" });
      reloadUsers();
    } else {
      setUserError(res.error || "Kullanıcı oluşturulamadı.");
    }
    setCreatingUser(false);
  }

  async function handleRoleChange(userId: string, newRole: string) {
    await updateUserRole(userId, newRole);
    reloadUsers();
  }

  async function handleToggle(userId: string) {
    await toggleUserActive(userId);
    reloadUsers();
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
    reloadUsers();
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
    if (res.success && res.data) {
      setTempPass({ userId, pass: (res.data as any).tempPassword, name: userName });
    } else {
      setUserError(res.error || "Şifre sıfırlanamadı.");
    }
  }

  async function handleInviteLink(userId: string, userName: string) {
    const res = await generateInviteLink(userId);
    if (res.success && res.data) {
      setInviteInfo({ userId, url: (res.data as any).inviteUrl, name: userName });
    } else {
      setUserError(res.error || "Davet linki oluşturulamadı.");
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loadError) {
    return (
      <div className="min-h-[400px] w-full flex items-center justify-center p-6 bg-[#FAFAFA] dark:bg-black">
        <div className="bg-white dark:bg-[#111] rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.04)] border border-black/5 p-8 w-full max-w-sm text-center space-y-5">
          <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/50 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6 text-rose-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-extrabold text-[#1D1D1F] dark:text-zinc-200">Yükleme Başarısız</h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed font-medium">
              {loadError}
            </p>
          </div>
          <button
            onClick={() => loadData()}
            className="w-full py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white text-[12px] font-bold rounded-xl transition-all cursor-pointer dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Tekrar Dene
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !tenant) return <PageLoader />;

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
            active={activeTab === 'users'} 
            icon={Users} 
            label="Kullanıcılar" 
            onClick={() => setActiveTab('users')} 
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

              <div className="pt-6 border-t border-black/5">
                <AutoGreetingSettingsPanel
                  channelsConfig={autoGreetingConfig || {}}
                  envLocks={envLocks || {
                    phaseLockBlocked: true,
                    globalDisabled: true,
                    isTenantAllowed: false,
                    dryRun: true,
                    allowedTenants: ""
                  }}
                  onSaveChannelConfig={handleSaveChannelConfig}
                />
              </div>
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
                    color="#FF9500" // Orange
                    disabled={pwLoading || !pwCurrent || pwNew.length < 6}
                  >
                    {pwLoading ? "Değiştiriliyor..." : "Şifre Güncelle"}
                  </ActionButton>
                </div>
              </SectionCard>
            </div>
          )}

          {/* TAB: USERS */}
          {activeTab === 'users' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-medium text-black dark:text-white">Takım Üyeleri</h2>
                  <p className="text-[13px] text-black/50 dark:text-white/50 mt-1">Sisteme erişebilen {users.length} temsilci ve yönetici.</p>
                </div>
                <button 
                  onClick={() => setShowCreateUser(!showCreateUser)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black text-[13px] font-medium rounded-lg"
                >
                  <Plus className="w-4 h-4" /> Yeni Kullanıcı
                </button>
              </div>

              {userError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl text-[13px]">
                  {userError}
                </div>
              )}

              {/* Create User Form */}
              {showCreateUser && (
                <SectionCard>
                  <SectionHeader icon={Users} title="Yeni Kullanıcı Ekle" />
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Ad Soyad" value={userForm.name} onChange={(v) => setUserForm({...userForm, name: v})} />
                    <Field label="E-posta" type="email" value={userForm.email} onChange={(v) => setUserForm({...userForm, email: v})} />
                    <Field label="Şifre" type="password" value={userForm.password} onChange={(v) => setUserForm({...userForm, password: v})} />
                    <Field label="Rol" type="select" options={ROLES} value={userForm.role} onChange={(v) => setUserForm({...userForm, role: v})} />
                  </div>
                  <div className="mt-4 flex justify-end">
                    <ActionButton color="#34C759" onClick={handleCreateUser} disabled={creatingUser}>
                      {creatingUser ? "Ekleniyor..." : "Oluştur"}
                    </ActionButton>
                  </div>
                </SectionCard>
              )}

              {/* Modals for Temp Pass / Invite Link */}
              {tempPass && (
                <div className="rounded-xl p-4 bg-[#FF9500]/10 border border-[#FF9500]/20 space-y-2">
                  <h3 className="text-[14px] font-medium text-black dark:text-white">🔑 {tempPass.name} — Geçici Şifre</h3>
                  <div className="flex items-center gap-2">
                    <code className="text-[15px] font-mono bg-white dark:bg-black px-2 py-1 rounded text-[#FF9500]">{tempPass.pass}</code>
                    <button onClick={() => copyToClipboard(tempPass.pass)} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded">
                      {copied ? <Check className="w-4 h-4 text-[#34C759]" /> : <Copy className="w-4 h-4 text-black/50 dark:text-white/50" />}
                    </button>
                  </div>
                  <p className="text-[12px] text-black/50 dark:text-white/50">Kullanıcı ilk girişte değiştirmek zorundadır.</p>
                  <button onClick={() => setTempPass(null)} className="text-[12px] text-[#007AFF]">Kapat</button>
                </div>
              )}

              {inviteInfo && (
                <div className="rounded-xl p-4 bg-[#AF52DE]/10 border border-[#AF52DE]/20 space-y-2">
                  <h3 className="text-[14px] font-medium text-black dark:text-white">🔗 {inviteInfo.name} — Davet Linki</h3>
                  <div className="flex items-center gap-2">
                    <code className="text-[12px] font-mono bg-white dark:bg-black px-2 py-1 rounded text-[#AF52DE] truncate w-full">{inviteInfo.url}</code>
                    <button onClick={() => copyToClipboard(inviteInfo.url)} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded">
                      {copied ? <Check className="w-4 h-4 text-[#34C759]" /> : <Copy className="w-4 h-4 text-black/50 dark:text-white/50" />}
                    </button>
                  </div>
                  <p className="text-[12px] text-black/50 dark:text-white/50">72 saat geçerlidir.</p>
                  <button onClick={() => setInviteInfo(null)} className="text-[12px] text-[#007AFF]">Kapat</button>
                </div>
              )}

              {/* User List */}
              <div className="space-y-3">
                {users.map((u: any) => {
                  const roleInfo = ROLES.find((r) => r.value === u.role) || ROLES[2];
                  return (
                    <div key={u.id} className={`flex items-center justify-between p-4 rounded-xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#111] transition-opacity ${!u.is_active ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-[14px]"
                          style={{ backgroundColor: roleInfo.color }}>
                          {u.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-[14px] font-medium text-black dark:text-white">{u.name}</h3>
                          <div className="flex items-center gap-2 mt-0.5 text-[12px] text-black/50 dark:text-white/50">
                            <span>{u.email}</span>
                            <span>·</span>
                            <span>{u.last_login_at ? `Giriş: ${new Date(u.last_login_at).toLocaleDateString('tr-TR')}` : 'Henüz giriş yapmadı'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value)}
                          className="text-[12px] rounded-lg px-2 py-1.5 outline-none bg-black/5 dark:bg-white/5 border-0 text-black dark:text-white"
                        >
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1 border-l border-black/10 dark:border-white/10 pl-2">
                          <button onClick={() => handleToggle(u.id)} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors" style={{ color: u.is_active ? '#34C759' : '#FF3B30' }} title={u.is_active ? 'Deaktif Et' : 'Aktifleştir'}>
                            <Power className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleResetPassword(u.id, u.name)} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-[#FF9500]" title="Şifre Sıfırla">
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleInviteLink(u.id, u.name)} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-[#AF52DE]" title="Davet Linki">
                            <Link2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(u.id)} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-[#FF3B30]" title="Sil">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

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
                <div className="p-6 text-center text-[13px] text-black/50">
                  {isLoading ? "Kullanım verisi yükleniyor..." : "Kullanım verisi yüklenemedi."}
                </div>
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
