/**
 * PHASE 2K: Notification Hub
 * 
 * P0: Panel-only (DB write).
 * P1: + Telegram dispatch via TelegramService.
 * P2: + Email/Push.
 * 
 * Dispatch Order:
 * 1. Always INSERT to notifications table first (panel channel)
 * 2. Fetch active notification_channels for tenant
 * 3. Dispatch to each channel (non-fatal)
 * 4. Update channels_sent with actual dispatch results
 * 5. Log any dispatch errors to metadata.dispatch_errors
 * 
 * Telegram failure NEVER blocks panel notification.
 */

import type { TenantDB } from '@/lib/core/tenant-db';
import { logger } from '@/lib/core/logger';

const log = logger.withContext({ module: 'NotificationService' });

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export type NotificationCategory =
  | 'hot_lead'
  | 'appointment_request'
  | 'report_received'
  | 'appointment_approaching'
  | 'overdue_task'
  | 'no_response'
  | 'bot_error'
  | 'coordinator_action'
  | 'callback_requested'
  | 'human_escalation'
  | 'system_alert';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';

export interface NotificationInput {
  tenantId: string;
  recipientType?: string;         // 'coordinator' | 'doctor' | 'admin'
  recipientId?: string;           // null = broadcast to all
  category: NotificationCategory;
  title: string;
  body: string;
  priority?: NotificationPriority;
  opportunityId?: string;
  taskId?: string;
  conversationId?: string;
  phoneNumber?: string;
  metadata?: Record<string, any>;
}

export interface Notification {
  id: string;
  tenant_id: string;
  recipient_type: string;
  recipient_id: string | null;
  category: NotificationCategory;
  title: string;
  body: string;
  opportunity_id: string | null;
  task_id: string | null;
  conversation_id: string | null;
  phone_number: string | null;
  channels_sent: string[];
  is_read: boolean;
  read_at: string | null;
  priority: NotificationPriority;
  metadata: Record<string, any>;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════

export class NotificationService {
  constructor(private db: TenantDB) {}

  /**
   * Send a notification.
   * 1. Always writes to DB first (panel channel).
   * 2. Dispatches to active external channels (Telegram, etc.) — non-fatal.
   * 3. Updates channels_sent and dispatch_errors after dispatch.
   */
  async send(input: NotificationInput): Promise<string> {
    const channelsSent = ['panel'];
    const dispatchErrors: Record<string, string> = {};

    // ── STEP 1: Panel DB insert (always first, never fails silently) ──
    const rows = await this.db.executeSafe({
      text: `INSERT INTO notifications (
               tenant_id, recipient_type, recipient_id,
               category, title, body,
               opportunity_id, task_id, conversation_id, phone_number,
               channels_sent, priority, metadata
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb)
             RETURNING id`,
      values: [
        input.tenantId,
        input.recipientType || 'coordinator',
        input.recipientId || null,
        input.category,
        input.title,
        input.body,
        input.opportunityId || null,
        input.taskId || null,
        input.conversationId || null,
        input.phoneNumber || null,
        JSON.stringify(channelsSent),
        input.priority || 'normal',
        JSON.stringify(input.metadata || {}),
      ]
    }) as any[];

    const notificationId = rows[0]?.id;

    // ── STEP 2: Dispatch to external channels (non-fatal) ──
    try {
      const channels = await this.db.executeSafe({
        text: `SELECT * FROM notification_channels 
               WHERE tenant_id = $1 AND is_enabled = true`,
        values: [input.tenantId]
      }) as any[];

      if (channels && channels.length > 0) {
        // Dynamic import to avoid circular deps and reduce cold start
        const { TelegramService } = await import('./telegram.service');

        for (const channel of channels) {
          if (channel.channel_type === 'telegram') {
            try {
              // Check category + priority filters
              if (!TelegramService.shouldDispatch(
                channel,
                input.category,
                (input.priority || 'normal') as NotificationPriority
              )) {
                log.info('[TELEGRAM_FILTERED] Notification filtered by category/priority', {
                  category: input.category,
                  priority: input.priority,
                  notificationId,
                });
                continue;
              }

              // Resolve config (decrypt bot token)
              const config = TelegramService.resolveConfig(channel);
              if (!config) {
                dispatchErrors['telegram'] = 'Config resolution failed — missing botToken or chatId';
                log.warn('[TELEGRAM_NO_CONFIG]', { tenantId: input.tenantId, notificationId });
                continue;
              }

              // Dispatch
              const result = await TelegramService.sendNotification(config, input);
              if (result.success) {
                channelsSent.push('telegram');
                log.info('[TELEGRAM_DISPATCHED]', {
                  notificationId,
                  telegramMessageId: result.messageId,
                  category: input.category,
                });
              } else {
                dispatchErrors['telegram'] = result.error || 'Unknown Telegram error';
                log.warn('[TELEGRAM_DISPATCH_FAILED]', {
                  notificationId,
                  error: result.error,
                });
              }
            } catch (telegramErr) {
              const errMsg = telegramErr instanceof Error ? telegramErr.message : String(telegramErr);
              dispatchErrors['telegram'] = errMsg;
              log.error('[TELEGRAM_DISPATCH_ERROR] Non-fatal',
                telegramErr instanceof Error ? telegramErr : new Error(errMsg),
                { notificationId }
              );
            }
          }
          // P2: email, push, etc. channels would go here
        }
      }
    } catch (channelErr) {
      // notification_channels table might not exist yet on older deployments
      log.warn('[NOTIFICATION_CHANNELS_QUERY_FAILED] Non-fatal — table may not exist yet', {
        error: channelErr instanceof Error ? channelErr.message : String(channelErr),
        notificationId,
      });
    }

    // ── STEP 3: Update channels_sent + dispatch_errors ──
    if (channelsSent.length > 1 || Object.keys(dispatchErrors).length > 0) {
      try {
        const updatedMetadata = {
          ...(input.metadata || {}),
          ...(Object.keys(dispatchErrors).length > 0 ? { dispatch_errors: dispatchErrors } : {}),
        };

        await this.db.executeSafe({
          text: `UPDATE notifications 
                 SET channels_sent = $1::jsonb, metadata = $2::jsonb
                 WHERE id = $3 AND tenant_id = $4`,
          values: [
            JSON.stringify(channelsSent),
            JSON.stringify(updatedMetadata),
            notificationId,
            input.tenantId,
          ]
        });
      } catch (updateErr) {
        // Non-fatal — notification already exists in DB
        log.warn('[NOTIFICATION_UPDATE_FAILED] Non-fatal channels_sent update', {
          notificationId,
          error: updateErr instanceof Error ? updateErr.message : String(updateErr),
        });
      }
    }

    return notificationId;
  }

