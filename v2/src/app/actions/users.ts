"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { getPublicBaseUrl } from "@/lib/core/url";
import { normalizeTenantAssignableRole } from "@/lib/auth/roles";

// ==========================================
// QUBA AI — Kullanıcı Yönetimi
// Tenant admin'i kendi kullanıcılarını yönetir
// ==========================================

export async function getUsers() {
  return withActionGuard({ actionName: 'getUsers', roles: ['owner', 'admin'] }, async (ctx) => {
    const users = await ctx.db.executeSafe(
      `SELECT id, name, email, role, is_active, last_login_at, created_at
      FROM users
      WHERE tenant_id = $1
      ORDER BY created_at ASC`,
      [ctx.tenantId]
    );
    return users;
  });
}

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: string;
}) {
  return withActionGuard({ actionName: 'createUser', roles: ['owner', 'admin'] }, async (ctx) => {
    const role = normalizeTenantAssignableRole(data.role);
    const existing = await ctx.db.executeSafe(
      `SELECT id FROM users WHERE email = $1 AND tenant_id = $2`,
      [data.email, ctx.tenantId]
    );
    if (existing.length > 0) throw new Error("Bu e-posta bu firmada zaten kullanılıyor.");

    const bcryptModule = await import("bcryptjs");
    const bcrypt = (bcryptModule as any).default || bcryptModule;
    const hash = await bcrypt.hash(data.password, 10);

    await ctx.db.executeSafe(
      `INSERT INTO users (tenant_id, email, password_hash, name, role, is_active)
      VALUES ($1, $2, $3, $4, $5, true)`,
      [ctx.tenantId, data.email, hash, data.name, role]
    );
    return true;
  });
}

export async function updateUserRole(userId: string, newRole: string) {
  return withActionGuard({ actionName: 'updateUserRole', roles: ['owner', 'admin'] }, async (ctx) => {
    if (userId === ctx.userId) throw new Error("Kendi rolünüzü değiştiremezsiniz.");
    const role = normalizeTenantAssignableRole(newRole);

    const target = await ctx.db.executeSafe(
      `SELECT role FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, ctx.tenantId]
    );
    if (target.length === 0) throw new Error("Kullanıcı bulunamadı.");
    if (target[0].role === 'owner' && ctx.role !== 'owner') {
      throw new Error("Firma sahibinin rolünü yalnızca firma sahibi değiştirebilir.");
    }

    await ctx.db.executeSafe(
      `UPDATE users SET role = $1 WHERE id = $2 AND tenant_id = $3`,
      [role, userId, ctx.tenantId]
    );
    return true;
  });
}

export async function toggleUserActive(userId: string) {
  return withActionGuard({ actionName: 'toggleUserActive', roles: ['owner', 'admin'] }, async (ctx) => {
    if (userId === ctx.userId) throw new Error("Kendinizi deaktif edemezsiniz.");

    const user = await ctx.db.executeSafe(
      `SELECT is_active, role FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, ctx.tenantId]
    );
    if (user.length === 0) throw new Error("Kullanıcı bulunamadı.");
    if (user[0].role === 'owner' && ctx.role !== 'owner') {
      throw new Error("Firma sahibini yalnızca firma sahibi pasifleştirebilir.");
    }

    await ctx.db.executeSafe(
      `UPDATE users SET is_active = $1 WHERE id = $2 AND tenant_id = $3`,
      [!user[0].is_active, userId, ctx.tenantId]
    );
    return true;
  });
}

export async function deleteUser(userId: string) {
  return withActionGuard({ actionName: 'deleteUser', roles: ['owner', 'admin'] }, async (ctx) => {
    if (userId === ctx.userId) throw new Error("Kendinizi silemezsiniz.");
    const target = await ctx.db.executeSafe(
      `SELECT role FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, ctx.tenantId]
    );
    if (target.length === 0) throw new Error("Kullanıcı bulunamadı.");
    if (target[0].role === 'owner' && ctx.role !== 'owner') {
      throw new Error("Firma sahibini yalnızca firma sahibi silebilir.");
    }

    await ctx.db.executeSafe(
      `DELETE FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, ctx.tenantId]
    );
    return true;
  });
}

// ==========================================
// ŞİFRE YÖNETİMİ
// ==========================================

export async function resetUserPassword(userId: string) {
  return withActionGuard({ actionName: 'resetUserPassword', roles: ['owner', 'admin'] }, async (ctx) => {
    const user = await ctx.db.executeSafe(
      `SELECT id, name, email FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, ctx.tenantId]
    );
    if (user.length === 0) throw new Error("Kullanıcı bulunamadı.");

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let tempPassword = "";
    for (let i = 0; i < 8; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const bcryptModule = await import("bcryptjs");
    const bcrypt = (bcryptModule as any).default || bcryptModule;
    const hash = await bcrypt.hash(tempPassword, 10);

    await ctx.db.executeSafe(
      `UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2 AND tenant_id = $3`,
      [hash, userId, ctx.tenantId]
    );

    return {
      tempPassword,
      userName: user[0].name,
      userEmail: user[0].email,
      message: `Geçici şifre: ${tempPassword} — Kullanıcı ilk girişte şifresini değiştirmek zorundadır.`,
    };
  });
}

export async function changeMyPassword(currentPassword: string, newPassword: string) {
  return withActionGuard({ actionName: 'changeMyPassword' }, async (ctx) => {
    if (newPassword.length < 6) throw new Error("Yeni şifre en az 6 karakter olmalı.");

    const user = await ctx.db.executeSafe(
      `SELECT password_hash FROM users WHERE id = $1 AND tenant_id = $2`,
      [ctx.userId, ctx.tenantId]
    );
    if (user.length === 0) throw new Error("Kullanıcı bulunamadı.");

    const bcryptModule = await import("bcryptjs");
    const bcrypt = (bcryptModule as any).default || bcryptModule;
    const valid = await bcrypt.compare(currentPassword, user[0].password_hash);
    if (!valid) throw new Error("Mevcut şifre yanlış.");

    const hash = await bcrypt.hash(newPassword, 10);
    await ctx.db.executeSafe(
      `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2 AND tenant_id = $3`,
      [hash, ctx.userId, ctx.tenantId]
    );

    return { message: "Şifre başarıyla güncellendi." };
  });
}

export async function generateInviteLink(userId: string) {
  return withActionGuard({ actionName: 'generateInviteLink', roles: ['owner', 'admin'] }, async (ctx) => {
    const user = await ctx.db.executeSafe(
      `SELECT id, email, name FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, ctx.tenantId]
    );
    if (user.length === 0) throw new Error("Kullanıcı bulunamadı.");

    const token = Array.from({ length: 32 }, () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 62))
    ).join("");

    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await ctx.db.executeSafe(
      `UPDATE users SET invite_token = $1, invite_expires_at = $2 WHERE id = $3 AND tenant_id = $4`,
      [token, expiresAt.toISOString(), userId, ctx.tenantId]
    );

    const inviteUrl = `${getPublicBaseUrl()}/login?invite=${token}`;

    return {
      inviteUrl,
      expiresAt: expiresAt.toISOString(),
      userName: user[0].name,
      userEmail: user[0].email,
    };
  });
}
