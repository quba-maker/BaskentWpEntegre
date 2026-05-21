import { NextRequest, NextResponse } from "next/server";
import { withTenantDB } from "@/lib/core/tenant-db";

// ==========================================
// QUBA AI OS — Tenant Admin API
// ==========================================
// Tenant Meta credential yönetimi.
// Setup key ile korunan admin endpoint.
// ==========================================

const getSetupKey = () => process.env.ADMIN_SETUP_KEY || process.env.SETUP_KEY || "quba-setup-2026";

// GET — Tüm tenant'ları listele (meta bilgileriyle)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== getSetupKey()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const systemDb = withTenantDB('admin-system', true);
  const tenants = await systemDb.executeSafe({
    text: `
      SELECT id, name, slug, status, plan,
             whatsapp_phone_id, whatsapp_business_id,
             meta_page_id, instagram_id,
             meta_app_id,
             CASE WHEN meta_app_secret IS NOT NULL THEN '***SET***' ELSE NULL END as meta_app_secret_status,
             CASE WHEN meta_page_token IS NOT NULL THEN '***SET***' ELSE NULL END as meta_page_token_status,
             created_at, updated_at
      FROM tenants
      ORDER BY created_at
    `
  }) as any[];

  return NextResponse.json({ tenants });
}

// PATCH — Tenant Meta bilgilerini güncelle
export async function PATCH(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== getSetupKey()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { slug, meta_app_id, meta_app_secret, meta_page_token, whatsapp_phone_id, whatsapp_business_id, meta_page_id, instagram_id } = body;

    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const systemDb = withTenantDB('admin-system', true);

    // Tenant var mı kontrol et
    const existing = await systemDb.executeSafe({
      text: "SELECT id, name FROM tenants WHERE slug = $1",
      values: [slug]
    }) as any[];

    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: `Tenant '${slug}' not found` }, { status: 404 });
    }

    // Sadece gönderilen alanları güncelle
    const updates: string[] = [];

    if (meta_app_id !== undefined) {
      await systemDb.executeSafe({
        text: "UPDATE tenants SET meta_app_id = $1 WHERE slug = $2",
        values: [meta_app_id, slug]
      });
      updates.push("meta_app_id");
    }
    if (meta_app_secret !== undefined) {
      await systemDb.executeSafe({
        text: "UPDATE tenants SET meta_app_secret = $1 WHERE slug = $2",
        values: [meta_app_secret, slug]
      });
      updates.push("meta_app_secret");
    }
    if (meta_page_token !== undefined) {
      await systemDb.executeSafe({
        text: "UPDATE tenants SET meta_page_token = $1 WHERE slug = $2",
        values: [meta_page_token, slug]
      });
      updates.push("meta_page_token");
    }
    if (whatsapp_phone_id !== undefined) {
      await systemDb.executeSafe({
        text: "UPDATE tenants SET whatsapp_phone_id = $1 WHERE slug = $2",
        values: [whatsapp_phone_id, slug]
      });
      updates.push("whatsapp_phone_id");
    }
    if (whatsapp_business_id !== undefined) {
      await systemDb.executeSafe({
        text: "UPDATE tenants SET whatsapp_business_id = $1 WHERE slug = $2",
        values: [whatsapp_business_id, slug]
      });
      updates.push("whatsapp_business_id");
    }
    if (meta_page_id !== undefined) {
      await systemDb.executeSafe({
        text: "UPDATE tenants SET meta_page_id = $1 WHERE slug = $2",
        values: [meta_page_id, slug]
      });
      updates.push("meta_page_id");
    }
    if (instagram_id !== undefined) {
      await systemDb.executeSafe({
        text: "UPDATE tenants SET instagram_id = $1 WHERE slug = $2",
        values: [instagram_id, slug]
      });
      updates.push("instagram_id");
    }

    // updated_at güncelle
    await systemDb.executeSafe({
      text: "UPDATE tenants SET updated_at = NOW() WHERE slug = $1",
      values: [slug]
    });

    return NextResponse.json({
      success: true,
      tenant: existing[0].name,
      slug,
      updatedFields: updates,
      message: `${updates.length} field(s) updated for tenant '${slug}'`
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
