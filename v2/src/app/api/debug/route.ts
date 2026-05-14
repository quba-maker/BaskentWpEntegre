import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export async function GET(req: Request) {
  try {
    const key = new URL(req.url).searchParams.get("key");
    if (key !== "debug2026") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sql = neon(process.env.DATABASE_URL!);
    
    // 1. Get baskent tenant ID
    const tenant = await sql`SELECT id, slug FROM tenants WHERE slug = 'baskent'`;
    if (tenant.length === 0) return NextResponse.json({ error: "Baskent tenant not found" });
    const tenantId = tenant[0].id;

    // 2. Get settings for baskent
    const settings = await sql`SELECT key, value, updated_at FROM settings WHERE tenant_id = ${tenantId}`;
    
    // 3. Get raw backup records
    let backupCount = 0;
    try {
      const backup = await sql`SELECT count(*) as c FROM settings_backup_0514`;
      backupCount = backup[0].c;
    } catch { }

    return NextResponse.json({
      success: true,
      tenantId,
      settingsCount: settings.length,
      backupCount,
      settings: settings.map(s => ({ key: s.key, value: s.value ? s.value.substring(0, 100) : null, updated_at: s.updated_at }))
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
