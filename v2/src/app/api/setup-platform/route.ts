import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// Quba Medya Platform Tenant oluştur
// Admin'i Quba tenant'ına taşı
// GET /api/setup-platform
// ==========================================

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);

    // 1. Quba Medya platform tenant'ı oluştur
    const existing = await sql`SELECT id FROM tenants WHERE slug = 'quba'`;
    
    let qubaId;
    if (existing.length === 0) {
      const result = await sql`
        INSERT INTO tenants (name, slug, industry, plan, status, monthly_message_limit)
        VALUES ('Quba Medya', 'quba', 'technology', 'enterprise', 'active', 999999)
        RETURNING id
      `;
      qubaId = result[0].id;
    } else {
      qubaId = existing[0].id;
    }

    // 2. Admin kullanıcısını Quba tenant'ına taşı
    await sql`
      UPDATE users SET tenant_id = ${qubaId}, role = 'owner'
      WHERE email = 'admin@qubamedya.com'
    `;

    return NextResponse.json({ 
      success: true, 
      message: "Quba Medya platform tenant oluşturuldu. Admin taşındı.",
      qubaId 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
