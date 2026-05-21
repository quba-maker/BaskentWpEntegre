"use server";

import { withActionGuard } from "@/lib/core/action-guard";

export async function getDashboardStats() {
  return withActionGuard({ actionName: 'getDashboardStats' }, async (ctx) => {
    const { db, tenantId } = ctx;

    const [convs, msgs, leads, botMsgs, activeConvs] = await Promise.all([
      db.executeSafe(`SELECT COUNT(*) as c FROM conversations WHERE tenant_id = $1`, [tenantId]),
      db.executeSafe(`SELECT COUNT(*) as c FROM messages WHERE tenant_id = $1`, [tenantId]),
      db.executeSafe(`SELECT COUNT(*) as c FROM leads WHERE tenant_id = $1`, [tenantId]),
      db.executeSafe(`SELECT COUNT(*) as c FROM messages WHERE tenant_id = $1 AND direction = 'out'`, [tenantId]),
      db.executeSafe(`SELECT COUNT(*) as c FROM conversations WHERE tenant_id = $1 AND last_message_at >= NOW() - INTERVAL '24 hours'`, [tenantId]),
    ]);

    // Son 7 gün mesaj grafiği
    const daily = await db.executeSafe(`
      SELECT DATE(created_at) as day, COUNT(*) as c
      FROM messages
      WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `, [tenantId]);

    // Son leadler
    const recentLeads = await db.executeSafe(`
      SELECT 
        COALESCE(cp.first_name || ' ' || cp.last_name, 'İsimsiz') as patient_name, 
        l.phone_number, 
        COALESCE(l.source, 'Bilinmeyen Form') as form_name, 
        'new' as stage, 
        l.created_at
      FROM leads l
      LEFT JOIN customer_profiles cp ON l.customer_id = cp.id
      WHERE l.tenant_id = $1
      ORDER BY l.created_at DESC
      LIMIT 5
    `, [tenantId]);

    return {
      totalConversations: parseInt(convs[0]?.c) || 0,
      totalMessages: parseInt(msgs[0]?.c) || 0,
      totalLeads: parseInt(leads[0]?.c) || 0,
      botMessages: parseInt(botMsgs[0]?.c) || 0,
      activeToday: parseInt(activeConvs[0]?.c) || 0,
      dailyMessages: daily.map((d: any) => ({ day: d.day, count: parseInt(d.c) })),
      recentLeads: recentLeads,
    };
  });
}
