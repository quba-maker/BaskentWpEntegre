"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { NoReplyAutomationService, type NoReplyAutomationSettings } from "@/lib/services/automation/no-reply-automation.service";
import { revalidatePath } from "next/cache";

export async function getNoReplySettingsAction() {
  return withActionGuard(
    { actionName: 'getNoReplySettingsAction' },
    async (ctx) => {
      return await NoReplyAutomationService.getNoReplyAutomationSettings(ctx.db, ctx.tenantId);
    }
  );
}

export async function saveNoReplySettingsAction(input: Partial<NoReplyAutomationSettings>) {
  return withActionGuard(
    { actionName: 'saveNoReplySettingsAction', roles: ['admin', 'owner'] },
    async (ctx) => {
      const updated = await NoReplyAutomationService.updateNoReplyAutomationSettings(ctx.db, ctx.tenantId, input);
      revalidatePath(`/[tenant_slug]/inbox`, 'layout');
      return { success: true, settings: updated };
    }
  );
}

export async function runNoReplyDryRunAction() {
  return withActionGuard(
    { actionName: 'runNoReplyDryRunAction' },
    async (ctx) => {
      return await NoReplyAutomationService.runNoReplyAutomationDryRun(ctx.db, ctx.tenantId);
    }
  );
}

export async function triggerNoReplyTickAction() {
  return withActionGuard(
    { actionName: 'triggerNoReplyTickAction', roles: ['admin', 'owner'] },
    async (ctx) => {
      const result = await NoReplyAutomationService.runNoReplyAutomationTick(ctx.db, ctx.tenantId, { dryRun: false });
      revalidatePath(`/[tenant_slug]/inbox`, 'layout');
      return result;
    }
  );
}
