import { toolRegistry, ToolContext } from "./tool-registry";
import { logger } from "@/lib/core/logger";

/**
 * ⚡️ Tool Executor
 * Enforces strict validation, timeouts, and auditing before any tool is run.
 * AI Intention -> Validation Layer -> Execution
 */
export class ToolExecutor {
  private log = logger.withContext({ module: 'ToolExecutor' });

  public async executeTool(
    toolName: string, 
    args: any, 
    context: ToolContext
  ): Promise<any> {
    const tool = toolRegistry.get(toolName);
    
    if (!tool) {
      this.log.warn(`AI attempted to call an unknown tool: ${toolName}`);
      throw new Error(`Tool [${toolName}] not found.`);
    }

    // 1. Permission Check
    // Implement robust permission validation against the Tenant settings here
    if (!this.checkPermissions(tool.permissions, context)) {
      this.log.warn(`Permission denied for tool: ${toolName}`, { tenantId: context.tenantId });
      throw new Error(`Permission denied for tool: ${toolName}`);
    }

    // 2. Schema Validation (Crucial to prevent Hallucination side-effects)
    let validatedArgs: any;
    try {
      validatedArgs = tool.schema.parse(args);
    } catch (err: any) {
      this.log.warn(`AI hallucinated invalid arguments for tool: ${toolName}`, { args, err: err.errors });
      throw new Error(`Invalid arguments provided for tool [${toolName}]. Validation failed.`);
    }

    // 3. Execution with Timeout & Audit
    this.log.info(`Executing tool: ${toolName}`, { tenantId: context.tenantId, args: validatedArgs });
    
    const timeoutMs = tool.timeoutMs || 10000; // Default 10s
    
    try {
      const result = await this.withTimeout(
        tool.execute(validatedArgs, context),
        timeoutMs
      );
      
      this.log.info(`Tool executed successfully: ${toolName}`);
      return result;
    } catch (error: any) {
      this.log.error(`Tool execution failed: ${toolName}`, error);
      throw error;
    }
  }

  private checkPermissions(requiredPermissions: string[], context: ToolContext): boolean {
    // TODO: Connect this to the actual Feature Flag / Settings system
    // Example: if tool needs 'appointments_write', check if tenant has it enabled.
    return true; 
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`Execution timed out after ${ms}ms`)), ms)
      )
    ]);
  }
}

export const toolExecutor = new ToolExecutor();
