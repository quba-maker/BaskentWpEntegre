/**
 * PHASE 2K: Notification Hub
 * 
 * P0: Panel-only (DB write). P1: + Telegram dispatch. P3: + Email/Push.
 * 
 * The service writes to the `notifications` table and in future phases
 * will dispatch to external channels via `notification_channels` config.
 */

import type { TenantDB } from '@/lib/core/tenant-db';

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
   * P0: Writes to DB only (panel channel).
   * P1: Will also dispatch to Telegram, etc.
   */
  async send(input: NotificationInput): Promise<string> {
    const channelsSent = ['panel']; // P1: add 'telegram', 'email', etc.

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

    // P1: Telegram dispatch would go here
    // if (channelConfig.telegram?.enabled) {
    //   await TelegramService.sendNotification(...)
    // }

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
