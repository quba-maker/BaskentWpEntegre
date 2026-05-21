import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { withTenantDB } from "@/lib/core/tenant-db";

// ==========================================
// FORENSIC DIAGNOSTIC ENDPOINT
// Tests the exact inbox query pipeline in production
// DELETE THIS AFTER DEBUGGING
// ==========================================

export async function GET(req: NextRequest) {
  const diagnostics: Record<string, any> = {
    timestamp: new Date().toISOString(),
    stages: {}
  };

  try {
    // Stage 1: Session
    const session = await getSession();
    diagnostics.stages.session = {
      hasSession: !!session,
      userId: session?.userId || null,
      tenantId: session?.tenantId || null,
      tenantSlug: session?.tenantSlug || null,
      role: session?.role || null,
      impersonatedTenantId: session?.impersonatedTenantId || null,
    };

    if (!session || !session.tenantId) {
      diagnostics.verdict = "SESSION_FAILED";
      return NextResponse.json(diagnostics);
    }

    // Stage 2: TenantDB
    const db = withTenantDB(session.tenantId, session.role === 'platform_admin');
    diagnostics.stages.tenantDb = {
      tenantId: db.tenantId,
      isAdmin: session.role === 'platform_admin',
    };

    // Stage 3: Query
    try {
      const rows = await db.executeSafe({
        text: `
          SELECT 
            c.phone_number as id,
            c.patient_name as name,
            c.channel,
            c.last_message_at,
            c.last_message_content
          FROM conversations c
          WHERE c.tenant_id = $1
          ORDER BY c.last_message_at DESC NULLS LAST
          LIMIT 10
        `,
        values: [session.tenantId]
      });

      const validRows = Array.isArray(rows) ? rows : ((rows as any)?.rows || []);
      diagnostics.stages.query = {
        success: true,
        rowCount: validRows.length,
        rows: validRows.map((r: any) => ({
          id: r.id,
          name: r.name,
          channel: r.channel,
          lastMsg: r.last_message_content?.substring(0, 50),
          lastAt: r.last_message_at
        }))
      };
    } catch (queryErr: any) {
      diagnostics.stages.query = {
        success: false,
        error: queryErr.message,
        stack: queryErr.stack?.substring(0, 500)
      };
    }

    // Stage 4: Messages count
    try {
      const msgCount = await db.executeSafe({
        text: `SELECT count(*)::int as cnt FROM messages WHERE tenant_id = $1`,
        values: [session.tenantId]
      });
      const validMsgCount = Array.isArray(msgCount) ? msgCount : ((msgCount as any)?.rows || []);
      diagnostics.stages.messages = {
        count: validMsgCount[0]?.cnt || 0
      };
    } catch (e: any) {
      diagnostics.stages.messages = { error: e.message };
    }

    diagnostics.verdict = "OK";
    return NextResponse.json(diagnostics);

  } catch (err: any) {
    diagnostics.verdict = "CRASH";
    diagnostics.error = err.message;
    diagnostics.stack = err.stack?.substring(0, 500);
    return NextResponse.json(diagnostics, { status: 500 });
  }
}
