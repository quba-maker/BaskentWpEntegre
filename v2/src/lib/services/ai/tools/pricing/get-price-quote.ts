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
    // In a real scenario, this might call an external CRM or query the database directly.
    // For now, we simulate fetching from the tenant's knowledge settings.
    
    // Safety check - force query strictly within tenant scope
    const db = withTenantDB(context.tenantId);
    const res = await db.executeSafe({
      text: `
        SELECT value FROM settings 
        WHERE key = 'bot_knowledge_prices' 
          AND tenant_id = $1
      `,
      values: [context.tenantId]
    }) as any[];

    if (!res || res.length === 0 || !res[0].value) {
      return { 
        status: "success", 
        data: "No specific pricing information is currently available. Please advise the user that a human agent will contact them for a custom quote." 
      };
    }

    // You can implement advanced searching here, but returning the raw string is fine for LLM to summarize
    return {
      status: "success",
      data: res[0].value
    };
  }
};
