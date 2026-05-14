"use server";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { neon } from "@neondatabase/serverless";

// ==========================================
// QUBA AI — Session Yönetimi (JWT + Cookie)
// ==========================================

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "quba-ai-secret-key-change-in-production"
);
const COOKIE_NAME = "quba_session";
const sql = neon(process.env.DATABASE_URL!);

// Session tipi
export interface Session {
  userId: string;
  email: string;
  name: string;
  role: string; // "owner" | "admin" | "agent" | "superadmin"
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
}

// JWT oluştur
async function createToken(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
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

// Aktif session'ı getir
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

// Giriş yap
export async function login(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; tenantSlug?: string }> {
  try {
    // Kullanıcıyı bul
    const users = await sql`
      SELECT u.*, t.slug as tenant_slug, t.name as tenant_name 
      FROM users u 
      JOIN tenants t ON u.tenant_id = t.id 
      WHERE u.email = ${email} AND u.is_active = true
    `;

    if (users.length === 0) {
      return { success: false, error: "E-posta veya şifre hatalı." };
    }

    const user = users[0];

    // Şifre kontrolü — bcryptjs dynamic import (edge uyumluluğu)
    const bcrypt = await import("bcryptjs");
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
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
      maxAge: 60 * 60 * 24 * 7, // 7 gün
      path: "/",
    });

    // Son giriş zamanını güncelle
    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`;

    return { success: true, tenantSlug: user.tenant_slug };
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
