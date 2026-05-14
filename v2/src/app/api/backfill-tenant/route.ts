import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// Mevcut verilere tenant_id ekle (Tek seferlik)
// GET /api/backfill-tenant
// ==========================================

export async function GET(req: NextRequest) {
  try {
    const setupKey = req.nextUrl.searchParams.get("key");
    if (setupKey !== (process.env.SETUP_KEY || "quba-setup-2026")) {
      return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Başkent tenant ID'sini bul
    const tenants = await sql`SELECT id FROM tenants WHERE slug = 'baskent'`;
    if (tenants.length === 0) {
      return NextResponse.json({ error: "Başkent tenant bulunamadı." }, { status: 404 });
    }

    const tenantId = tenants[0].id;
    const results: string[] = [];

    // Conversations — tenant_id NULL olanları Başkent'e ata
    const convUpdate = await sql`
      UPDATE conversations SET tenant_id = ${tenantId} WHERE tenant_id IS NULL
    `;
    results.push(`✅ Conversations güncellendi`);

    // Messages — tenant_id NULL olanları Başkent'e ata
    const msgUpdate = await sql`
      UPDATE messages SET tenant_id = ${tenantId} WHERE tenant_id IS NULL
    `;
    results.push(`✅ Messages güncellendi`);

    // Leads — tenant_id yoksa ekle ve güncelle
    try {
      await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS tenant_id UUID`;
      await sql`UPDATE leads SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
      results.push(`✅ Leads güncellendi`);
    } catch (e) {
      results.push(`⚠️ Leads: ${(e as any).message}`);
    }

    // Settings — tenant_id güncelle
    try {
      await sql`UPDATE settings SET tenant_id = ${tenantId} WHERE tenant_id IS NULL`;
      results.push(`✅ Settings güncellendi`);
    } catch (e) {
      results.push(`⚠️ Settings: ${(e as any).message}`);
    }

    return NextResponse.json({ success: true, tenantId, results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
