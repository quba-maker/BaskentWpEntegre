"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export async function getDashboardStats() {
  const session = await getSession();
  if (!session?.tenantId) return null;

  const tenantId = session.tenantId;

  try {
    const [convs, msgs, leads, botMsgs, activeConvs] = await Promise.all([
      sql`SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ${tenantId}`,
      sql`SELECT COUNT(*) as c FROM messages WHERE tenant_id = ${tenantId}`,
      sql`SELECT COUNT(*) as c FROM leads WHERE tenant_id = ${tenantId}`,
      sql`SELECT COUNT(*) as c FROM messages WHERE tenant_id = ${tenantId} AND direction = 'out'`,
      sql`SELECT COUNT(*) as c FROM conversations WHERE tenant_id = ${tenantId} AND last_message_at >= NOW() - INTERVAL '24 hours'`,
    ]);

    // Son 7 gün mesaj grafiği
    const daily = await sql`
      SELECT DATE(created_at) as day, COUNT(*) as c
      FROM messages
      WHERE tenant_id = ${tenantId} AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `;

    // Son leadler
    const recentLeads = await sql`
      SELECT 
        COALESCE(cp.first_name || ' ' || cp.last_name, 'İsimsiz') as patient_name, 
        l.phone_number, 
        COALESCE(l.source, 'Bilinmeyen Form') as form_name, 
        'new' as stage, 
        l.created_at
      FROM leads l
      LEFT JOIN customer_profiles cp ON l.customer_id = cp.id
      WHERE l.tenant_id = ${tenantId}
      ORDER BY l.created_at DESC
      LIMIT 5
    `;

    return {
      totalConversations: parseInt(convs[0]?.c) || 0,
      totalMessages: parseInt(msgs[0]?.c) || 0,
      totalLeads: parseInt(leads[0]?.c) || 0,
      botMessages: parseInt(botMsgs[0]?.c) || 0,
      activeToday: parseInt(activeConvs[0]?.c) || 0,
      dailyMessages: daily.map((d: any) => ({ day: d.day, count: parseInt(d.c) })),
      recentLeads: recentLeads,
      tenantName: session.tenantName,
      role: session.role,
    };
  } catch (error: any) {
    const { logger: dashLogger } = await import("@/lib/core/logger");
    dashLogger.withContext({ module: 'Dashboard' }).error("Dashboard stats error", error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}
