import { toolRegistry } from "../core/tool-registry";
import { getPriceQuoteTool } from "./pricing/get-price-quote";
import { escalateToHumanTool } from "./crm/escalate-to-human";

/**
 * 🧰 Bootstrapper for AI Tools
 * Registers all available tools into the global registry.
 */
export function registerAllTools() {
  // Prevent duplicate registration if called multiple times in Serverless environments
  if (toolRegistry.getDefinitionsForLLM().length === 0) {
    toolRegistry.register(getPriceQuoteTool);
    toolRegistry.register(escalateToHumanTool);
    console.log("✅ All Agentic Tools registered successfully.");
  }
}
