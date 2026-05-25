"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { OpportunityService } from "@/lib/services/opportunity.service";

export async function getOpportunities(filters?: {
  stage?: string;
  priority?: string;
  department?: string;
  source?: string;
  limit?: number;
  offset?: number;
}) {
  return withActionGuard(
    { actionName: 'getOpportunities' },
    async (ctx) => {
      const service = new OpportunityService(ctx.db);
      return service.list(ctx.tenantId, filters);
    }
  ).then(res => res.data || { items: [], total: 0 });
}

export async function getOpportunityStats() {
  return withActionGuard(
    { actionName: 'getOpportunityStats' },
    async (ctx) => {
      const service = new OpportunityService(ctx.db);
      return service.getStats(ctx.tenantId);
    }
  ).then(res => res.data || { active: 0, hot: 0, overdue: 0, due_today: 0 });
}

export async function updateOpportunityStage(oppId: string, newStage: string, reason?: string) {
  return withActionGuard(
    { actionName: 'updateOpportunityStage' },
    async (ctx) => {
      const service = new OpportunityService(ctx.db);
      await service.updateStage(ctx.tenantId, oppId, newStage, reason);
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}

export async function addOpportunityNote(oppId: string, text: string) {
  return withActionGuard(
    { actionName: 'addOpportunityNote' },
    async (ctx) => {
      const service = new OpportunityService(ctx.db);
      await service.addNote(ctx.tenantId, oppId, "Admin", text);
      return { success: true };
    }
  ).then(res => {
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  });
}
