export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getBotSettings } from "@/app/actions/bot";
import { getConversations } from "@/app/actions/inbox";
import { sql } from "@/lib/db";
import { withTenantDB } from "@/lib/core/tenant-db";

export async function GET(req: Request) {
  try {
    const key = new URL(req.url).searchParams.get("key");
    if (key !== "debug2026") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = new URL(req.url).searchParams.get("tenantId") || "43c08749-ecc3-452f-a48d-60cd631986f8";

    // 1. Direct neon query
    const dbUrl = process.env.DATABASE_URL || "postgres://dummy:dummy@dummy.com/dummy";
    const s = neon(dbUrl);
    const rawData = await s`SELECT key, substring(value from 1 for 100) as value FROM settings WHERE tenant_id = ${tenantId}`;

    // 2. TenantDB query
    const tdb = withTenantDB(tenantId, false);
    let tdbData, tdbError;
    try {
      tdbData = await tdb.executeSafe(sql`SELECT key, substring(value from 1 for 100) as value FROM settings WHERE tenant_id = ${tenantId}`);
    } catch(e: any) {
      tdbError = e.message;
    }

    // 3. getConversations direct query
    let rawConvs = [];
    try {
      rawConvs = await s`SELECT phone_number, patient_name, tenant_id FROM conversations WHERE tenant_id = ${tenantId}`;
    } catch {}

    // 4. getConversations via tenant DB
    let tdbConvs = null, tdbConvsError = null;
    try {
      tdbConvs = await tdb.executeSafe(sql`SELECT phone_number, patient_name FROM conversations WHERE tenant_id = ${tenantId}`);
    } catch(e: any) {
      tdbConvsError = e.message;
    }

    return NextResponse.json({
      success: true,
      tenantId,
      rawSettingsCount: rawData.length,
      tdbSettingsCount: Array.isArray(tdbData) ? tdbData.length : -1,
      tdbIsArray: Array.isArray(tdbData),
      tdbError,
      rawConvsCount: rawConvs.length,
      tdbConvsCount: Array.isArray(tdbConvs) ? tdbConvs.length : -1,
      tdbConvsError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
