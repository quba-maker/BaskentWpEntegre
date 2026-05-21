import { NextResponse } from 'next/server';
import { withTenantDB } from '@/lib/core/tenant-db';
import { sql } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId');
    const bypass = url.searchParams.get('bypass') === 'true';

    if (!tenantId && !bypass) {
      return NextResponse.json({ error: 'tenantId or bypass required' }, { status: 400 });
    }

    const db = withTenantDB(tenantId || '00000000-0000-0000-0000-000000000000', bypass);

    try {
      const channels = await db.executeSafe(sql`SELECT id, tenant_id, name FROM channels LIMIT 10`);
      const groups = await db.executeSafe(sql`SELECT id, tenant_id, name FROM channel_groups LIMIT 10`);
      
      return NextResponse.json({
        success: true,
        data: {
          channels,
          groups
        }
      });
    } catch (dbError: any) {
      return NextResponse.json({
        success: false,
        error: dbError.message,
        code: dbError.code
      }, { status: 403 });
    }

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
