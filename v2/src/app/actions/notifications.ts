"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { NotificationService } from "@/lib/services/notification.service";

/**
 * PHASE 2K: Notification server actions
 * Used by NotificationBell component and Takip panel
 */

export async function getUnreadNotifications(limit: number = 10) {
  return withActionGuard(
    { actionName: 'getUnreadNotifications' },
    async (ctx) => {
      const service = new NotificationService(ctx.db);
      return service.getUnread(ctx.tenantId, limit);
    }
  ).then(res => res.data || []);
}

export async function getNotificationCount() {
  return withActionGuard(
    { actionName: 'getNotificationCount' },
    async (ctx) => {
      const service = new NotificationService(ctx.db);
      const count = await service.getUnreadCount(ctx.tenantId);
      return { count };
    }
  ).then(res => res.data?.count ?? 0);
}

export async function markNotificationRead(notificationId: string) {
  return withActionGuard(
    { actionName: 'markNotificationRead' },
    async (ctx) => {
      const service = new NotificationService(ctx.db);
      await service.markRead(notificationId, ctx.tenantId);
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function markAllNotificationsRead() {
  return withActionGuard(
    { actionName: 'markAllNotificationsRead' },
    async (ctx) => {
      const service = new NotificationService(ctx.db);
      await service.markAllRead(ctx.tenantId);
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}
