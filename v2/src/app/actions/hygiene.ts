"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { getTelegramChannelConfig } from "@/app/actions/notification-channels";
import { logger } from "@/lib/core/logger";

const log = logger.withContext({ module: 'HygieneActions' });

export interface SystemHealthResponse {
  qstash: {
    configured: boolean;
    hasToken: boolean;
    hasScheduleId: boolean;
    scheduleIdMasked?: string;
    status: 'active' | 'missing' | 'unknown';
    message: string;
  };
  telegram: {
    configured: boolean;
    enabled: boolean;
    hasToken: boolean;
    hasChatId: boolean;
    status: 'active' | 'disabled' | 'missing' | 'unknown';
    message: string;
  };
  automation: {
    activeRuleCount: number;
    totalRuleCount: number;
    archivedRuleCount: number;
    lastRunAt?: string;
    failedRuns24h: number;
    skippedRuns24h: number;
  };
}

export async function getAutomationSystemHealth(): Promise<SystemHealthResponse> {
  return withActionGuard<SystemHealthResponse>(
    { actionName: 'getAutomationSystemHealth' },
    async (ctx) => {
      // 1. Evaluate QStash Health
      const hasQStashToken = !!process.env.QSTASH_TOKEN;
      const qstashScheduleId = process.env.QSTASH_SCHEDULE_ID || "";
      const hasScheduleId = qstashScheduleId.trim() !== "";
      
      const qstashConfigured = hasQStashToken && hasScheduleId;
      let qstashStatus: 'active' | 'missing' | 'unknown' = 'unknown';
      let qstashMessage = "Durum doğrulanamadı ⚪";

      if (!hasQStashToken) {
        qstashStatus = 'missing';
        qstashMessage = "QStash token eksik 🟡";
      } else if (!hasScheduleId) {
        qstashStatus = 'missing';
        qstashMessage = "QStash Schedule ID eksik 🟡";
      } else {
        qstashStatus = 'active';
        qstashMessage = "QStash Zamanlayıcı Aktif 🟢";
      }

      const scheduleIdMasked = hasScheduleId 
        ? `${qstashScheduleId.substring(0, 4)}...${qstashScheduleId.substring(Math.max(0, qstashScheduleId.length - 4))}`
        : undefined;

      // 2. Evaluate Telegram Health (Tenant Isolated)
      let telegramConfigured = false;
      let telegramEnabled = false;
      let hasTelegramToken = false;
      let hasTelegramChatId = false;
      let telegramStatus: 'active' | 'disabled' | 'missing' | 'unknown' = 'unknown';
      let telegramMessage = "Durum doğrulanamadı ⚪";

      try {
        const tgRes = await getTelegramChannelConfig();
        if (tgRes.success && tgRes.config) {
          telegramEnabled = tgRes.config.isEnabled;
          hasTelegramToken = tgRes.config.hasToken;
          hasTelegramChatId = !!tgRes.config.chatId && tgRes.config.chatId.trim() !== "";
          telegramConfigured = hasTelegramToken && hasTelegramChatId;

          if (!telegramEnabled) {
            telegramStatus = 'disabled';
            telegramMessage = "Telegram Kanalı Kapalı 🟡";
          } else if (!hasTelegramToken) {
            telegramStatus = 'missing';
            telegramMessage = "Telegram Token Eksik 🟠";
          } else if (!hasTelegramChatId) {
            telegramStatus = 'missing';
            telegramMessage = "Telegram Chat ID Eksik 🟠";
          } else {
            telegramStatus = 'active';
            telegramMessage = "Telegram Bildirimleri Aktif 🟢";
          }
        }
      } catch (err: any) {
        log.error("Failed to query Telegram configuration for health check", err);
      }

      // 3. Evaluate DB Rules & Runs stats (Tenant Isolated)
      let activeRuleCount = 0;
      let totalRuleCount = 0;
      let archivedRuleCount = 0;
      let lastRunAt: string | undefined = undefined;
      let failedRuns24h = 0;
      let skippedRuns24h = 0;

      try {
        // Active & Total rules count
        const rulesCountRes = await ctx.db.executeSafe({
          text: `SELECT 
                   COUNT(*) FILTER (WHERE metadata->>'archived_at' IS NULL) as total,
                   COUNT(*) FILTER (WHERE is_active = true AND metadata->>'archived_at' IS NULL) as active,
                   COUNT(*) FILTER (WHERE metadata->>'archived_at' IS NOT NULL) as archived
                 FROM automation_rules 
                 WHERE tenant_id = $1`,
          values: [ctx.tenantId]
        }) as any[];

        if (rulesCountRes.length > 0) {
          totalRuleCount = parseInt(rulesCountRes[0].total || "0");
          activeRuleCount = parseInt(rulesCountRes[0].active || "0");
          archivedRuleCount = parseInt(rulesCountRes[0].archived || "0");
        }

        // Runs count last 24h & last run at timestamp
        const runsStatsRes = await ctx.db.executeSafe({
          text: `SELECT 
                   COUNT(*) FILTER (WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours') as failed,
                   COUNT(*) FILTER (WHERE status = 'skipped' AND created_at > NOW() - INTERVAL '24 hours') as skipped,
                   MAX(created_at) as last_run
                 FROM automation_runs 
                 WHERE tenant_id = $1`,
          values: [ctx.tenantId]
        }) as any[];

        if (runsStatsRes.length > 0) {
          failedRuns24h = parseInt(runsStatsRes[0].failed || "0");
          skippedRuns24h = parseInt(runsStatsRes[0].skipped || "0");
          lastRunAt = runsStatsRes[0].last_run ? new Date(runsStatsRes[0].last_run).toISOString() : undefined;
        }

      } catch (err: any) {
        log.error("Failed to query database rule statistics for health check", err);
      }

      return {
        qstash: {
          configured: qstashConfigured,
          hasToken: hasQStashToken,
          hasScheduleId,
          scheduleIdMasked,
          status: qstashStatus,
          message: qstashMessage
        },
        telegram: {
          configured: telegramConfigured,
          enabled: telegramEnabled,
          hasToken: hasTelegramToken,
          hasChatId: hasTelegramChatId,
          status: telegramStatus,
          message: telegramMessage
        },
        automation: {
          activeRuleCount,
          totalRuleCount,
          archivedRuleCount,
          lastRunAt,
          failedRuns24h,
          skippedRuns24h
        }
      };
    }
  ).then(res => {
    if (!res.success) {
      throw new Error(res.error || "Sistem sağlık kontrolü başarısız.");
    }
    return res.data!;
  });
}
