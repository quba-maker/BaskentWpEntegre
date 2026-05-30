"use client";

import { useState } from "react";
import { login } from "@/lib/auth/session";
import { changeMyPassword } from "@/app/actions/users";
import { useRouter } from "next/navigation";
import { Loader2, Bot, Eye, EyeOff, KeyRound, ShieldAlert, Sparkles, CheckCircle2 } from "lucide-react";
import Link from "next/link";

// ==========================================
// QUBA AI — Premium Login Page (Dual Column)
// ==========================================

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setLoading(true);
    setError("");

    const result = await login(email, password);

    if (result.success) {
      if (result.mustChangePassword) {
        setMustChangePassword(true);
        setError("");
        setLoading(false);
      } else {
        router.push(`/${result.tenantSlug || ""}`);
        router.refresh();
      }
    } else {
      setError(result.error || "Giriş başarısız.");
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) { setError("Yeni şifre en az 6 karakter olmalı."); return; }
    if (newPassword !== confirmPassword) { setError("Şifreler eşleşmiyor."); return; }
    setChangingPassword(true); setError("");

    const res = await changeMyPassword(password, newPassword);
    if (res.success) {
      const reLogin = await login(email, newPassword);
      if (reLogin.success) {
        router.push(`/${reLogin.tenantSlug || ""}`);
        router.refresh();
      }
    } else {
      setError(res.error || "Şifre değiştirilemedi.");
      setChangingPassword(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 font-sans selection:bg-blue-500 selection:text-white">
      {/* 1. Left Column: Product pitch & Trust elements (Hidden on mobile) */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white relative overflow-hidden flex-col justify-between p-16">
        {/* Soft background glow */}
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[100px] pointer-events-none" />
        
        {/* Top: Branding */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">Quba AI</span>
        </div>

        {/* Middle: Feature list */}
        <div className="max-w-md relative z-10 my-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs font-semibold text-blue-400 mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Kurumsal CRM ve Süreç Otomasyonu</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight text-white">
            Çok kanallı iletişimi yapay zeka ile güçlendirin.
          </h2>
          <p className="text-slate-400 mt-4 text-[15px] leading-relaxed">
            Meta API doğrulamasına sahip, tüm kanalları tek panelde birleştiren ve zero-outbound güvenlik modeliyle tam izole çalışan kurumsal B2B CRM sistemi.
          </p>

          <div className="space-y-4 mt-8">
            <div className="flex gap-3 items-start">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-slate-300 text-sm">WhatsApp, Instagram ve Messenger mesajları tek ekranda.</p>
            </div>
            <div className="flex gap-3 items-start">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-slate-300 text-sm">Denetimli yapay zeka taslakları ve otomatik süreç özetleri.</p>
            </div>
            <div className="flex gap-3 items-start">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-slate-300 text-sm">Her tenant için izole edilmiş, KVKK uyumlu güvenli altyapı.</p>
            </div>
          </div>
        </div>

        {/* Bottom: Legal metadata */}
        <div className="relative z-10 text-xs text-slate-500 flex items-center justify-between">
          <span>Sunucu Durumu: Aktif</span>
          <span>© 2026 Quba AI</span>
        </div>
      </div>

      {/* 2. Right Column: Login form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-between p-8 sm:p-12 md:p-16 relative">
        <div className="absolute inset-0 bg-gradient-to-tr from-slate-50 via-white to-slate-100/50 pointer-events-none -z-10" />

        {/* Brand logo for mobile only */}
        <div className="flex lg:hidden items-center gap-3 mb-12">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-md">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900">Quba AI</span>
        </div>

        {/* Middle: Auth Card */}
        <div className="w-full max-w-[380px] mx-auto my-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Platforma Giriş Yapın</h1>
            <p className="text-slate-500 text-sm mt-1.5">Hesap bilgilerinizi girerek oturum açın.</p>
          </div>

          {mustChangePassword ? (
            /* Password Change Form */
            <form onSubmit={handleChangePassword} className="space-y-5">
              <div className="flex items-center gap-2 text-amber-600 mb-2">
                <KeyRound className="w-5 h-5" />
                <span className="text-sm font-semibold">Şifre Değiştirme Zorunlu</span>
              </div>
              <p className="text-[13px] text-slate-600 leading-relaxed">
                Hesap güvenliğiniz için size atanan geçici şifreyi yeni bir şifre ile değiştirin.
              </p>

              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Yeni Şifre</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="En az 6 karakter"
                  className="w-full px-4 py-3 text-[14px] bg-slate-100 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  required 
                  minLength={6} 
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">Yeni Şifre (Tekrar)</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Şifreyi tekrar girin"
                  className="w-full px-4 py-3 text-[14px] bg-slate-100 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  required 
                  minLength={6}
                />
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-xl flex gap-2.5 items-start">
                  <ShieldAlert className="w-4.5 h-4.5 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-[13px] text-red-700 font-medium leading-relaxed">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={changingPassword || newPassword.length < 6 || newPassword !== confirmPassword}
                className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white text-[14px] font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
              >
                {changingPassword ? <><Loader2 className="w-4 h-4 animate-spin" /> Değiştiriliyor...</> : "Şifreyi Değiştir & Giriş Yap"}
              </button>
            </form>
          ) : (
            /* Normal Login Form */
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                  E-posta
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="isim@firma.com"
                  className="w-full px-4 py-3 text-[14px] bg-slate-100 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  autoFocus
                  required
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
                  Şifre
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-3 pr-12 text-[14px] bg-slate-100 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-xl flex gap-2.5 items-start">
                  <ShieldAlert className="w-4.5 h-4.5 text-red-600 shrink-0 mt-0.5" />
                  <p className="text-[13px] text-red-700 font-medium leading-relaxed">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || !email.trim() || !password.trim()}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md shadow-blue-500/10 active:scale-98"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Giriş yapılıyor...
                  </>
                ) : (
                  "Giriş Yap"
                )}
              </button>
            </form>
          )}
        </div>

        {/* Bottom: Legal & Support navigation links */}
        <div className="text-center mt-12 text-xs text-slate-400 space-y-3">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
            <Link href="/privacy" className="hover:text-slate-700 transition-colors">Gizlilik</Link>
            <span>·</span>
            <Link href="/terms" className="hover:text-slate-700 transition-colors">Kullanım Koşulları</Link>
            <span>·</span>
            <Link href="/data-deletion" className="hover:text-slate-700 transition-colors">Veri Silme</Link>
            <span>·</span>
            <Link href="/legal" className="hover:text-slate-700 transition-colors">Yasal Bilgiler</Link>
            <span>·</span>
            <Link href="/support" className="hover:text-slate-700 transition-colors">Destek</Link>
          </div>
          <p>© 2026 Quba AI. Tüm hakları saklıdır.</p>
        </div>
      </div>
    </div>
  );
}
