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
      sql`SELECT COUNT(*) as c FROM messages WHERE tenant_id = ${tenantId} AND direction = 'out' AND model_used IS NOT NULL AND model_used NOT IN ('panel', 'mesai-disi', 'fallback', 'none')`,
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
      SELECT patient_name, phone_number, form_name, stage, created_at
      FROM leads
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
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
    console.error("Dashboard stats error:", error);
    return null;
  }
}
