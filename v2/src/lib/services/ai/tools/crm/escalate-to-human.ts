import { z } from "zod";
import { ToolDefinition } from "../../core/tool-registry";
import { sql } from "@/lib/db";

export const escalateToHumanTool: ToolDefinition = {
  name: "escalate_to_human",
  description: "Triggers a human handover. Use this when the user is angry, asking complex questions that you cannot answer, or specifically requesting to speak with a human.",
  schema: z.object({
    reason: z.string().describe("The reason why human escalation is required"),
    urgency: z.enum(["low", "medium", "high", "critical"]).describe("The priority of this handover"),
  }),
  permissions: ["handoff_write"],
  execute: async (args, context) => {
    // 1. Update the conversation status to 'human' in the database
    await sql`
      UPDATE conversations
      SET 
        status = 'human',
        updated_at = NOW()
      WHERE 
        phone_number = ${context.phoneNumber} 
        AND tenant_id = ${context.tenantId}
    `;

    // 2. Here, you could also trigger an event to Slack/WhatsApp/Email notifications via QStash
    // e.g., await publishEvent('tenant.notification', { type: 'handoff', phone: context.phoneNumber, reason: args.reason })

    return {
      status: "success",
      action_taken: "Conversation has been successfully frozen for the bot and transferred to a human agent.",
      instructions_for_ai: "Tell the user politely that a human agent has been notified and will contact them shortly. Do not attempt to answer further domain questions."
    };
  }
};
