"use server";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { neon } from "@neondatabase/serverless";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

// ==========================================
// QUBA AI — Session Yönetimi (JWT + Cookie)
// ==========================================

const AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) {
  throw new Error("AUTH_SECRET environment variable is REQUIRED. System cannot start without it.");
}

const SECRET = new TextEncoder().encode(AUTH_SECRET);
const COOKIE_NAME = "quba_session";
const sql = neon(process.env.DATABASE_URL!);

// Session tipi
export interface Session {
  userId: string;
  email: string;
  name: string;
  role: string; // "owner" | "admin" | "agent" | "superadmin" | "platform_admin"
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  
  // Impersonation Fields (Sadece platform_admin kullanabilir)
  impersonatedTenantId?: string;
  impersonatedTenantSlug?: string;
}

// JWT oluştur
async function createToken(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("2h")
    .setIssuedAt()
    .sign(SECRET);
}

// JWT doğrula
async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

// Aktif session'ı getir — DB doğrulamalı
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  
  const session = await verifyToken(token);
  if (!session) return null;

  // DB'den kullanıcı durumunu doğrula (silinen/deaktif/rol değişen kullanıcılar)
  try {
    const user = await sql`
      SELECT u.is_active, u.role, t.status as tenant_status, t.name as tenant_name
      FROM users u
      JOIN tenants t ON u.tenant_id = t.id
      WHERE u.id = ${session.userId} AND u.tenant_id = ${session.tenantId}
    `;
    
    // Kullanıcı silinmiş veya deaktif
    if (user.length === 0 || !user[0].is_active) {
      cookieStore.delete(COOKIE_NAME);
      return null;
    }
    
    // Tenant askıya alınmış
    if (user[0].tenant_status === 'suspended') {
      cookieStore.delete(COOKIE_NAME);
      return null;
    }
    
    // Rol değişmişse session'ı güncelle
    if (user[0].role !== session.role) {
      session.role = user[0].role;
    }
    
    // Eğer platform_admin başka bir tenant'ı impersonate ediyorsa, context'i değiştir (Fakat DB doğrulamasını orijinal kullanıcıyla geçtikten sonra)
    if (session.role === 'platform_admin' && session.impersonatedTenantId) {
      session.tenantId = session.impersonatedTenantId;
      session.tenantSlug = session.impersonatedTenantSlug!;
      // İsteğe bağlı olarak tenantName de güncellenebilir
    }

    return session;
  } catch {
    // DB hatası durumunda JWT'ye güven (graceful degradation)
    // Impersonation varsa yine context değiştir
    if (session.role === 'platform_admin' && session.impersonatedTenantId) {
      session.tenantId = session.impersonatedTenantId;
      session.tenantSlug = session.impersonatedTenantSlug!;
    }
    return session;
  }
}

// Giriş yap
export async function login(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; tenantSlug?: string; mustChangePassword?: boolean }> {
  try {
    // Rate Limiting — IP yerine email bazlı (serverless'ta IP güvenilmez)
    const rl = checkRateLimit(`login:${email}`, 5, 60_000);
    if (!rl.allowed) {
      await logAudit({ action: "login_rate_limited", userEmail: email, details: { retryAfterMs: rl.retryAfterMs } });
      return { success: false, error: `Çok fazla deneme. ${Math.ceil(rl.retryAfterMs / 1000)} saniye sonra tekrar deneyin.` };
    }

    // Kullanıcıyı bul
    const users = await sql`
      SELECT u.*, t.slug as tenant_slug, t.name as tenant_name 
      FROM users u 
      JOIN tenants t ON u.tenant_id = t.id 
      WHERE u.email = ${email} AND u.is_active = true
    `;

    if (users.length === 0) {
      await logAudit({ action: "login_failed", userEmail: email, details: { reason: "user_not_found" } });
      return { success: false, error: "E-posta veya şifre hatalı." };
    }

    const user = users[0];

    // Şifre kontrolü — bcryptjs dynamic import (edge uyumluluğu)
    const bcrypt = await import("bcryptjs");
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await logAudit({ action: "login_failed", userEmail: email, tenantId: user.tenant_id, details: { reason: "wrong_password" } });
      return { success: false, error: "E-posta veya şifre hatalı." };
    }

    // Session oluştur
    const session: Session = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantSlug: user.tenant_slug,
      tenantName: user.tenant_name,
    };

    const token = await createToken(session);
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 2, // 2 saat (JWT ile eşleşmeli)
      path: "/",
    });

    // Son giriş zamanını güncelle
    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`;

    // Audit log
    await logAudit({
      tenantId: user.tenant_id,
      userId: user.id,
      userEmail: user.email,
      action: "login_success",
      details: { role: user.role, tenantSlug: user.tenant_slug },
    });

    return { success: true, tenantSlug: user.tenant_slug, mustChangePassword: user.must_change_password === true };
  } catch (error: any) {
    console.error("Login error:", error);
    return { success: false, error: "Bir hata oluştu. Tekrar deneyin." };
  }
}

// Çıkış yap
export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// ==========================================
// IMPERSONATION (MÜŞTERİ GÖZÜNDEN BAK)
// ==========================================

export async function startImpersonation(targetTenantId: string, targetTenantSlug: string) {
  const session = await getSession();
  // Güvenlik: Sadece gerçek platform_admin bu eylemi gerçekleştirebilir!
  if (!session || session.role !== 'platform_admin') {
    throw new Error("Unauthorized: Only Platform Admins can impersonate tenants.");
  }

  // Token'ı yeniden oluştur
  const newSession: Session = {
    ...session,
    impersonatedTenantId: targetTenantId,
    impersonatedTenantSlug: targetTenantSlug,
    // Dikkat: Gerçek tenantId'sini ezmiyoruz! getSession anında çalışma zamanında(runtime) swap yapılacak.
  };

  const token = await createToken(newSession);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 2,
    path: "/",
  });

  await logAudit({
    tenantId: targetTenantId,
    userId: session.userId,
    userEmail: session.email,
    action: "impersonation_started",
    details: { targetTenantSlug }
  });

  return { success: true, redirectUrl: `/${targetTenantSlug}` };
}

export async function stopImpersonation() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return { success: false };

  const { payload } = await jwtVerify(token, SECRET);
  const session = payload as unknown as Session;

  if (!session.impersonatedTenantId) return { success: true }; // Zaten impersonate edilmemiş

  // Impersonation verilerini temizle
  delete session.impersonatedTenantId;
  delete session.impersonatedTenantSlug;

  const newToken = await createToken(session);
  cookieStore.set(COOKIE_NAME, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 2,
    path: "/",
  });

  return { success: true, redirectUrl: `/${session.tenantSlug}/admin` };
}
