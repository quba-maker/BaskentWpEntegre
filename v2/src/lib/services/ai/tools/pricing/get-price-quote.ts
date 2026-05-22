import { z } from "zod";
import { ToolDefinition } from "../../core/tool-registry";
import { withTenantDB } from "@/lib/core/tenant-db";

export const getPriceQuoteTool: ToolDefinition = {
  name: "get_price_quote",
  description: "Fetches live price quotes or service information for a specific department or treatment. Use this when the user asks about the price of a service.",
  schema: z.object({
    department: z.string().describe("The medical or service department, e.g., 'hair_transplant', 'dental', 'aesthetic'"),
    service_name: z.string().optional().describe("Specific service name if mentioned by the user"),
  }),
  permissions: ["pricing_read"],
  execute: async (args, context) => {
    // V2: Read from channel_prompts.knowledge_prices via channel_prompt_bindings
    const db = withTenantDB(context.tenantId);

    let knowledgePrices: string | null = null;

    // Strategy 1: If conversationId exists, try to find the channel and its bound prompt
    if (context.conversationId) {
      try {
        const convChannel = await db.executeSafe({
          text: `SELECT c.id as channel_id
                 FROM conversations conv
                 JOIN channels c ON conv.channel_id = c.id
                 JOIN channel_groups cg ON c.group_id = cg.id
                 WHERE conv.id = $1 AND cg.tenant_id = $2
                 LIMIT 1`,
          values: [context.conversationId, context.tenantId]
        }) as any[];

        if (convChannel.length > 0) {
          const channelPrices = await db.executeSafe({
            text: `SELECT cp.knowledge_prices
                   FROM channel_prompt_bindings cpb
                   JOIN channel_prompts cp ON cpb.prompt_id = cp.id
                   WHERE cpb.channel_id = $1
                     AND cpb.is_active = true
                     AND cp.prompt_type = 'system'
                     AND cp.tenant_id = $2
                   ORDER BY cpb.priority ASC
                   LIMIT 1`,
            values: [convChannel[0].channel_id, context.tenantId]
          }) as any[];

          if (channelPrices.length > 0 && channelPrices[0].knowledge_prices) {
            knowledgePrices = channelPrices[0].knowledge_prices;
          }
        }
      } catch (e) {
        // Non-fatal: fall through to tenant-wide fallback
      }
    }

    // Strategy 2: Fallback — get knowledge_prices from any active WhatsApp prompt for this tenant
    if (!knowledgePrices) {
      try {
        const fallback = await db.executeSafe({
          text: `SELECT cp.knowledge_prices
                 FROM channel_prompts cp
                 WHERE cp.tenant_id = $1
                   AND cp.prompt_type = 'system'
                   AND cp.knowledge_prices IS NOT NULL
                   AND cp.knowledge_prices != ''
                 ORDER BY cp.updated_at DESC
                 LIMIT 1`,
          values: [context.tenantId]
        }) as any[];

        if (fallback.length > 0) {
          knowledgePrices = fallback[0].knowledge_prices;
        }
      } catch (e) {
        // Non-fatal
      }
    }

    if (!knowledgePrices) {
      return { 
        status: "success", 
        data: "No specific pricing information is currently available. Please advise the user that a human agent will contact them for a custom quote." 
      };
    }

    return {
      status: "success",
      data: knowledgePrices
    };
  }
};
