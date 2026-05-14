"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

// ==========================================
// QUBA AI — Kullanıcı Yönetimi
// Tenant admin'i kendi kullanıcılarını yönetir
// ==========================================

// Roller: admin (firma sahibi), agent (temsilci), viewer (izleyici)

export async function getUsers() {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Oturum yok" };
  if (session.role !== "owner" && session.role !== "admin" && session.role !== "platform_admin") {
    return { success: false, error: "Yetki yok" };
  }

  try {
    const users = await sql`
      SELECT id, name, email, role, is_active, last_login_at, created_at
      FROM users
      WHERE tenant_id = ${session.tenantId}
      ORDER BY created_at ASC
    `;

    return { success: true, users };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: string;
}) {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Oturum yok" };
  if (session.role !== "owner" && session.role !== "admin" && session.role !== "platform_admin") {
    return { success: false, error: "Yetki yok" };
  }

  try {
    // E-posta kontrolü — aynı tenant içinde benzersiz olmalı (farklı tenant'larda kullanılabilir)
    const existing = await sql`SELECT id FROM users WHERE email = ${data.email} AND tenant_id = ${session.tenantId}`;
    if (existing.length > 0) return { success: false, error: "Bu e-posta bu firmada zaten kullanılıyor." };

    // Şifre hash
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash(data.password, 10);

    await sql`
      INSERT INTO users (tenant_id, email, password_hash, name, role, is_active)
      VALUES (${session.tenantId}, ${data.email}, ${hash}, ${data.name}, ${data.role}, true)
    `;

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateUserRole(userId: string, newRole: string) {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Oturum yok" };
  if (session.role !== "owner" && session.role !== "admin" && session.role !== "platform_admin") {
    return { success: false, error: "Yetki yok" };
  }

  // Kendi rolünü değiştiremez
  if (userId === session.userId) return { success: false, error: "Kendi rolünüzü değiştiremezsiniz." };

  try {
    await sql`
      UPDATE users SET role = ${newRole}, updated_at = NOW()
      WHERE id = ${userId} AND tenant_id = ${session.tenantId}
    `;
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function toggleUserActive(userId: string) {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Oturum yok" };
  if (session.role !== "owner" && session.role !== "admin" && session.role !== "platform_admin") {
    return { success: false, error: "Yetki yok" };
  }
  if (userId === session.userId) return { success: false, error: "Kendinizi deaktif edemezsiniz." };

  try {
    const user = await sql`SELECT is_active FROM users WHERE id = ${userId} AND tenant_id = ${session.tenantId}`;
    if (user.length === 0) return { success: false, error: "Kullanıcı bulunamadı." };

    await sql`
      UPDATE users SET is_active = ${!user[0].is_active}, updated_at = NOW()
      WHERE id = ${userId} AND tenant_id = ${session.tenantId}
    `;
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteUser(userId: string) {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Oturum yok" };
  if (session.role !== "owner" && session.role !== "admin" && session.role !== "platform_admin") {
    return { success: false, error: "Yetki yok" };
  }
  if (userId === session.userId) return { success: false, error: "Kendinizi silemezsiniz." };

  try {
    await sql`DELETE FROM users WHERE id = ${userId} AND tenant_id = ${session.tenantId}`;
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ==========================================
// ŞİFRE YÖNETİMİ
// ==========================================

/**
 * Admin şifre sıfırlama — yeni geçici şifre oluştur
 */
export async function resetUserPassword(userId: string) {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Oturum yok" };
  if (session.role !== "owner" && session.role !== "admin" && session.role !== "platform_admin") {
    return { success: false, error: "Yetki yok" };
  }

  try {
    const user = await sql`SELECT id, name, email FROM users WHERE id = ${userId} AND tenant_id = ${session.tenantId}`;
    if (user.length === 0) return { success: false, error: "Kullanıcı bulunamadı." };

    // 8 karakterlik random geçici şifre
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let tempPassword = "";
    for (let i = 0; i < 8; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash(tempPassword, 10);

    // Şifreyi güncelle + must_change_password flag
    await sql`
      UPDATE users SET password_hash = ${hash}, must_change_password = true, updated_at = NOW()
      WHERE id = ${userId} AND tenant_id = ${session.tenantId}
    `;

    return {
      success: true,
      tempPassword,
      userName: user[0].name,
      userEmail: user[0].email,
      message: `Geçici şifre: ${tempPassword} — Kullanıcı ilk girişte şifresini değiştirmek zorundadır.`,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Kullanıcı kendi şifresini değiştirir
 */
export async function changeMyPassword(currentPassword: string, newPassword: string) {
  const session = await getSession();
  if (!session?.userId) return { success: false, error: "Oturum yok" };
  if (newPassword.length < 6) return { success: false, error: "Yeni şifre en az 6 karakter olmalı." };

  try {
    const user = await sql`SELECT password_hash FROM users WHERE id = ${session.userId}`;
    if (user.length === 0) return { success: false, error: "Kullanıcı bulunamadı." };

    const bcrypt = await import("bcryptjs");
    const valid = await bcrypt.compare(currentPassword, user[0].password_hash);
    if (!valid) return { success: false, error: "Mevcut şifre yanlış." };

    const hash = await bcrypt.hash(newPassword, 10);
    await sql`
      UPDATE users SET password_hash = ${hash}, must_change_password = false, updated_at = NOW()
      WHERE id = ${session.userId}
    `;

    return { success: true, message: "Şifre başarıyla güncellendi." };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Davet linki oluştur (token-based)
 */
export async function generateInviteLink(userId: string) {
  const session = await getSession();
  if (!session?.tenantId) return { success: false, error: "Oturum yok" };
  if (session.role !== "owner" && session.role !== "admin" && session.role !== "platform_admin") {
    return { success: false, error: "Yetki yok" };
  }

  try {
    const user = await sql`SELECT id, email, name FROM users WHERE id = ${userId} AND tenant_id = ${session.tenantId}`;
    if (user.length === 0) return { success: false, error: "Kullanıcı bulunamadı." };

    // 32 char random token
    const token = Array.from({ length: 32 }, () => 
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 62))
    ).join("");

    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 saat

    // Token'ı DB'ye kaydet
    await sql`
      UPDATE users SET 
        invite_token = ${token}, 
        invite_expires_at = ${expiresAt.toISOString()},
        updated_at = NOW()
      WHERE id = ${userId} AND tenant_id = ${session.tenantId}
    `;

    const inviteUrl = `https://ai.qubamedya.com/login?invite=${token}`;

    return {
      success: true,
      inviteUrl,
      expiresAt: expiresAt.toISOString(),
      userName: user[0].name,
      userEmail: user[0].email,
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
