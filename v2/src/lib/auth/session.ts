"use server";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { withTenantDB } from "@/lib/core/tenant-db";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { logger } from "@/lib/core/logger";

// ==========================================
// QUBA AI — Session Yönetimi (JWT + Cookie)
// ==========================================

const AUTH_SECRET = process.env.AUTH_SECRET || "fallback_secret_for_build_only";

const SECRET = new TextEncoder().encode(AUTH_SECRET);
const COOKIE_NAME = "quba_session";

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
  if (!token) {
    console.log(`[SESSION_FORENSIC] No cookie found (${COOKIE_NAME})`);
    return null;
  }
  
  const session = await verifyToken(token);
  if (!session) {
    console.log(`[SESSION_FORENSIC] JWT verification failed`);
    return null;
  }
  console.log(`[SESSION_FORENSIC] JWT decoded | userId=${session.userId} | tenantId=${session.tenantId} | role=${session.role} | impersonated=${session.impersonatedTenantId || 'NONE'}`);

  // DB'den kullanıcı durumunu doğrula (silinen/deaktif/rol değişen kullanıcılar)
  try {
    const db = withTenantDB(session.tenantId);
    const user = await db.executeSafe({
      text: `
        SELECT u.is_active, u.role, t.status as tenant_status, t.name as tenant_name
        FROM users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE u.id = $1 AND u.tenant_id = $2
      `,
      values: [session.userId, session.tenantId]
    });
    
    // Kullanıcı silinmiş veya deaktif
    if (user.length === 0 || !user[0].is_active) {
      console.log(`[SESSION_FORENSIC] User not found or inactive | userCount=${user.length} | isActive=${user[0]?.is_active}`);
      try {
        cookieStore.delete(COOKIE_NAME);
      } catch {
        // Ignored: Next.js throws when modifying cookies during Server Component render phase
      }
      return null;
    }
    
    // Tenant askıya alınmış
    if (user[0].tenant_status === 'suspended') {
      try {
        cookieStore.delete(COOKIE_NAME);
      } catch {
        // Ignored
      }
      return null;
    }
    
    // Rol değişmişse session'ı güncelle
    if (user[0].role !== session.role) {
      session.role = user[0].role;
    }
    
    // Eğer platform_admin başka bir tenant'ı impersonate ediyorsa, context'i değiştir (Fakat DB doğrulamasını orijinal kullanıcıyla geçtikten sonra)
    if (session.role === 'platform_admin' && session.impersonatedTenantId) {
      const impCheck = await db.executeSafe({
        text: `SELECT status, name FROM tenants WHERE id = $1`,
        values: [session.impersonatedTenantId]
      });
      if (impCheck.length === 0 || impCheck[0].status === 'suspended') {
        logger.withContext({ module: 'Auth' }).warn("Impersonation target is suspended or invalid, rejecting session", { targetTenantId: session.impersonatedTenantId });
        return null;
      }
      session.tenantId = session.impersonatedTenantId;
      session.tenantSlug = session.impersonatedTenantSlug!;
      session.tenantName = impCheck[0].name;
    }

    return session;
  } catch (error) {
    // Fail closed: log database/auth failures and deny access
    console.log(`[SESSION_FORENSIC] DB verification CRASHED: ${error instanceof Error ? error.message : String(error)}`);
    logger.withContext({ module: 'Auth' }).error("Database verification check failed - failing closed", error instanceof Error ? error : new Error(String(error)));
    try {
      cookieStore.delete(COOKIE_NAME);
    } catch {
      // Ignored
    }
    return null;
  }
}

// Giriş yap
export async function login(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; tenantSlug?: string; mustChangePassword?: boolean }> {
  if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Attempting login for: ${email}`);
  try {
    // Rate Limiting — IP yerine email bazlı (serverless'ta IP güvenilmez)
    const rl = await checkRateLimit(`login:${email}`, 5, 60_000);
    if (!rl.allowed) {
      if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Rate limit exceeded for: ${email}`);
      await logAudit({ action: "login_rate_limited", userEmail: email, details: { retryAfterMs: rl.retryAfterMs } });
      return { success: false, error: `Çok fazla deneme. ${Math.ceil(rl.retryAfterMs / 1000)} saniye sonra tekrar deneyin.` };
    }

    // Kullanıcıyı bul
    const systemDb = withTenantDB('admin-system', true);
    const users = await systemDb.executeSafe({
      text: `
        SELECT u.*, t.slug as tenant_slug, t.name as tenant_name 
        FROM users u 
        JOIN tenants t ON u.tenant_id = t.id 
        WHERE u.email = $1 AND u.is_active = true
      `,
      values: [email]
    });

    if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] User found in Neon DB? ${users.length > 0 ? "Yes" : "No"}`);

    if (users.length === 0) {
      await logAudit({ action: "login_failed", userEmail: email, details: { reason: "user_not_found" } });
      return { success: false, error: "E-posta veya şifre hatalı." };
    }

    const user = users[0];

    // Şifre kontrolü — bcryptjs dynamic import (edge uyumluluğu)
    const bcrypt = await import("bcryptjs");
    const isValid = await bcrypt.compare(password, user.password_hash);
    
    if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Password compare result: ${isValid}`);

    if (!isValid) {
      await logAudit({ action: "login_failed", userEmail: email, tenantId: user.tenant_id, details: { reason: "wrong_password" } });
      return { success: false, error: "E-posta veya şifre hatalı." };
    }

    if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Tenant resolved: ${user.tenant_slug}`);

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
    if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Session successfully created & JWT signed for User ID: ${session.userId}`);
    
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 2, // 2 saat (JWT ile eşleşmeli)
      path: "/",
    });
    
    if (process.env.NODE_ENV !== 'production') console.log(`[AUTH AUDIT] Cookie successfully written.`);

    // Son giriş zamanını güncelle
    await systemDb.executeSafe({
      text: `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
      values: [user.id]
    });

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
    console.error(`[AUTH AUDIT] Critical Login Error:`, error);
    const { logger: authLogger } = await import("@/lib/core/logger");
    authLogger.withContext({ module: 'Auth' }).error("Login error", error instanceof Error ? error : new Error(String(error)));
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
