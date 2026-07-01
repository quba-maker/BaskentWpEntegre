"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { sql } from "@/lib/db";

// ==========================================
// QUBA AI — Billing & Usage Server Actions
// Firma bazlı kullanım istatistikleri ve fatura verisi
// ==========================================

export async function getUsageStats() {
  return withActionGuard({ actionName: 'getUsageStats' }, async (ctx) => {
    const { db, tenantId } = ctx;
    const currentMonth = new Date().toISOString().slice(0, 7);
    const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 7);

    const [totalMsgs, aiMsgs, humanMsgs, channels, dailyStats] = await Promise.all([
      db.executeSafe(`SELECT COUNT(*) as c FROM messages WHERE tenant_id = $1 AND created_at >= DATE_TRUNC('month', NOW())`, [tenantId]),
      db.executeSafe(`SELECT COUNT(*) as c FROM messages WHERE tenant_id = $1 AND created_at >= DATE_TRUNC('month', NOW()) AND direction = 'out'`, [tenantId]),
      db.executeSafe(`SELECT COUNT(*) as c FROM messages WHERE tenant_id = $1 AND created_at >= DATE_TRUNC('month', NOW()) AND direction = 'in'`, [tenantId]),
      db.executeSafe(`SELECT channel, COUNT(*) as c FROM messages WHERE tenant_id = $1 AND created_at >= DATE_TRUNC('month', NOW()) GROUP BY channel`, [tenantId]),
      db.executeSafe(`SELECT DATE(created_at) as day, COUNT(*) as total, COUNT(*) FILTER (WHERE direction = 'out') as ai FROM messages WHERE tenant_id = $1 AND created_at >= DATE_TRUNC('month', NOW()) GROUP BY DATE(created_at) ORDER BY day`, [tenantId]),
    ]);

    const lastMonthTotal = await db.executeSafe(
      `SELECT COUNT(*) as c FROM messages WHERE tenant_id = $1 AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', $2::date)`,
      [tenantId, lastMonth + '-01']
    );

    const channelBreakdown: Record<string, number> = {};
    for (const ch of channels) {
      channelBreakdown[ch.channel || 'unknown'] = Number(ch.c);
    }

    const aiCount = Number(aiMsgs[0]?.c || 0);
    const estimatedCost = (aiCount * 0.0001).toFixed(4);

    // Tenant limit — bu sorgu tenant tablosuna gittiği için RLS bypass gerekebilir
    const tenantInfo = await db.executeSafe(
      `SELECT name, plan, monthly_message_limit FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const tenant = tenantInfo[0] || {};

    const monthlyLimit = tenant.monthly_message_limit || 500;
    const totalCount = Number(totalMsgs[0]?.c || 0);
    const usagePercent = Math.round((totalCount / monthlyLimit) * 100);

    return {
      currentMonth,
      tenantName: tenant.name,
      plan: tenant.plan || 'starter',
      totalMessages: totalCount,
      aiMessages: aiCount,
      humanMessages: Number(humanMsgs[0]?.c || 0),
      lastMonthTotal: Number(lastMonthTotal[0]?.c || 0),
      growthPercent: lastMonthTotal[0]?.c > 0
        ? Math.round(((totalCount - Number(lastMonthTotal[0].c)) / Number(lastMonthTotal[0].c)) * 100)
        : 100,
      channels: channelBreakdown,
      daily: dailyStats.map((d: any) => ({
        day: d.day,
        total: Number(d.total),
        ai: Number(d.ai),
      })),
      monthlyLimit,
      usagePercent,
      estimatedCostUsd: estimatedCost,
    };
  });
}

/**
 * Platform admin — tüm tenantların kullanım özeti
 * NOT: Bu action cross-tenant data gerektirir, bu nedenle raw sql kullanır
 */
export async function getAllTenantsUsage() {
  return withActionGuard({ actionName: 'getAllTenantsUsage', roles: ['platform_admin'], requireTenant: false }, async (ctx) => {
    // Cross-tenant sorgu — platform admin bypass ile çalışır
    const stats = await sql`
      SELECT 
        t.name, t.slug, t.plan, t.status,
        COUNT(m.id) as total_messages,
        COUNT(m.id) FILTER (WHERE m.direction = 'out') as ai_messages,
        COUNT(DISTINCT m.phone_number) as unique_contacts,
        MAX(m.created_at) as last_activity
      FROM tenants t
      LEFT JOIN messages m ON m.tenant_id = t.id AND m.created_at >= DATE_TRUNC('month', NOW())
      WHERE t.status = 'active'
      GROUP BY t.id, t.name, t.slug, t.plan, t.status
      ORDER BY total_messages DESC
    `;

    return stats.map((t: any) => ({
      name: t.name,
      slug: t.slug,
      plan: t.plan,
      totalMessages: Number(t.total_messages),
      aiMessages: Number(t.ai_messages),
      uniqueContacts: Number(t.unique_contacts),
      lastActivity: t.last_activity,
      estimatedCost: (Number(t.ai_messages) * 0.0001).toFixed(4),
    }));
  });
}
