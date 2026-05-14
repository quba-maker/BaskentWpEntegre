"use server";

import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

// ==========================================
// QUBA AI — Billing & Usage Server Actions
// Firma bazlı kullanım istatistikleri ve fatura verisi
// ==========================================

export async function getUsageStats() {
  try {
    const session = await getSession();
    if (!session?.tenantId) return { success: false, error: "Oturum yok" };
    const tenantId = session.tenantId;

    // Aylık kullanım
    const currentMonth = new Date().toISOString().slice(0, 7); // 2026-05
    const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 7);

    // Güncel ay istatistikleri
    const [totalMsgs, aiMsgs, humanMsgs, channels, dailyStats] = await Promise.all([
      sql`SELECT COUNT(*) as c FROM messages WHERE tenant_id = ${tenantId} AND created_at >= DATE_TRUNC('month', NOW())`,
      sql`SELECT COUNT(*) as c FROM messages WHERE tenant_id = ${tenantId} AND created_at >= DATE_TRUNC('month', NOW()) AND model_used IS NOT NULL AND model_used NOT IN ('panel', 'mesai-disi', 'fallback', 'none', 'human-telegram', 'retry')`,
      sql`SELECT COUNT(*) as c FROM messages WHERE tenant_id = ${tenantId} AND created_at >= DATE_TRUNC('month', NOW()) AND direction = 'out' AND (model_used IS NULL OR model_used IN ('panel', 'human-telegram'))`,
      sql`SELECT channel, COUNT(*) as c FROM messages WHERE tenant_id = ${tenantId} AND created_at >= DATE_TRUNC('month', NOW()) GROUP BY channel`,
      sql`SELECT DATE(created_at) as day, COUNT(*) as total, COUNT(*) FILTER (WHERE model_used IS NOT NULL AND model_used NOT IN ('panel','mesai-disi','fallback','none','human-telegram','retry')) as ai FROM messages WHERE tenant_id = ${tenantId} AND created_at >= DATE_TRUNC('month', NOW()) GROUP BY DATE(created_at) ORDER BY day`,
    ]);

    // Geçen ay karşılaştırma
    const lastMonthTotal = await sql`SELECT COUNT(*) as c FROM messages WHERE tenant_id = ${tenantId} AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', ${lastMonth + '-01'}::date)`;

    // Kanal dağılımı
    const channelBreakdown: Record<string, number> = {};
    for (const ch of channels) {
      channelBreakdown[ch.channel || 'unknown'] = Number(ch.c);
    }

    // Tahmini maliyet (Gemini Flash: ~$0.0001/mesaj)
    const aiCount = Number(aiMsgs[0]?.c || 0);
    const estimatedCost = (aiCount * 0.0001).toFixed(4);

    // Tenant limiti
    const tenantInfo = await sql`SELECT name, daily_ai_limit, plan, monthly_message_limit FROM tenants WHERE id = ${tenantId}`;
    const tenant = tenantInfo[0] || {};

    // Bu ay kullanım oranı
    const monthlyLimit = tenant.monthly_message_limit || 500;
    const totalCount = Number(totalMsgs[0]?.c || 0);
    const usagePercent = Math.round((totalCount / monthlyLimit) * 100);

    return {
      success: true,
      data: {
        currentMonth,
        tenantName: tenant.name || session.tenantName,
        plan: tenant.plan || 'starter',

        // Mesaj İstatistikleri
        totalMessages: totalCount,
        aiMessages: aiCount,
        humanMessages: Number(humanMsgs[0]?.c || 0),
        
        // Karşılaştırma
        lastMonthTotal: Number(lastMonthTotal[0]?.c || 0),
        growthPercent: lastMonthTotal[0]?.c > 0 
          ? Math.round(((totalCount - Number(lastMonthTotal[0].c)) / Number(lastMonthTotal[0].c)) * 100) 
          : 100,

        // Kanal Dağılımı
        channels: channelBreakdown,

        // Günlük Grafik
        daily: dailyStats.map((d: any) => ({
          day: d.day,
          total: Number(d.total),
          ai: Number(d.ai),
        })),

        // Limitler
        monthlyLimit,
        dailyAiLimit: tenant.daily_ai_limit || 200,
        usagePercent,

        // Maliyet
        estimatedCostUsd: estimatedCost,
      },
    };
  } catch (error: any) {
    console.error("Usage stats error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Platform admin — tüm tenantların kullanım özeti
 */
export async function getAllTenantsUsage() {
  try {
    const session = await getSession();
    if (session?.role !== "owner" && session?.role !== "platform_admin") {
      return { success: false, error: "Yetki yok" };
    }

    const stats = await sql`
      SELECT 
        t.name, t.slug, t.plan, t.status,
        COUNT(m.id) as total_messages,
        COUNT(m.id) FILTER (WHERE m.model_used IS NOT NULL AND m.model_used NOT IN ('panel','mesai-disi','fallback','none','human-telegram','retry')) as ai_messages,
        COUNT(DISTINCT m.phone_number) as unique_contacts,
        MAX(m.created_at) as last_activity
      FROM tenants t
      LEFT JOIN messages m ON m.tenant_id = t.id AND m.created_at >= DATE_TRUNC('month', NOW())
      WHERE t.status = 'active'
      GROUP BY t.id, t.name, t.slug, t.plan, t.status
      ORDER BY total_messages DESC
    `;

    return {
      success: true,
      tenants: stats.map((t: any) => ({
        name: t.name,
        slug: t.slug,
        plan: t.plan,
        totalMessages: Number(t.total_messages),
        aiMessages: Number(t.ai_messages),
        uniqueContacts: Number(t.unique_contacts),
        lastActivity: t.last_activity,
        estimatedCost: (Number(t.ai_messages) * 0.0001).toFixed(4),
      })),
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
