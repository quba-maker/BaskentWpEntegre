import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ==========================================
// ROL NORMALİZASYON SCRIPTI (TEK SEFERLİK)
// ==========================================

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL!);

    // 1. Quba tenant'ındaki owner'ları 'platform_admin' yap
    await sql`
      UPDATE users 
      SET role = 'platform_admin' 
      WHERE role = 'owner' 
      AND tenant_id = (SELECT id FROM tenants WHERE slug = 'quba')
    `;

    // 2. Diğer tenantlardaki owner'ları 'admin' yap
    await sql`
      UPDATE users 
      SET role = 'admin' 
      WHERE role = 'owner' 
      AND tenant_id != (SELECT id FROM tenants WHERE slug = 'quba')
    `;

    return NextResponse.json({ success: true, message: "Roller normalize edildi." });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
