import { NextResponse } from "next/server";
import { withTenantDB } from "@/lib/core/tenant-db";
import { sql } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const key = new URL(req.url).searchParams.get("key");
    if (key !== "debug2026") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = new URL(req.url).searchParams.get("tenantId") || "43c08749-ecc3-452f-a48d-60cd631986f8";
    
    const db = withTenantDB(tenantId, false);
    
    // Test tagged template
    const settings = await db.executeSafe(sql`
      SELECT key, value FROM settings 
      WHERE tenant_id = ${tenantId}
      LIMIT 2
    `);

    // Test arrayness
    const isArray = Array.isArray(settings);

    return NextResponse.json({
      success: true,
      settingsType: typeof settings,
      isArray,
      settingsKeys: Object.keys(settings || {}),
      settingsData: settings
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}
