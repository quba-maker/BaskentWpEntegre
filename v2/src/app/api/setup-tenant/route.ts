import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// Tenant Meta bilgilerini güncelle
// POST /api/setup-tenant
// ==========================================

export async function POST(req: NextRequest) {
  try {
    const setupKey = req.headers.get("x-setup-key");
    if (setupKey !== (process.env.SETUP_KEY || "quba-setup-2026")) {
      return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const { slug, metaPageId, metaPageToken, instagramId, whatsappPhoneId, whatsappBusinessId } = await req.json();

    if (!slug) {
      return NextResponse.json({ error: "slug gerekli." }, { status: 400 });
    }

    await sql`
      UPDATE tenants SET
        meta_page_id = COALESCE(${metaPageId || null}, meta_page_id),
        meta_page_token = COALESCE(${metaPageToken || null}, meta_page_token),
        instagram_id = COALESCE(${instagramId || null}, instagram_id),
        whatsapp_phone_id = COALESCE(${whatsappPhoneId || null}, whatsapp_phone_id),
        whatsapp_business_id = COALESCE(${whatsappBusinessId || null}, whatsapp_business_id),
        updated_at = NOW()
      WHERE slug = ${slug}
    `;

    return NextResponse.json({ success: true, message: `${slug} tenant güncellendi.` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
