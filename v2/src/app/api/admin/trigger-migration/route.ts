import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { MigrationService } from "@/lib/core/migration.service";
import { withTenantDB } from "@/lib/core/tenant-db";

export async function POST(req: NextRequest) {
  try {
    // Sadece Super Admin (Quba) bu endpoint'i tetikleyebilir
    const session = await getSession();
    if (!session || session.role !== 'platform_admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { targetTenantId } = await req.json();
    if (!targetTenantId) {
      return NextResponse.json({ error: "targetTenantId required" }, { status: 400 });
    }

    // TenantDB oluştur ve migrate et
    const db = withTenantDB(targetTenantId, true); // true = isAdmin context
    const result = await MigrationService.runTenantMigration(targetTenantId, db);

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
