"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { TaskService, type TaskFilters, type TaskType } from "@/lib/services/task.service";

/**
 * PHASE 2K: Task server actions
 * Used by Takip Merkezi Görevler tab
 */

// ── QUERIES ──

export async function getFollowUpTasks(filters?: TaskFilters) {
  return withActionGuard(
    { actionName: 'getFollowUpTasks' },
    async (ctx) => {
      const service = new TaskService(ctx.db);
      return service.list(ctx.tenantId, filters);
    }
  ).then(res => res.data || { items: [], total: 0 });
}

export async function getTaskStats() {
  return withActionGuard(
    { actionName: 'getTaskStats' },
    async (ctx) => {
      const service = new TaskService(ctx.db);
      return service.getStats(ctx.tenantId);
    }
  ).then(res => res.data || { total: 0, pending: 0, overdue: 0, dueToday: 0, completed: 0, cancelled: 0, skipped: 0 });
}

// ── MUTATIONS ──

export async function createManualTask(input: {
  phoneNumber: string;
  taskType: TaskType;
  title: string;
  description?: string;
  dueAt: string;
  opportunityId?: string;
  conversationId?: string;
}) {
  return withActionGuard(
    { actionName: 'createManualTask' },
    async (ctx) => {
      const service = new TaskService(ctx.db);
      const id = await service.create({
        tenantId: ctx.tenantId,
        phoneNumber: input.phoneNumber,
        taskType: input.taskType,
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        opportunityId: input.opportunityId,
        conversationId: input.conversationId,
        createdBy: ctx.userId || 'manual',
        isAutomated: false,
      });
      return { success: true, taskId: id };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return res.data || { success: true };
  });
}

export async function completeTask(taskId: string, note?: string) {
  return withActionGuard(
    { actionName: 'completeTask' },
    async (ctx) => {
      const service = new TaskService(ctx.db);
      await service.complete(taskId, ctx.tenantId, note, ctx.userId);
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function cancelTask(taskId: string, reason?: string) {
  return withActionGuard(
    { actionName: 'cancelTask' },
    async (ctx) => {
      const service = new TaskService(ctx.db);
      await service.cancel(taskId, ctx.tenantId, reason || 'manual_cancel');
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function rescheduleTask(taskId: string, newDueAt: string) {
  return withActionGuard(
    { actionName: 'rescheduleTask' },
    async (ctx) => {
      const service = new TaskService(ctx.db);
      await service.reschedule(taskId, ctx.tenantId, newDueAt);
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}
