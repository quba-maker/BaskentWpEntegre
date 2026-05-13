import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

// ==========================================
// İlk Admin Kullanıcı Oluşturma (Tek seferlik)
// POST /api/setup-admin
// ==========================================

export async function POST(req: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const { email, password, name, tenantSlug } = await req.json();

    if (!email || !password || !name || !tenantSlug) {
      return NextResponse.json({ error: "Eksik alan." }, { status: 400 });
    }

    // Setup key kontrolü (güvenlik)
    const setupKey = req.headers.get("x-setup-key");
    if (setupKey !== (process.env.SETUP_KEY || "quba-setup-2026")) {
      return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
    }

    // Tenant'ı bul
    const tenants = await sql`SELECT id FROM tenants WHERE slug = ${tenantSlug}`;
    if (tenants.length === 0) {
      return NextResponse.json({ error: "Tenant bulunamadı." }, { status: 404 });
    }

    // Şifreyi hashle
    const passwordHash = await bcrypt.hash(password, 12);

    // Kullanıcı oluştur
    await sql`
      INSERT INTO users (tenant_id, email, password_hash, name, role)
      VALUES (${tenants[0].id}, ${email}, ${passwordHash}, ${name}, 'owner')
      ON CONFLICT (email) DO UPDATE SET 
        password_hash = ${passwordHash},
        name = ${name}
    `;

    return NextResponse.json({ success: true, message: "Admin oluşturuldu." });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
