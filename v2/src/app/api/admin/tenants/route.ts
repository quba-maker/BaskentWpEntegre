import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// QUBA AI OS — Tenant Admin API
// ==========================================
// Tenant Meta credential yönetimi.
// Setup key ile korunan admin endpoint.
// ==========================================

const SETUP_KEY = "quba-setup-2026";

// GET — Tüm tenant'ları listele (meta bilgileriyle)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== SETUP_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const tenants = await sql`
    SELECT id, name, slug, status, plan,
           whatsapp_phone_id, whatsapp_business_id,
           meta_page_id, instagram_id,
           meta_app_id,
           CASE WHEN meta_app_secret IS NOT NULL THEN '***SET***' ELSE NULL END as meta_app_secret_status,
           CASE WHEN meta_page_token IS NOT NULL THEN '***SET***' ELSE NULL END as meta_page_token_status,
           created_at, updated_at
    FROM tenants
    ORDER BY created_at
  `;

  return NextResponse.json({ tenants });
}

// PATCH — Tenant Meta bilgilerini güncelle
export async function PATCH(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== SETUP_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { slug, meta_app_id, meta_app_secret, meta_page_token, whatsapp_phone_id, whatsapp_business_id, meta_page_id, instagram_id } = body;

    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Tenant var mı kontrol et
    const existing = await sql`SELECT id, name FROM tenants WHERE slug = ${slug}`;
    if (existing.length === 0) {
      return NextResponse.json({ error: `Tenant '${slug}' not found` }, { status: 404 });
    }

    // Sadece gönderilen alanları güncelle
    const updates: string[] = [];

    if (meta_app_id !== undefined) {
      await sql`UPDATE tenants SET meta_app_id = ${meta_app_id} WHERE slug = ${slug}`;
      updates.push("meta_app_id");
    }
    if (meta_app_secret !== undefined) {
      await sql`UPDATE tenants SET meta_app_secret = ${meta_app_secret} WHERE slug = ${slug}`;
      updates.push("meta_app_secret");
    }
    if (meta_page_token !== undefined) {
      await sql`UPDATE tenants SET meta_page_token = ${meta_page_token} WHERE slug = ${slug}`;
      updates.push("meta_page_token");
    }
    if (whatsapp_phone_id !== undefined) {
      await sql`UPDATE tenants SET whatsapp_phone_id = ${whatsapp_phone_id} WHERE slug = ${slug}`;
      updates.push("whatsapp_phone_id");
    }
    if (whatsapp_business_id !== undefined) {
      await sql`UPDATE tenants SET whatsapp_business_id = ${whatsapp_business_id} WHERE slug = ${slug}`;
      updates.push("whatsapp_business_id");
    }
    if (meta_page_id !== undefined) {
      await sql`UPDATE tenants SET meta_page_id = ${meta_page_id} WHERE slug = ${slug}`;
      updates.push("meta_page_id");
    }
    if (instagram_id !== undefined) {
      await sql`UPDATE tenants SET instagram_id = ${instagram_id} WHERE slug = ${slug}`;
      updates.push("instagram_id");
    }

    // updated_at güncelle
    await sql`UPDATE tenants SET updated_at = NOW() WHERE slug = ${slug}`;

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
