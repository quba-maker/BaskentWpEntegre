"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

// ==========================================
// QUBA AI — Super Admin Actions
// Sadece "owner" rolündeki kullanıcılar erişebilir
// ==========================================

export async function getAllTenants() {
  const session = await getSession();
  if (session?.role !== "owner") return { success: false, error: "Yetki yok" };

  try {
    const tenants = await sql`
      SELECT t.*,
        (SELECT COUNT(*) FROM conversations WHERE tenant_id = t.id) as conversation_count,
        (SELECT COUNT(*) FROM messages WHERE tenant_id = t.id) as message_count,
        (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as user_count
      FROM tenants t
      ORDER BY t.created_at DESC
    `;

    return { success: true, tenants };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function createTenant(data: {
  name: string;
  slug: string;
  industry?: string;
  plan?: string;
}) {
  const session = await getSession();
  if (session?.role !== "owner") return { success: false, error: "Yetki yok" };

  try {
    const existing = await sql`SELECT id FROM tenants WHERE slug = ${data.slug}`;
    if (existing.length > 0) return { success: false, error: "Bu slug zaten kullanılıyor." };

    await sql`
      INSERT INTO tenants (name, slug, industry, plan, status)
      VALUES (${data.name}, ${data.slug}, ${data.industry || 'general'}, ${data.plan || 'starter'}, 'active')
    `;

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function toggleTenantStatus(tenantId: string) {
  const session = await getSession();
  if (session?.role !== "owner") return { success: false, error: "Yetki yok" };

  try {
    const tenant = await sql`SELECT status FROM tenants WHERE id = ${tenantId}`;
    const newStatus = tenant[0]?.status === "active" ? "suspended" : "active";

    await sql`UPDATE tenants SET status = ${newStatus}, updated_at = NOW() WHERE id = ${tenantId}`;

    return { success: true, newStatus };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