  /**
   * Get unread notifications for tenant.
   */
  async getUnread(tenantId: string, limit: number = 20): Promise<Notification[]> {
    return await this.db.executeSafe({
      text: `SELECT * FROM notifications 
             WHERE tenant_id = $1 AND is_read = false
             ORDER BY 
               CASE priority 
                 WHEN 'critical' THEN 0 
                 WHEN 'high' THEN 1 
                 WHEN 'normal' THEN 2 
                 ELSE 3 
               END,
               created_at DESC
             LIMIT $2`,
      values: [tenantId, limit]
    }) as any[];
  }

  /**
   * Get unread count for notification bell badge.
   */
  async getUnreadCount(tenantId: string): Promise<number> {
    const rows = await this.db.executeSafe({
      text: `SELECT COUNT(*) as c FROM notifications 
             WHERE tenant_id = $1 AND is_read = false`,
      values: [tenantId]
    }) as any[];

    return parseInt(rows[0]?.c) || 0;
  }

  /**
   * Get all notifications (paginated, for full notification panel).
   */
  async list(tenantId: string, limit: number = 30, offset: number = 0): Promise<{ items: Notification[]; total: number }> {
    const items = await this.db.executeSafe({
      text: `SELECT * FROM notifications 
             WHERE tenant_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
      values: [tenantId, limit, offset]
    }) as any[];

    const countRows = await this.db.executeSafe({
      text: `SELECT COUNT(*) as total FROM notifications WHERE tenant_id = $1`,
      values: [tenantId]
    }) as any[];

    return {
      items: items as Notification[],
      total: parseInt(countRows[0]?.total) || 0,
    };
  }

  /**
   * Mark a single notification as read.
   */
  async markRead(notificationId: string, tenantId: string): Promise<void> {
    await this.db.executeSafe({
      text: `UPDATE notifications 
             SET is_read = true, read_at = NOW()
             WHERE id = $1 AND tenant_id = $2`,
      values: [notificationId, tenantId]
    });
  }

  /**
   * Mark all notifications as read for tenant.
   */
  async markAllRead(tenantId: string): Promise<void> {
    await this.db.executeSafe({
      text: `UPDATE notifications 
             SET is_read = true, read_at = NOW()
             WHERE tenant_id = $1 AND is_read = false`,
      values: [tenantId]
    });
  }
}
