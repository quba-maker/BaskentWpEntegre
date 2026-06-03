"use server";

import { withActionGuard } from "@/lib/core/action-guard";
import { BotInterventionService, BotInterventionType, BotInterventionError } from "@/lib/services/bot-intervention.service";

export async function triggerBotInterventionAction(
  opportunityId: string, 
  interventionType: BotInterventionType, 
  customInstruction?: string
) {
  if (!opportunityId) return { success: false, error: "Fırsat ID gerekli.", errorCode: 'MISSING_OPPORTUNITY_ID' };

  return withActionGuard(
    { actionName: 'triggerBotInterventionAction' },
    async (ctx) => {
      try {
        const service = new BotInterventionService(ctx.db);
        const result = await service.executeOneShot(
          ctx.userId,
          opportunityId,
          interventionType,
          customInstruction
        );
        return { success: true, messageId: result.messageId, draftMsg: result.draftMsg };
      } catch (err: any) {
        if (err instanceof BotInterventionError) {
          return { success: false, error: err.message, errorCode: err.code };
        }
        console.error('[BotInterventionAction Error]', err);
        return { success: false, error: "Bir hata oluştu.", errorCode: 'INTERNAL_ERROR' };
      }
    }
  ).then((res: any) => {
    if (!res.success) return { success: false, error: res.error, errorCode: res.errorCode };
    if (res.data && !res.data.success) return { success: false, error: res.data.error, errorCode: res.data.errorCode };
    return { success: true, messageId: res.data?.messageId, draftMsg: res.data?.draftMsg };
  }).catch((err: any) => {
    console.error('[triggerBotInterventionAction_CATCH]', err);
    return { success: false, error: "İşlem sırasında beklenmeyen bir hata oluştu.", errorCode: 'UNKNOWN_ERROR' };
  });
}
