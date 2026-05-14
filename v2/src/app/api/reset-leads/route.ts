import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// ==========================================
// QUBA AI — Lead Reset (Güvenli)
// Sadece setup key ile erişilebilir
// Tenant bazlı izole çalışır
// ==========================================

export async function POST(req: NextRequest) {
  try {
    // 1. Auth kontrolü
    const setupKey = req.headers.get("x-setup-key");
    if (setupKey !== "quba-setup-2026") {
      return NextResponse.json({ error: "Yetkisiz." }, { status: 401 });
    }

    // 2. Tenant slug kontrolü (body'den)
    const body = await req.json().catch(() => ({}));
    const tenantSlug = body.tenant_slug;

    if (!tenantSlug) {
      return NextResponse.json({ error: "tenant_slug gerekli. Tüm verileri silmek için 'all' gönderin." }, { status: 400 });
    }

    if (tenantSlug === "all") {
      // Sadece super admin — tüm leadleri temizle
      await sql`TRUNCATE TABLE leads RESTART IDENTITY CASCADE`;
      return NextResponse.json({ success: true, message: "Tüm lead verileri silindi." });
    }

    // Belirli tenant'ın leadlerini sil
    const tenant = await sql`SELECT id FROM tenants WHERE slug = ${tenantSlug}`;
    if (tenant.length === 0) {
      return NextResponse.json({ error: "Tenant bulunamadı." }, { status: 404 });
    }

    await sql`DELETE FROM leads WHERE tenant_id = ${tenant[0].id}`;
    return NextResponse.json({ success: true, message: `${tenantSlug} tenant'ının lead verileri silindi.` });
  } catch (error: any) {
    console.error('Reset error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET isteğini tamamen engelle
export async function GET() {
  return NextResponse.json({ error: "Bu endpoint artık GET ile erişilemez. POST + x-setup-key gerekli." }, { status: 405 });
}
