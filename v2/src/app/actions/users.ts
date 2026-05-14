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
