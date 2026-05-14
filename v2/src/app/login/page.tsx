"use client";

import { useState } from "react";
import { login } from "@/lib/auth/session";
import { changeMyPassword } from "@/app/actions/users";
import { useRouter } from "next/navigation";
import { Loader2, Bot, Eye, EyeOff, KeyRound } from "lucide-react";

// ==========================================
// QUBA AI — Login Page (Apple ID Style)
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
    <div className="min-h-screen flex items-center justify-center bg-[#F5F5F7] px-4">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-[#F5F5F7] via-white to-[#E8E8ED]" />

      <div className="relative z-10 w-full max-w-[400px]">
        {/* Logo */}
        <div className="text-center mb-10">
          <img src="/quba-logo.svg" alt="Quba AI" className="w-16 h-16 mx-auto mb-5 rounded-2xl shadow-lg shadow-blue-500/20" />
          <h1 className="text-[28px] font-bold text-[#1D1D1F] tracking-tight">
            Quba AI
          </h1>
          <p className="text-[15px] text-[#86868B] mt-1">
            Yapay Zeka İletişim Platformu
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-black/5 p-8">
          {mustChangePassword ? (
            /* Password Change Form */
            <form onSubmit={handleChangePassword} className="space-y-5">
              <div className="flex items-center gap-2 text-[#FF9500] mb-2">
                <KeyRound className="w-5 h-5" />
                <span className="text-[15px] font-semibold">Şifre Değiştirme Zorunlu</span>
              </div>
              <p className="text-[13px] text-[#86868B]">Geçici şifrenizi değiştirin.</p>

              <div>
                <label className="block text-[13px] font-medium text-[#1D1D1F] mb-1.5">Yeni Şifre</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="En az 6 karakter"
                  className="w-full px-4 py-3 text-[15px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                  required minLength={6} autoFocus
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#1D1D1F] mb-1.5">Yeni Şifre (Tekrar)</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Şifreyi tekrar girin"
                  className="w-full px-4 py-3 text-[15px] bg-[#F5F5F7] rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30"
                  required minLength={6}
                />
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                  <p className="text-[13px] text-red-600 font-medium">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={changingPassword || newPassword.length < 6 || newPassword !== confirmPassword}
                className="w-full py-3 bg-[#FF9500] hover:bg-[#E68A00] text-white text-[15px] font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {changingPassword ? <><Loader2 className="w-4 h-4 animate-spin" /> Değiştiriliyor...</> : "Şifreyi Değiştir & Giriş Yap"}
              </button>
            </form>
          ) : (
            /* Normal Login Form */
            <form onSubmit={handleSubmit} className="space-y-5">

            {/* Email */}
            <div>
              <label className="block text-[13px] font-medium text-[#1D1D1F] mb-1.5">
                E-posta
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@firma.com"
                className="w-full px-4 py-3 text-[15px] bg-[#F5F5F7] border-0 rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all placeholder:text-[#C7C7CC]"
                autoFocus
                required
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[13px] font-medium text-[#1D1D1F] mb-1.5">
                Şifre
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 text-[15px] bg-[#F5F5F7] border-0 rounded-xl outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all placeholder:text-[#C7C7CC]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868B] hover:text-[#1D1D1F] transition-colors"
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
              <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
                <p className="text-[13px] text-red-600 font-medium">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !email.trim() || !password.trim()}
              className="w-full py-3 bg-[#007AFF] hover:bg-[#0066D6] text-white text-[15px] font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

        {/* Footer */}
        <div className="mt-8 text-center space-y-2">
          <div className="flex items-center justify-center gap-4 text-[12px] text-[#86868B]">
            <a href="/privacy" className="hover:text-[#1D1D1F] transition-colors">
              Gizlilik Politikası
            </a>
            <span>·</span>
            <a href="/terms" className="hover:text-[#1D1D1F] transition-colors">
              Kullanım Koşulları
            </a>
          </div>
          <p className="text-[11px] text-[#C7C7CC]">
            © 2026 Quba AI — Quba Medya
          </p>
        </div>
      </div>
    </div>
  );
}
